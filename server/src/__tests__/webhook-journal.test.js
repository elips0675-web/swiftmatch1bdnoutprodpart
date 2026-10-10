// P1 #8: журнал доставок вебхуков (webhook_deliveries) — запись вне транзакции
// обработки, чтобы упавшая доставка была видна, и чтобы ошибка журнала не роняла платёж.
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

import pool from '../db.js'
import premiumRoutes from '../routes/premium.js'
import { logWebhookDelivery, markWebhookProcessed, markWebhookFailed } from '../webhooks.js'

const constructEvent = stripeWebhooks.constructEvent

function createApp() {
  const app = express()
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf } }))
  app.use(premiumRoutes)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockResolvedValue([{ affectedRows: 1 }, []])
  conn.query.mockResolvedValue([{ affectedRows: 1 }, []])
})

describe('webhooks.js — fail-safe журнал', () => {
  it('logWebhookDelivery пишет INSERT с JSON-payload', async () => {
    await logWebhookDelivery({
      provider: 'stripe',
      eventId: 'evt_1',
      eventType: 'checkout.session.completed',
      payload: { id: 'evt_1', nested: { a: 1 } },
    })
    const [sql, params] = pool.query.mock.calls[0]
    expect(String(sql)).toMatch(/INSERT INTO webhook_deliveries/)
    expect(params[0]).toBe('stripe')
    expect(params[1]).toBe('evt_1')
    expect(params[2]).toBe('checkout.session.completed')
    expect(JSON.parse(params[3])).toEqual({ id: 'evt_1', nested: { a: 1 } })
  })

  it('строковый payload не перекодируется повторно', async () => {
    await logWebhookDelivery({ provider: 'stripe', eventId: 'e', eventType: 't', payload: '{"raw":true}' })
    expect(pool.query.mock.calls[0][1][3]).toBe('{"raw":true}')
  })

  it('ошибка БД в журнале не пробрасывается наружу (платёж важнее)', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    await expect(
      logWebhookDelivery({ provider: 'stripe', eventId: 'e', eventType: 't', payload: {} }),
    ).resolves.toBeUndefined()
  })

  it('markWebhookProcessed и markWebhookFailed тоже глотают ошибку БД', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    await expect(markWebhookProcessed('stripe', 'e')).resolves.toBeUndefined()
    pool.query.mockRejectedValueOnce(new Error('db down'))
    await expect(markWebhookFailed('stripe', 'e', 'boom')).resolves.toBeUndefined()
  })
})

describe('premium-вебхук оставляет след в журнале', () => {
  it('успешная обработка -> INSERT received + UPDATE processed', async () => {
    constructEvent.mockReturnValue({
      id: 'evt_journal_1',
      type: 'checkout.session.completed',
      data: { object: { metadata: { userId: '5', tier: 'plus', duration_months: '1' } } },
    })
    const res = await request(createApp())
      .post('/api/premium/webhook')
      .set('stripe-signature', 't=1,v1=ok')
      .send({ fake: true })

    expect(res.status).toBe(200)
    const sqls = pool.query.mock.calls.map((c) => String(c[0]))
    expect(sqls.some((s) => s.includes('INSERT INTO webhook_deliveries'))).toBe(true)
    expect(sqls.some((s) => s.includes('UPDATE webhook_deliveries') && s.includes("'processed'"))).toBe(true)
  })

  it('падение обработки -> UPDATE failed с текстом ошибки', async () => {
    constructEvent.mockReturnValue({
      id: 'evt_journal_2',
      type: 'checkout.session.completed',
      data: { object: { metadata: { userId: '5', tier: 'plus', duration_months: '1' } } },
    })
    conn.query.mockImplementation((sql) => {
      if (String(sql).includes('INSERT INTO subscriptions')) return Promise.reject(new Error('insert exploded'))
      return Promise.resolve([{ affectedRows: 1 }, []])
    })
    const res = await request(createApp())
      .post('/api/premium/webhook')
      .set('stripe-signature', 't=1,v1=ok')
      .send({ fake: true })

    expect(res.status).toBe(200)
    const failed = pool.query.mock.calls.find(
      (c) => String(c[0]).includes('UPDATE webhook_deliveries') && String(c[0]).includes("'failed'"),
    )
    expect(failed).toBeTruthy()
    expect(String(failed[1][0])).toContain('insert exploded')
  })
})
