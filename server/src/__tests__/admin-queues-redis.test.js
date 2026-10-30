import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import express from 'express'
import request from 'supertest'

const requireRedis = process.env.REQUIRE_REDIS === '1'
const baseUrl = (process.env.REDIS_URL || 'redis://127.0.0.1:6379').replace(/\/+$/, '')
const isolatedUrl = /\/\d+$/.test(baseUrl) ? baseUrl.replace(/\/\d+$/, '/15') : `${baseUrl}/15`

async function probe(url) {
  const { default: Redis } = await import('ioredis')
  const client = new Redis(url, {
    lazyConnect: true,
    connectTimeout: 3000,
    retryStrategy: () => null,
    maxRetriesPerRequest: 1,
  })
  client.on('error', () => {})
  try {
    await client.connect()
    return (await client.ping()) === 'PONG'
  } catch {
    return false
  } finally {
    client.disconnect()
  }
}

const reachable = await probe(isolatedUrl)

async function waitFor(predicate, timeoutMs = 20000) {
  const started = Date.now()
  for (;;) {
    if (await predicate()) return true
    if (Date.now() - started > timeoutMs) return false
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

describe.skipIf(!reachable && !requireRedis)('admin-очереди на живом Redis (TEST-06)', () => {
  let live
  let app
  let retentionQueue
  const retentionName = `retain-${Date.now()}-${process.pid}`
  const originalRedisUrl = process.env.REDIS_URL
  const originalEnv = {
    QUEUE_KEEP_FAILED: process.env.QUEUE_KEEP_FAILED,
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASS: process.env.SMTP_PASS,
  }

  it('живой Redis доступен там, где он обязателен (REQUIRE_REDIS=1)', () => {
    expect(reachable).toBe(true)
  })

  beforeAll(async () => {
    if (!reachable) {
      throw new Error(
        `Redis недоступен по ${isolatedUrl}` +
          (requireRedis ? ' (REQUIRE_REDIS=1 — в CI это падение, а не пропуск)' : ''),
      )
    }

    process.env.REDIS_URL = isolatedUrl
    process.env.QUEUE_KEEP_FAILED = '2'
    process.env.SMTP_HOST = '127.0.0.1'
    process.env.SMTP_PORT = '1'
    process.env.SMTP_USER = 'smoke'
    process.env.SMTP_PASS = 'smoke'

    live = await import('../queue.js')
    const { default: adminQueues } = await import('../routes/admin/queues.js')
    app = express()
    app.use(express.json())
    app.use('/api/admin', adminQueues)

    live.initQueues()
    const ready = await waitFor(() => Boolean(live.emailQueue && live.pushQueue && live.imageQueue), 20000)
    if (!ready) throw new Error('initQueues не создал очереди на живом Redis')
  }, 40000)

  afterAll(async () => {
    const queues = [retentionQueue, live?.emailQueue, live?.pushQueue, live?.imageQueue].filter(Boolean)
    for (const queue of queues) {
      await queue.obliterate({ force: true }).catch(() => {})
    }
    await live?.closeQueues().catch(() => {})

    if (originalRedisUrl === undefined) delete process.env.REDIS_URL
    else process.env.REDIS_URL = originalRedisUrl
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }, 40000)

  it('GET /api/admin/queues отдаёт состояние очередей из живого Redis', async () => {
    const res = await request(app).get('/api/admin/queues')

    expect(res.status).toBe(200)
    expect(res.body.redisConfigured).toBe(true)
    expect(res.body.available).toEqual(['email', 'push', 'image'])
    expect(res.body.queues).toHaveLength(3)

    for (const queue of res.body.queues) {
      expect(queue.enabled).toBe(true)
      expect(Number.isFinite(Number(queue.counts.failed))).toBe(true)
      expect(Array.isArray(queue.failed)).toBe(true)
    }
  })

  it('упавшая джоба видна через роут вместе с причиной', async () => {
    await live.emailQueue.add(
      { to: 'smoke@example.test', subject: 'smoke', html: '<p>smoke</p>' },
      { attempts: 1 },
    )

    const failed = await waitFor(async () => (await live.emailQueue.getJobCounts()).failed >= 1)
    expect(failed).toBe(true)

    const res = await request(app).get('/api/admin/queues')
    const email = res.body.queues.find((queue) => queue.name === 'email')

    expect(res.status).toBe(200)
    expect(email.failed.length).toBeGreaterThanOrEqual(1)
    expect(String(email.failed[0].failedReason)).toMatch(/ECONN|connect|refused/i)
    expect(Number(email.failed[0].id)).toBeGreaterThan(0)
  })

  it('POST /api/admin/queues/:name/retry возвращает итог повторной постановки', async () => {
    const res = await request(app).post('/api/admin/queues/email/retry')

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ name: 'email', available: true })
    expect(res.body.retried).toBeGreaterThanOrEqual(1)
    expect(res.body.failed).toBe(res.body.total - res.body.retried)

    await waitFor(async () => (await live.emailQueue.getJobCounts()).failed >= 1)
  }, 30000)

  it('неизвестная очередь отбивается 400, а не 503', async () => {
    const res = await request(app).post('/api/admin/queues/unknown/retry')

    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Unknown queue')
  })

  it('QUEUE_KEEP_FAILED держит хвост упавших джоб на живом Redis', async () => {
    retentionQueue = live.createQueue(retentionName)
    expect(live.KEEP_FAILED_JOBS).toBe(2)
    expect(retentionQueue.defaultJobOptions.removeOnFail).toBe(2)

    retentionQueue.process(async () => {
      throw new Error('retain-boom')
    })

    for (let i = 0; i < 3; i += 1) {
      await retentionQueue.add({ index: i }, { attempts: 1 })
    }

    const trimmed = await waitFor(async () => (await retentionQueue.getJobCounts()).failed === 2)
    expect(trimmed).toBe(true)

    const failedJobs = await retentionQueue.getFailed(0, 99)
    expect(failedJobs).toHaveLength(2)
    expect(failedJobs.every((job) => job.failedReason === 'retain-boom')).toBe(true)
  }, 30000)
})
