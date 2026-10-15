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

import premiumRoutes, { applyPremiumEvent, applyStripeRefund } from '../routes/premium.js'
import pool from '../db.js'

const constructEvent = stripeWebhooks.constructEvent

function journalStatus(status) {
  return pool.query.mock.calls.some((c) => String(c[0]).includes('UPDATE webhook_deliveries') && String(c[0]).includes(`'${status}'`))
}

function createApp() {
  const app = express()
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf } }))
  app.use(premiumRoutes)
  return app
}

function postWebhook() {
  return request(createApp())
    .post('/api/premium/webhook')
    .set('stripe-signature', 't=1,v1=ok')
    .send({ fake: true })
}

function refundEvent(charge, id = 'evt_refund_1') {
  return { id, type: 'charge.refunded', data: { object: charge } }
}

function mockConn({ subscriptionRows = [{ id: 42 }], dedupAffectedRows = 1 } = {}) {
  conn.query.mockImplementation((sql) => {
    const text = String(sql)
    if (text.includes('INSERT IGNORE INTO webhook_events')) return Promise.resolve([{ affectedRows: dedupAffectedRows }, []])
    if (text.includes('FROM subscriptions WHERE provider')) return Promise.resolve([subscriptionRows, []])
    return Promise.resolve([{ affectedRows: 1 }, []])
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/premium/webhook — charge.refunded', () => {
  it('полный возврат снимает доступ: is_active = 0 и status = refunded', async () => {
    constructEvent.mockReturnValue(refundEvent({ payment_intent: 'pi_full', amount: 1000, amount_refunded: 1000, refunded: true }))
    mockConn()
    const res = await postWebhook()
    expect(res.status).toBe(200)
    expect(res.body.received).toBe(true)
    const update = conn.query.mock.calls.find((c) => String(c[0]).includes('UPDATE subscriptions SET is_active = 0, status'))
    expect(update).toBeDefined()
    expect(String(update[0])).toContain("status = 'refunded'")
    expect(update[1]).toEqual([42])
    expect(conn.commit).toHaveBeenCalled()
    expect(journalStatus('processed')).toBe(true)
  })

  it('частичный возврат: подписку не трогаем, доставка processed', async () => {
    constructEvent.mockReturnValue(refundEvent({ payment_intent: 'pi_part', amount: 1000, amount_refunded: 300, refunded: false }))
    mockConn()
    const res = await postWebhook()
    expect(res.status).toBe(200)
    const sqls = conn.query.mock.calls.map((c) => String(c[0]))
    expect(sqls.some((s) => s.includes('UPDATE subscriptions SET is_active'))).toBe(false)
    expect(sqls.some((s) => s.includes('FROM subscriptions WHERE provider'))).toBe(false)
    expect(journalStatus('processed')).toBe(true)
    expect(conn.commit).toHaveBeenCalled()
  })

  it('подписка по payment_intent не найдена -> failed в журнале, 200', async () => {
    constructEvent.mockReturnValue(refundEvent({ payment_intent: 'pi_unknown', amount: 1000, amount_refunded: 1000, refunded: true }))
    mockConn({ subscriptionRows: [] })
    const res = await postWebhook()
    expect(res.status).toBe(200)
    const sqls = conn.query.mock.calls.map((c) => String(c[0]))
    expect(sqls.some((s) => s.includes('UPDATE subscriptions SET is_active'))).toBe(false)
    expect(journalStatus('failed')).toBe(true)
  })

  it('событие без payment_intent -> failed в журнале, 200', async () => {
    constructEvent.mockReturnValue(refundEvent({ amount: 1000, amount_refunded: 1000, refunded: true }))
    mockConn()
    const res = await postWebhook()
    expect(res.status).toBe(200)
    const sqls = conn.query.mock.calls.map((c) => String(c[0]))
    expect(sqls.some((s) => s.includes('FROM subscriptions WHERE provider'))).toBe(false)
    expect(journalStatus('failed')).toBe(true)
  })

  it('повторная доставка события не снимает доступ второй раз', async () => {
    constructEvent.mockReturnValue(refundEvent({ payment_intent: 'pi_full', amount: 1000, amount_refunded: 1000, refunded: true }, 'evt_refund_dup'))
    mockConn({ dedupAffectedRows: 0 })
    const res = await postWebhook()
    expect(res.status).toBe(200)
    const sqls = conn.query.mock.calls.map((c) => String(c[0]))
    expect(sqls.some((s) => s.includes('FROM subscriptions WHERE provider'))).toBe(false)
    expect(sqls.some((s) => s.includes('UPDATE subscriptions SET is_active'))).toBe(false)
    expect(conn.rollback).toHaveBeenCalled()
  })
})

describe('applyStripeRefund', () => {
  it('payment_intent объектом (expandable) тоже матчится', async () => {
    conn.query.mockImplementation((sql) =>
      Promise.resolve(String(sql).includes('FROM subscriptions WHERE provider') ? [[{ id: 7 }], []] : [{ affectedRows: 1 }, []]),
    )
    const outcome = await applyStripeRefund(refundEvent({ payment_intent: { id: 'pi_obj' }, amount: 500, amount_refunded: 500, refunded: true }), conn)
    expect(outcome).toEqual({ applied: true, subscriptionId: 7 })
    const select = conn.query.mock.calls.find((c) => String(c[0]).includes('FROM subscriptions WHERE provider'))
    expect(select[1]).toEqual(['pi_obj'])
  })

  it('флаг refunded = true при неполной сумме считается полным возвратом', async () => {
    conn.query.mockImplementation((sql) =>
      Promise.resolve(String(sql).includes('FROM subscriptions WHERE provider') ? [[{ id: 9 }], []] : [{ affectedRows: 1 }, []]),
    )
    const outcome = await applyStripeRefund(refundEvent({ payment_intent: 'pi_flag', amount: 1000, amount_refunded: 0, refunded: true }), conn)
    expect(outcome.applied).toBe(true)
  })

  it('нулевая сумма без флага — не полный возврат', async () => {
    const outcome = await applyStripeRefund(refundEvent({ payment_intent: 'pi_zero', amount: 0, amount_refunded: 0, refunded: false }), conn)
    expect(outcome).toEqual({ applied: false, reason: 'partial' })
    expect(conn.query).not.toHaveBeenCalled()
  })
})

describe('applyPremiumEvent', () => {
  it('charge.refunded идёт в applyStripeRefund', async () => {
    conn.query.mockImplementation((sql) =>
      Promise.resolve(String(sql).includes('FROM subscriptions WHERE provider') ? [[{ id: 11 }], []] : [{ affectedRows: 1 }, []]),
    )
    const outcome = await applyPremiumEvent(refundEvent({ payment_intent: 'pi_disp', amount: 100, amount_refunded: 100, refunded: true }), conn)
    expect(outcome).toEqual({ applied: true, subscriptionId: 11 })
  })

  it('checkout.session.completed идёт в applyPremiumCheckout и хранит provider_payment_intent', async () => {
    conn.query.mockImplementation((sql) => {
      const text = String(sql)
      if (text.includes('FROM subscriptions WHERE provider')) return Promise.resolve([[], []])
      return Promise.resolve([{ affectedRows: 1 }, []])
    })
    const event = {
      id: 'evt_chk',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_pi', payment_intent: 'pi_777', metadata: { userId: '5', tier: 'plus', duration_months: '1' } } },
    }
    expect(await applyPremiumEvent(event, conn)).toBe(true)
    const insert = conn.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO subscriptions'))
    expect(String(insert[0])).toContain('provider_payment_intent')
    expect(insert[1]).toContain('pi_777')
    expect(insert[1][1]).toBe('cs_pi')
  })

  it('неизвестный тип события ничего не делает', async () => {
    expect(await applyPremiumEvent({ id: 'evt_x', type: 'invoice.paid' }, conn)).toBe(false)
    expect(conn.query).not.toHaveBeenCalled()
  })
})
