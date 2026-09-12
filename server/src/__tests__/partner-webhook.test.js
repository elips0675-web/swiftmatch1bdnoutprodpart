import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_dummy'
})

const { conn, stripeWebhooks } = vi.hoisted(() => ({
  conn: {
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
    query: vi.fn(),
  },
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
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('../cache.js', () => ({
  getCached: vi.fn(() => Promise.resolve(null)),
  setCached: vi.fn(() => Promise.resolve()),
  invalidate: vi.fn(() => Promise.resolve()),
}))

vi.mock('../middleware.js', () => ({
  auth: (req, _res, next) => { req.userId = 5; next() },
}))

vi.mock('stripe', () => ({
  default: function StripeMock() {
    return { webhooks: stripeWebhooks }
  },
}))

import partnerDashboard from '../routes/partner-dashboard.js'

const constructEvent = stripeWebhooks.constructEvent

function createApp() {
  const app = express()
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf } }))
  app.use(partnerDashboard)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/partner/webhook', () => {
  it('без STRIPE_SECRET_KEY -> mock mode 200 (контракт)', async () => {
    const key = process.env.STRIPE_SECRET_KEY
    delete process.env.STRIPE_SECRET_KEY
    try {
      const res = await request(createApp()).post('/api/partner/webhook').send({})
      expect(res.status).toBe(200)
      expect(res.body.received).toBe(true)
    } finally {
      process.env.STRIPE_SECRET_KEY = key
    }
  })

  it('нет заголовка stripe-signature -> 400 Missing signature', async () => {
    const res = await request(createApp()).post('/api/partner/webhook').send({})
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/Missing signature/i)
  })

  it('битая подпись -> 400 Invalid signature', async () => {
    constructEvent.mockImplementation(() => { throw new Error('Invalid signature') })
    const res = await request(createApp())
      .post('/api/partner/webhook')
      .set('stripe-signature', 't=1,v1=deadbeef')
      .send({ foo: 'bar' })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Invalid signature')
  })

  it('checkout.session.completed активирует подписку pro и комиссию 15%', async () => {
    constructEvent.mockReturnValue({
      id: 'evt_partner_001',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_001', payment_status: 'paid', metadata: { partner_id: '7', tier: 'pro' } } },
    })
    conn.query.mockImplementation((_sql, _params) => Promise.resolve([{ affectedRows: 1 }, []]))
    const res = await request(createApp())
      .post('/api/partner/webhook')
      .set('stripe-signature', 't=1,v1=ok')
      .send({ fake: true })
    expect(res.status).toBe(200)
    expect(res.body.received).toBe(true)
    const sqls = conn.query.mock.calls.map((c) => String(c[0]))
    expect(sqls.some((s) => s.includes('webhook_events'))).toBe(true)
    expect(sqls.some((s) => s.includes('UPDATE partner_subscriptions'))).toBe(true)
    expect(sqls.some((s) => s.includes('INSERT INTO partner_subscriptions'))).toBe(true)
    expect(sqls.some((s) => s.includes('commission_rate = 15'))).toBe(true)
    expect(conn.commit).toHaveBeenCalled()
  })

  it('replay: то же событие не создаёт дубль подписки', async () => {
    constructEvent.mockReturnValue({
      id: 'evt_partner_002',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_002', payment_status: 'paid', metadata: { partner_id: '7', tier: 'pro' } } },
    })
    conn.query.mockImplementation((sql) =>
      Promise.resolve(String(sql).includes('webhook_events') ? [{ affectedRows: 0 }, []] : [{ insertId: 9 }, []]),
    )
    const res = await request(createApp())
      .post('/api/partner/webhook')
      .set('stripe-signature', 't=1,v1=ok')
      .send({ fake: true })
    expect(res.status).toBe(200)
    expect(res.body.received).toBe(true)
    const sqls = conn.query.mock.calls.map((c) => String(c[0]))
    expect(sqls.some((s) => s.includes('INSERT INTO partner_subscriptions'))).toBe(false)
    expect(conn.rollback).toHaveBeenCalled()
  })

  it('metadata tier != pro -> игнор', async () => {
    constructEvent.mockReturnValue({
      id: 'evt_partner_003',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_003', payment_status: 'paid', metadata: { partner_id: '7', tier: 'basic' } } },
    })
    const res = await request(createApp())
      .post('/api/partner/webhook')
      .set('stripe-signature', 't=1,v1=ok')
      .send({ fake: true })
    expect(res.status).toBe(200)
    expect(res.body.received).toBe(true)
    const sqls = conn.query.mock.calls.map((c) => String(c[0]))
    expect(sqls.some((s) => s.includes('INSERT INTO partner_subscriptions'))).toBe(false)
    expect(conn.beginTransaction).not.toHaveBeenCalled()
  })
})