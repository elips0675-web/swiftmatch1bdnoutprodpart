import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

const mocks = vi.hoisted(() => ({
  queueNames: vi.fn(() => ['email', 'push', 'image']),
  queueStats: vi.fn(),
  retryFailed: vi.fn(),
  redisConfigured: vi.fn(() => false),
}))

vi.mock('../queue-monitor.js', () => mocks)

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import adminQueues from '../routes/admin/queues.js'

function createApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/admin', adminQueues)
  return app
}

describe('N6: GET /api/admin/queues', () => {
  beforeEach(() => vi.clearAllMocks())

  it('отдаёт статистику очередей', async () => {
    mocks.queueStats.mockResolvedValue([
      { name: 'email', enabled: true, counts: { failed: 1 }, failed: [] },
      { name: 'push', enabled: false, counts: null, failed: [] },
    ])
    mocks.redisConfigured.mockReturnValue(true)
    const res = await request(createApp()).get('/api/admin/queues')
    expect(res.status).toBe(200)
    expect(res.body.queues).toHaveLength(2)
    expect(res.body.available).toEqual(['email'])
    expect(res.body.redisConfigured).toBe(true)
  })

  it('показывает отключённые очереди, когда Redis недоступен (P2 #19)', async () => {
    mocks.queueStats.mockResolvedValue([
      { name: 'email', enabled: false, counts: null, failed: [] },
      { name: 'push', enabled: false, counts: null, failed: [] },
      { name: 'image', enabled: false, counts: null, failed: [] },
    ])
    mocks.redisConfigured.mockReturnValue(false)
    const res = await request(createApp()).get('/api/admin/queues')
    expect(res.status).toBe(200)
    expect(res.body.queues.map((q) => q.enabled)).toEqual([false, false, false])
    expect(res.body.available).toEqual([])
    expect(res.body.redisConfigured).toBe(false)
  })

  it('ошибка статистики — 500, а не падение', async () => {
    mocks.queueStats.mockRejectedValue(new Error('redis down'))
    const res = await request(createApp()).get('/api/admin/queues')
    expect(res.status).toBe(500)
  })
})

describe('N6: POST /api/admin/queues/:name/retry', () => {
  beforeEach(() => vi.clearAllMocks())

  it('повторяет упавшие джобы очереди', async () => {
    mocks.retryFailed.mockResolvedValue({ name: 'email', available: true, total: 2, retried: 2, failed: 0 })
    const res = await request(createApp()).post('/api/admin/queues/email/retry')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ retried: 2 })
    expect(mocks.retryFailed).toHaveBeenCalledWith('email')
  })

  it('неизвестная очередь — 400 (белый список, а не любое имя)', async () => {
    const res = await request(createApp()).post('/api/admin/queues/bogus/retry')
    expect(res.status).toBe(400)
    expect(mocks.retryFailed).not.toHaveBeenCalled()
  })

  it('отключённая очередь (Redis недоступен) — 503', async () => {
    mocks.retryFailed.mockResolvedValue({ name: 'email', available: false, total: 0, retried: 0, failed: 0 })
    const res = await request(createApp()).post('/api/admin/queues/email/retry')
    expect(res.status).toBe(503)
  })

  it('ошибка повтора — 500', async () => {
    mocks.retryFailed.mockRejectedValue(new Error('boom'))
    const res = await request(createApp()).post('/api/admin/queues/email/retry')
    expect(res.status).toBe(500)
  })
})
