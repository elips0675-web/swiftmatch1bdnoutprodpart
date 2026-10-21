// Инцидент 21.10.2026: обрыв Redis (ECONNRESET) → retryStrategy сдался после
// 3 ретраев → клиент мёртв навсегда → RedisStore.sendCommand отвечает
// "Connection is closed." → express-rate-limit пробрасывает ошибку в error
// handler → ВСЕ /api отвечали 500 (стек в server/logs/api.log, строка
// RedisStore.retryableIncrement → limiters.js:16).
//
// Правило AGENTS: «Redis недоступен → тихий in-memory fallback, никогда не
// падать 500 на всех роутах». FailOpenStore в getRateLimitStore() — единственная
// узловая точка всех лимитеров: при ошибке Redis-стора счёт переходит в
// память (MemoryStore), лог деградации пишется один раз, после восстановления
// Redis счёт возвращается в общий стор.
vi.hoisted(() => {
  process.env.ICEBREAKER_RATE_MAX = '30'
})

const deadClient = vi.hoisted(() => ({
  call: vi.fn(async () => {
    throw new Error('Connection is closed.')
  }),
}))

import { describe, it, expect, vi, afterEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  rootLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../redis.js', () => ({
  getRedis: () => deadClient,
}))

import logger from '../logger.js'
import { makeApiLimiter, makeIcebreakerLimiter, FailOpenStore } from '../middleware/limiters.js'

function listen(app) {
  const server = app.listen(0)
  return { server, url: `http://127.0.0.1:${server.address().port}` }
}

const servers = []
function startApp(app) {
  const handle = listen(app)
  servers.push(handle.server)
  return handle
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
  vi.clearAllMocks()
})

describe('лимитеры при мёртвом Redis-клиенте (инцидент 21.10.2026)', () => {
  it('запрос через лимитер доходит до роута — 200, а не 500', async () => {
    const app = express()
    app.use('/api/', makeApiLimiter())
    app.get('/api/ping', (req, res) => res.json({ ok: true }))
    app.use((err, req, res, _next) => res.status(500).json({ message: 'Internal server error' }))

    const { url } = startApp(app)
    const res = await request(url).get('/api/ping')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })

  it('in-memory fallback реально считает: лимит работает без Redis', async () => {
    const app = express()
    app.use(makeIcebreakerLimiter())
    app.get('/ping', (req, res) => res.json({ ok: true }))
    app.use((err, req, res, _next) => res.status(500).json({ message: 'Internal server error' }))

    const { url } = startApp(app)
    for (let i = 0; i < 30; i++) {
      const res = await request(url).get('/ping')
      expect(res.status).toBe(200)
    }
    const blocked = await request(url).get('/ping')
    expect(blocked.status).toBe(429)
    expect(blocked.body.message).toBe('Too many icebreaker requests')
  })
})

describe('FailOpenStore', () => {
  function fakePrimary() {
    return {
      init: vi.fn(async () => {}),
      increment: vi.fn(async () => ({ totalHits: 99 })),
      decrement: vi.fn(async () => {}),
      resetKey: vi.fn(async () => {}),
    }
  }

  function failingPrimary() {
    return {
      init: vi.fn(async () => {
        throw new Error('Connection is closed.')
      }),
      increment: vi.fn(async () => {
        throw new Error('Connection is closed.')
      }),
      decrement: vi.fn(async () => {
        throw new Error('Connection is closed.')
      }),
      resetKey: vi.fn(async () => {
        throw new Error('Connection is closed.')
      }),
    }
  }

  it('ошибка стора — лог один раз на деградацию, а не на каждый запрос', async () => {
    const primary = failingPrimary()
    const store = new FailOpenStore(primary)

    for (let i = 1; i <= 3; i++) {
      const result = await store.increment('k')
      expect(result.totalHits).toBe(i)
    }

    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.error.mock.calls[0][0]).toContain('[ratelimit]')
  })

  it('после восстановления Redis снова основной стор, лог восстановления', async () => {
    const primary = failingPrimary()
    const store = new FailOpenStore(primary)

    await store.increment('k')
    expect(logger.info).not.toHaveBeenCalled()

    primary.increment.mockResolvedValue({ totalHits: 7, resetTime: undefined })
    const recovered = await store.increment('k')
    expect(recovered.totalHits).toBe(7)
    expect(logger.info).toHaveBeenCalledTimes(1)
    expect(logger.info.mock.calls[0][0]).toContain('[ratelimit]')
  })

  it('init с ошибкой primary не ломает лимитер: счёт идёт через память', async () => {
    const primary = failingPrimary()
    const store = new FailOpenStore(primary)

    await expect(store.init({ windowMs: 60000 })).resolves.toBeUndefined()

    const result = await store.increment('k')
    expect(result.totalHits).toBe(1)
    expect(primary.init).toHaveBeenCalledTimes(1)
  })

  it('decrement и resetKey при ошибке primary тоже идут в память', async () => {
    const primary = failingPrimary()
    const store = new FailOpenStore(primary)

    await expect(store.decrement('k')).resolves.toBeUndefined()

    await store.increment('k')
    await store.increment('k')
    await expect(store.resetKey('k')).resolves.toBeUndefined()
    const afterReset = await store.increment('k')
    expect(afterReset.totalHits).toBe(1)
  })

  it('здоровый Redis: ответ идёт от основного стора, память не участвует', async () => {
    const primary = fakePrimary()
    const store = new FailOpenStore(primary)

    const result = await store.increment('k')
    expect(result.totalHits).toBe(99)
    expect(logger.error).not.toHaveBeenCalled()
  })
})
