import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'

vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
})

const { conn, db, applyPremiumCheckout, stripeCtor } = vi.hoisted(() => ({
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
  applyPremiumCheckout: vi.fn(async () => true),
  stripeCtor: vi.fn(function StripeMock() {
    return { checkout: { sessions: { list: vi.fn(async () => ({ data: [], has_more: false })) } } }
  }),
}))

vi.mock('../db.js', () => ({ default: db }))

vi.mock('../routes/premium.js', () => ({ applyPremiumCheckout }))

vi.mock('stripe', () => ({ default: stripeCtor }))

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import {
  reconcilePremiumSubscriptions,
  fetchRecentPaidSessions,
  startPaymentReconcile,
  stopPaymentReconcile,
} from '../payment-reconcile.js'

const SAVED = {
  key: process.env.STRIPE_SECRET_KEY,
  lookback: process.env.STRIPE_RECONCILE_LOOKBACK_HOURS,
}

function paidSession(overrides = {}) {
  return {
    id: 'cs_edge_1',
    status: 'complete',
    payment_status: 'paid',
    metadata: { userId: '7', tier: 'plus' },
    ...overrides,
  }
}

function stripeReturning(sessions) {
  return { checkout: { sessions: { list: vi.fn(async () => ({ data: sessions, has_more: false })) } } }
}

beforeEach(() => {
  vi.clearAllMocks()
  applyPremiumCheckout.mockResolvedValue(true)
  conn.query.mockImplementation(() => Promise.resolve([{ affectedRows: 1 }, []]))
  db.getConnection.mockResolvedValue(conn)
  delete process.env.STRIPE_SECRET_KEY
  delete process.env.STRIPE_RECONCILE_LOOKBACK_HOURS
})

afterEach(() => {
  stopPaymentReconcile()
})

afterAll(() => {
  if (SAVED.key === undefined) delete process.env.STRIPE_SECRET_KEY
  else process.env.STRIPE_SECRET_KEY = SAVED.key
  if (SAVED.lookback === undefined) delete process.env.STRIPE_RECONCILE_LOOKBACK_HOURS
  else process.env.STRIPE_RECONCILE_LOOKBACK_HOURS = SAVED.lookback
})

describe('окно поиска: значение из env', () => {
  it('нечисловое значение env игнорируется — дефолт 72 ч', async () => {
    process.env.STRIPE_RECONCILE_LOOKBACK_HOURS = 'abc'
    const stripe = stripeReturning([])
    const now = Date.UTC(2026, 9, 15, 12, 0, 0)
    await reconcilePremiumSubscriptions({ db, stripe, now })
    expect(stripe.checkout.sessions.list.mock.calls[0][0].created.gte).toBe(Math.floor((now - 72 * 3_600_000) / 1000))
  })

  it('нулевое значение env игнорируется — дефолт 72 ч', async () => {
    process.env.STRIPE_RECONCILE_LOOKBACK_HOURS = '0'
    const stripe = stripeReturning([])
    const now = Date.UTC(2026, 9, 15, 12, 0, 0)
    await reconcilePremiumSubscriptions({ db, stripe, now })
    expect(stripe.checkout.sessions.list.mock.calls[0][0].created.gte).toBe(Math.floor((now - 72 * 3_600_000) / 1000))
  })

  it('положительное значение env используется как окно', async () => {
    process.env.STRIPE_RECONCILE_LOOKBACK_HOURS = '5'
    const stripe = stripeReturning([])
    const now = Date.UTC(2026, 9, 15, 12, 0, 0)
    await reconcilePremiumSubscriptions({ db, stripe, now })
    expect(stripe.checkout.sessions.list.mock.calls[0][0].created.gte).toBe(Math.floor((now - 5 * 3_600_000) / 1000))
  })

  it('lookbackHours из опций имеет приоритет над env', async () => {
    process.env.STRIPE_RECONCILE_LOOKBACK_HOURS = '999'
    const stripe = stripeReturning([])
    const now = Date.UTC(2026, 9, 15, 12, 0, 0)
    await reconcilePremiumSubscriptions({ db, stripe, now, lookbackHours: 1 })
    expect(stripe.checkout.sessions.list.mock.calls[0][0].created.gte).toBe(Math.floor((now - 3_600_000) / 1000))
  })
})

describe('страницы Stripe: устойчивость к пустым ответам', () => {
  it('batch без data (null) не роняет обход', async () => {
    const list = vi.fn(async () => null)
    const sessions = await fetchRecentPaidSessions({ stripe: { checkout: { sessions: { list } } }, sinceSeconds: 1 })
    expect(sessions).toEqual([])
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('страница без has_more прекращает обход после первой', async () => {
    const list = vi.fn(async () => ({ data: [{ id: 'cs_1' }] }))
    const sessions = await fetchRecentPaidSessions({ stripe: { checkout: { sessions: { list } } }, sinceSeconds: 1 })
    expect(sessions.map((s) => s.id)).toEqual(['cs_1'])
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('maxPages ограничивает число запросов', async () => {
    const list = vi.fn(async () => ({ data: [{ id: 'cs_x' }], has_more: true }))
    await fetchRecentPaidSessions({ stripe: { checkout: { sessions: { list } } }, sinceSeconds: 1, pageSize: 1, maxPages: 3 })
    expect(list).toHaveBeenCalledTimes(3)
  })

  it('pageSize по умолчанию попадает в параметры запроса', async () => {
    const list = vi.fn(async () => ({ data: [], has_more: false }))
    await fetchRecentPaidSessions({ stripe: { checkout: { sessions: { list } } }, sinceSeconds: 42 })
    expect(list.mock.calls[0][0]).toEqual({ limit: 100, created: { gte: 42 } })
  })
})

describe('сессия без обязательных полей', () => {
  it('session = null пропускается', async () => {
    const stripe = stripeReturning([null])
    const result = await reconcilePremiumSubscriptions({ db, stripe })
    expect(result.checked).toBe(1)
    expect(result.applied).toBe(0)
  })

  it('session без metadata пропускается', async () => {
    const stripe = stripeReturning([{ id: 'cs_no_meta', status: 'complete', payment_status: 'paid' }])
    const result = await reconcilePremiumSubscriptions({ db, stripe })
    expect(result.applied).toBe(0)
    expect(applyPremiumCheckout).not.toHaveBeenCalled()
  })
})

describe('транзакция применения: откат и освобождение соединения', () => {
  it('сбой записи откатывает транзакцию и освобождает соединение', async () => {
    applyPremiumCheckout.mockRejectedValue(new Error('insert boom'))
    const stripe = stripeReturning([paidSession({ id: 'cs_boom', metadata: { userId: '7', tier: 'plus' } })])
    const result = await reconcilePremiumSubscriptions({ db, stripe })
    expect(result.applied).toBe(0)
    expect(conn.rollback).toHaveBeenCalled()
    expect(conn.release).toHaveBeenCalled()
    expect(conn.commit).not.toHaveBeenCalled()
  })

  it('не-Error (строка) в отказе сессии логируется без падения', async () => {
    applyPremiumCheckout.mockRejectedValue('plain string failure')
    const stripe = stripeReturning([paidSession({ metadata: { userId: '7', tier: 'plus' } })])
    const result = await reconcilePremiumSubscriptions({ db, stripe })
    expect(result.applied).toBe(0)
    expect(conn.rollback).toHaveBeenCalled()
  })
})

describe('не-Error в отказе списка', () => {
  it('list бросает строку — error в ответе есть, наружу не летит', async () => {
    const stripe = { checkout: { sessions: { list: vi.fn(async () => { throw 'string failure' }) } } }
    const result = await reconcilePremiumSubscriptions({ db, stripe })
    expect(result.skipped).toBe(false)
    expect(result.checked).toBe(0)
    expect(result.error).toContain('string failure')
  })
})

describe('запуск по расписанию', () => {
  it('без переданного клиента поднимается реальный Stripe по ключу', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'
    stripeCtor.mockImplementation(function StripeMock() {
      return { checkout: { sessions: { list: vi.fn(async () => ({ data: [], has_more: false })) } } }
    })
    const timer = startPaymentReconcile({ intervalMs: 60_000, db })
    expect(timer).toBeTruthy()
    await vi.waitFor(() => expect(stripeCtor).toHaveBeenCalledWith('sk_test_dummy'))
  })

  it('таймерный прогон выполняет сверку и глушит ошибку прогона', async () => {
    vi.useFakeTimers()
    try {
      process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'
      const list = vi.fn(async () => { throw new Error('tick boom') })
      stripeCtor.mockImplementation(function StripeMock() {
        return { checkout: { sessions: { list } } }
      })
      startPaymentReconcile({ intervalMs: 1000, db })
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(1000)
      expect(list.mock.calls.length).toBeGreaterThanOrEqual(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('повторная остановка безопасна после запуска', () => {
    const timer = startPaymentReconcile({ intervalMs: 60_000, stripe: stripeReturning([]), db })
    expect(timer).toBeTruthy()
    stopPaymentReconcile()
    expect(() => stopPaymentReconcile()).not.toThrow()
  })
})
