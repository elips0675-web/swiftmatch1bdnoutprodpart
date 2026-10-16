vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }))

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import pool from '../db.js'
import { rootLogger } from '../logger.js'
import referralRoutes from '../routes/referral.js'

const app = express()
app.use(express.json())
app.use(referralRoutes)

function token(userId = 1) {
  return jwt.sign({ userId, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '1h' })
}

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockReset()
})

describe('GET /api/referral/code', () => {
  it('401 без токена', async () => {
    const res = await request(app).get('/api/referral/code')
    expect(res.status).toBe(401)
  })

  it('отдаёт существующий код, не переписывая его', async () => {
    pool.query.mockResolvedValueOnce([[{ referral_code: 'abc12345' }], []])
    const res = await request(app).get('/api/referral/code').set('Authorization', `Bearer ${token()}`)
    expect(res.status).toBe(200)
    expect(res.body.code).toBe('abc12345')
    expect(pool.query).toHaveBeenCalledTimes(1)
  })

  it('генерирует 8 hex-символов и сохраняет код, если его нет', async () => {
    pool.query
      .mockResolvedValueOnce([[{ referral_code: null }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
    const res = await request(app).get('/api/referral/code').set('Authorization', `Bearer ${token(7)}`)
    expect(res.status).toBe(200)
    expect(res.body.code).toMatch(/^[a-f0-9]{8}$/)
    const [sql, params] = pool.query.mock.calls[1]
    expect(String(sql)).toMatch(/UPDATE users SET referral_code = \?/)
    expect(params).toEqual([res.body.code, 7])
  })

  it('404 для несуществующего пользователя', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(app).get('/api/referral/code').set('Authorization', `Bearer ${token()}`)
    expect(res.status).toBe(404)
  })

  it('ошибка БД → 500, а не 200 с пустым кодом', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await request(app).get('/api/referral/code').set('Authorization', `Bearer ${token()}`)
    expect(res.status).toBe(500)
    expect(rootLogger.error).toHaveBeenCalledWith('Referral code error:', expect.any(Error))
  })
})

describe('POST /api/referral/apply', () => {
  it('400 без кода и без запроса в БД', async () => {
    const res = await request(app).post('/api/referral/apply').send({})
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('404 на неизвестный код', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(app).post('/api/referral/apply').send({ code: 'nope' })
    expect(res.status).toBe(404)
  })

  it('валидный код → referrer_id, поиск строго по коду', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 42 }], []])
    const res = await request(app).post('/api/referral/apply').send({ code: 'abc12345' })
    expect(res.status).toBe(200)
    expect(res.body.referrer_id).toBe(42)
    const [sql, params] = pool.query.mock.calls[0]
    expect(String(sql)).toContain('WHERE referral_code = ?')
    expect(params).toEqual(['abc12345'])
  })

  it('ошибка БД → 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await request(app).post('/api/referral/apply').send({ code: 'x' })
    expect(res.status).toBe(500)
    expect(rootLogger.error).toHaveBeenCalledWith('Referral apply error:', expect.any(Error))
  })
})

describe('GET /api/referral/stats', () => {
  it('401 без токена', async () => {
    const res = await request(app).get('/api/referral/stats')
    expect(res.status).toBe(401)
  })

  it('отдаёт totalReferrals и premiumReferrals по своим параметрам', async () => {
    pool.query
      .mockResolvedValueOnce([[{ count: 4 }], []])
      .mockResolvedValueOnce([[{ premium: 1 }], []])
    const res = await request(app).get('/api/referral/stats').set('Authorization', `Bearer ${token(3)}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ totalReferrals: 4, premiumReferrals: 1 })
    expect(pool.query.mock.calls[0][1]).toEqual([3])
    expect(pool.query.mock.calls[1][1]).toEqual([3, 'user', 'active'])
  })

  it('ошибка БД → 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await request(app).get('/api/referral/stats').set('Authorization', `Bearer ${token()}`)
    expect(res.status).toBe(500)
    expect(rootLogger.error).toHaveBeenCalledWith('Referral stats error:', expect.any(Error))
  })
})
