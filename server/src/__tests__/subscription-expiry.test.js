import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }))
vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import {
  expireSubscriptions,
  startSubscriptionExpiry,
  stopSubscriptionExpiry,
} from '../subscriptions.js'
import pool from '../db.js'

function fakeDb(affectedRows = 3) {
  return { query: vi.fn().mockResolvedValue([{ affectedRows }, []]) }
}

describe('expireSubscriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pool.query.mockReset()
    pool.query.mockResolvedValue([{ affectedRows: 0 }, []])
  })

  afterEach(() => {
    stopSubscriptionExpiry()
    vi.useRealTimers()
  })

  it('гасит is_active только у истёкших подписок', async () => {
    const db = fakeDb(4)
    expect(await expireSubscriptions(db)).toBe(4)
    const sql = String(db.query.mock.calls[0][0])
    expect(sql).toMatch(/UPDATE subscriptions/i)
    expect(sql).toMatch(/is_active = 0/)
    expect(sql).toMatch(/is_active = 1 AND expires_at <= NOW\(\)/)
  })

  it('не трогает подписки, у которых expires_at в будущем', async () => {
    const db = fakeDb(0)
    await expireSubscriptions(db)
    const sql = String(db.query.mock.calls[0][0])
    expect(sql).not.toMatch(/expires_at > NOW\(\)/)
    expect(sql).toMatch(/expires_at <= NOW\(\)/)
  })

  it('помечает статусом expired только активные, отменённые сохраняют свой статус', async () => {
    const db = fakeDb(1)
    await expireSubscriptions(db)
    const sql = String(db.query.mock.calls[0][0])
    expect(sql).toMatch(/IF\(status = 'active', 'expired', status\)/)
  })

  it('возвращает 0 когда affectedRows отсутствует', async () => {
    const db = { query: vi.fn().mockResolvedValue([{}, []]) }
    expect(await expireSubscriptions(db)).toBe(0)
  })

  it('пробрасывает ошибку БД наверх (таймер её гасит сам)', async () => {
    const db = { query: vi.fn().mockRejectedValue(new Error('db down')) }
    await expect(expireSubscriptions(db)).rejects.toThrow('db down')
  })
})

describe('startSubscriptionExpiry / stopSubscriptionExpiry', () => {
  beforeEach(() => {
    stopSubscriptionExpiry()
    vi.clearAllMocks()
  })

  afterEach(() => {
    stopSubscriptionExpiry()
    vi.useRealTimers()
  })

  it('проходит один раз сразу при старте, не дожидаясь интервала', async () => {
    const db = fakeDb(2)
    const timer = startSubscriptionExpiry({ intervalMs: 60_000, db })
    expect(typeof timer.unref).toBe('function')
    await vi.waitFor(() => expect(db.query).toHaveBeenCalledTimes(1))
  })

  it('повторный запуск не плодит второй таймер', () => {
    const db = fakeDb(0)
    const first = startSubscriptionExpiry({ intervalMs: 60_000, db })
    const second = startSubscriptionExpiry({ intervalMs: 60_000, db })
    expect(second).toBe(first)
  })

  it('по интервалу повторяет проход', async () => {
    vi.useFakeTimers()
    const db = fakeDb(0)
    startSubscriptionExpiry({ intervalMs: 1000, db })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(3000)
    expect(db.query).toHaveBeenCalledTimes(4)
  })

  it('stopSubscriptionExpiry останавливает таймер', async () => {
    vi.useFakeTimers()
    const db = fakeDb(0)
    startSubscriptionExpiry({ intervalMs: 1000, db })
    await vi.advanceTimersByTimeAsync(1000)
    const before = db.query.mock.calls.length
    stopSubscriptionExpiry()
    await vi.advanceTimersByTimeAsync(5000)
    expect(db.query.mock.calls.length).toBe(before)
  })

  it('stopSubscriptionExpiry без запуска не падает', () => {
    expect(() => stopSubscriptionExpiry()).not.toThrow()
  })

  it('падение БД не роняет процесс и не даёт unhandled rejection', async () => {
    const db = { query: vi.fn().mockRejectedValue(new Error('db down')) }
    startSubscriptionExpiry({ intervalMs: 60_000, db })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(db.query).toHaveBeenCalled()
  })
})
