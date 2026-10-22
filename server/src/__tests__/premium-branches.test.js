/**
 * Непокрытые ветки routes/premium (Stage 156): ошибка валидатора не маскируется
 * под 400, сбой транзакции mock-оплаты откатывается, сбой дедупликации
 * вебхука возврата не теряется.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'

vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
})

const { log, conn, stripeWebhooks, intFieldMock, actual, refuseMockPayment } = vi.hoisted(() => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  conn: {
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
    query: vi.fn(),
  },
  stripeWebhooks: { constructEvent: vi.fn() },
  intFieldMock: vi.fn(),
  actual: { intField: null },
  refuseMockPayment: vi.fn(() => false),
}))

vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
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
  isProduction: () => false,
  stripeIsConfigured: () => false,
  stripeIsLiveMode: () => false,
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
  app.use(express.json())
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

function journalStatus(status) {
  return pool.query.mock.calls.some(
    (c) => String(c[0]).includes('UPDATE webhook_deliveries') && String(c[0]).includes(`'${status}'`),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  intFieldMock.mockImplementation(actual.intField)
  delete process.env.STRIPE_SECRET_KEY
  delete process.env.STRIPE_LIVE
  delete process.env.STRIPE_WEBHOOK_SECRET
})

afterEach(() => {
  if (SAVED.key === undefined) delete process.env.STRIPE_SECRET_KEY
  else process.env.STRIPE_SECRET_KEY = SAVED.key
  if (SAVED.live === undefined) delete process.env.STRIPE_LIVE
  else process.env.STRIPE_LIVE = SAVED.live
  if (SAVED.hook === undefined) delete process.env.STRIPE_WEBHOOK_SECRET
  else process.env.STRIPE_WEBHOOK_SECRET = SAVED.hook
})

describe('POST /api/premium/create-checkout — сбои', () => {
  it('валидатор бросил не-FieldError: ошибка не маскируется под 400, ответ 500', async () => {
    intFieldMock.mockImplementation(() => {
      throw new Error('validator exploded')
    })

    const res = await checkout()

    expect(res.status).toBe(500)
    expect(res.text).toContain('validator exploded')
    expect(pool.getConnection).not.toHaveBeenCalled()
  })

  it('сбой записи подписки: транзакция откатывается, коммита нет, ответ 500', async () => {
    conn.query.mockImplementation((sql) => {
      if (String(sql).includes('INSERT INTO subscriptions')) return Promise.reject(new Error('db down'))
      return Promise.resolve([{ affectedRows: 1 }, []])
    })

    const res = await checkout()

    expect(res.status).toBe(500)
    expect(conn.rollback).toHaveBeenCalled()
    expect(conn.commit).not.toHaveBeenCalled()
    expect(conn.release).toHaveBeenCalled()
  })
})

describe('POST /api/premium/webhook — сбой дедупликации возврата', () => {
  it('падение записи в webhook_events: откат, лог и отметка failed, ответ 200', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_dummy'
    stripeWebhooks.constructEvent.mockReturnValue({
      id: 'evt_refund_fail',
      type: 'charge.refunded',
      data: { object: { payment_intent: 'pi_fail', amount: 1000, amount_refunded: 1000, refunded: true } },
    })
    conn.query.mockImplementation((sql) => {
      if (String(sql).includes('INSERT IGNORE INTO webhook_events')) return Promise.reject(new Error('db down'))
      return Promise.resolve([{ affectedRows: 1 }, []])
    })

    const res = await postWebhook()

    expect(res.status).toBe(200)
    expect(conn.rollback).toHaveBeenCalled()
    expect(log.error).toHaveBeenCalledWith('Refund webhook error:', expect.any(Error))
    expect(journalStatus('failed')).toBe(true)
  })

  it('checkout.session.completed: падение applyPremiumCheckout -> откат, лог и отметка failed', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_dummy'
    stripeWebhooks.constructEvent.mockReturnValue({
      id: 'evt_chk_fail',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_fail', payment_intent: 'pi_fail', metadata: { userId: '5', tier: 'plus', duration_months: '1' } } },
    })
    conn.query.mockImplementation((sql) => {
      const text = String(sql)
      if (text.includes('INSERT IGNORE INTO webhook_events')) return Promise.resolve([{ affectedRows: 1 }, []])
      if (text.includes('FROM subscriptions WHERE provider')) return Promise.resolve([[], []])
      if (text.includes('INSERT INTO subscriptions')) return Promise.reject(new Error('insert down'))
      return Promise.resolve([{ affectedRows: 1 }, []])
    })

    const res = await postWebhook()

    expect(res.status).toBe(200)
    expect(conn.rollback).toHaveBeenCalled()
    expect(log.error).toHaveBeenCalledWith('Webhook insert error:', expect.any(Error))
    expect(journalStatus('failed')).toBe(true)
  })
})

describe('POST /api/premium/create-checkout — live/mock гейты', () => {
  it('STRIPE_LIVE=true без ключа: refuseMockPayment отдаёт 503 STRIPE_NOT_CONFIGURED', async () => {
    process.env.STRIPE_LIVE = 'true'
    delete process.env.STRIPE_SECRET_KEY
    refuseMockPayment.mockImplementation((res) => {
      res.status(503).json({ code: 'STRIPE_NOT_CONFIGURED', message: 'Stripe not configured in live mode' })
      return true
    })

    const res = await checkout()

    expect(res.status).toBe(503)
    expect(res.body.code).toBe('STRIPE_NOT_CONFIGURED')
    expect(pool.getConnection).not.toHaveBeenCalled()
  })

  it('без Stripe-конфига в тесте: refuseMockPayment блокирует mock-путь, отдаёт 503', async () => {
    delete process.env.STRIPE_SECRET_KEY
    delete process.env.STRIPE_LIVE
    refuseMockPayment.mockImplementation((res) => {
      res.status(503).json({ code: 'STRIPE_NOT_CONFIGURED', message: 'Stripe not configured for production' })
      return true
    })

    const res = await checkout()

    expect(res.status).toBe(503)
    expect(res.body.code).toBe('STRIPE_NOT_CONFIGURED')
    expect(pool.getConnection).not.toHaveBeenCalled()
  })
})
