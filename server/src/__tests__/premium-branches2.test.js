/** 
 * Обратные подстановки для routes/premium (Stage 156) — защищает гварды, ветки
 * транзакции и обработку ошибок вебхука.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'

vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
})

const { conn, poolQuery, stripeWebhooks, intFieldMock, actual, refuseMockPayment, log } = vi.hoisted(() => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  conn: {
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
    query: vi.fn(),
  },
  poolQuery: vi.fn(),
  stripeWebhooks: { constructEvent: vi.fn() },
  intFieldMock: vi.fn(),
  actual: { intField: null },
  refuseMockPayment: vi.fn(() => false),
}))

vi.mock('../db.js', () => ({
  default: {
    query: poolQuery,
    getConnection: vi.fn(async () => conn),
  },
}))

vi.mock('../logger.js', () => ({
  default: log,
  createLogger: () => log,
  rootLogger: log,
}))

vi.mock('../runtime.js', () => ({
  refuseMockPayment,
}))

vi.mock('stripe', () => ({
  default: function StripeMock() {
    return { webhooks: stripeWebhooks }
  },
}))

vi.mock('../profile-fields.js', async (importOriginal) => {
  const mod = await importOriginal()
  actual.intField = mod.intField
  return { ...mod, intField: intFieldMock }
})

import premiumRoutes from '../routes/premium.js'
import pool from '../db.js'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'
const SAVED = {
  key: process.env.STRIPE_SECRET_KEY,
  live: process.env.STRIPE_LIVE,
  hook: process.env.STRIPE_WEBHOOK_SECRET,
}

function authToken(userId = 1) {
  return jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })
}

function createApp() {
  const app = express()
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf } }))
  app.use(premiumRoutes)
  return app
}

function checkout(body = { tier: 'plus', duration_months: 1 }) {
  return request(createApp())
    .post('/api/premium/create-checkout')
    .set('Authorization', `Bearer ${authToken()}`)
    .send(body)
}

function postWebhook() {
  return request(createApp())
    .post('/api/premium/webhook')
    .set('stripe-signature', 't=1,v1=ok')
    .send({ fake: true })
}

beforeEach(() => {
  vi.clearAllMocks()
  intFieldMock.mockImplementation(actual.intField)
  delete process.env.STRIPE_SECRET_KEY
  delete process.env.STRIPE_LIVE
  delete process.env.STRIPE_WEBHOOK_SECRET
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_dummy'
  poolQuery.mockResolvedValue([[], []])
  conn.query.mockResolvedValue([{ affectedRows: 1 }, []])
})

describe('Stage 156 обратные подстановки', () => {
  it('tier/duration_months обязательны (400)', async () => {
    const res = await checkout({ tier: 'plus' })
    expect(res.status).toBe(400)
  })

  it('неизвестный tier (400)', async () => {
    const res = await checkout({ tier: 'unknown', duration_months: 1 })
    expect(res.status).toBe(400)
  })

  it('intField кидает не-FieldError -> пробрасывается (500)', async () => {
    intFieldMock.mockImplementation(() => {
      const err = new Error('boom')
      err.name = 'OtherError'
      throw err
    })
    const res = await checkout()
    expect(res.status).toBe(500)
  })

  it('GET /api/premium/my: есть подписка возвращается', async () => {
    poolQuery.mockResolvedValue([[{ tier: 'gold', expires_at: '2099-01-01' }], []])
    const res = await request(createApp()).get('/api/premium/my').set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.tier).toBe('gold')
  })

  it('GET /api/premium/my: ошибка БД -> 500', async () => {
    poolQuery.mockRejectedValue(new Error('db'))
    const res = await request(createApp()).get('/api/premium/my').set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(500)
  })

  it('cancel: нет активной -> 404', async () => {
    poolQuery.mockResolvedValueOnce([{ affectedRows: 0 }, []])
    const res = await request(createApp()).post('/api/premium/cancel').set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(404)
  })

  it('cancel: активна -> 200 с expires_at', async () => {
    poolQuery.mockResolvedValueOnce([{ affectedRows: 1 }, []]).mockResolvedValueOnce([[{ expires_at: '2099-01-01' }], []])
    const res = await request(createApp()).post('/api/premium/cancel').set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('canceled')
  })

  it('cancel: ошибка БД -> 500', async () => {
    poolQuery.mockRejectedValue(new Error('db'))
    const res = await request(createApp()).post('/api/premium/cancel').set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(500)
  })

  it('webhook: без ключа -> 200 received true', async () => {
    delete process.env.STRIPE_SECRET_KEY
    const res = await postWebhook()
    expect(res.status).toBe(200)
    expect(res.body.received).toBe(true)
  })

  it('webhook: нет подписи -> 400', async () => {
    const res = await request(createApp()).post('/api/premium/webhook').send({ fake: true })
    expect(res.status).toBe(400)
  })

  it('webhook: checkout.session.completed без userId/tier -> 200', async () => {
    stripeWebhooks.constructEvent.mockReturnValue({ id: 'evt1', type: 'checkout.session.completed', data: { object: { metadata: {} } } })
    const res = await postWebhook()
    expect(res.status).toBe(200)
  })

  it('webhook: checkout дубликат события -> rollback, 200', async () => {
    stripeWebhooks.constructEvent.mockReturnValue({ id: 'evt2', type: 'checkout.session.completed', data: { object: { id: 'cs1', payment_intent: 'pi1', metadata: { userId: '1', tier: 'plus' } } } })
    conn.query.mockImplementation((sql) => {
      if (String(sql).includes('INSERT IGNORE INTO webhook_events')) return Promise.resolve([{ affectedRows: 0 }, []])
      return Promise.resolve([{ affectedRows: 1 }, []])
    })
    const res = await postWebhook()
    expect(res.status).toBe(200)
    expect(conn.rollback).toHaveBeenCalled()
  })

  it('webhook: charge.refunded дубликат -> rollback, 200', async () => {
    stripeWebhooks.constructEvent.mockReturnValue({ id: 'evt3', type: 'charge.refunded', data: { object: { payment_intent: 'pi1', amount: 1000, amount_refunded: 1000, refunded: true } } })
    conn.query.mockImplementation((sql) => {
      if (String(sql).includes('INSERT IGNORE INTO webhook_events')) return Promise.resolve([{ affectedRows: 0 }, []])
      return Promise.resolve([{ affectedRows: 1 }, []])
    })
    const res = await postWebhook()
    expect(res.status).toBe(200)
    expect(conn.rollback).toHaveBeenCalled()
  })

  it('webhook: charge.refunded частичный -> processed', async () => {
    stripeWebhooks.constructEvent.mockReturnValue({ id: 'evt4', type: 'charge.refunded', data: { object: { payment_intent: 'pi2', amount: 1000, amount_refunded: 300, refunded: false } } })
    conn.query.mockImplementation((sql) => {
      if (String(sql).includes('INSERT IGNORE INTO webhook_events')) return Promise.resolve([{ affectedRows: 1 }, []])
      return Promise.resolve([{ affectedRows: 1 }, []])
    })
    const res = await postWebhook()
    expect(res.status).toBe(200)
  })

  it('webhook: charge.refunded не найден -> failed', async () => {
    stripeWebhooks.constructEvent.mockReturnValue({ id: 'evt5', type: 'charge.refunded', data: { object: { payment_intent: 'pi3', amount: 1000, amount_refunded: 1000, refunded: true } } })
    conn.query.mockImplementation((sql) => {
      if (String(sql).includes('INSERT IGNORE INTO webhook_events')) return Promise.resolve([{ affectedRows: 1 }, []])
      if (String(sql).includes('FROM subscriptions WHERE provider')) return Promise.resolve([[], []])
      return Promise.resolve([{ affectedRows: 1 }, []])
    })
    const res = await postWebhook()
    expect(res.status).toBe(200)
  })

  it('webhook: charge.refunded без payment_intent -> failed', async () => {
    stripeWebhooks.constructEvent.mockReturnValue({ id: 'evt6', type: 'charge.refunded', data: { object: { amount: 1000, amount_refunded: 1000, refunded: true } } })
    conn.query.mockImplementation((sql) => {
      if (String(sql).includes('INSERT IGNORE INTO webhook_events')) return Promise.resolve([{ affectedRows: 1 }, []])
      return Promise.resolve([{ affectedRows: 1 }, []])
    })
    const res = await postWebhook()
    expect(res.status).toBe(200)
  })
})
