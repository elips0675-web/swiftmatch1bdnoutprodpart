/**
 * Непокрытая ветка routes/payment-reconcile (Stage 155): внешний .catch у
 * runReconcile — падение прогона сверки уходит в лог, а не теряется.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'

vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
})

const { log, conn, db, stripeCtor } = vi.hoisted(() => {
  const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
  return {
    log,
    conn: {
      query: vi.fn(),
      beginTransaction: vi.fn(),
      commit: vi.fn(),
      rollback: vi.fn(),
      release: vi.fn(),
    },
    db: {
      query: vi.fn(),
      getConnection: vi.fn(async () => conn),
    },
    stripeCtor: vi.fn(function StripeMock() {
      return { checkout: { sessions: { list: vi.fn(async () => ({ data: [], has_more: false })) } } }
    }),
  }
})

vi.mock('../db.js', () => ({ default: db }))

vi.mock('../routes/premium.js', () => ({ applyPremiumCheckout: vi.fn(async () => true) }))

vi.mock('stripe', () => ({ default: stripeCtor }))

vi.mock('../logger.js', () => ({
  default: log,
  createLogger: () => log,
  rootLogger: log,
}))

import { startPaymentReconcile, stopPaymentReconcile } from '../payment-reconcile.js'

const SAVED = { key: process.env.STRIPE_SECRET_KEY }

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.STRIPE_SECRET_KEY
})

afterEach(() => {
  stopPaymentReconcile()
})

afterAll(() => {
  if (SAVED.key === undefined) delete process.env.STRIPE_SECRET_KEY
  else process.env.STRIPE_SECRET_KEY = SAVED.key
})

describe('падение прогона сверки уходит в лог', () => {
  it('ошибка с message логируется как Reconcile run failed', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'
    stripeCtor.mockImplementation(function StripeMock() {
      throw new Error('stripe ctor boom')
    })

    const timer = startPaymentReconcile({ intervalMs: 60_000, db })
    expect(timer).toBeTruthy()

    await vi.waitFor(() => expect(log.error).toHaveBeenCalledWith('Reconcile run failed: stripe ctor boom'))
  })

  it('отказ без message логируется как есть', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'
    stripeCtor.mockImplementation(function StripeMock() {
      throw 'plain string failure'
    })

    startPaymentReconcile({ intervalMs: 60_000, db })

    await vi.waitFor(() => expect(log.error).toHaveBeenCalledWith('Reconcile run failed: plain string failure'))
  })

  it('отказ null не роняет лог', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'
    stripeCtor.mockImplementation(function StripeMock() {
      throw null
    })

    startPaymentReconcile({ intervalMs: 60_000, db })

    await vi.waitFor(() => expect(log.error).toHaveBeenCalledWith('Reconcile run failed: null'))
  })
})
