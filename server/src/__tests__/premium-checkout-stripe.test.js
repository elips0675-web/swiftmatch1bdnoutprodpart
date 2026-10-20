vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'

const { create } = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
    getConnection: vi.fn(),
  },
}))

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('stripe', () => ({
  default: function StripeMock() {
    return { checkout: { sessions: { create } } }
  },
}))

import premiumRoutes from '../routes/premium.js'
import pool from '../db.js'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

function authToken(userId = 1) {
  return jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })
}

function mockTransaction() {
  const conn = { query: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() }
  pool.getConnection.mockResolvedValue(conn)
  return conn
}

function createApp() {
  const app = express()
  app.use(express.json())
  app.use(premiumRoutes)
  return app
}

function checkout(body = { tier: 'plus', duration_months: 1 }) {
  return request(createApp())
    .post('/api/premium/create-checkout')
    .set('Authorization', `Bearer ${authToken()}`)
    .set('Origin', 'https://swiftmatch.app')
    .send(body)
}

describe('POST /api/premium/create-checkout со Stripe-ключом', () => {
  let saved

  beforeEach(() => {
    vi.clearAllMocks()
    saved = { key: process.env.STRIPE_SECRET_KEY, live: process.env.STRIPE_LIVE }
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'
    delete process.env.STRIPE_LIVE
    mockTransaction()
    pool.query.mockResolvedValue([[], []])
  })

  afterEach(() => {
    if (saved.key === undefined) delete process.env.STRIPE_SECRET_KEY
    else process.env.STRIPE_SECRET_KEY = saved.key
    if (saved.live === undefined) delete process.env.STRIPE_LIVE
    else process.env.STRIPE_LIVE = saved.live
  })

  it('успешная сессия: отдаёт url и sessionId, mock-подписка не создаётся', async () => {
    create.mockResolvedValue({ id: 'cs_checkout_1', url: 'https://checkout.stripe.com/cs_checkout_1' })

    const res = await checkout()

    expect(res.status).toBe(200)
    expect(res.body.url).toBe('https://checkout.stripe.com/cs_checkout_1')
    expect(res.body.sessionId).toBe('cs_checkout_1')
    expect(pool.getConnection).not.toHaveBeenCalled()
    expect(pool.query).not.toHaveBeenCalled()
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('параметры сессии считают сумму от цены тарифа и числа месяцев', async () => {
    create.mockResolvedValue({ id: 'cs_checkout_2', url: 'https://checkout.stripe.com/cs_checkout_2' })

    await checkout({ tier: 'gold', duration_months: 3 })

    const params = create.mock.calls[0][0]
    expect(params.line_items[0].price_data.unit_amount).toBe(699 * 3 * 100)
    expect(params.line_items[0].price_data.product_data.name).toContain('Gold')
    expect(params.metadata).toMatchObject({ userId: '1', tier: 'gold', duration_months: '3' })
    expect(params.success_url).toContain('/premium/success')
    expect(params.cancel_url).toContain('/premium/cancel')
  })

  it('ключ есть, но STRIPE_LIVE не поднят: сбой Stripe откатывается в mock (201)', async () => {
    create.mockRejectedValue(new Error('stripe down'))

    const res = await checkout()

    expect(res.status).toBe(201)
    expect(res.body.message).toMatch(/mock/i)
    expect(pool.getConnection).toHaveBeenCalled()
  })

  it('STRIPE_LIVE=true: сбой Stripe — 502, mock НЕ включается', async () => {
    process.env.STRIPE_LIVE = 'true'
    create.mockRejectedValue(new Error('stripe down'))

    const res = await checkout()

    expect(res.status).toBe(502)
    expect(res.body.message).toBe('Stripe payment failed')
    expect(res.body.error).toBe('stripe down')
    expect(pool.getConnection).not.toHaveBeenCalled()
  })

  it('STRIPE_LIVE=true: успешная сессия отдаёт url, доступ не выдаётся сразу', async () => {
    process.env.STRIPE_LIVE = 'true'
    create.mockResolvedValue({ id: 'cs_live_1', url: 'https://checkout.stripe.com/cs_live_1' })

    const res = await checkout()

    expect(res.status).toBe(200)
    expect(res.body.sessionId).toBe('cs_live_1')
    expect(pool.getConnection).not.toHaveBeenCalled()
  })
})
