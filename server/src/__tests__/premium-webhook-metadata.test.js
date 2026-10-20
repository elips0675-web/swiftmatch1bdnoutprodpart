import { describe, it, expect, vi, beforeEach } from 'vitest'

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

import { applyPremiumCheckout, applyStripeRefund } from '../routes/premium.js'
import premiumRoutes from '../routes/premium.js'
import request from 'supertest'
import express from 'express'

const constructEvent = stripeWebhooks.constructEvent

function connResolving(map = {}) {
  conn.query.mockImplementation((sql) => {
    const text = String(sql)
    for (const [needle, value] of Object.entries(map)) {
      if (text.includes(needle)) return Promise.resolve(value)
    }
    return Promise.resolve([{ affectedRows: 1 }, []])
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('applyPremiumCheckout — отсутствие обязательных полей', () => {
  it('metadata пустая → false, ни одного запроса к БД', async () => {
    const applied = await applyPremiumCheckout({ data: { object: {} } }, conn)
    expect(applied).toBe(false)
    expect(conn.query).not.toHaveBeenCalled()
  })

  it('нет userId → false без запроса', async () => {
    const applied = await applyPremiumCheckout({ data: { object: { metadata: { tier: 'plus' } } } }, conn)
    expect(applied).toBe(false)
    expect(conn.query).not.toHaveBeenCalled()
  })

  it('нет tier → false без запроса', async () => {
    const applied = await applyPremiumCheckout({ data: { object: { metadata: { userId: '5' } } } }, conn)
    expect(applied).toBe(false)
    expect(conn.query).not.toHaveBeenCalled()
  })

  it('неизвестный tier → подписка создаётся с ценой 0', async () => {
    connResolving({ 'FROM subscriptions WHERE provider': [[], []] })
    const applied = await applyPremiumCheckout(
      { data: { object: { id: 'cs_unknown', metadata: { userId: '5', tier: 'legendary' } } } },
      conn,
    )
    expect(applied).toBe(true)
    const insert = conn.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO subscriptions'))
    expect(insert[1][5]).toBe(0)
  })

  it('duration_months не задан → по умолчанию 1 месяц', async () => {
    connResolving({ 'FROM subscriptions WHERE provider': [[], []] })
    await applyPremiumCheckout({ data: { object: { id: 'cs_def', metadata: { userId: '5', tier: 'plus' } } } }, conn)
    const insert = conn.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO subscriptions'))
    expect(insert[1][4]).toBe(1)
    expect(insert[1][5]).toBe(299)
  })
})

describe('POST /api/premium/webhook — граничные payload', () => {
  it('checkout.session.completed без userId/tier ничего не применяет', async () => {
    constructEvent.mockReturnValue({ id: 'evt_nometa', type: 'checkout.session.completed', data: { object: { metadata: {} } } })
    connResolving()
    const res = await request(app())
      .post('/api/premium/webhook')
      .set('stripe-signature', 't=1,v1=ok')
      .send({ fake: true })
    expect(res.status).toBe(200)
    expect(res.body.received).toBe(true)
    const sqls = conn.query.mock.calls.map((c) => String(c[0]))
    expect(sqls.some((s) => s.includes('INSERT IGNORE INTO webhook_events'))).toBe(false)
    expect(sqls.some((s) => s.includes('INSERT INTO subscriptions'))).toBe(false)
    expect(conn.commit).not.toHaveBeenCalled()
  })

  it('событие без id: дедуп идёт с пустым event_id и не падает', async () => {
    constructEvent.mockReturnValue({ type: 'checkout.session.completed', data: { object: { metadata: { userId: '5', tier: 'plus' } } } })
    connResolving({ 'FROM subscriptions WHERE provider': [[], []] })
    const res = await request(app())
      .post('/api/premium/webhook')
      .set('stripe-signature', 't=1,v1=ok')
      .send({ fake: true })
    expect(res.status).toBe(200)
    const dedup = conn.query.mock.calls.find((c) => String(c[0]).includes('INSERT IGNORE INTO webhook_events'))
    expect(dedup[1][1]).toBe('')
  })

  it('charge.refunded без id: дедуп с пустым event_id', async () => {
    constructEvent.mockReturnValue({ type: 'charge.refunded', data: { object: { payment_intent: 'pi_x', amount: 100, amount_refunded: 100, refunded: true } } })
    connResolving({ 'FROM subscriptions WHERE provider': [[{ id: 4 }], []] })
    const res = await request(app())
      .post('/api/premium/webhook')
      .set('stripe-signature', 't=1,v1=ok')
      .send({ fake: true })
    expect(res.status).toBe(200)
    const dedup = conn.query.mock.calls.find((c) => String(c[0]).includes('INSERT IGNORE INTO webhook_events'))
    expect(dedup[1][1]).toBe('')
  })
})

describe('applyStripeRefund — отсутствие данных', () => {
  it('payload без data.object → partial, без запроса', async () => {
    const outcome = await applyStripeRefund({}, conn)
    expect(outcome).toEqual({ applied: false, reason: 'partial' })
    expect(conn.query).not.toHaveBeenCalled()
  })
})

function app() {
  const a = express()
  a.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf } }))
  a.use(premiumRoutes)
  return a
}
