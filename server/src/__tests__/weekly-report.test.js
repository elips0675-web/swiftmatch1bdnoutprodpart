// P3 #28 (qwen #28): еженедельная сводка админу — новые юзеры/мэтчи/выручка/жалобы.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }))
vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))
vi.mock('../mail.js', () => ({ sendCustomEmail: vi.fn() }))

import {
  WEEK_MS,
  resolveRecipient,
  buildWeeklySummary,
  formatWeeklyReport,
  sendWeeklyReport,
  startWeeklyReportMonitor,
  stopWeeklyReportMonitor,
} from '../weekly-report.js'

const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() }

function fakeDb(...rowsList) {
  const query = vi.fn()
  for (const rows of rowsList) query.mockResolvedValueOnce([rows, []])
  return { query }
}

describe('weekly report (P3 #28)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('WEEK_MS = семь суток', () => {
    expect(WEEK_MS).toBe(7 * 24 * 60 * 60 * 1000)
  })

  it('resolveRecipient берёт ADMIN_EMAIL, обрезает пробелы и молчит на пустом', () => {
    expect(resolveRecipient({ ADMIN_EMAIL: '  admin@swiftmatch.app ' })).toBe('admin@swiftmatch.app')
    expect(resolveRecipient({})).toBeNull()
    expect(resolveRecipient({ ADMIN_EMAIL: '   ' })).toBeNull()
  })

  it('buildWeeklySummary считает юзеров, мэтчи, выручку и жалобы за период', async () => {
    const since = new Date('2026-10-06T00:00:00.000Z')
    const until = new Date('2026-10-13T00:00:00.000Z')
    const db = fakeDb(
      [{ count: 12 }],
      [{ count: 5 }],
      [{ amount: '19.90' }],
      [{ count: 3 }],
    )

    const summary = await buildWeeklySummary(db, { since, until })

    expect(summary).toEqual({
      from: '2026-10-06',
      to: '2026-10-13',
      newUsers: 12,
      matches: 5,
      revenue: 19.9,
      complaints: 3,
    })
    expect(String(db.query.mock.calls[0][0])).toMatch(/FROM users/i)
    expect(String(db.query.mock.calls[1][0])).toMatch(/FROM matches/i)
    expect(String(db.query.mock.calls[1][0])).toMatch(/matched = 1/)
    expect(String(db.query.mock.calls[2][0])).toMatch(/FROM subscriptions/i)
    expect(String(db.query.mock.calls[3][0])).toMatch(/FROM reports/i)
    expect(db.query.mock.calls[0][1]).toEqual([since, until])
  })

  it('buildWeeklySummary без since берёт период ровно в семь суток', async () => {
    const until = new Date('2026-10-13T12:00:00.000Z')
    const db = fakeDb([{ count: 0 }], [{ count: 0 }], [{ amount: null }], [{ count: 0 }])

    const summary = await buildWeeklySummary(db, { until })

    expect(summary.from).toBe('2026-10-06')
    expect(summary.revenue).toBe(0)
    expect(db.query.mock.calls[0][1][0].getTime()).toBe(until.getTime() - WEEK_MS)
  })

  it('formatWeeklyReport кладёт период и все четыре метрики в письмо', () => {
    const { subject, html } = formatWeeklyReport({
      from: '2026-10-06',
      to: '2026-10-13',
      newUsers: 12,
      matches: 5,
      revenue: 19.9,
      complaints: 3,
    })
    expect(subject).toContain('2026-10-06')
    expect(subject).toContain('2026-10-13')
    expect(html).toContain('12')
    expect(html).toContain('19.9')
    expect(html).toContain('Жалобы')
  })

  it('sendWeeklyReport без ADMIN_EMAIL пропускает отправку', async () => {
    const db = { query: vi.fn() }
    const send = vi.fn()

    const result = await sendWeeklyReport({ db, send, logger, env: {} })

    expect(result).toEqual({ sent: false, reason: 'no-recipient' })
    expect(send).not.toHaveBeenCalled()
    expect(db.query).not.toHaveBeenCalled()
  })

  it('sendWeeklyReport шлёт письмо на ADMIN_EMAIL с готовой сводкой', async () => {
    const db = fakeDb([{ count: 2 }], [{ count: 1 }], [{ amount: 9.99 }], [{ count: 0 }])
    const send = vi.fn().mockResolvedValue(undefined)

    const result = await sendWeeklyReport({
      db,
      send,
      logger,
      env: { ADMIN_EMAIL: 'admin@swiftmatch.app' },
      now: () => new Date('2026-10-13T00:00:00.000Z'),
    })

    expect(result.sent).toBe(true)
    expect(result.summary.newUsers).toBe(2)
    expect(send).toHaveBeenCalledTimes(1)
    const [to, subject, html] = send.mock.calls[0]
    expect(to).toBe('admin@swiftmatch.app')
    expect(subject).toContain('SwiftMatch')
    expect(html).toContain('Новые пользователи')
  })

  it('ошибка сборки сводки не роняет монитор и не шлёт письмо', async () => {
    const db = { query: vi.fn().mockRejectedValue(new Error('db down')) }
    const send = vi.fn()

    const result = await sendWeeklyReport({ db, send, logger, env: { ADMIN_EMAIL: 'a@b.c' } })

    expect(result).toEqual({ sent: false, reason: 'error' })
    expect(send).not.toHaveBeenCalled()
  })

  it('ошибка отправки письма не роняет монитор', async () => {
    const db = fakeDb([{ count: 1 }], [{ count: 1 }], [{ amount: 0 }], [{ count: 1 }])
    const send = vi.fn().mockRejectedValue(new Error('smtp down'))

    const result = await sendWeeklyReport({ db, send, logger, env: { ADMIN_EMAIL: 'a@b.c' } })

    expect(result.sent).toBe(false)
    expect(result.reason).toBe('error')
  })
})

describe('weekly report monitor (P3 #28)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    stopWeeklyReportMonitor()
    vi.useRealTimers()
  })

  it('startWeeklyReportMonitor ставит unref-таймер и повторный вызов не плодит таймеры', () => {
    const timer = startWeeklyReportMonitor({ intervalMs: 1000 })
    expect(typeof timer.unref).toBe('function')
    expect(startWeeklyReportMonitor({ intervalMs: 1000 })).toBe(timer)
  })

  it('stopWeeklyReportMonitor безопасен без предварительного запуска', () => {
    stopWeeklyReportMonitor()
    expect(() => stopWeeklyReportMonitor()).not.toThrow()
  })

  it('таймер срабатывает по интервалу, stop его снимает', async () => {
    vi.useFakeTimers()
    const db = fakeDb([{ count: 1 }], [{ count: 1 }], [{ amount: 0 }], [{ count: 0 }])
    const send = vi.fn().mockResolvedValue(undefined)

    startWeeklyReportMonitor({ intervalMs: 1000, db, send, logger, env: { ADMIN_EMAIL: 'a@b.c' } })

    await vi.advanceTimersByTimeAsync(1000)
    expect(send).toHaveBeenCalledTimes(1)

    stopWeeklyReportMonitor()
    await vi.advanceTimersByTimeAsync(5000)
    expect(send).toHaveBeenCalledTimes(1)
  })
})
