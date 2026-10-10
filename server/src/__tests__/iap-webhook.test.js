// Этап 42 (аудит дипсик #9): RevenueCat webhook security unit
// нет секрета -> 503, битый Bearer -> 401, события пишут в subscriptions,
// product_id -> tier (M5): plus_1m -> plus, duration_months/price/expires_at заполняются,
// неизвестный product_id -> 400 без записи в БД
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
  process.env.REVENUECAT_WEBHOOK_SECRET = 'rc_secret_dummy'
})

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }))
vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import iapRoutes from '../routes/iap.js'
import pool from '../db.js'

function createApp() {
  const app = express()
  app.use(express.json())
  app.use(iapRoutes)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockResolvedValue([{ affectedRows: 1 }, []])
})

function sendEvent(overrides = {}, raw = false) {
  const body = raw ? overrides : { event: { type: 'INITIAL_PURCHASE', app_user_id: '5', product_id: 'plus_1m', expiration_at_ms: Date.now() + 30 * 24 * 3600 * 1000, ...overrides } }
  return request(createApp())
    .post('/api/iap/webhook')
    .set('Authorization', 'Bearer rc_secret_dummy')
    .send(body)
}

describe('POST /api/iap/webhook security', () => {
  it('секрет не настроен -> 503 not configured', async () => {
    delete process.env.REVENUECAT_WEBHOOK_SECRET
    try {
      const res = await request(createApp()).post('/api/iap/webhook').set('Authorization', '').send({})
      expect([401, 503]).toContain(res.status)
    } finally {
      process.env.REVENUECAT_WEBHOOK_SECRET = 'rc_secret_dummy'
    }
  })

  it('неверный Bearer -> 401 Invalid signature', async () => {
    const res = await request(createApp())
      .post('/api/iap/webhook')
      .set('Authorization', 'Bearer wrong')
      .send({ event: { type: 'INITIAL_PURCHASE' } })
    expect(res.status).toBe(401)
    expect(res.body.message).toMatch(/Invalid signature/i)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('INITIAL_PURCHASE маппит plus_12m в tier=plus, заполняет duration_months/price/expires_at', async () => {
    const res = await sendEvent({ product_id: 'plus_12m' })
    expect(res.status).toBe(200)
    expect(res.body.received).toBe(true)
    const [sql, params] = pool.query.mock.calls[0]
    expect(String(sql)).toMatch(/INSERT INTO subscriptions/)
    expect(String(sql)).toMatch(/'revenuecat'/)
    expect(String(sql)).toMatch(/duration_months/)
    expect(String(sql)).toMatch(/price/)
    expect(String(sql)).toMatch(/expires_at/)
    expect(params[0]).toBe('5')
    expect(params[1]).toBe('plus')
    expect(params[2]).toBe('plus_12m')
    expect(params[3]).toBe(12)
    expect(params[4]).toBe(Math.round(499 * 12 * 0.6))
    expect(params[5]).toBeInstanceOf(Date)
  })

  it('маппинг для всех тиров: plus/gold/platinum с разными duration', async () => {
    const cases = [
      { product_id: 'gold_6m', tier: 'gold', months: 6, price: Math.round(999 * 6 * 0.8) },
      { product_id: 'platinum_1m', tier: 'platinum', months: 1, price: 1990 },
      { product_id: 'plus_1m', tier: 'plus', months: 1, price: 499 },
    ]
    for (const c of cases) {
      pool.query.mockClear()
      const res = await sendEvent({ product_id: c.product_id })
      expect(res.status).toBe(200)
      const [, params] = pool.query.mock.calls[0]
      expect(params[1]).toBe(c.tier)
      expect(params[2]).toBe(c.product_id)
      expect(params[3]).toBe(c.months)
      expect(params[4]).toBe(c.price)
    }
  })

  it('неизвестный product_id -> 400, ничего не пишет в БД', async () => {
    const res = await sendEvent({ product_id: 'premium_monthly' })
    expect(res.status).toBe(400)
    expect(res.body.received).toBe(false)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('RENEWAL обновляет/создаёт подписку с правильным тиром', async () => {
    pool.query.mockClear()
    const res = await sendEvent({ type: 'RENEWAL', product_id: 'gold_12m' })
    expect(res.status).toBe(200)
    const [sql, params] = pool.query.mock.calls[0]
    expect(String(sql)).toMatch(/INSERT INTO subscriptions/)
    expect(params[1]).toBe('gold')
    expect(params[3]).toBe(12)
    expect(params[4]).toBe(Math.round(999 * 12 * 0.6))
  })

  it('CANCELLATION и EXPIRATION обновляют статус по user+product', async () => {
    await request(createApp())
      .post('/api/iap/webhook')
      .set('Authorization', 'Bearer rc_secret_dummy')
      .send({ event: { type: 'CANCELLATION', app_user_id: '5', product_id: 'plus_12m' } })
    let [sql] = pool.query.mock.calls[0]
    expect(String(sql)).toMatch(/status = 'canceled'/)

    pool.query.mockClear()
    await request(createApp())
      .post('/api/iap/webhook')
      .set('Authorization', 'Bearer rc_secret_dummy')
      .send({ event: { type: 'EXPIRATION', app_user_id: '5', product_id: 'plus_12m' } })
    ;[sql] = pool.query.mock.calls[0]
    expect(String(sql)).toMatch(/status = 'expired'/)
  })

  it('неизвестный тип события -> 200 received без запросов к БД', async () => {
    const res = await request(createApp())
      .post('/api/iap/webhook')
      .set('Authorization', 'Bearer rc_secret_dummy')
      .send({ event: { type: 'TRANSFER', app_user_id: '5', product_id: 'x' } })
    expect(res.status).toBe(200)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('ошибка БД -> 500, секрет не утекает в ответе', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await sendEvent({ product_id: 'plus_1m' })
    expect(res.status).toBe(500)
    expect(JSON.stringify(res.body)).not.toContain('rc_secret_dummy')
  })
})

describe('GET /api/iap/products', () => {
  it('product_id = {tier}_{1m|6m|12m}, по 3 длительности на тир', async () => {
    const res = await request(createApp()).get('/api/iap/products')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(9)
    const ids = res.body.map((p) => p.id)
    expect(ids).toContain('plus_1m')
    expect(ids).toContain('plus_6m')
    expect(ids).toContain('plus_12m')
    expect(ids).toContain('gold_1m')
    expect(ids).toContain('platinum_6m')
    expect(new Set(ids).size).toBe(9)
  })

  it('цена считается по формуле tier.price*months*(1-discount/100)', async () => {
    const res = await request(createApp()).get('/api/iap/products')
    const plus12 = res.body.find((p) => p.id === 'plus_12m')
    expect(plus12.price).toBe(Math.round(499 * 12 * 0.6))
    const gold6 = res.body.find((p) => p.id === 'gold_6m')
    expect(gold6.price).toBe(Math.round(999 * 6 * 0.8))
  })
})