import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import {
  QUEUE_NAMES,
  resolveQueues,
  queueStats,
  retryFailed,
  redisConfigured,
  backloggedQueues,
  formatBacklogAlert,
  createBackpressureAlerter,
  startQueueBackpressureMonitor,
  stopQueueBackpressureMonitor,
  QUEUE_ALERT_THRESHOLD,
} from '../queue-monitor.js'

function fakeQueue({ counts = { waiting: 0, active: 0, completed: 0, failed: 0 }, failed = [] } = {}) {
  return {
    getJobCounts: vi.fn().mockResolvedValue(counts),
    getFailed: vi.fn().mockResolvedValue(failed),
  }
}

function fakeJob(overrides = {}) {
  return {
    id: '1',
    name: 'send-email',
    attemptsMade: 3,
    failedReason: 'SMTP timeout',
    data: { to: 'a@b.c' },
    retry: vi.fn().mockResolvedValue(true),
    ...overrides,
  }
}

describe('queue-monitor (N6)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('знает ровно три очереди', () => {
    expect(QUEUE_NAMES).toEqual(['email', 'push', 'image'])
  })

  it('resolveQueues пропускает отключённые (null) очереди', () => {
    const email = fakeQueue()
    const resolved = resolveQueues({ emailQueue: email, pushQueue: null, imageQueue: undefined })
    expect(resolved).toEqual([{ name: 'email', queue: email }])
  })

  it('queueStats отдаёт счётчики и упавшие джобы без data-мусора', async () => {
    const email = fakeQueue({
      counts: { waiting: 2, failed: 1 },
      failed: [fakeJob()],
    })
    const stats = await queueStats({ emailQueue: email })
    expect(email.getFailed).toHaveBeenCalledWith(0, 999)
    expect(stats).toEqual([
      {
        name: 'email',
        enabled: true,
        counts: { waiting: 2, failed: 1 },
        failed: [{ id: '1', name: 'send-email', attemptsMade: 3, failedReason: 'SMTP timeout', data: { to: 'a@b.c' } }],
      },
      { name: 'push', enabled: false, counts: null, failed: [] },
      { name: 'image', enabled: false, counts: null, failed: [] },
    ])
  })

  it('queueStats показывает отключённые очереди (Redis недоступен), а не пустой список', async () => {
    expect(await queueStats({ emailQueue: null })).toEqual([
      { name: 'email', enabled: false, counts: null, failed: [] },
      { name: 'push', enabled: false, counts: null, failed: [] },
      { name: 'image', enabled: false, counts: null, failed: [] },
    ])
  })

  it('redisConfigured сообщает, задан ли REDIS_URL', () => {
    expect(redisConfigured({ redisConfigured: true })).toBe(true)
    expect(redisConfigured({})).toBe(false)
    expect(redisConfigured()).toBe(false)
  })

  it('retryFailed повторяет каждую упавшую джобу', async () => {
    const job = fakeJob()
    const email = fakeQueue({ failed: [job] })
    const result = await retryFailed('email', { emailQueue: email })
    expect(job.retry).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ name: 'email', available: true, total: 1, retried: 1, failed: 0 })
  })

  it('retryFailed считает неудачные повторы, не роняя весь прогон', async () => {
    const ok = fakeJob({ id: 'ok' })
    const bad = fakeJob({ id: 'bad', retry: vi.fn().mockRejectedValue(new Error('boom')) })
    const email = fakeQueue({ failed: [ok, bad] })
    const result = await retryFailed('email', { emailQueue: email })
    expect(result).toEqual({ name: 'email', available: true, total: 2, retried: 1, failed: 1 })
  })

  it('retryFailed по отключённой очереди сообщает available:false', async () => {
    const result = await retryFailed('email', { emailQueue: null })
    expect(result).toEqual({ name: 'email', available: false, total: 0, retried: 0, failed: 0 })
  })
})

describe('queue backpressure (P2 #21)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    stopQueueBackpressureMonitor()
    vi.useRealTimers()
  })

  function busySource(counts) {
    return { redisConfigured: true, emailQueue: fakeQueue({ counts }) }
  }

  it('QUEUE_ALERT_THRESHOLD по умолчанию 1000', () => {
    expect(QUEUE_ALERT_THRESHOLD).toBe(1000)
  })

  it('backloggedQueues считает завал по waiting+delayed и игнорирует отключённые очереди', () => {
    const stats = [
      { name: 'email', enabled: true, counts: { waiting: 900, delayed: 200, failed: 0 }, failed: [] },
      { name: 'push', enabled: true, counts: { waiting: 10, delayed: 0, failed: 0 }, failed: [] },
      { name: 'image', enabled: false, counts: null, failed: [] },
    ]
    expect(backloggedQueues(stats, 1000)).toEqual([{ name: 'email', waiting: 900, delayed: 200, failed: 0 }])
  })

  it('без REDIS_URL монитор молчит (disabled)', async () => {
    const send = vi.fn()
    const check = createBackpressureAlerter({ source: { redisConfigured: false }, send })
    expect(await check()).toEqual({ alerted: false, reason: 'disabled', queues: [] })
    expect(send).not.toHaveBeenCalled()
  })

  it('забитая очередь → письмо админу', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    const check = createBackpressureAlerter({
      source: busySource({ waiting: 1200, delayed: 0, failed: 3 }),
      threshold: 1000,
      send,
    })
    const result = await check()
    expect(result.alerted).toBe(true)
    expect(result.reason).toBe('sent')
    expect(send).toHaveBeenCalledWith([{ name: 'email', waiting: 1200, delayed: 0, failed: 3 }])
  })

  it('анти-спам: повторная проверка в пределах cooldown не шлёт второе письмо', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    let clock = 10_000_000
    const check = createBackpressureAlerter({
      source: busySource({ waiting: 5000, delayed: 0, failed: 0 }),
      threshold: 1000,
      cooldownMs: 3_600_000,
      send,
      now: () => clock,
    })
    await check()
    clock += 60_000
    const second = await check()
    expect(send).toHaveBeenCalledTimes(1)
    expect(second).toEqual({
      alerted: false,
      reason: 'cooldown',
      queues: [{ name: 'email', waiting: 5000, delayed: 0, failed: 0 }],
    })
  })

  it('после истечения cooldown алерт уходит снова', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    let clock = 10_000_000
    const check = createBackpressureAlerter({
      source: busySource({ waiting: 5000, delayed: 0, failed: 0 }),
      threshold: 1000,
      cooldownMs: 3_600_000,
      send,
      now: () => clock,
    })
    await check()
    clock += 3_600_001
    const second = await check()
    expect(send).toHaveBeenCalledTimes(2)
    expect(second.alerted).toBe(true)
  })

  it('свободная очередь не беспокоит админа', async () => {
    const send = vi.fn()
    const check = createBackpressureAlerter({ source: busySource({ waiting: 1, delayed: 0, failed: 0 }), send })
    expect(await check()).toEqual({ alerted: false, reason: 'ok', queues: [] })
    expect(send).not.toHaveBeenCalled()
  })

  it('ошибка чтения счётчиков не роняет монитор', async () => {
    const send = vi.fn()
    const broken = {
      getJobCounts: vi.fn().mockRejectedValue(new Error('redis down')),
      getFailed: vi.fn().mockResolvedValue([]),
    }
    const check = createBackpressureAlerter({ source: { redisConfigured: true, emailQueue: broken }, send })
    expect(await check()).toEqual({ alerted: false, reason: 'error', queues: [] })
    expect(send).not.toHaveBeenCalled()
  })

  it('ошибка отправки письма не роняет монитор', async () => {
    const send = vi.fn().mockRejectedValue(new Error('smtp down'))
    const check = createBackpressureAlerter({ source: busySource({ waiting: 5000, delayed: 0, failed: 0 }), send })
    expect(await check()).toEqual({
      alerted: false,
      reason: 'error',
      queues: [{ name: 'email', waiting: 5000, delayed: 0, failed: 0 }],
    })
  })

  it('formatBacklogAlert перечисляет забитые очереди', () => {
    const { subject, html } = formatBacklogAlert([{ name: 'email', waiting: 1200, delayed: 5, failed: 2 }])
    expect(subject).toContain('backlog')
    expect(html).toContain('email')
    expect(html).toContain('1200')
  })

  it('startQueueBackpressureMonitor ставит unref-таймер, stop снимает его безопасно', () => {
    const timer = startQueueBackpressureMonitor({ intervalMs: 1000 })
    expect(typeof timer.unref).toBe('function')
    stopQueueBackpressureMonitor()
    expect(() => stopQueueBackpressureMonitor()).not.toThrow()
  })
})
