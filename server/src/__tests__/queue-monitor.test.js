import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { QUEUE_NAMES, resolveQueues, queueStats, retryFailed } from '../queue-monitor.js'

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
        counts: { waiting: 2, failed: 1 },
        failed: [{ id: '1', name: 'send-email', attemptsMade: 3, failedReason: 'SMTP timeout', data: { to: 'a@b.c' } }],
      },
    ])
  })

  it('queueStats без активных очередей возвращает пусто (Redis недоступен)', async () => {
    expect(await queueStats({ emailQueue: null })).toEqual([])
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
