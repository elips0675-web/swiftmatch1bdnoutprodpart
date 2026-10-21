vi.hoisted(() => {
  process.env.REDIS_URL = 'redis://127.0.0.1:6379'
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  rootLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const instances = []

class FakeRedis {
  constructor(url, opts) {
    this.url = url
    this.opts = opts
    this.status = 'wait'
    this.handlers = {}
    this.on = vi.fn((event, fn) => { this.handlers[event] = fn; return this })
    this.connect = vi.fn(async () => { this.status = 'ready'; return this })
    this.ping = vi.fn(async () => 'PONG')
    this.quit = vi.fn(async () => 'OK')
    instances.push(this)
  }
}

vi.mock('ioredis', () => ({ default: FakeRedis }))

import logger from '../logger.js'

async function freshRedis() {
  vi.resetModules()
  return import('../redis.js')
}

beforeEach(() => {
  instances.length = 0
  vi.clearAllMocks()
  process.env.REDIS_URL = 'redis://127.0.0.1:6379'
  process.env.NODE_ENV = 'test'
})

afterEach(() => {
  process.env.NODE_ENV = 'test'
})

describe('redis.js — жизненный цикл клиентов', () => {
  it('getRedis создаёт клиент один раз и переиспользует его', async () => {
    const { getRedis } = await freshRedis()
    const first = getRedis()
    const second = getRedis()
    expect(first).toBe(second)
    expect(instances).toHaveLength(1)
    expect(first.url).toBe('redis://127.0.0.1:6379')
  })

  it('getRedis вешает обработчики error/connect/close', async () => {
    const { getRedis } = await freshRedis()
    const client = getRedis()
    expect(client.on.mock.calls.map(c => c[0])).toEqual(['error', 'connect', 'close'])
    client.handlers.error(new Error('boom'))
    client.handlers.connect()
    client.handlers.close()
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('[redis] client connection error'), expect.any(Error))
    expect(logger.info).toHaveBeenCalledWith('[redis] client connected')
    expect(logger.info).toHaveBeenCalledWith('[redis] client connection closed')
  })

  it('getRedisPub и getRedisSub — отдельные клиенты, каждый кэшируется', async () => {
    const { getRedisPub, getRedisSub } = await freshRedis()
    const pub = getRedisPub()
    const sub = getRedisSub()
    expect(pub).not.toBe(sub)
    expect(pub.url).toBe('redis://127.0.0.1:6379')
    expect(instances).toHaveLength(2)
    expect(getRedisPub()).toBe(pub)
    expect(getRedisSub()).toBe(sub)
    expect(instances).toHaveLength(2)
  })

  it('без REDIS_URL все геттеры возвращают null и логируют один раз', async () => {
    delete process.env.REDIS_URL
    const { getRedis, getRedisPub, getRedisSub } = await freshRedis()
    expect(getRedis()).toBeNull()
    expect(getRedisPub()).toBeNull()
    expect(getRedisSub()).toBeNull()
    expect(getRedis()).toBeNull()
    expect(logger.info).toHaveBeenCalledTimes(1)
    expect(logger.info).toHaveBeenCalledWith('Redis not configured — skipping')
  })

  it('опции клиента: лимит повторов, connectTimeout и retryStrategy никогда не сдаётся', async () => {
    const { getRedis } = await freshRedis()
    const client = getRedis()
    expect(client.opts.maxRetriesPerRequest).toBe(3)
    expect(client.opts.connectTimeout).toBe(3000)
    expect(client.opts.retryStrategy(1)).toBe(200)
    expect(client.opts.retryStrategy(3)).toBe(600)
    // Инцидент 21.10.2026: `times > 3 → null` убивал клиент навсегда после
    // обрыва — все /api отвечали 500 до рестарта процесса. Стратегия обязана
    // возвращать задержку при любых times (с потолком), без null.
    expect(client.opts.retryStrategy(4)).toBe(800)
    expect(client.opts.retryStrategy(999)).toBe(10_000)
  })

  it('lazyConnect включается только вне NODE_ENV=test', async () => {
    const inTest = (await freshRedis()).getRedis()
    expect(inTest.opts.lazyConnect).toBeUndefined()

    process.env.NODE_ENV = 'production'
    const inProd = (await freshRedis()).getRedis()
    expect(inProd.opts.lazyConnect).toBe(true)
  })
})

describe('redis.js — isRedisReady', () => {
  it('true, когда pub и sub уже ready (без подключения)', async () => {
    const mod = await freshRedis()
    const pub = mod.getRedisPub()
    const sub = mod.getRedisSub()
    pub.status = 'ready'
    sub.status = 'ready'
    await expect(mod.isRedisReady()).resolves.toBe(true)
    expect(pub.connect).not.toHaveBeenCalled()
    expect(sub.connect).not.toHaveBeenCalled()
  })

  it('false без REDIS_URL, не поднимая клиентов', async () => {
    delete process.env.REDIS_URL
    const mod = await freshRedis()
    await expect(mod.isRedisReady()).resolves.toBe(false)
    expect(instances).toHaveLength(0)
  })

  it('подключает клиентов и возвращает true, когда они поднялись', async () => {
    const mod = await freshRedis()
    const ready = await mod.isRedisReady()
    expect(ready).toBe(true)
    expect(instances).toHaveLength(2)
    expect(instances[0].connect).toHaveBeenCalled()
    expect(instances[1].connect).toHaveBeenCalled()
  })

  it('false, когда подключение отклонено (Redis лежит)', async () => {
    const mod = await freshRedis()
    const pub = mod.getRedisPub()
    const sub = mod.getRedisSub()
    pub.connect.mockRejectedValue(new Error('ECONNREFUSED'))
    sub.connect.mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(mod.isRedisReady()).resolves.toBe(false)
    expect(pub.status).toBe('wait')
  })

  it('false по таймауту, если connect не разрешается', async () => {
    const mod = await freshRedis()
    const pub = mod.getRedisPub()
    const sub = mod.getRedisSub()
    pub.connect.mockImplementation(() => new Promise(() => {}))
    sub.connect.mockImplementation(() => new Promise(() => {}))
    await expect(mod.isRedisReady(5)).resolves.toBe(false)
  })
})

describe('redis.js — withRedis и disconnectRedis', () => {
  it('withRedis возвращает результат операции', async () => {
    const mod = await freshRedis()
    mod.getRedis()
    await expect(mod.withRedis(async (r) => { expect(r).toBe(instances[0]); return 'value' })).resolves.toBe('value')
  })

  it('withRedis возвращает null и логирует, если операция упала', async () => {
    const mod = await freshRedis()
    mod.getRedis()
    await expect(mod.withRedis(async () => { throw new Error('op failed') })).resolves.toBeNull()
    expect(logger.error).toHaveBeenCalledWith('[redis] operation failed', expect.any(Error))
  })

  it('withRedis возвращает null без REDIS_URL, не вызывая функцию', async () => {
    delete process.env.REDIS_URL
    const mod = await freshRedis()
    const fn = vi.fn()
    await expect(mod.withRedis(fn)).resolves.toBeNull()
    expect(fn).not.toHaveBeenCalled()
  })

  it('disconnectRedis закрывает client/pub/sub и сбрасывает состояние', async () => {
    const mod = await freshRedis()
    const client = mod.getRedis()
    const pub = mod.getRedisPub()
    const sub = mod.getRedisSub()

    await mod.disconnectRedis()

    expect(client.quit).toHaveBeenCalled()
    expect(pub.quit).toHaveBeenCalled()
    expect(sub.quit).toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith('[redis] client disconnected')
    expect(logger.info).toHaveBeenCalledWith('[redis] pub disconnected')
    expect(logger.info).toHaveBeenCalledWith('[redis] sub disconnected')

    const after = mod.getRedis()
    expect(after).not.toBe(client)
    expect(instances).toHaveLength(4)
  })

  it('disconnectRedis не падает, если quit отклонён', async () => {
    const mod = await freshRedis()
    const client = mod.getRedis()
    client.quit.mockRejectedValue(new Error('quit failed'))
    await expect(mod.disconnectRedis()).resolves.toBeUndefined()
  })

  it('disconnectRedis без клиентов проходит молча', async () => {
    const mod = await freshRedis()
    await expect(mod.disconnectRedis()).resolves.toBeUndefined()
    expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining('disconnected'))
  })
})
