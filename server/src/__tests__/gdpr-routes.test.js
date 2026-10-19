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
import logger from '../logger.js'
import gdprRouter from '../routes/gdpr.js'

const createApp = () => {
  const app = express()
  app.use(express.json())
  app.use(gdprRouter)
  return app
}

const app = createApp()

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/data/erase/request', () => {
  it('создаёт запрос с токеном-32-байтом в hex и статусом pending', async () => {
    pool.query.mockResolvedValue([{ insertId: 1 }])
    const res = await request(app).post('/api/data/erase/request').send({})

    expect(res.status).toBe(200)
    expect(res.body.message).toContain('Confirm within 24h')
    expect(res.body.token).toMatch(/^[0-9a-f]{64}$/)

    const [sql, params] = pool.query.mock.calls[0]
    expect(sql).toContain('INSERT INTO data_erase_requests')
    expect(params[0]).toBe(1)
    expect(params[1]).toBe(res.body.token)
    expect(params[2]).toBe('pending')
    expect(logger.info).toHaveBeenCalledWith('Erase request created', { userId: 1 })
  })

  it('дубликат (ER_DUP_ENTRY, MySQL 1062) → 409 без записи в лог ошибок', async () => {
    const dup = Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' })
    pool.query.mockRejectedValue(dup)
    const res = await request(app).post('/api/data/erase/request').send({})

    expect(res.status).toBe(409)
    expect(res.body.message).toBe('Erase request already exists')
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('прочая ошибка БД → 500 с записью в лог', async () => {
    pool.query.mockRejectedValue(new Error('boom'))
    const res = await request(app).post('/api/data/erase/request').send({})

    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to create erase request')
    expect(logger.error).toHaveBeenCalled()
  })
})

describe('POST /api/data/erase/confirm — вход и ошибки', () => {
  it('без токена → 400 и БД не трогается', async () => {
    const res = await request(app).post('/api/data/erase/confirm').send({})

    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Token is required')
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('падение БД → 500 «Failed to erase account»', async () => {
    pool.query.mockRejectedValue(new Error('boom'))
    const res = await request(app).post('/api/data/erase/confirm').send({ token: 'tok' })

    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to erase account')
    expect(logger.error).toHaveBeenCalled()
  })

  it('полное стирание: все таблицы очищены, users обезличен, запрос completed', async () => {
    const deleted = []
    pool.query.mockImplementation(async (sql) => {
      if (/FROM data_erase_requests/.test(sql)) return [[{ id: 55, status: 'pending' }]]
      if (/DELETE FROM user_photos/.test(sql)) return [{ affectedRows: 0 }]
      if (/^DELETE FROM/.test(sql)) {
        deleted.push(sql.replace(/DELETE FROM (\w+).*/, '$1'))
        return [{ affectedRows: 1 }]
      }
      return [{ affectedRows: 1 }]
    })
    const res = await request(app).post('/api/data/erase/confirm').send({ token: 'tok' })

    expect(res.status).toBe(200)
    expect(res.body.message).toBe('Account erased successfully')
    expect(deleted).toEqual([
      'user_interests', 'likes', 'messages', 'notifications', 'activity_log',
      'consent_log', 'push_subscriptions', 'refresh_tokens', 'user_profiles', 'subscriptions',
    ])

    const anon = pool.query.mock.calls.find((c) => typeof c[0] === 'string' && c[0].includes('UPDATE users SET email'))
    expect(anon).toBeTruthy()
    expect(anon[1]).toEqual([1])

    const completed = pool.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes("UPDATE data_erase_requests SET status = ?") && c[1][0] === 'completed',
    )
    expect(completed).toBeTruthy()
    expect(completed[1][1]).toBe(55)
    expect(logger.info).toHaveBeenCalledWith('Account erased', { userId: 1 })
  })

  it('при удалённых фото пишется аудит delete_bulk с count', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (/FROM data_erase_requests/.test(sql)) return [[{ id: 55, status: 'pending' }]]
      if (/DELETE FROM user_photos/.test(sql)) return [{ affectedRows: 4 }]
      return [{ affectedRows: 1 }]
    })
    const res = await request(app).post('/api/data/erase/confirm').send({ token: 'tok' })

    expect(res.status).toBe(200)
    const audit = pool.query.mock.calls.find((c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO audit_log'))
    expect(audit).toBeTruthy()
    expect(audit[1][0]).toBe('user_photos')
    expect(audit[1][2]).toBe('delete_bulk')
    expect(JSON.parse(audit[1][3])).toEqual({ user_id: 1, count: 4 })
  })
})

describe('POST /api/consent', () => {
  it('записывает согласие с true → 201 и granted=1', async () => {
    pool.query.mockResolvedValue([{ insertId: 1 }])
    const res = await request(app).post('/api/consent').send({ consent_type: 'data_processing', granted: true })

    expect(res.status).toBe(201)
    expect(res.body.message).toBe('Consent recorded')
    const [sql, params] = pool.query.mock.calls[0]
    expect(sql).toContain('INSERT INTO consent_log')
    expect(params[0]).toBe(1)
    expect(params[1]).toBe('data_processing')
    expect(params[2]).toBe(1)
  })

  it('granted=false → granted=0', async () => {
    pool.query.mockResolvedValue([{ insertId: 1 }])
    const res = await request(app).post('/api/consent').send({ consent_type: 'marketing', granted: false })

    expect(res.status).toBe(201)
    expect(pool.query.mock.calls[0][1][2]).toBe(0)
  })

  it('пустой consent_type → 400 без записи в БД', async () => {
    const res = await request(app).post('/api/consent').send({ consent_type: '   ', granted: true })

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('required')
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('granted отсутствует → 400 без записи в БД', async () => {
    const res = await request(app).post('/api/consent').send({ consent_type: 'data_processing' })

    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('нестроковый consent_type (число) приводится к строке и принимается', async () => {
    pool.query.mockResolvedValue([{ insertId: 1 }])
    const res = await request(app).post('/api/consent').send({ consent_type: 42, granted: true })

    expect(res.status).toBe(201)
    expect(pool.query.mock.calls[0][1][1]).toBe('42')
  })

  it('consent_type=null → 400 (textField → undefined → пустой)', async () => {
    const res = await request(app).post('/api/consent').send({ consent_type: null, granted: true })

    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('падение БД → 500', async () => {
    pool.query.mockRejectedValue(new Error('boom'))
    const res = await request(app).post('/api/consent').send({ consent_type: 'data_processing', granted: true })

    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to record consent')
    expect(logger.error).toHaveBeenCalled()
  })
})

describe('GET /api/consent/history', () => {
  it('отдаёт историю согласий пользователя с лимитом 50', async () => {
    const rows = [{ id: 1, consent_type: 'data_processing', granted: 1, ip_address: '127.0.0.1', created_at: '2026-01-01' }]
    pool.query.mockResolvedValue([rows])
    const res = await request(app).get('/api/consent/history')

    expect(res.status).toBe(200)
    expect(res.body).toEqual(rows)
    const [sql, params] = pool.query.mock.calls[0]
    expect(sql).toContain('FROM consent_log WHERE user_id = ?')
    expect(sql).toContain('LIMIT 50')
    expect(params).toEqual([1])
  })

  it('падение БД → 500', async () => {
    pool.query.mockRejectedValue(new Error('boom'))
    const res = await request(app).get('/api/consent/history')

    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to fetch consent history')
    expect(logger.error).toHaveBeenCalled()
  })
})
