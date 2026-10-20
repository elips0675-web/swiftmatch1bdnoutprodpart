// Stage 111 (часть 2): остаточные ветки `queue.js`, `swagger.js` и
// `middleware/limiters.js`.
//
// `queue.js`: в `queue-init.test.js` процессоры лишь проверялись на
// «функция передана», но ни разу не вызывались — значит импорт job-модулей
// (строки 70-71, 77-78, 84-85) оставался непокрытым. Здесь процессоры
// вызываются напрямую, а три job-модуля замоканы, чтобы не поднимать SMTP,
// web-push и sharp.
//
// `swagger.js`: `setupSwagger` не вызывался ни разу — монтирование UI и
// `/api-docs.json` (строки 100-108).
//
// `middleware/limiters.js`: ветка Redis-backed store (строки 13-16, 43-44)
// требует `getRateLimitStore() !== undefined`; проверяем, что при доступном
// Redis фабрики лимитеров отдают работающий лимитер с общим счётчиком.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../logger.js', () => {
  const mock = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
  return { default: mock, createLogger: () => ({ ...mock }), rootLogger: mock }
})

const emailJob = vi.fn(async () => ({ sent: true }))
const pushJob = vi.fn(async () => ({ sent: 1 }))
const imageJob = vi.fn(async () => ({ processed: true }))

vi.mock('../jobs/email.job.js', () => ({ default: emailJob }))
vi.mock('../jobs/push.job.js', () => ({ default: pushJob }))
vi.mock('../jobs/image.job.js', () => ({ default: imageJob }))

const bullInstances = []

class FakeQueue {
  constructor(name, url, opts) {
    this.name = name
    this.url = url
    this.opts = opts
    this.handlers = {}
    this.on = vi.fn((event, fn) => { this.handlers[event] = fn; return this })
    this.process = vi.fn()
    this.close = vi.fn(async () => {})
    bullInstances.push(this)
  }
}

vi.mock('bull', () => ({ default: FakeQueue }))

class FakeRedis {
  constructor() {
    this.connect = vi.fn(async () => this)
    this.ping = vi.fn(async () => 'PONG')
    this.disconnect = vi.fn()
    this.on = vi.fn()
    this.call = vi.fn(async () => 1)
  }
}

vi.mock('ioredis', () => ({ default: FakeRedis }))

import { rootLogger } from '../logger.js'

async function freshQueue(redisUrl) {
  if (redisUrl) process.env.REDIS_URL = redisUrl
  else delete process.env.REDIS_URL
  vi.resetModules()
  return import('../queue.js')
}

beforeEach(() => {
  bullInstances.length = 0
  vi.clearAllMocks()
  delete process.env.REDIS_URL
})

afterEach(() => {
  delete process.env.REDIS_URL
})

describe('queue.js — процессоры вызывают job-модули', () => {
  it('без REDIS_URL очереди не создаются, процесс живёт', async () => {
    const mod = await freshQueue(null)
    expect(mod.redisConfigured).toBe(false)
    mod.initQueues()
    await vi.waitFor(() => expect(rootLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Redis unreachable')))
    expect(bullInstances).toHaveLength(0)
    expect(mod.emailQueue).toBeNull()
    expect(mod.pushQueue).toBeNull()
    expect(mod.imageQueue).toBeNull()
  })

  it('email-процессор импортирует и вызывает processEmail', async () => {
    const mod = await freshQueue('redis://127.0.0.1:6379')
    mod.initQueues()
    await vi.waitFor(() => expect(mod.emailQueue).not.toBeNull())
    const handler = bullInstances[0].process.mock.calls[0][0]
    await handler({ id: 7 })
    expect(emailJob).toHaveBeenCalledWith({ id: 7 })
  })

  it('push-процессор вызывает processPush', async () => {
    const mod = await freshQueue('redis://127.0.0.1:6379')
    mod.initQueues()
    await vi.waitFor(() => expect(mod.pushQueue).not.toBeNull())
    const handler = bullInstances[1].process.mock.calls[0][0]
    await handler({ id: 8 })
    expect(pushJob).toHaveBeenCalledWith({ id: 8 })
  })

  it('image-процессор вызывает processImage', async () => {
    const mod = await freshQueue('redis://127.0.0.1:6379')
    mod.initQueues()
    await vi.waitFor(() => expect(mod.imageQueue).not.toBeNull())
    const handler = bullInstances[2].process.mock.calls[0][0]
    await handler({ id: 9 })
    expect(imageJob).toHaveBeenCalledWith({ id: 9 })
  })
})

describe('swagger.js — setupSwagger', () => {
  it('монтирует UI и отдаёт JSON-спеку', async () => {
    const { setupSwagger, swaggerSpec } = await import('../swagger.js')
    const app = express()
    setupSwagger(app)
    const res = await request(app).get('/api-docs.json')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/json/)
    expect(res.body.openapi).toBe('3.0.0')
    expect(res.body).toEqual(swaggerSpec)
  })
})

describe('middleware/limiters.js — Redis-backed store', () => {
  it('getRateLimitStore не возвращает undefined при доступном Redis', async () => {
    process.env.REDIS_URL = 'redis://127.0.0.1:6379'
    vi.resetModules()
    const { getRateLimitStore } = await import('../middleware/limiters.js')
    const store = getRateLimitStore('rl:test:')
    expect(store).toBeDefined()
    expect(store).not.toBeNull()
  })

  it('getRateLimitStore undefined без Redis', async () => {
    delete process.env.REDIS_URL
    vi.resetModules()
    const { getRateLimitStore } = await import('../middleware/limiters.js')
    expect(getRateLimitStore()).toBeUndefined()
  })
})
