// Этап 42 (аудит kimi 1.3): purge revoked refresh-токенов старше 30 дней
// P2 #21: purge уведомлений >90 дней + безопасная остановка фоновых таймеров
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }))
vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import {
  purgeRevokedRefreshTokens,
  purgeOldNotifications,
  startRefreshTokenCleanup,
  startNotificationCleanup,
  stopCleanup,
  NOTIFICATION_RETENTION_DAYS,
} from '../cleanup.js'
import pool from '../db.js'

describe('cleanup', () => {
  beforeEach(() => {
    stopCleanup()
    vi.clearAllMocks()
    pool.query.mockReset()
    pool.query.mockResolvedValue([{ affectedRows: 0 }, []])
  })

  afterEach(() => {
    stopCleanup()
    vi.useRealTimers()
  })

  it('purgeRevokedRefreshTokens удаляет только revoked-токены старше 30 дней', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 7 }, []])
    const n = await purgeRevokedRefreshTokens()
    expect(n).toBe(7)
    const sql = String(pool.query.mock.calls[0][0])
    expect(sql).toMatch(/DELETE FROM refresh_tokens/i)
    expect(sql).toMatch(/revoked = 1/)
    expect(sql).toMatch(/INTERVAL 30 DAY/)
    expect(sql).not.toMatch(/updated_at/)
  })

  it('purgeRevokedRefreshTokens когда удалять нечего — возвращает 0', async () => {
    expect(await purgeRevokedRefreshTokens()).toBe(0)
  })

  it('purgeOldNotifications удаляет уведомления старше 90 дней', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 12 }, []])
    const n = await purgeOldNotifications()
    expect(n).toBe(12)
    const [sql, params] = pool.query.mock.calls[0]
    expect(String(sql)).toMatch(/DELETE FROM notifications/i)
    expect(String(sql)).toMatch(/INTERVAL \? DAY/)
    expect(params).toEqual([90])
  })

  it('NOTIFICATION_RETENTION_DAYS = 90', () => {
    expect(NOTIFICATION_RETENTION_DAYS).toBe(90)
  })

  it('purgeOldNotifications позволяет переопределить срок хранения', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }, []])
    await purgeOldNotifications(pool, 7)
    expect(pool.query.mock.calls[0][1]).toEqual([7])
  })

  it('purgeOldNotifications когда удалять нечего — возвращает 0', async () => {
    expect(await purgeOldNotifications()).toBe(0)
  })

  it('startRefreshTokenCleanup ставит interval и unref не роняет процесс', () => {
    const t = startRefreshTokenCleanup(60_000)
    expect(typeof t.unref).toBe('function')
  })

  it('startNotificationCleanup ставит interval и unref не роняет процесс', () => {
    const t = startNotificationCleanup(60_000)
    expect(typeof t.unref).toBe('function')
  })

  it('stopCleanup без предварительного запуска не падает', () => {
    stopCleanup()
    expect(() => stopCleanup()).not.toThrow()
  })

  it('stopCleanup останавливает оба таймера (interval больше не срабатывает)', async () => {
    vi.useFakeTimers()
    startRefreshTokenCleanup(1000)
    startNotificationCleanup(1000)

    await vi.advanceTimersByTimeAsync(1000)
    const afterTick = pool.query.mock.calls.length
    expect(afterTick).toBe(2)

    stopCleanup()
    await vi.advanceTimersByTimeAsync(5000)
    expect(pool.query.mock.calls.length).toBe(afterTick)
  })

  it('purge возвращает 0, когда БД не вернула affectedRows', async () => {
    pool.query.mockResolvedValueOnce([undefined, []])
    pool.query.mockResolvedValueOnce([undefined, []])
    expect(await purgeRevokedRefreshTokens()).toBe(0)
    expect(await purgeOldNotifications()).toBe(0)
  })

  it('повторный start возвращает уже запущенный таймер, а не плодит второй', () => {
    const first = startRefreshTokenCleanup(60_000)
    const second = startRefreshTokenCleanup(60_000)
    expect(second).toBe(first)

    const firstNotif = startNotificationCleanup(60_000)
    const secondNotif = startNotificationCleanup(60_000)
    expect(secondNotif).toBe(firstNotif)
  })

  it('сбой purge внутри таймера логируется и не роняет процесс', async () => {
    vi.useFakeTimers()
    pool.query.mockRejectedValueOnce(new Error('db down'))
    pool.query.mockRejectedValueOnce(new Error('db down'))
    startRefreshTokenCleanup(1000)
    startNotificationCleanup(1000)
    await vi.advanceTimersByTimeAsync(1000)
    expect(pool.query).toHaveBeenCalledTimes(2)
  })
})
