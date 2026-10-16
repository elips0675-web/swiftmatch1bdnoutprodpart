import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('../middleware.js', () => ({
  auth: (req, _res, next) => {
    req.userId = 1
    next()
  },
}))

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }))

import pool from '../db.js'
import gdprRouter from '../routes/gdpr.js'

const createApp = () => {
  const app = express()
  app.use(express.json())
  app.use(gdprRouter)
  return app
}

const app = createApp()

const auditCalls = () => pool.query.mock.calls.filter(([sql]) => /INSERT INTO audit_log/.test(sql))

function mockErase({ requestFound = true, affectedPhotos = 2 } = {}) {
  pool.query.mockImplementation(async (sql) => {
    if (/FROM data_erase_requests/.test(sql)) return [requestFound ? [{ id: 55, status: 'pending' }] : []]
    if (/DELETE FROM user_photos/.test(sql)) return [{ affectedRows: affectedPhotos }]
    return [{ affectedRows: 1 }]
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/data/erase/confirm — след аудита удаления фото', () => {
  it('удаление user_photos попадает в audit_log (delete_bulk + count)', async () => {
    mockErase({ affectedPhotos: 3 })
    const res = await request(app).post('/api/data/erase/confirm').send({ token: 'tok-1' })

    expect(res.status).toBe(200)
    expect(res.body.message).toBe('Account erased successfully')

    const calls = auditCalls()
    expect(calls).toHaveLength(1)
    const params = calls[0][1]
    expect(params[0]).toBe('user_photos')
    expect(params[1]).toBe(null)
    expect(params[2]).toBe('delete_bulk')
    expect(JSON.parse(params[3])).toEqual({ user_id: 1, count: 3 })
    expect(params[5]).toBe(1)
  })

  it('нет фото — нет записи аудита (пустой delete_bulk не плодим)', async () => {
    mockErase({ affectedPhotos: 0 })
    const res = await request(app).post('/api/data/erase/confirm').send({ token: 'tok-2' })

    expect(res.status).toBe(200)
    expect(auditCalls()).toHaveLength(0)
  })

  it('неверный или истёкший токен — 404 и ни одной записи аудита', async () => {
    mockErase({ requestFound: false })
    const res = await request(app).post('/api/data/erase/confirm').send({ token: 'bad' })

    expect(res.status).toBe(404)
    expect(auditCalls()).toHaveLength(0)
  })
})
