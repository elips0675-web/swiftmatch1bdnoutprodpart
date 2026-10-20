vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'

vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
    execute: vi.fn(),
    getConnection: vi.fn(),
  },
}))

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

const { invalidateMock } = vi.hoisted(() => ({ invalidateMock: vi.fn(async () => {}) }))
vi.mock('../cache.js', () => ({
  getCached: vi.fn(async () => null),
  setCached: vi.fn(async () => {}),
  invalidate: invalidateMock,
}))

const { stripeCheckoutCreate, stripeConstructEvent } = vi.hoisted(() => ({
  stripeCheckoutCreate: vi.fn(),
  stripeConstructEvent: vi.fn(),
}))
vi.mock('stripe', () => ({
  default: function StripeMock() {
    return {
      checkout: { sessions: { create: stripeCheckoutCreate } },
      webhooks: { constructEvent: stripeConstructEvent },
    }
  },
}))

import pool from '../db.js'
import logger from '../logger.js'
import partnerDashboardRoutes from '../routes/partner-dashboard.js'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

function createApp() {
  const app = express()
  app.use(express.json())
  app.use(partnerDashboardRoutes)
  return app
}

function authToken(userId = 7) {
  return jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })
}

const PARTNER = { id: 3, user_id: 7, name: 'Partner', type: 'deeplink', status: 'active', commission_rate: 10 }

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockReset()
  pool.query.mockResolvedValue([[], []])
  invalidateMock.mockReset()
  invalidateMock.mockResolvedValue(undefined)
  stripeCheckoutCreate.mockReset()
  delete process.env.STRIPE_SECRET_KEY
  delete process.env.STRIPE_LIVE
})

describe('POST /api/partner/register', () => {
  it('creates a partner with default deeplink type', async () => {
    pool.query
      .mockResolvedValueOnce([[undefined], []])
      .mockResolvedValueOnce([[undefined], []])
      .mockResolvedValueOnce([{ insertId: 11 }, []])
    const res = await request(createApp())
      .post('/api/partner/register')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ name: '   My Shop   ' })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe(11)
    const insert = pool.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO partners'))
    expect(insert[1][1]).toBe('My Shop')
    expect(insert[1][2]).toBe('deeplink')
  })

  it('rejects invalid partner type with 400 and no DB writes', async () => {
    const res = await request(createApp())
      .post('/api/partner/register')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ name: 'My Shop', type: 'bogus' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/type must be one of/)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('truncates an overlong partner name to the column size', async () => {
    pool.query
      .mockResolvedValueOnce([[undefined], []])
      .mockResolvedValueOnce([[undefined], []])
      .mockResolvedValueOnce([{ insertId: 12 }, []])
    const res = await request(createApp())
      .post('/api/partner/register')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ name: 'x'.repeat(300) })
    expect(res.status).toBe(201)
    const insert = pool.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO partners'))
    expect(insert[1][1]).toHaveLength(100)
  })
})

describe('POST /api/partner/offers', () => {
  it('creates a valid offer with normalized fields', async () => {
    pool.query
      .mockResolvedValueOnce([[PARTNER], []])
      .mockResolvedValueOnce([[undefined], []])
      .mockResolvedValueOnce([[{ count: 0 }], []])
      .mockResolvedValueOnce([{ insertId: 9 }, []])
      .mockResolvedValueOnce([[], []])
    const res = await request(createApp())
      .post('/api/partner/offers')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ category: 'restaurant', title: 'Ужин', deeplink: 'https://swiftmatch.app/go/1', price: '1490.50', city: 'Москва', capacity: '12' })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe(9)
    const insert = pool.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO partner_offers'))
    expect(insert[1][0]).toBe(3)
    expect(insert[1][2]).toBe('Ужин')
    expect(insert[1][4]).toBe('https://swiftmatch.app/go/1')
    expect(insert[1][5]).toBe(1490.5)
    expect(insert[1][6]).toBe('Москва')
    expect(insert[1][7]).toBe('chat')
    expect(insert[1][13]).toBe(12)
  })

  it('rejects garbage price with 400 and no writes', async () => {
    pool.query.mockResolvedValueOnce([[PARTNER], []])
    const res = await request(createApp())
      .post('/api/partner/offers')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ category: 'restaurant', title: 'Ужин', deeplink: 'https://x', price: 'abc' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/price/)
    expect(pool.query).toHaveBeenCalledTimes(1)
  })

  it('rejects negative capacity with 400', async () => {
    pool.query.mockResolvedValueOnce([[PARTNER], []])
    const res = await request(createApp())
      .post('/api/partner/offers')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ category: 'restaurant', title: 'Ужин', deeplink: 'https://x', capacity: -3 })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/capacity/)
  })

  it('rejects garbage event date with 400 instead of 500', async () => {
    pool.query.mockResolvedValueOnce([[PARTNER], []])
    const res = await request(createApp())
      .post('/api/partner/offers')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ category: 'restaurant', title: 'Ужин', deeplink: 'https://x', event_start: 'garbage' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/event_start/)
  })
})

describe('PUT /api/partner/offers/:offerId', () => {
  it('turns empty price into a NULL update instead of 500', async () => {
    pool.query
      .mockResolvedValueOnce([[PARTNER], []])
      .mockResolvedValueOnce([[{ id: 5 }], []])
      .mockResolvedValueOnce([[], []])
    const res = await request(createApp())
      .put('/api/partner/offers/5')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ price: '' })
    expect(res.status).toBe(200)
    const update = pool.query.mock.calls.find(([sql]) => sql.includes('UPDATE partner_offers'))
    expect(update[0]).toContain('price = ?')
    expect(update[1][0]).toBeUndefined()
  })

  it('rejects garbage price with 400', async () => {
    pool.query
      .mockResolvedValueOnce([[PARTNER], []])
      .mockResolvedValueOnce([[{ id: 5 }], []])
    const res = await request(createApp())
      .put('/api/partner/offers/5')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ price: 'abc' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/price/)
  })

  it('rejects garbage capacity with 400', async () => {
    pool.query
      .mockResolvedValueOnce([[PARTNER], []])
      .mockResolvedValueOnce([[{ id: 5 }], []])
    const res = await request(createApp())
      .put('/api/partner/offers/5')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ capacity: 'abc' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/capacity/)
  })

  it('rejects garbage event_start with 400 instead of 500', async () => {
    pool.query
      .mockResolvedValueOnce([[PARTNER], []])
      .mockResolvedValueOnce([[{ id: 5 }], []])
    const res = await request(createApp())
      .put('/api/partner/offers/5')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ event_start: 'bogus' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/event_start/)
  })

  it('truncates an overlong title to the column size', async () => {
    pool.query
      .mockResolvedValueOnce([[PARTNER], []])
      .mockResolvedValueOnce([[{ id: 5 }], []])
      .mockResolvedValueOnce([[], []])
    const res = await request(createApp())
      .put('/api/partner/offers/5')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ title: 't'.repeat(300) })
    expect(res.status).toBe(200)
    const update = pool.query.mock.calls.find(([sql]) => sql.includes('UPDATE partner_offers'))
    expect(update[1][0]).toHaveLength(255)
  })
})

describe('auth и requirePartner', () => {
  it('без токена — 401', async () => {
    const res = await request(createApp()).get('/api/partner/dashboard')
    expect(res.status).toBe(401)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('запрос без тела не роняет партнёрский роут', async () => {
    pool.query
      .mockResolvedValueOnce([[PARTNER], []])
      .mockResolvedValueOnce([[], []])
    const res = await request(createApp())
      .post('/api/partner/offers')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/category must be one of/)
  })

  it('оффер без тела сохраняет пустые поля как NULL', async () => {
    pool.query
      .mockResolvedValueOnce([[PARTNER], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ count: 0 }], []])
      .mockResolvedValueOnce([{ insertId: 31 }, []])
      .mockResolvedValueOnce([[], []])
    const res = await request(createApp())
      .post('/api/partner/offers')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ category: 'restaurant', title: 'Ужин', deeplink: 'https://x', description: '', city: '', location: '', poster_url: '', event_url: '' })
    expect(res.status).toBe(201)
    const insert = pool.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO partner_offers'))
    expect(insert[1][3]).toBeNull()
    expect(insert[1][6]).toBeNull()
    expect(insert[1][10]).toBeNull()
    expect(insert[1][11]).toBeNull()
    expect(insert[1][12]).toBeNull()
  })

  it('нет партнёрского аккаунта — 403', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(createApp())
      .get('/api/partner/dashboard')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(403)
    expect(res.body.message).toBe('Not a partner account')
  })

  it('аккаунт на паузе — 403', async () => {
    pool.query.mockResolvedValueOnce([[{ ...PARTNER, status: 'paused' }], []])
    const res = await request(createApp())
      .get('/api/partner/dashboard')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(403)
    expect(res.body.message).toBe('Partner account is paused')
  })

  it('падение загрузки партнёра — 500 и лог', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp())
      .get('/api/partner/offers')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Server error')
    expect(logger.error).toHaveBeenCalledWith('Partner middleware error:', expect.any(Error))
  })

  it('запрос без тела — 400, а не 500', async () => {
    const res = await request(createApp())
      .post('/api/partner/register')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/min 2 chars/)
  })
})

describe('POST /api/partner/register — ошибки', () => {
  it('имя из не-строки приводится к строке', async () => {
    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ insertId: 13 }, []])
    const res = await request(createApp())
      .post('/api/partner/register')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ name: 12345 })
    expect(res.status).toBe(201)
    const insert = pool.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO partners'))
    expect(insert[1][1]).toBe('12345')
  })

  it('пустое имя — 400', async () => {
    const res = await request(createApp())
      .post('/api/partner/register')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ name: '   ' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/min 2 chars/)
  })

  it('уже зарегистрирован — 409', async () => {
    pool.query.mockResolvedValueOnce([[PARTNER], []])
    const res = await request(createApp())
      .post('/api/partner/register')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ name: 'My Shop' })
    expect(res.status).toBe(409)
    expect(res.body.message).toBe('Already registered as partner')
  })

  it('имя занято другим партнёром — 409', async () => {
    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ id: 4 }], []])
    const res = await request(createApp())
      .post('/api/partner/register')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ name: 'My Shop' })
    expect(res.status).toBe(409)
    expect(res.body.message).toBe('Partner name already taken')
  })

  it('падение БД — 500 и лог', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp())
      .post('/api/partner/register')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ name: 'My Shop' })
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to register partner')
    expect(logger.error).toHaveBeenCalledWith('Partner register error:', expect.any(Error))
  })
})

describe('GET /api/partner/dashboard', () => {
  it('отдаёт статистику, подписку и данные партнёра', async () => {
    pool.query
      .mockResolvedValueOnce([[PARTNER], []])
      .mockResolvedValueOnce([[{ offers_count: 2, clicks_total: 10, commission_pending: 500 }], []])
      .mockResolvedValueOnce([[{ tier: 'pro', status: 'active', expires_at: null }], []])
    const res = await request(createApp())
      .get('/api/partner/dashboard')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.partner).toEqual({ id: 3, name: 'Partner', type: 'deeplink', status: 'active' })
    expect(res.body.stats.commission_pending).toBe(500)
    expect(res.body.subscription.tier).toBe('pro')
    const [sql, params] = pool.query.mock.calls[1]
    expect(String(sql)).toContain('AS offers_count')
    expect(params).toEqual([3, 3, 3, 3, 3, 3, 3])
  })

  it('подписки нет — subscription: null', async () => {
    pool.query
      .mockResolvedValueOnce([[PARTNER], []])
      .mockResolvedValueOnce([[{ offers_count: 0 }], []])
      .mockResolvedValueOnce([[], []])
    const res = await request(createApp())
      .get('/api/partner/dashboard')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.subscription).toBeNull()
  })

  it('падение БД — 500 и лог', async () => {
    pool.query
      .mockResolvedValueOnce([[PARTNER], []])
      .mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp())
      .get('/api/partner/dashboard')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to load dashboard')
    expect(logger.error).toHaveBeenCalledWith('Partner dashboard error:', expect.any(Error))
  })
})

describe('GET /api/partner/offers', () => {
  it('отдаёт офферы с кликами', async () => {
    pool.query
      .mockResolvedValueOnce([[PARTNER], []])
      .mockResolvedValueOnce([[{ id: 9, title: 'Ужин', clicks: 4 }], []])
    const res = await request(createApp())
      .get('/api/partner/offers')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(200)
    expect(res.body[0].clicks).toBe(4)
    expect(String(pool.query.mock.calls[1][0])).toContain('AS clicks')
  })

  it('падение БД — 500 и лог', async () => {
    pool.query
      .mockResolvedValueOnce([[PARTNER], []])
      .mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp())
      .get('/api/partner/offers')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to load offers')
    expect(logger.error).toHaveBeenCalledWith('Partner offers list error:', expect.any(Error))
  })
})

describe('POST /api/partner/offers — валидации', () => {
  it('недопустимая категория — 400', async () => {
    pool.query.mockResolvedValueOnce([[PARTNER], []])
    const res = await request(createApp())
      .post('/api/partner/offers')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ category: 'space', title: 'Ужин', deeplink: 'https://x' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/category must be one of/)
    expect(pool.query).toHaveBeenCalledTimes(1)
  })

  it('короткий title — 400', async () => {
    pool.query.mockResolvedValueOnce([[PARTNER], []])
    const res = await request(createApp())
      .post('/api/partner/offers')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ category: 'restaurant', title: 'ab', deeplink: 'https://x' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/min 3 chars/)
  })

  it('без deeplink — 400', async () => {
    pool.query.mockResolvedValueOnce([[PARTNER], []])
    const res = await request(createApp())
      .post('/api/partner/offers')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ category: 'restaurant', title: 'Ужин' })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('deeplink is required')
  })

  it('event без event_start — 400', async () => {
    pool.query.mockResolvedValueOnce([[PARTNER], []])
    const res = await request(createApp())
      .post('/api/partner/offers')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ category: 'event', title: 'Концерт', deeplink: 'https://x' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/event_start is required/)
  })

  it('нестроковая дата — 400, а не 500', async () => {
    pool.query.mockResolvedValueOnce([[PARTNER], []])
    const res = await request(createApp())
      .post('/api/partner/offers')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ category: 'restaurant', title: 'Ужин', deeplink: 'https://x', event_start: 1234567890123 })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/event_start/)
  })

  it('невалидный placement схлопывается в chat', async () => {
    pool.query
      .mockResolvedValueOnce([[PARTNER], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ count: 0 }], []])
      .mockResolvedValueOnce([{ insertId: 30 }, []])
      .mockResolvedValueOnce([[], []])
    const res = await request(createApp())
      .post('/api/partner/offers')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ category: 'restaurant', title: 'Ужин', deeplink: 'https://x', placement: 'moon' })
    expect(res.status).toBe(201)
    const insert = pool.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO partner_offers'))
    expect(insert[1][7]).toBe('chat')
  })

  it('лимит 5 офферов на basic — 403 UPGRADE_REQUIRED', async () => {
    pool.query
      .mockResolvedValueOnce([[PARTNER], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ count: 5 }], []])
    const res = await request(createApp())
      .post('/api/partner/offers')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ category: 'restaurant', title: 'Ужин', deeplink: 'https://x' })
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('UPGRADE_REQUIRED')
    expect(res.body.message).toContain('5')
  })

  it('лимит 50 офферов на pro — 403', async () => {
    pool.query
      .mockResolvedValueOnce([[PARTNER], []])
      .mockResolvedValueOnce([[{ tier: 'pro' }], []])
      .mockResolvedValueOnce([[{ count: 50 }], []])
    const res = await request(createApp())
      .post('/api/partner/offers')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ category: 'restaurant', title: 'Ужин', deeplink: 'https://x' })
    expect(res.status).toBe(403)
    expect(res.body.message).toContain('50')
  })

  it('падение БД — 500 и лог', async () => {
    pool.query
      .mockResolvedValueOnce([[PARTNER], []])
      .mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp())
      .post('/api/partner/offers')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ category: 'restaurant', title: 'Ужин', deeplink: 'https://x' })
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to create offer')
    expect(logger.error).toHaveBeenCalledWith('Partner offer create error:', expect.any(Error))
  })
})

describe('PUT /api/partner/offers/:offerId — границы', () => {
  it('нечисловой id — 400', async () => {
    pool.query.mockResolvedValueOnce([[PARTNER], []])
    const res = await request(createApp())
      .put('/api/partner/offers/abc')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ title: 'Ужин' })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Invalid offer id')
    expect(pool.query).toHaveBeenCalledTimes(1)
  })

  it('title из не-строки приводится к строке', async () => {
    pool.query
      .mockResolvedValueOnce([[PARTNER], []])
      .mockResolvedValueOnce([[{ id: 5 }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
    const res = await request(createApp())
      .put('/api/partner/offers/5')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ title: 12345 })
    expect(res.status).toBe(200)
    expect(pool.query.mock.calls[2][1][0]).toBe('12345')
  })

  it('чужой/несуществующий оффер — 404', async () => {
    pool.query
      .mockResolvedValueOnce([[PARTNER], []])
      .mockResolvedValueOnce([[], []])
    const res = await request(createApp())
      .put('/api/partner/offers/99')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ title: 'Ужин' })
    expect(res.status).toBe(404)
    expect(res.body.message).toBe('Offer not found')
  })

  it('обновляет все поля, включая даты и NULL capacity', async () => {
    pool.query
      .mockResolvedValueOnce([[PARTNER], []])
      .mockResolvedValueOnce([[{ id: 5 }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
    const res = await request(createApp())
      .put('/api/partner/offers/5')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({
        title: ' Новое ',
        description: 'Описание',
        deeplink: 'https://x/new',
        price: '250.5',
        city: 'Сочи',
        placement: 'chat,hangout',
        status: 'paused',
        event_start: '2026-12-01 10:00',
        event_end: '2026-12-01 12:00',
        location: 'Зал',
        poster_url: 'https://x/p.jpg',
        event_url: 'https://x/e',
        capacity: null,
      })
    expect(res.status).toBe(200)
    expect(res.body.message).toBe('Offer updated')
    const [sql, params] = pool.query.mock.calls[2]
    for (const col of ['title = ?', 'description = ?', 'deeplink = ?', 'price = ?', 'city = ?', 'placement = ?', 'status = ?', 'event_start = ?', 'event_end = ?', 'location = ?', 'poster_url = ?', 'event_url = ?', 'capacity = ?']) {
      expect(String(sql)).toContain(col)
    }
    expect(params[0]).toBe('Новое')
    expect(params[3]).toBe(250.5)
    expect(params[5]).toBe('chat,hangout')
    expect(params[6]).toBe('paused')
    expect(params[7]).toBeInstanceOf(Date)
    expect(params[8]).toBeInstanceOf(Date)
    expect(params[12]).toBeNull()
    expect(params[13]).toBe('5')
    expect(invalidateMock).toHaveBeenCalledWith('partner:offers:*')
  })

  it('только невалидный placement — 400 No fields to update', async () => {
    pool.query
      .mockResolvedValueOnce([[PARTNER], []])
      .mockResolvedValueOnce([[{ id: 5 }], []])
    const res = await request(createApp())
      .put('/api/partner/offers/5')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ placement: 'moon' })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('No fields to update')
  })

  it('пустые текстовые поля сохраняются как NULL', async () => {
    pool.query
      .mockResolvedValueOnce([[PARTNER], []])
      .mockResolvedValueOnce([[{ id: 5 }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
    const res = await request(createApp())
      .put('/api/partner/offers/5')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ title: '   ', description: '', city: '', location: '', poster_url: '', event_url: '' })
    expect(res.status).toBe(200)
    const params = pool.query.mock.calls[2][1]
    expect(params[0]).toBe('')
    expect(params[1]).toBeNull()
    expect(params[2]).toBeNull()
    expect(params[3]).toBeNull()
    expect(params[4]).toBeNull()
    expect(params[5]).toBeNull()
    expect(params[6]).toBe('5')
  })

  it('падение БД — 500 и лог', async () => {
    pool.query
      .mockResolvedValueOnce([[PARTNER], []])
      .mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp())
      .put('/api/partner/offers/5')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ title: 'Новое' })
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to update offer')
    expect(logger.error).toHaveBeenCalledWith('Partner offer update error:', expect.any(Error))
  })
})

describe('DELETE /api/partner/offers/:offerId', () => {
  it('нечисловой id — 400', async () => {
    pool.query.mockResolvedValueOnce([[PARTNER], []])
    const res = await request(createApp())
      .delete('/api/partner/offers/abc')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Invalid offer id')
    expect(pool.query).toHaveBeenCalledTimes(1)
  })

  it('оффер не найден — 404', async () => {
    pool.query
      .mockResolvedValueOnce([[PARTNER], []])
      .mockResolvedValueOnce([{ affectedRows: 0 }, []])
    const res = await request(createApp())
      .delete('/api/partner/offers/99')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(404)
    expect(res.body.message).toBe('Offer not found')
    expect(invalidateMock).not.toHaveBeenCalled()
  })

  it('удаляет оффер и сбрасывает кэш', async () => {
    pool.query
      .mockResolvedValueOnce([[PARTNER], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
    const res = await request(createApp())
      .delete('/api/partner/offers/5')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.message).toBe('Offer deleted')
    expect(pool.query.mock.calls[1][1]).toEqual(['5', 3])
    expect(invalidateMock).toHaveBeenCalledWith('partner:offers:*')
  })

  it('падение БД — 500 и лог', async () => {
    pool.query
      .mockResolvedValueOnce([[PARTNER], []])
      .mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp())
      .delete('/api/partner/offers/5')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to delete offer')
    expect(logger.error).toHaveBeenCalledWith('Partner offer delete error:', expect.any(Error))
  })
})

describe('GET /api/partner/conversions', () => {
  it('отдаёт последние конверсии', async () => {
    pool.query
      .mockResolvedValueOnce([[PARTNER], []])
      .mockResolvedValueOnce([[{ id: 1, conversion_type: 'click', offer_title: 'Ужин' }], []])
    const res = await request(createApp())
      .get('/api/partner/conversions')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(200)
    expect(res.body[0].offer_title).toBe('Ужин')
    expect(String(pool.query.mock.calls[1][0])).toContain('LIMIT 100')
  })

  it('падение БД — 500 и лог', async () => {
    pool.query
      .mockResolvedValueOnce([[PARTNER], []])
      .mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp())
      .get('/api/partner/conversions')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to load conversions')
    expect(logger.error).toHaveBeenCalledWith('Partner conversions error:', expect.any(Error))
  })
})

describe('GET /api/partner/subscription', () => {
  it('отдаёт последнюю подписку', async () => {
    pool.query
      .mockResolvedValueOnce([[PARTNER], []])
      .mockResolvedValueOnce([[{ tier: 'pro', status: 'active', starts_at: null, expires_at: null }], []])
    const res = await request(createApp())
      .get('/api/partner/subscription')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.tier).toBe('pro')
  })

  it('подписки нет — дефолт basic', async () => {
    pool.query
      .mockResolvedValueOnce([[PARTNER], []])
      .mockResolvedValueOnce([[], []])
    const res = await request(createApp())
      .get('/api/partner/subscription')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ tier: 'basic', status: 'active', expires_at: null })
  })

  it('падение БД — 500 и лог', async () => {
    pool.query
      .mockResolvedValueOnce([[PARTNER], []])
      .mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp())
      .get('/api/partner/subscription')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to load subscription')
    expect(logger.error).toHaveBeenCalledWith('Partner subscription error:', expect.any(Error))
  })
})

describe('POST /api/partner/subscribe', () => {
  it('запрос без тела — 400, не 500', async () => {
    pool.query.mockResolvedValueOnce([[PARTNER], []])
    const res = await request(createApp())
      .post('/api/partner/subscribe')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/tier must be one of/)
  })

  it('недопустимый тариф — 400', async () => {
    pool.query.mockResolvedValueOnce([[PARTNER], []])
    const res = await request(createApp())
      .post('/api/partner/subscribe')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ tier: 'gold' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/tier must be one of/)
  })

  it('basic понижает тариф и комиссию до 10%', async () => {
    pool.query
      .mockResolvedValueOnce([[PARTNER], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
    const res = await request(createApp())
      .post('/api/partner/subscribe')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ tier: 'basic' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ message: 'Downgraded to Basic', tier: 'basic' })
    expect(String(pool.query.mock.calls[1][0])).toContain("SET status = 'cancelled'")
    expect(String(pool.query.mock.calls[2][0])).toContain('commission_rate = 10')
  })

  it('со STRIPE_SECRET_KEY возвращает checkout-сессию', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_partner'
    stripeCheckoutCreate.mockResolvedValue({ url: 'https://checkout.stripe.test/cs_1', id: 'cs_1' })
    pool.query.mockResolvedValueOnce([[PARTNER], []])
    const res = await request(createApp())
      .post('/api/partner/subscribe')
      .set('Authorization', `Bearer ${authToken()}`)
      .set('Origin', 'https://swiftmatch.test')
      .send({ tier: 'pro' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ url: 'https://checkout.stripe.test/cs_1', session_id: 'cs_1' })
    const arg = stripeCheckoutCreate.mock.calls[0][0]
    expect(arg.mode).toBe('payment')
    expect(arg.metadata).toEqual({ partner_id: '3', tier: 'pro' })
    expect(arg.success_url).toBe('https://swiftmatch.test/partner/dashboard?upgraded=1')
    expect(arg.cancel_url).toBe('https://swiftmatch.test/partner/dashboard?cancelled=1')
  })

  it('без origin в checkout уходит прод-домен', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_partner'
    stripeCheckoutCreate.mockResolvedValue({ url: 'https://checkout.stripe.test/cs_2', id: 'cs_2' })
    pool.query.mockResolvedValueOnce([[PARTNER], []])
    const res = await request(createApp())
      .post('/api/partner/subscribe')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ tier: 'pro' })
    expect(res.status).toBe(200)
    expect(stripeCheckoutCreate.mock.calls[0][0].success_url).toContain('https://swiftmatch.app/partner/dashboard')
  })

  it('mock-режим активирует pro и комиссию 15%', async () => {
    pool.query
      .mockResolvedValueOnce([[PARTNER], []])
      .mockResolvedValueOnce([{ insertId: 71 }, []])
      .mockResolvedValueOnce([[], []])
    const res = await request(createApp())
      .post('/api/partner/subscribe')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ tier: 'pro' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ message: 'Pro activated (mock)', tier: 'pro', mock: true })
    expect(String(pool.query.mock.calls[1][0])).toContain('INSERT INTO partner_subscriptions')
    expect(String(pool.query.mock.calls[2][0])).toContain('commission_rate = 15')
  })

  it('в live-режиме mock-оплата отбивается 503', async () => {
    process.env.STRIPE_LIVE = 'true'
    pool.query.mockResolvedValueOnce([[PARTNER], []])
    const res = await request(createApp())
      .post('/api/partner/subscribe')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ tier: 'pro' })
    expect(res.status).toBe(503)
    expect(res.body.code).toBe('STRIPE_NOT_CONFIGURED')
    expect(pool.query).toHaveBeenCalledTimes(1)
  })
})

describe('POST /api/partner/webhook — ветки обработки', () => {
  const stubSession = (over = {}) => ({ id: 'cs_branch_1', payment_status: 'paid', metadata: { partner_id: '7', tier: 'pro' }, ...over })
  const stubEvent = (session, over = {}) => ({
    id: 'evt_branch_1',
    type: 'checkout.session.completed',
    data: { object: session },
    ...over,
  })

  function useSession(session, eventOver = {}) {
    process.env.STRIPE_SECRET_KEY = 'sk_test_branch'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_branch'
    stripeConstructEvent.mockReturnValue(stubEvent(session, eventOver))
  }

  beforeEach(() => {
    pool.getConnection.mockResolvedValue({
      beginTransaction: vi.fn(),
      commit: vi.fn(),
      rollback: vi.fn(),
      release: vi.fn(),
      query: vi.fn().mockResolvedValue([{ affectedRows: 1 }, []]),
    })
  })

  it('событие без metadata -> received true, транзакции нет', async () => {
    useSession(stubSession({ metadata: undefined }))
    const res = await request(createApp())
      .post('/api/partner/webhook')
      .set('stripe-signature', 't=1,v1=ok')
      .send({})
    expect(res.status).toBe(200)
    expect(res.body.received).toBe(true)
    expect(pool.getConnection).not.toHaveBeenCalled()
  })

  it('неоплаченная сессия -> received true, транзакции нет', async () => {
    useSession(stubSession({ id: 'cs_b2', payment_status: 'unpaid' }))
    const res = await request(createApp())
      .post('/api/partner/webhook')
      .set('stripe-signature', 't=1,v1=ok')
      .send({})
    expect(res.status).toBe(200)
    expect(res.body.received).toBe(true)
    expect(pool.getConnection).not.toHaveBeenCalled()
  })

  it('событие без id -> received true, дедуп по пустому event_id', async () => {
    useSession(stubSession({ id: 'cs_b3' }), { id: undefined })
    const res = await request(createApp())
      .post('/api/partner/webhook')
      .set('stripe-signature', 't=1,v1=ok')
      .send({})
    expect(res.status).toBe(200)
    expect(res.body.received).toBe(true)
    expect(pool.getConnection).toHaveBeenCalled()
    expect(pool.query.mock.calls[0][1][1]).toBe('')
  })

  it('mock-режим без ключа -> received true', async () => {
    const res = await request(createApp()).post('/api/partner/webhook').send({})
    expect(res.status).toBe(200)
    expect(res.body.received).toBe(true)
  })
})