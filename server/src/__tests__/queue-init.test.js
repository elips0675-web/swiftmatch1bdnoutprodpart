vi.hoisted(() => {
  process.env.REDIS_URL = 'redis://127.0.0.1:6379'
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  rootLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const bullInstances = []
let bullShouldThrow = false

class FakeQueue {
  constructor(name, url, opts) {
    if (bullShouldThrow) throw new Error('bull init failed')
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

const redisInstances = []
let pingResult = 'PONG'

class FakeRedis {
  constructor(url, opts) {
    this.url = url
    this.opts = opts
    this.on = vi.fn()
    this.connect = vi.fn(async () => this)
    this.ping = vi.fn(async () => {
      if (pingResult instanceof Error) throw pingResult
      return pingResult
    })
    this.disconnect = vi.fn()
    redisInstances.push(this)
  }
}

vi.mock('ioredis', () => ({ default: FakeRedis }))

import { rootLogger } from '../logger.js'

async function freshQueue() {
  vi.resetModules()
  return import('../queue.js')
}

async function initAll(mod) {
  mod.initQueues()
  await vi.waitFor(() => expect(mod.emailQueue).not.toBeNull())
  return mod
}

beforeEach(() => {
  bullInstances.length = 0
  redisInstances.length = 0
  bullShouldThrow = false
  pingResult = 'PONG'
  delete process.env.QUEUE_KEEP_FAILED
  process.env.REDIS_URL = 'redis://127.0.0.1:6379'
  vi.clearAllMocks()
})

describe('queue.js — инициализация очередей', () => {
  it('создаёт email/push/image, вешает обработчики и процессоры при живом Redis', async () => {
    const mod = await freshQueue()
    await initAll(mod)

    expect(mod.redisConfigured).toBe(true)
    expect(bullInstances.map(q => q.name)).toEqual(['email', 'push', 'image'])
    for (const q of bullInstances) {
      expect(q.url).toBe('redis://127.0.0.1:6379')
      expect(q.on.mock.calls.map(c => c[0])).toEqual(['completed', 'failed', 'error'])
      expect(q.process).toHaveBeenCalledTimes(1)
      expect(typeof q.process.mock.calls[0][0]).toBe('function')
    }
    expect(mod.emailQueue).toBe(bullInstances[0])
    expect(mod.pushQueue).toBe(bullInstances[1])
    expect(mod.imageQueue).toBe(bullInstances[2])
    expect(rootLogger.info).toHaveBeenCalledWith('[queue] Queues initialized')
  })

  it('настройки очереди: attempts, backoff, removeOnComplete и KEEP_FAILED', async () => {
    const mod = await freshQueue()
    await initAll(mod)
    const opts = bullInstances[0].opts
    expect(opts.defaultJobOptions.attempts).toBe(3)
    expect(opts.defaultJobOptions.backoff).toEqual({ type: 'exponential', delay: 2000 })
    expect(opts.defaultJobOptions.removeOnComplete).toBe(100)
    expect(opts.defaultJobOptions.removeOnFail).toBe(1000)
    expect(opts.settings.lockDuration).toBe(60000)
    expect(opts.settings.maxStalledCount).toBe(2)
  })

  it('QUEUE_KEEP_FAILED из окружения переопределяет removeOnFail', async () => {
    process.env.QUEUE_KEEP_FAILED = '7'
    const mod = await freshQueue()
    await initAll(mod)
    expect(bullInstances[0].opts.defaultJobOptions.removeOnFail).toBe(7)
  })

  it('обработчики очереди пишут в лог completed/failed/error', async () => {
    const mod = await freshQueue()
    await initAll(mod)
    const q = bullInstances[0]
    q.handlers.completed({ id: 1 })
    q.handlers.failed({ id: 2 }, new Error('job boom'))
    q.handlers.error(new Error('queue boom'))
    expect(rootLogger.info).toHaveBeenCalledWith('[queue] email job 1 completed', { jobName: 'email', jobId: 1 })
    expect(rootLogger.error).toHaveBeenCalledWith('[queue] email job 2 failed: job boom', { jobName: 'email', jobId: 2, error: 'job boom' })
    expect(rootLogger.error).toHaveBeenCalledWith('[queue] email error: queue boom', { jobName: 'email', error: 'queue boom' })
  })

  it('probe-клиент использует lazyConnect и отключается после проверки', async () => {
    const mod = await freshQueue()
    await initAll(mod)
    expect(redisInstances).toHaveLength(1)
    expect(redisInstances[0].url).toBe('redis://127.0.0.1:6379')
    expect(redisInstances[0].opts).toMatchObject({ lazyConnect: true, connectTimeout: 4000, maxRetriesPerRequest: 1 })
    expect(redisInstances[0].disconnect).toHaveBeenCalled()
  })

  it('недостижимый Redis (probe бросает) — очереди выключены, процесс живёт', async () => {
    pingResult = new Error('ECONNREFUSED')
    const mod = await freshQueue()
    mod.initQueues()
    await vi.waitFor(() => expect(rootLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Redis unreachable')))
    expect(rootLogger.warn).toHaveBeenCalledWith(expect.stringContaining('[queue] Redis probe failed'))
    expect(mod.emailQueue).toBeNull()
    expect(mod.pushQueue).toBeNull()
    expect(mod.imageQueue).toBeNull()
    expect(bullInstances).toHaveLength(0)
  })

  it('Redis отвечает не PONG — очереди не создаются', async () => {
    pingResult = 'NOPE'
    const mod = await freshQueue()
    mod.initQueues()
    await vi.waitFor(() => expect(rootLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Redis unreachable')))
    expect(bullInstances).toHaveLength(0)
    expect(mod.emailQueue).toBeNull()
  })

  it('ошибка создания очереди ловится: все очереди обнуляются, процесс не падает', async () => {
    bullShouldThrow = true
    const mod = await freshQueue()
    mod.initQueues()
    await vi.waitFor(() => expect(rootLogger.error).toHaveBeenCalledWith(expect.stringContaining('[queue] init failed')))
    expect(mod.emailQueue).toBeNull()
    expect(mod.pushQueue).toBeNull()
    expect(mod.imageQueue).toBeNull()
  })
})

describe('queue.js — закрытие очередей', () => {
  it('closeQueues закрывает все созданные очереди', async () => {
    const mod = await freshQueue()
    await initAll(mod)
    await mod.closeQueues()
    for (const q of bullInstances) expect(q.close).toHaveBeenCalledTimes(1)
    expect(rootLogger.info).toHaveBeenCalledWith('[queue] Closing queues...')
    expect(rootLogger.info).toHaveBeenCalledWith('[queue] All queues closed')
  })

  it('closeQueues без очередей выходит сразу, не логируя закрытие', async () => {
    const mod = await freshQueue()
    await expect(mod.closeQueues()).resolves.toBeUndefined()
    expect(rootLogger.info).not.toHaveBeenCalledWith('[queue] Closing queues...')
  })

  it('ошибка закрытия одной очереди не мешает остальным', async () => {
    const mod = await freshQueue()
    await initAll(mod)
    bullInstances[0].close.mockRejectedValue(new Error('close failed'))
    await expect(mod.closeQueues()).resolves.toBeUndefined()
    expect(bullInstances[1].close).toHaveBeenCalled()
    expect(bullInstances[2].close).toHaveBeenCalled()
  })
})
