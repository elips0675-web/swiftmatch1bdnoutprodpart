// Этап 39 (слепые зоны, аудит дипсик): Stripe webhook security unit
// invalid signature -> 400, replay события -> без дублей подписки
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

vi.mock('stripe', () => ({
  default: function StripeMock() {
    return { webhooks: stripeWebhooks }
  },
}))

import premiumRoutes from '../routes/premium.js'

const constructEvent = stripeWebhooks.constructEvent

function createApp() {
  const app = express()
  // вебхук должен получать raw body (как в index.js)
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf } }))
  app.use(premiumRoutes)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/premium/webhook security', () => {
  it('без подписки-секрета в env -> mock mode 200 (проверка контракта)', async () => {
    const key = process.env.STRIPE_SECRET_KEY
    delete process.env.STRIPE_SECRET_KEY
    try {
      const res = await request(createApp()).post('/api/premium/webhook').send({})
      expect(res.status).toBe(200)
      expect(res.body.received).toBe(true)
    } finally {
      process.env.STRIPE_SECRET_KEY = key
    }
  })

  it('нет заголовка stripe-signature -> 400 Missing signature', async () => {
    const res = await request(createApp()).post('/api/premium/webhook').send({})
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/Missing signature/i)
  })

  it('битая подпись -> 400 Invalid signature', async () => {
    constructEvent.mockImplementation(() => { throw new Error('Invalid signature') })
    const res = await request(createApp())
      .post('/api/premium/webhook')
      .set('stripe-signature', 't=1,v1=deadbeef')
      .send({ foo: 'bar' })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Invalid signature')
  })

  it('checkout.session.completed создаёт подписку и записывает event_id', async () => {
    constructEvent.mockReturnValue({
      id: 'evt_001',
      type: 'checkout.session.completed',
      data: { object: { metadata: { userId: '5', tier: 'plus', duration_months: '1' } } },
    })
    conn.query.mockImplementation((_sql, _params) => Promise.resolve([{ affectedRows: 1 }, []]))
    const res = await request(createApp())
      .post('/api/premium/webhook')
      .set('stripe-signature', 't=1,v1=ok')
      .send({ fake: true })
    expect(res.status).toBe(200)
    expect(res.body.received).toBe(true)
    const sqls = conn.query.mock.calls.map((c) => String(c[0]))
    expect(sqls.some((s) => s.includes('INSERT IGNORE INTO webhook_events'))).toBe(true)
    expect(sqls.some((s) => s.includes('INSERT INTO subscriptions'))).toBe(true)
    expect(conn.commit).toHaveBeenCalled()
  })

  it('replay: то же событие второй раз не создаёт дубль подписки', async () => {
    constructEvent.mockReturnValue({
      id: 'evt_002',
      type: 'checkout.session.completed',
      data: { object: { metadata: { userId: '5', tier: 'plus', duration_months: '1' } } },
    })
    // INSERT IGNORE вернул affectedRows: 0 -> дубликат
    conn.query.mockImplementation((sql) =>
      Promise.resolve(String(sql).includes('webhook_events') ? [{ affectedRows: 0 }, []] : [{ insertId: 9 }, []]),
    )
    const res = await request(createApp())
      .post('/api/premium/webhook')
      .set('stripe-signature', 't=1,v1=ok')
      .send({ fake: true })
    expect(res.status).toBe(200)
    expect(res.body.received).toBe(true)
    const sqls = conn.query.mock.calls.map((c) => String(c[0]))
    expect(sqls.some((s) => s.includes('INSERT INTO subscriptions'))).toBe(false)
    expect(conn.rollback).toHaveBeenCalled()
  })

  it('событие с session.id привязывает подписку к платежу (provider + id)', async () => {
    constructEvent.mockReturnValue({
      id: 'evt_010',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_010', metadata: { userId: '5', tier: 'gold', duration_months: '6' } } },
    })
    conn.query.mockImplementation((sql) =>
      Promise.resolve(
        String(sql).includes('FROM subscriptions WHERE provider')
          ? [[], []]
          : [{ affectedRows: 1 }, []],
      ),
    )
    const res = await request(createApp())
      .post('/api/premium/webhook')
      .set('stripe-signature', 't=1,v1=ok')
      .send({ fake: true })
    expect(res.status).toBe(200)
    const insertCall = conn.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO subscriptions'))
    expect(String(insertCall[0])).toContain('provider_subscription_id')
    expect(insertCall[1]).toContain('cs_010')
  })

  it('вебхук по уже проведённому платежу (сверка догнала) не продлевает подписку', async () => {
    // Сессию уже применила сверка пропущенных оплат (payment-reconcile.js),
    // а следом пришёл «догоняющий» вебхук с новым event_id: дедуп по event_id
    // его не поймает, поэтому защита — уникальность session.id в подписках.
    constructEvent.mockReturnValue({
      id: 'evt_011',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_011', metadata: { userId: '5', tier: 'plus', duration_months: '1' } } },
    })
    conn.query.mockImplementation((sql) =>
      Promise.resolve(
        String(sql).includes('FROM subscriptions WHERE provider')
          ? [[{ id: 3 }], []]
          : [{ affectedRows: 1 }, []],
      ),
    )
    const res = await request(createApp())
      .post('/api/premium/webhook')
      .set('stripe-signature', 't=1,v1=ok')
      .send({ fake: true })
    expect(res.status).toBe(200)
    const sqls = conn.query.mock.calls.map((c) => String(c[0]))
    expect(sqls.some((s) => s.includes('INSERT INTO subscriptions'))).toBe(false)
  })
})
