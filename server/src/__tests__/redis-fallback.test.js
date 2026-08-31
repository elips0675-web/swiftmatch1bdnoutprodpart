import { describe, it, expect, vi, afterEach } from 'vitest'
import { rootLogger } from '../logger.js'

vi.mock('../logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  rootLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// Моделируем ioredis, который НЕ подключён и на каждую операцию отвечает
// ошибкой подключения (ECONNREFUSED) — как если бы Redis-сервер лежал.
class FakeRedisClient {
  constructor() {
    this.status = 'wait'
    this.get = vi.fn().mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:6379'), { code: 'ECONNREFUSED' }))
    this.setex = vi.fn().mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:6379'), { code: 'ECONNREFUSED' }))
    this.scanStream = vi.fn().mockReturnValue({
      [Symbol.asyncIterator]: async function* () { throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) },
    })
    this.ping = vi.fn().mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:6379'), { code: 'ECONNREFUSED' }))
    this.connect = vi.fn().mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:6379'), { code: 'ECONNREFUSED' }))
    this.quit = vi.fn().mockResolvedValue('OK')
    this.disconnect = vi.fn()
    this.on = vi.fn()
  }
}

// При NODE_ENV !== 'test' redis.js рендерит lazyConnect — не важно для теста:
// клиенты создаются, но не подключаются; все операции отклоняются.
process.env.NODE_ENV = 'test'

const fakeClient = new FakeRedisClient()
const fakePub = new FakeRedisClient()
const fakeSub = new FakeRedisClient()

vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => fakeClient),
}))

vi.mock('../redis.js', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    getRedis: () => fakeClient,
    getRedisPub: () => fakePub,
    getRedisSub: () => fakeSub,
    isRedisReady: async () => false,
    withRedis: async (fn) => {
      try {
        return await fn(fakeClient)
      } catch {
        return null
      }
    },
  }
})

describe('Redis graceful fallback (ECONNREFUSED → приложение живёт)', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('getCached возвращает null при недоступном Redis (не бросает)', async () => {
    const { getCached } = await import('../cache.js')
    const result = await getCached('swiftmatch:route:/health')
    expect(result).toBeNull()
    expect(fakeClient.get).toHaveBeenCalled()
  })

  it('setCached не бросает при недоступном Redis, возвращает null', async () => {
    const { setCached } = await import('../cache.js')
    await expect(setCached('swiftmatch:key', { data: 1 })).resolves.toBeNull()
    expect(fakeClient.setex).toHaveBeenCalled()
  })

  it('invalidate не бросает при недоступном Redis, возвращает null', async () => {
    const { invalidate } = await import('../cache.js')
    await expect(invalidate('partner:offers:*')).resolves.toBeNull()
  })

  it('cacheRoute middleware переходит к next(), а не отвечает 500 при недоступном Redis', async () => {
    const { cacheRoute } = await import('../cache.js')
    const middleware = cacheRoute(60)
    const req = { originalUrl: '/api/partners/offers/hotel?city=Moscow' }
    const res = { json: vi.fn() }
    const next = vi.fn()

    middleware(req, res, next)
    await vi.waitFor(() => expect(next).toHaveBeenCalledTimes(1))
  })

  it('cacheRoutePerUser переходит к next() при недоступном Redis', async () => {
    const { cacheRoutePerUser } = await import('../cache.js')
    const middleware = cacheRoutePerUser(60)
    const req = { originalUrl: '/api/hangouts', userId: 1 }
    const res = { json: vi.fn() }
    const next = vi.fn()

    middleware(req, res, next)
    await vi.waitFor(() => expect(next).toHaveBeenCalledTimes(1))
  })

  it('initQueues при недоступном Redis не создаёт очереди и не падает', async () => {
    const queueModule = await import('../queue.js')
    queueModule.initQueues()
    await vi.waitFor(() => {
      expect(rootLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Redis unreachable'))
    })
    expect(queueModule.emailQueue).toBeNull()
    expect(queueModule.pushQueue).toBeNull()
    expect(queueModule.imageQueue).toBeNull()
  })

  it('withRedis возвращает null на провале операции (не бросает наружу)', async () => {
    const { withRedis } = await import('../redis.js')
    const result = await withRedis(async (r) => {
      await r.get('key')
    })
    expect(result).toBeNull()
  })
})
