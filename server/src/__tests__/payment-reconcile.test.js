import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
})

const { conn } = vi.hoisted(() => ({
  conn: {
    query: vi.fn(),
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  },
}))

const { db } = vi.hoisted(() => ({
  db: {
    query: vi.fn(),
    getConnection: vi.fn(async () => conn),
  },
}))

vi.mock('../db.js', () => ({ default: db }))

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import {
  reconcilePremiumSubscriptions,
  fetchRecentPaidSessions,
  stripeReconcileEnabled,
  startPaymentReconcile,
  stopPaymentReconcile,
} from '../payment-reconcile.js'

const SAVED_KEY = process.env.STRIPE_SECRET_KEY

function paidSession(overrides = {}) {
  return {
    id: 'cs_test_1',
    status: 'complete',
    payment_status: 'paid',
    metadata: { userId: '7', tier: 'plus', duration_months: '1' },
    ...overrides,
  }
}

function stripeReturning(sessions, extra = {}) {
  return {
    checkout: {
      sessions: {
        list: vi.fn(async () => ({ data: sessions, has_more: false, ...extra })),
      },
    },
  }
}

function sqlCalls() {
  return conn.query.mock.calls.map((c) => String(c[0]))
}

beforeEach(() => {
  vi.clearAllMocks()
  conn.query.mockImplementation(() => Promise.resolve([{ affectedRows: 1 }, []]))
  delete process.env.STRIPE_SECRET_KEY
})

afterAll(() => {
  if (SAVED_KEY === undefined) delete process.env.STRIPE_SECRET_KEY
  else process.env.STRIPE_SECRET_KEY = SAVED_KEY
})

describe('reconcilePremiumSubscriptions: без ключа ничего не делает', () => {
  it('нет STRIPE_SECRET_KEY и нет клиента -> skipped', async () => {
    expect(stripeReconcileEnabled()).toBe(false)
    const result = await reconcilePremiumSubscriptions()
    expect(result).toEqual({ skipped: true, checked: 0, applied: 0 })
    expect(conn.query).not.toHaveBeenCalled()
  })

  it('есть ключ -> сверка включена', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'
    expect(stripeReconcileEnabled()).toBe(true)
  })
})

describe('reconcilePremiumSubscriptions: догоняет пропущенный вебхук', () => {
  it('оплаченная сессия без подписки в БД -> подписка создана', async () => {
    const stripe = stripeReturning([paidSession()])
    const result = await reconcilePremiumSubscriptions({ db, stripe, now: Date.now() })
    expect(result).toEqual({ skipped: false, checked: 1, applied: 1 })
    expect(sqlCalls().some((s) => s.includes('INSERT INTO subscriptions'))).toBe(true)
    expect(conn.commit).toHaveBeenCalled()
  })

  it('оплата уже применена -> повторно не пишем', async () => {
    conn.query.mockImplementation((sql) =>
      String(sql).includes('FROM subscriptions WHERE provider')
        ? Promise.resolve([[{ id: 42 }], []])
        : Promise.resolve([{ affectedRows: 1 }, []]),
    )
    const stripe = stripeReturning([paidSession()])
    const result = await reconcilePremiumSubscriptions({ db, stripe })
    expect(result.applied).toBe(0)
    expect(sqlCalls().some((s) => s.includes('INSERT INTO subscriptions'))).toBe(false)
  })

  it('неоплаченная сессия (payment_status !== paid) пропускается', async () => {
    const stripe = stripeReturning([paidSession({ payment_status: 'unpaid' })])
    const result = await reconcilePremiumSubscriptions({ db, stripe })
    expect(result).toEqual({ skipped: false, checked: 1, applied: 0 })
    expect(conn.beginTransaction).not.toHaveBeenCalled()
  })

  it('сессия без metadata.userId — не наша оплата, пропуск', async () => {
    const stripe = stripeReturning([paidSession({ metadata: {} })])
    const result = await reconcilePremiumSubscriptions({ db, stripe })
    expect(result.applied).toBe(0)
  })

  it('окно поиска — из lookback (по умолчанию 72 ч)', async () => {
    const stripe = stripeReturning([])
    const now = Date.UTC(2026, 9, 15, 12, 0, 0)
    await reconcilePremiumSubscriptions({ db, stripe, now })
    const params = stripe.checkout.sessions.list.mock.calls[0][0]
    expect(params.created.gte).toBe(Math.floor((now - 72 * 60 * 60 * 1000) / 1000))
  })
})

describe('reconcilePremiumSubscriptions: устойчивость', () => {
  it('падение Stripe не пробрасывается наружу', async () => {
    const stripe = { checkout: { sessions: { list: vi.fn(async () => { throw new Error('stripe down') }) } } }
    const result = await reconcilePremiumSubscriptions({ db, stripe })
    expect(result.applied).toBe(0)
    expect(result.error).toContain('stripe down')
  })

  it('падение на одной сессии не мешает обработать остальные', async () => {
    conn.query.mockImplementation((sql, params) => {
      if (String(sql).includes('INSERT INTO subscriptions') && params?.[1] === 'cs_bad') {
        return Promise.reject(new Error('insert boom'))
      }
      return Promise.resolve([{ affectedRows: 1 }, []])
    })
    const stripe = stripeReturning([
      paidSession({ id: 'cs_bad' }),
      paidSession({ id: 'cs_good' }),
    ])
    const result = await reconcilePremiumSubscriptions({ db, stripe })
    expect(result.applied).toBe(1)
    expect(result.checked).toBe(2)
  })
})

describe('fetchRecentPaidSessions: постраничный обход', () => {
  it('идёт по страницам, пока has_more', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ id: 'cs_1' }, { id: 'cs_2' }], has_more: true })
      .mockResolvedValueOnce({ data: [{ id: 'cs_3' }], has_more: false })
    const stripe = { checkout: { sessions: { list } } }
    const sessions = await fetchRecentPaidSessions({ stripe, sinceSeconds: 1, pageSize: 2 })
    expect(sessions.map((s) => s.id)).toEqual(['cs_1', 'cs_2', 'cs_3'])
    expect(list.mock.calls[1][0].starting_after).toBe('cs_2')
  })

  it('пустая страница прекращает обход', async () => {
    const list = vi.fn(async () => ({ data: [], has_more: true }))
    const sessions = await fetchRecentPaidSessions({ stripe: { checkout: { sessions: { list } } }, sinceSeconds: 1 })
    expect(sessions).toHaveLength(0)
    expect(list).toHaveBeenCalledTimes(1)
  })
})

describe('таймер сверки', () => {
  it('повторный запуск не поднимает второй таймер', () => {
    const stripe = stripeReturning([])
    const first = startPaymentReconcile({ intervalMs: 60_000, stripe, db })
    const second = startPaymentReconcile({ intervalMs: 60_000, stripe, db })
    expect(second).toBe(first)
    stopPaymentReconcile()
  })

  it('остановка безопасна без запуска', () => {
    expect(() => stopPaymentReconcile()).not.toThrow()
  })
})
