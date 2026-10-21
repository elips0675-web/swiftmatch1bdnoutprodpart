// Stage 151 (COV-03, остаток): непокрытые ветки `server/src/routes/partners.js` —
// money-роут B2B (офферы, конверсии, брони, комиссии). Роут был покрыт по
// счастливым путям, но фоллбэки остались непроверенными: токен партнёра из
// query-параметра и из заголовка, отсутствие заголовка, атрибуция `user_id` в
// конверсии, город из query, пустой `deeplink` у оффера, клампы гостей,
// null-поля карточки брони, падение записи в кэш и работа роутов без
// body-парсера.
//
// Проверяется поведение, а не строки: каждая ветка обязана менять ответ или
// запись в БД, иначе тест проходит и на сломанной ветке.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'

vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}))

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('../ws.js', () => ({
  getIO: vi.fn(() => null),
}))

const { getCachedMock, setCachedMock } = vi.hoisted(() => ({
  getCachedMock: vi.fn(async () => null),
  setCachedMock: vi.fn(async () => {}),
}))
vi.mock('../cache.js', () => ({
  getCached: getCachedMock,
  setCached: setCachedMock,
  invalidate: vi.fn(async () => {}),
}))

import pool from '../db.js'
import partnersRoutes from '../routes/partners.js'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'
const app = express()
app.use(express.json())
app.use(partnersRoutes)

const as = (userId = 1) => ({
  Authorization: `Bearer ${jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })}`,
})

const TOKEN = 'tok_partner_1'

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockReset()
  getCachedMock.mockResolvedValue(null)
  setCachedMock.mockResolvedValue(undefined)
})

describe('POST /api/partners/postback/:id — авторизация партнёра', () => {
  it('принимает affiliate_token из query-параметра', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1, affiliate_token: TOKEN, hmac_secret: null, commission_rate: 10 }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ insertId: 501 }, []])

    const res = await request(app)
      .post(`/api/partners/postback/1?token=${TOKEN}`)
      .send({ external_order_id: 'ext_query', amount: 1000 })

    expect(res.status).toBe(200)
    expect(res.body.commission).toBe(100)
  })

  it('без токена в body, query и заголовке — 401', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 1, affiliate_token: TOKEN, hmac_secret: null, commission_rate: 10 }], []])

    const res = await request(app)
      .post('/api/partners/postback/1')
      .send({ external_order_id: 'ext_none', amount: 1000 })

    expect(res.status).toBe(401)
    expect(res.body.message).toBe('Unauthorized')
  })

  it('принимает affiliate_token из заголовка Authorization', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1, affiliate_token: TOKEN, hmac_secret: null, commission_rate: 10 }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ insertId: 502 }, []])

    const res = await request(app)
      .post('/api/partners/postback/1')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ external_order_id: 'ext_header', amount: 1000 })

    expect(res.status).toBe(200)
    expect(res.body.commission).toBe(100)
  })
})

describe('POST /api/partners/postback/:id — атрибуция user_id', () => {
  it('числовой user_id из body попадает в конверсию', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1, affiliate_token: TOKEN, hmac_secret: null, commission_rate: 10 }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ insertId: 503 }, []])

    const res = await request(app)
      .post('/api/partners/postback/1')
      .send({ token: TOKEN, external_order_id: 'ext_uid', amount: 1000, user_id: 42 })

    expect(res.status).toBe(200)
    const insertCall = pool.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO partner_conversions'))
    expect(insertCall[1][2]).toBe(42)
  })

  it('нечисловой user_id не попадает в конверсию — null', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1, affiliate_token: TOKEN, hmac_secret: null, commission_rate: 10 }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ insertId: 504 }, []])

    const res = await request(app)
      .post('/api/partners/postback/1')
      .send({ token: TOKEN, external_order_id: 'ext_uid_bad', amount: 1000, user_id: 'abc' })

    expect(res.status).toBe(200)
    const insertCall = pool.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO partner_conversions'))
    expect(insertCall[1][2]).toBeNull()
  })
})
