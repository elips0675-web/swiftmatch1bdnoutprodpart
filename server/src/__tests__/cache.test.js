import { describe, it, expect, vi, beforeEach } from 'vitest'

const { withRedisMock } = vi.hoisted(() => ({ withRedisMock: vi.fn() }))

vi.mock('../redis.js', () => ({ withRedis: withRedisMock }))

import { cacheKey, getCached, setCached, invalidate, cacheRoute, cacheRoutePerUser } from '../cache.js'

/** Redis-заглушка с фиксацией вызовов get/setex/scanStream/del. */
function fakeRedis({ get, scanBatches = [] } = {}) {
  return {
    get: vi.fn().mockResolvedValue(get ?? null),
    setex: vi.fn().mockResolvedValue('OK'),
    scanStream: vi.fn(() => makeStream(scanBatches)),
    del: vi.fn().mockResolvedValue(1),
  }
}

async function* makeStream(batches) {
  for (const batch of batches) yield batch
}

function makeRes() {
  const res = {
    sent: null,
    json(body) {
      this.sent = body
      return this
    },
  }
  return res
}

/** Мидлварь `cacheRoute*` не возвращает промис (fire-and-forget `.then`),
 *  поэтому после вызова нужно дать цепочке микротасков прокрутиться. */
const flush = () => new Promise((resolve) => setImmediate(resolve))

beforeEach(() => {
  withRedisMock.mockReset()
})

describe('cacheKey', () => {
  it('склеивает префикс и id в пространство swiftmatch:', () => {
    expect(cacheKey('route', '/api/feed')).toBe('swiftmatch:route:/api/feed')
    expect(cacheKey('user', '7:/api/me')).toBe('swiftmatch:user:7:/api/me')
  })
})

describe('getCached', () => {
  it('распарсивает JSON из Redis', async () => {
    const redis = fakeRedis({ get: JSON.stringify({ a: 1 }) })
    withRedisMock.mockImplementation((fn) => fn(redis))
    await expect(getCached('k')).resolves.toEqual({ a: 1 })
    expect(redis.get).toHaveBeenCalledWith('k')
  })

  it('пустое значение → null без парсинга', async () => {
    const redis = fakeRedis({ get: '' })
    withRedisMock.mockImplementation((fn) => fn(redis))
    await expect(getCached('k')).resolves.toBeNull()
  })

  it('без Redis (withRedis → null) возвращает null', async () => {
    withRedisMock.mockResolvedValue(null)
    await expect(getCached('k')).resolves.toBeNull()
  })
})

describe('setCached', () => {
  it('кладёт JSON с TTL по умолчанию', async () => {
    const redis = fakeRedis()
    withRedisMock.mockImplementation((fn) => fn(redis))
    await setCached('k', { x: 1 })
    expect(redis.setex).toHaveBeenCalledWith('k', 60, JSON.stringify({ x: 1 }))
  })

  it('уважает переданный TTL', async () => {
    const redis = fakeRedis()
    withRedisMock.mockImplementation((fn) => fn(redis))
    await setCached('k', 'v', 5)
    expect(redis.setex).toHaveBeenCalledWith('k', 5, '"v"')
  })
})

describe('invalidate', () => {
  it('удаляет ключи из каждого непустого батча scanStream', async () => {
    const redis = fakeRedis({ scanBatches: [['a', 'b'], [], ['c']] })
    withRedisMock.mockImplementation((fn) => fn(redis))
    await invalidate('route:*')
    expect(redis.scanStream).toHaveBeenCalledWith({ match: 'swiftmatch:route:*', count: 100 })
    expect(redis.del).toHaveBeenCalledTimes(2)
    expect(redis.del).toHaveBeenNthCalledWith(1, 'a', 'b')
    expect(redis.del).toHaveBeenNthCalledWith(2, 'c')
  })

  it('пустой стрим — del не зовётся', async () => {
    const redis = fakeRedis({ scanBatches: [[]] })
    withRedisMock.mockImplementation((fn) => fn(redis))
    await invalidate('route:*')
    expect(redis.del).not.toHaveBeenCalled()
  })
})

describe('cacheRoute — middleware кэша роута', () => {
  it('попадание в кэш отдаёт данные и не зовёт next', async () => {
    const redis = fakeRedis({ get: JSON.stringify({ cached: true }) })
    withRedisMock.mockImplementation((fn) => fn(redis))
    const next = vi.fn()
    const res = makeRes()
    await cacheRoute()({ originalUrl: '/api/feed' }, res, next)
    await flush()
    expect(res.sent).toEqual({ cached: true })
    expect(next).not.toHaveBeenCalled()
  })

  it('промах — подменяет res.json и зовёт next; запись при ответе', async () => {
    const redis = fakeRedis({ get: null })
    withRedisMock.mockImplementation((fn) => fn(redis))
    const next = vi.fn()
    const res = makeRes()
    await cacheRoute(30)({ originalUrl: '/api/feed' }, res, next)
    await flush()
    expect(next).toHaveBeenCalledTimes(1)

    res.json({ fresh: true })
    expect(res.sent).toEqual({ fresh: true })
    await vi.waitFor(() => expect(redis.setex).toHaveBeenCalled())
    expect(redis.setex).toHaveBeenCalledWith(cacheKey('route', '/api/feed'), 30, JSON.stringify({ fresh: true }))
  })

  it('падение getCached (нет Redis) → просто next', async () => {
    withRedisMock.mockRejectedValue(new Error('redis down'))
    const next = vi.fn()
    await cacheRoute()({ originalUrl: '/api/feed' }, makeRes(), next)
    await flush()
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('падение setCached при ответе молча глотается (catch в res.json)', async () => {
    withRedisMock.mockImplementation((fn) => {
      const redis = fakeRedis({ get: null })
      redis.setex.mockRejectedValue(new Error('write failed'))
      return fn(redis)
    })
    const next = vi.fn()
    const res = makeRes()
    await cacheRoute()({ originalUrl: '/api/feed' }, res, next)
    await flush()
    res.json({ x: 1 })
    expect(res.sent).toEqual({ x: 1 })
    await flush()
  })
})

describe('cacheRoutePerUser — кэш на пользователя', () => {
  it('без req.userId сразу next без обращения к кэшу', async () => {
    const next = vi.fn()
    await cacheRoutePerUser()({ originalUrl: '/api/me' }, makeRes(), next)
    expect(next).toHaveBeenCalledTimes(1)
    expect(withRedisMock).not.toHaveBeenCalled()
  })

  it('попадание отдаёт данные пользователя', async () => {
    const redis = fakeRedis({ get: JSON.stringify({ me: 1 }) })
    withRedisMock.mockImplementation((fn) => fn(redis))
    const next = vi.fn()
    const res = makeRes()
    await cacheRoutePerUser()({ userId: 7, originalUrl: '/api/me' }, res, next)
    await flush()
    expect(res.sent).toEqual({ me: 1 })
    expect(redis.get).toHaveBeenCalledWith(cacheKey('user', '7:/api/me'))
    expect(next).not.toHaveBeenCalled()
  })

  it('промах — подмена res.json с ключом пользователя и next', async () => {
    const redis = fakeRedis({ get: null })
    withRedisMock.mockImplementation((fn) => fn(redis))
    const next = vi.fn()
    const res = makeRes()
    await cacheRoutePerUser(15)({ userId: 9, originalUrl: '/api/me' }, res, next)
    await flush()
    expect(next).toHaveBeenCalledTimes(1)
    res.json({ ok: true })
    await vi.waitFor(() => expect(redis.setex).toHaveBeenCalled())
    expect(redis.setex).toHaveBeenCalledWith(cacheKey('user', '9:/api/me'), 15, JSON.stringify({ ok: true }))
  })

  it('падение кэша → next (без 500)', async () => {
    withRedisMock.mockRejectedValue(new Error('redis down'))
    const next = vi.fn()
    await cacheRoutePerUser()({ userId: 1, originalUrl: '/api/me' }, makeRes(), next)
    await flush()
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('падение setCached при ответе молча глотается (catch в res.json)', async () => {
    withRedisMock.mockImplementation((fn) => {
      const redis = fakeRedis({ get: null })
      redis.setex.mockRejectedValue(new Error('write failed'))
      return fn(redis)
    })
    const next = vi.fn()
    const res = makeRes()
    await cacheRoutePerUser()({ userId: 3, originalUrl: '/api/me' }, res, next)
    await flush()
    res.json({ y: 2 })
    expect(res.sent).toEqual({ y: 2 })
    await flush()
  })
})
