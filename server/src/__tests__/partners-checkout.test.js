vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
  delete process.env.REDIS_URL
  delete process.env.STRIPE_SECRET_KEY
  delete process.env.STRIPE_LIVE
})

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import express from 'express'

const { stripeCreate, constructEvent, connQuery, conn, poolMock } = vi.hoisted(() => {
  const connection = {
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
    query: vi.fn(),
  }
  return {
    stripeCreate: vi.fn(),
    constructEvent: vi.fn(),
    connQuery: connection.query,
    conn: connection,
    poolMock: { query: vi.fn(), getConnection: vi.fn() },
  }
})

vi.mock('../db.js', () => ({ default: poolMock }))

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('../middleware.js', () => ({
  auth: (req, _res, next) => {
    req.userId = 5
    next()
  },
}))

vi.mock('../ws.js', () => ({ getIO: vi.fn(() => null) }))

vi.mock('../cache.js', () => ({
  getCached: vi.fn(async () => null),
  setCached: vi.fn(async () => {}),
  invalidate: vi.fn(async () => {}),
}))

const { logDeliveryMock, markProcessedMock, markFailedMock } = vi.hoisted(() => ({
  logDeliveryMock: vi.fn(async () => {}),
  markProcessedMock: vi.fn(async () => {}),
  markFailedMock: vi.fn(async () => {}),
}))
vi.mock('../webhooks.js', () => ({
  logWebhookDelivery: logDeliveryMock,
  markWebhookProcessed: markProcessedMock,
  markWebhookFailed: markFailedMock,
  WEBHOOK_PROVIDERS: Object.freeze({
    stripe: 'stripe',
    partnerOrder: 'partner_order',
    revenuecat: 'revenuecat',
    twilio: 'twilio',
  }),
}))

vi.mock('stripe', () => ({
  default: function StripeMock() {
    return { checkout: { sessions: { create: stripeCreate } }, webhooks: { constructEvent } }
  },
}))

import pool from '../db.js'
import logger from '../logger.js'
import partnersRoutes from '../routes/partners.js'

const app = express()
app.use(express.json())
app.use(partnersRoutes)

const ENV = {
  key: process.env.STRIPE_SECRET_KEY,
  live: process.env.STRIPE_LIVE,
}

const partnerRow = (over = {}) => ({
  id: 3,
  affiliate_token: 'tok',
  hmac_secret: null,
  commission_rate: '10.00',
  ...over,
})

const offerRow = (over = {}) => ({
  id: 4,
  partner_id: 3,
  title: 'Букет',
  price: '1200.00',
  deeplink: 'https://shop.example/gift',
  partner_name: 'Цветы',
  commission_rate: '10.00',
  partner_status: 'active',
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.STRIPE_SECRET_KEY
  delete process.env.STRIPE_LIVE
  pool.query.mockReset()
  pool.query.mockResolvedValue([[], []])
  pool.getConnection.mockReset()
  pool.getConnection.mockResolvedValue(conn)
  connQuery.mockReset()
  connQuery.mockResolvedValue([[], []])
  stripeCreate.mockReset()
  stripeCreate.mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.com/cs_1' })
  constructEvent.mockReset()
  logDeliveryMock.mockReset()
  logDeliveryMock.mockResolvedValue(undefined)
  markProcessedMock.mockReset()
  markProcessedMock.mockResolvedValue(undefined)
  markFailedMock.mockReset()
  markFailedMock.mockResolvedValue(undefined)
})

afterAll(() => {
  if (ENV.key === undefined) delete process.env.STRIPE_SECRET_KEY
  else process.env.STRIPE_SECRET_KEY = ENV.key
  if (ENV.live === undefined) delete process.env.STRIPE_LIVE
  else process.env.STRIPE_LIVE = ENV.live
})

describe('POST /api/partners/postback/:id: разрешение offer_id', () => {
  it('offer_id своего партнёра сохраняется, комиссия считается от суммы', async () => {
    pool.query
      .mockResolvedValueOnce([[partnerRow()], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ id: 4 }], []])
      .mockResolvedValueOnce([{ insertId: 9 }, []])
    const res = await request(app)
      .post('/api/partners/postback/3')
      .query({ token: 'tok' })
      .send({ external_order_id: 'ext-1', amount: 1200, offer_id: 4 })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: 9, commission: 120 })
    const insert = pool.query.mock.calls[3]
    expect(insert[1]).toEqual([3, 4, null, 'purchase', 'ext-1', 1200, 120])
  })

  it('offer_id чужого партнёра превращается в NULL, конверсия всё равно пишется', async () => {
    pool.query
      .mockResolvedValueOnce([[partnerRow()], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ insertId: 10 }, []])
    const res = await request(app)
      .post('/api/partners/postback/3')
      .query({ token: 'tok' })
      .send({ external_order_id: 'ext-2', amount: 500, offer_id: 999 })
    expect(res.status).toBe(200)
    expect(pool.query.mock.calls[3][1][1]).toBeNull()
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app)
      .post('/api/partners/postback/3')
      .query({ token: 'tok' })
      .send({ external_order_id: 'ext-3', amount: 100 })
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Partner postback error:', expect.any(Error))
  })
})

describe('POST /api/partners/order: Stripe и mock', () => {
  it('с ключом Stripe создаёт сессию и pending-заказ, отдаёт url', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'
    pool.query
      .mockResolvedValueOnce([[offerRow()], []])
      .mockResolvedValueOnce([{ insertId: 1 }, []])
    const res = await request(app)
      .post('/api/partners/order')
      .set('Origin', 'http://localhost:8081')
      .send({ offer_id: 4, recipient_name: 'Маша', recipient_address: 'Сочи, ул. 1', gift_message: 'С днём!' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ url: 'https://checkout.stripe.com/cs_1', sessionId: 'cs_1' })
    expect(stripeCreate).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'payment',
      success_url: 'http://localhost:8081/partner-order/success?session_id={CHECKOUT_SESSION_ID}',
      metadata: expect.objectContaining({ userId: '5', offer_id: '4', partner_id: '3', recipient_name: 'Маша' }),
    }))
    const insert = pool.query.mock.calls[1]
    expect(String(insert[0])).toContain("'pending'")
    expect(insert[1]).toEqual([3, 4, 5, 'cs_1', 1200, 120, 'Маша', 'Сочи, ул. 1', 'С днём!'])
  })

  it('падение Stripe в live-режиме — 502, заказ не создаётся', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_x'
    process.env.STRIPE_LIVE = 'true'
    stripeCreate.mockRejectedValueOnce(new Error('card declined'))
    pool.query.mockResolvedValueOnce([[offerRow()], []])
    const res = await request(app).post('/api/partners/order').send({ offer_id: 4 })
    expect(res.status).toBe(502)
    expect(res.body.message).toMatch(/Stripe payment failed/)
    expect(pool.query).toHaveBeenCalledTimes(1)
  })

  it('падение Stripe вне live — тихий откат в mock-заказ 201', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'
    stripeCreate.mockRejectedValueOnce(new Error('network'))
    pool.query
      .mockResolvedValueOnce([[offerRow()], []])
      .mockResolvedValueOnce([{ insertId: 2 }, []])
    const res = await request(app).post('/api/partners/order').send({ offer_id: 4 })
    expect(res.status).toBe(201)
    expect(res.body.message).toMatch(/mock/)
    expect(res.body.orderId).toMatch(/^mock_/)
  })

  it('STRIPE_LIVE без ключа — 503 STRIPE_NOT_CONFIGURED, без запроса в БД', async () => {
    process.env.STRIPE_LIVE = 'true'
    pool.query.mockResolvedValueOnce([[offerRow()], []])
    const res = await request(app).post('/api/partners/order').send({ offer_id: 4 })
    expect(res.status).toBe(503)
    expect(res.body.code).toBe('STRIPE_NOT_CONFIGURED')
  })

  it('оффер без цены — 400 без обращения к Stripe', async () => {
    pool.query.mockResolvedValueOnce([[offerRow({ price: null })], []])
    const res = await request(app).post('/api/partners/order').send({ offer_id: 4 })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/no price/)
    expect(stripeCreate).not.toHaveBeenCalled()
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).post('/api/partners/order').send({ offer_id: 4 })
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Partner order error:', expect.any(Error))
  })
})

describe('POST /api/partners/order/webhook', () => {
  it('без STRIPE_SECRET_KEY — 200 received (контракт Stripe), без проверки подписи', async () => {
    const res = await request(app).post('/api/partners/order/webhook').send({})
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ received: true })
    expect(constructEvent).not.toHaveBeenCalled()
  })

  it('без заголовка подписи — 400', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec'
    const res = await request(app).post('/api/partners/order/webhook').send({})
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/Missing signature/)
  })

  it('битая подпись — 400 Invalid signature', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec'
    constructEvent.mockImplementationOnce(() => {
      throw new Error('bad sig')
    })
    const res = await request(app)
      .post('/api/partners/order/webhook')
      .set('stripe-signature', 't=1,v1=dead')
      .send({ foo: 'bar' })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Invalid signature')
    expect(logger.error).toHaveBeenCalledWith('Partner order webhook signature error:', expect.any(Error))
  })

  it('чужой тип события игнорируется', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec'
    constructEvent.mockReturnValueOnce({ id: 'evt_x', type: 'payment_intent.created', data: { object: {} } })
    const res = await request(app).post('/api/partners/order/webhook').set('stripe-signature', 't=1,v1=ok').send({})
    expect(res.status).toBe(200)
    expect(pool.getConnection).not.toHaveBeenCalled()
    expect(logDeliveryMock).not.toHaveBeenCalled()
  })

  it('checkout.session.completed без оплаты — received без транзакции', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec'
    constructEvent.mockReturnValueOnce({
      id: 'evt_unpaid',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_1', payment_status: 'unpaid' } },
    })
    const res = await request(app).post('/api/partners/order/webhook').set('stripe-signature', 't=1,v1=ok').send({})
    expect(res.status).toBe(200)
    expect(pool.getConnection).not.toHaveBeenCalled()
    expect(logDeliveryMock).not.toHaveBeenCalled()
  })

  it('оплаченная сессия: заказ paid, конверсия, коммит и markWebhookProcessed', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec'
    constructEvent.mockReturnValueOnce({
      id: 'evt_paid_1',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_1', payment_status: 'paid' } },
    })
    connQuery.mockImplementation(async (sql) => {
      if (String(sql).includes('INSERT IGNORE INTO webhook_events')) return [{ affectedRows: 1 }, []]
      return [{}, []]
    })
    const res = await request(app).post('/api/partners/order/webhook').set('stripe-signature', 't=1,v1=ok').send({})
    expect(res.status).toBe(200)
    expect(logDeliveryMock).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'partner_order',
      eventId: 'evt_paid_1',
      eventType: 'checkout.session.completed',
    }))
    const sqls = connQuery.mock.calls.map((c) => String(c[0]))
    expect(sqls[0]).toContain('INSERT IGNORE INTO webhook_events')
    expect(sqls.some((s) => s.includes("UPDATE partner_orders SET status = 'paid'"))).toBe(true)
    expect(sqls.some((s) => s.includes('INSERT INTO partner_conversions'))).toBe(true)
    const update = connQuery.mock.calls.find((c) => String(c[0]).includes("UPDATE partner_orders SET status = 'paid'"))
    expect(update[1]).toEqual(['cs_1'])
    expect(conn.commit).toHaveBeenCalled()
    expect(markProcessedMock).toHaveBeenCalledWith('partner_order', 'evt_paid_1')
    expect(conn.release).toHaveBeenCalled()
  })

  it('повторная доставка события откатывается и не применяет заказ', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec'
    constructEvent.mockReturnValueOnce({
      id: 'evt_replay',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_1', payment_status: 'paid' } },
    })
    connQuery.mockResolvedValueOnce([{ affectedRows: 0 }, []])
    const res = await request(app).post('/api/partners/order/webhook').set('stripe-signature', 't=1,v1=ok').send({})
    expect(res.status).toBe(200)
    expect(conn.rollback).toHaveBeenCalled()
    expect(conn.commit).not.toHaveBeenCalled()
    const sqls = connQuery.mock.calls.map((c) => String(c[0]))
    expect(sqls.some((s) => s.includes('UPDATE partner_orders'))).toBe(false)
    expect(markProcessedMock).not.toHaveBeenCalled()
  })

  it('падение транзакции — rollback, markWebhookFailed, ответ всё равно 200', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec'
    constructEvent.mockReturnValueOnce({
      id: 'evt_fail',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_1', payment_status: 'paid' } },
    })
    connQuery.mockImplementation(async (sql) => {
      if (String(sql).includes('INSERT IGNORE INTO webhook_events')) return [{ affectedRows: 1 }, []]
      throw new Error('db down')
    })
    const res = await request(app).post('/api/partners/order/webhook').set('stripe-signature', 't=1,v1=ok').send({})
    expect(res.status).toBe(200)
    expect(conn.rollback).toHaveBeenCalled()
    expect(markFailedMock).toHaveBeenCalledWith('partner_order', 'evt_fail', 'db down')
    expect(markProcessedMock).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledWith('Partner order webhook processing error:', expect.any(Error))
    expect(conn.release).toHaveBeenCalled()
  })
})
