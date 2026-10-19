vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_dummy'
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'

const { conn, stripeSession, stripeWebhooks } = vi.hoisted(() => ({
  conn: {
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
    query: vi.fn(),
  },
  stripeSession: { create: vi.fn() },
  stripeWebhooks: { constructEvent: vi.fn() },
}))

vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
    getConnection: vi.fn(async () => conn),
  },
}))

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('../ws.js', () => ({ getIO: vi.fn(() => null) }))

vi.mock('../cache.js', () => ({
  getCached: vi.fn(() => Promise.resolve(null)),
  setCached: vi.fn(() => Promise.resolve()),
  invalidate: vi.fn(() => Promise.resolve()),
}))

vi.mock('stripe', () => ({
  default: function StripeMock() {
    return { checkout: { sessions: stripeSession }, webhooks: stripeWebhooks }
  },
}))

import pool from '../db.js'
import logger from '../logger.js'
import eventsRoutes, { applyEventTicket } from '../routes/events.js'

const JWT_SECRET = process.env.JWT_SECRET
const authHeader = (userId = 2) => 'Bearer ' + jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })

const sampleEvent = {
  id: 1, partner_id: 3, category: 'event', title: 'Speed-dating', description: 'Test',
  price: 1500, city: 'Москва', capacity: 40, tickets_sold: 5, remaining: 35,
  commission_rate: 15, partner_status: 'active', partner_name: 'Wild Events',
  event_start: '2026-12-01T18:00:00Z', event_end: null,
}

function createApp() {
  const app = express()
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf } }))
  app.use(eventsRoutes)
  return app
}

const app = createApp()

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockReset()
})

describe('GET /api/events — фильтр по городу', () => {
  it('city добавляет условие (o.city = ? OR o.city IS NULL)', async () => {
    pool.query.mockResolvedValueOnce([[{ ...sampleEvent, remaining: 5 }], []])
    const res = await request(app).get('/api/events?city=Казань').set('Authorization', authHeader())
    expect(res.status).toBe(200)
    const [sql, params] = pool.query.mock.calls[0]
    expect(String(sql)).toContain('(o.city = ? OR o.city IS NULL)')
    expect(params).toEqual(['Казань'])
  })

  it('city из пробелов игнорируется — условия нет', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    await request(app).get('/api/events?city=%20%20').set('Authorization', authHeader())
    const [sql, params] = pool.query.mock.calls[0]
    expect(String(sql)).not.toContain('o.city = ?')
    expect(params).toEqual([])
  })
})

describe('POST /api/events/:id/purchase — Stripe-контур', () => {
  it('падение БД на покупке → 500 Failed to purchase ticket', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await request(app).post('/api/events/1/purchase').set('Authorization', authHeader(5))
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to purchase ticket')
  })

  it('оплаченный черновик уже есть → 409 ALREADY_PURCHASED «already in progress»', async () => {
    pool.query
      .mockResolvedValueOnce([[sampleEvent], []])
      .mockResolvedValueOnce([[{ id: 7, status: 'pending' }], []])
    const res = await request(app).post('/api/events/1/purchase').set('Authorization', authHeader())
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('ALREADY_PURCHASED')
    expect(res.body.message).toBe('Purchase already in progress')
  })

  it('Stripe настроен: создаётся checkout-сессия, пишутся partner_orders и event_tickets, отдаётся url', async () => {
    stripeSession.create.mockResolvedValueOnce({ id: 'cs_evt_1', url: 'https://checkout.stripe/cs_evt_1' })
    pool.query
      .mockResolvedValueOnce([[sampleEvent], []])
      .mockResolvedValueOnce([[undefined], []])
      .mockResolvedValueOnce([{ insertId: 300 }, []])
      .mockResolvedValueOnce([{ insertId: 400 }, []])
    const res = await request(app)
      .post('/api/events/1/purchase')
      .set('Authorization', authHeader(5))
      .set('Origin', 'http://localhost:8081')
    expect(res.status).toBe(200)
    expect(res.body.url).toBe('https://checkout.stripe/cs_evt_1')
    expect(res.body.ticket_id).toBe(400)

    const order = pool.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO partner_orders'))
    expect(order[1]).toEqual([3, '1', 5, 'cs_evt_1', 1500, 225])
    const ticket = pool.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO event_tickets'))
    expect(ticket[1]).toEqual(['1', 5, 300, 'cs_evt_1', 1500])
  })

  it('Stripe настроен, но падение создания сессии вне live → тихий fallback в mock', async () => {
    stripeSession.create.mockRejectedValueOnce(new Error('stripe down'))
    pool.query
      .mockResolvedValueOnce([[sampleEvent], []])
      .mockResolvedValueOnce([[undefined], []])
      .mockResolvedValueOnce([{ insertId: 301 }, []])
      .mockResolvedValueOnce([{ insertId: 401 }, []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
    const res = await request(app).post('/api/events/1/purchase').set('Authorization', authHeader(5))
    expect(res.status).toBe(201)
    expect(res.body.mock).toBe(true)
  })

  it('ER_DUP_ENTRY на вставке → 409 ALREADY_PURCHASED (гонка двух покупок)', async () => {
    stripeSession.create.mockRejectedValueOnce(new Error('x'))
    const dup = Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' })
    pool.query
      .mockResolvedValueOnce([[sampleEvent], []])
      .mockResolvedValueOnce([[undefined], []])
      .mockRejectedValueOnce(dup)
    const res = await request(app).post('/api/events/1/purchase').set('Authorization', authHeader(5))
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('ALREADY_PURCHASED')
  })
})

describe('GET /api/events/:id — ошибка БД', () => {
  it('падение запроса → 500 Failed to fetch event', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await request(app).get('/api/events/1').set('Authorization', authHeader(5))
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to fetch event')
  })
})

describe('POST /api/events/:id/purchase — live и падение Stripe', () => {
  it('live: падение Stripe → 502 Stripe payment failed (без mock-fallback)', async () => {
    const key = process.env.STRIPE_SECRET_KEY
    process.env.STRIPE_LIVE = 'true'
    stripeSession.create.mockRejectedValueOnce(new Error('stripe 500'))
    try {
      const mod = await import('../routes/events.js')
      const app2 = express()
      app2.use(express.json())
      app2.use(mod.default)
      pool.query
        .mockResolvedValueOnce([[sampleEvent], []])
        .mockResolvedValueOnce([[undefined], []])
      const res = await request(app2).post('/api/events/1/purchase').set('Authorization', authHeader(5)).set('Origin', 'http://localhost:8081')
      expect(res.status).toBe(502)
      expect(res.body.message).toBe('Stripe payment failed')
    } finally {
      process.env.STRIPE_SECRET_KEY = key
      delete process.env.STRIPE_LIVE
      vi.resetModules()
    }
  })
})

describe('POST /api/events/:id/purchase — live-режим', () => {
  it('STRIPE_LIVE без ключа → 503 STRIPE_NOT_CONFIGURED (fail-closed)', async () => {
    const key = process.env.STRIPE_SECRET_KEY
    delete process.env.STRIPE_SECRET_KEY
    process.env.STRIPE_LIVE = 'true'
    try {
      const mod = await import('../routes/events.js')
      const app2 = express()
      app2.use(express.json())
      app2.use(mod.default)
      pool.query
        .mockResolvedValueOnce([[{ ...sampleEvent }], []])
        .mockResolvedValueOnce([[undefined], []])
      const res = await request(app2).post('/api/events/1/purchase').set('Authorization', authHeader(5))
      expect(res.status).toBe(503)
      expect(res.body.code).toBe('STRIPE_NOT_CONFIGURED')
    } finally {
      process.env.STRIPE_SECRET_KEY = key
      delete process.env.STRIPE_LIVE
      vi.resetModules()
    }
  })
})

describe('POST /api/events/order/webhook', () => {
  it('нет STRIPE_WEBHOOK_SECRET → 400 Missing signature', async () => {
    const sec = process.env.STRIPE_WEBHOOK_SECRET
    delete process.env.STRIPE_WEBHOOK_SECRET
    try {
      const mod = await import('../routes/events.js')
      const app2 = express()
      app2.use(express.json())
      app2.use(mod.default)
      const res = await request(app2)
        .post('/api/events/order/webhook')
        .set('stripe-signature', 't=1,v1=x')
        .send({})
      expect(res.status).toBe(400)
      expect(res.body.message).toBe('Missing signature')
    } finally {
      process.env.STRIPE_WEBHOOK_SECRET = sec
      vi.resetModules()
    }
  })

  it('неверная подпись → 400 Invalid signature', async () => {
    stripeWebhooks.constructEvent.mockImplementationOnce(() => { throw new Error('bad sig') })
    const res = await request(app)
      .post('/api/events/order/webhook')
      .set('stripe-signature', 't=1,v1=bad')
      .send({})
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Invalid signature')
  })

  it('событие не checkout.session.completed → received без обработки', async () => {
    stripeWebhooks.constructEvent.mockReturnValueOnce({ id: 'evt_x', type: 'payment_intent.created', data: { object: {} } })
    const res = await request(app)
      .post('/api/events/order/webhook')
      .set('stripe-signature', 't=1,v1=ok')
      .send({})
    expect(res.status).toBe(200)
    expect(res.body.received).toBe(true)
    expect(conn.beginTransaction).not.toHaveBeenCalled()
  })

  it('metadata.kind !== event → received без транзакции', async () => {
    stripeWebhooks.constructEvent.mockReturnValueOnce({
      id: 'evt_y', type: 'checkout.session.completed',
      data: { object: { metadata: { kind: 'premium' }, payment_status: 'paid' } },
    })
    const res = await request(app).post('/api/events/order/webhook').set('stripe-signature', 't=1,v1=ok').send({})
    expect(res.status).toBe(200)
    expect(conn.beginTransaction).not.toHaveBeenCalled()
  })

  it('payment_status !== paid → received без обработки', async () => {
    stripeWebhooks.constructEvent.mockReturnValueOnce({
      id: 'evt_z', type: 'checkout.session.completed',
      data: { object: { metadata: { kind: 'event' }, payment_status: 'unpaid' } },
    })
    const res = await request(app).post('/api/events/order/webhook').set('stripe-signature', 't=1,v1=ok').send({})
    expect(res.status).toBe(200)
    expect(logger.info).not.toHaveBeenCalled()
  })

  it('успех: транзакция, INSERT IGNORE, applyEventTicket, commit, processed', async () => {
    stripeWebhooks.constructEvent.mockReturnValueOnce({
      id: 'evt_ok', type: 'checkout.session.completed',
      data: { object: { id: 'cs_ok', metadata: { kind: 'event', offer_id: '1' }, payment_status: 'paid' } },
    })
    pool.query.mockResolvedValue([{ affectedRows: 1 }])
    conn.query.mockImplementation((sql) => {
      if (String(sql).includes('INSERT IGNORE INTO webhook_events')) return Promise.resolve([{ affectedRows: 1 }])
      if (String(sql).includes('UPDATE event_tickets')) return Promise.resolve([{ affectedRows: 1 }])
      return Promise.resolve([{ affectedRows: 1 }])
    })
    const res = await request(app).post('/api/events/order/webhook').set('stripe-signature', 't=1,v1=ok').send({})
    expect(res.status).toBe(200)
    expect(conn.beginTransaction).toHaveBeenCalled()
    expect(conn.commit).toHaveBeenCalled()
    expect(conn.release).toHaveBeenCalled()

    const sqls = pool.query.mock.calls.map((c) => String(c[0]))
    expect(sqls.some((s) => s.includes('INSERT INTO webhook_deliveries'))).toBe(true)
    expect(sqls.some((s) => s.includes("status = 'processed'"))).toBe(true)
  })

  it('дубликат (affectedRows 0) → rollback и received, без commit', async () => {
    stripeWebhooks.constructEvent.mockReturnValueOnce({
      id: 'evt_dup', type: 'checkout.session.completed',
      data: { object: { id: 'cs_dup', metadata: { kind: 'event', offer_id: '1' }, payment_status: 'paid' } },
    })
    pool.query.mockResolvedValue([{ affectedRows: 1 }])
    conn.query.mockResolvedValueOnce([{ affectedRows: 0 }])
    const res = await request(app).post('/api/events/order/webhook').set('stripe-signature', 't=1,v1=ok').send({})
    expect(res.status).toBe(200)
    expect(res.body.received).toBe(true)
    expect(conn.rollback).toHaveBeenCalled()
    expect(conn.commit).not.toHaveBeenCalled()
  })

  it('падение обработки → rollback, markWebhookFailed с текстом ошибки', async () => {
    stripeWebhooks.constructEvent.mockReturnValueOnce({
      id: 'evt_fail', type: 'checkout.session.completed',
      data: { object: { id: 'cs_fail', metadata: { kind: 'event', offer_id: '1' }, payment_status: 'paid' } },
    })
    pool.query.mockResolvedValue([{ affectedRows: 1 }])
    conn.query.mockImplementation((sql) => {
      if (String(sql).includes('INSERT IGNORE')) return Promise.resolve([{ affectedRows: 1 }])
      if (String(sql).includes('UPDATE event_tickets')) return Promise.reject(new Error('ticket update exploded'))
      return Promise.resolve([{ affectedRows: 1 }])
    })
    const res = await request(app).post('/api/events/order/webhook').set('stripe-signature', 't=1,v1=ok').send({})
    expect(res.status).toBe(200)
    expect(conn.rollback).toHaveBeenCalled()
    const failed = pool.query.mock.calls.find(
      (c) => String(c[0]).includes('UPDATE webhook_deliveries') && String(c[0]).includes("'failed'"),
    )
    expect(failed).toBeTruthy()
    expect(String(failed[1][0])).toContain('ticket update exploded')
  })
})

describe('applyEventTicket', () => {
  it('нет pending-строки (affectedRows 0) → ничего не пишется дальше', async () => {
    conn.query.mockResolvedValue([{ affectedRows: 0 }])
    await applyEventTicket({ data: { object: { id: 'cs_1', metadata: { offer_id: '1' } } } }, conn)
    expect(conn.query).toHaveBeenCalledTimes(1)
  })

  it('pending-строка переведена в paid → tickets_sold +1 и конверсия', async () => {
    conn.query.mockResolvedValue([{ affectedRows: 1 }])
    await applyEventTicket({ data: { object: { id: 'cs_2', metadata: { offer_id: '9' } } } }, conn)
    const sqls = conn.query.mock.calls.map((c) => String(c[0]))
    expect(sqls.some((s) => s.includes('UPDATE event_tickets SET status'))).toBe(true)
    expect(sqls.some((s) => s.includes('UPDATE partner_offers SET tickets_sold'))).toBe(true)
    expect(sqls.some((s) => s.includes('INSERT INTO partner_conversions'))).toBe(true)
    expect(sqls.some((s) => s.includes('UPDATE partner_orders SET status' ))).toBe(true)
  })
})
