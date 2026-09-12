// Этап 40 (слепые зоны, аудит kimi): rate-limit spec — 61-й запрос к auth -> 429
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import express from 'express'
import rateLimit from 'express-rate-limit'
import { makeAuthLimiter, makeApiLimiter } from '../middleware/limiters.js'

function createApp(limiter) {
  const app = express()
  app.use(limiter)
  app.post('/ping', (_req, res) => res.json({ ok: true }))
  return app
}

describe('rate limiters', () => {
  it('authLimiter: первые 1000 запросов проходят, 1001-й -> 429', async () => {
    const app = createApp(makeAuthLimiter())
    let last
    for (let i = 0; i < 1000; i++) {
      last = await request(app).post('/ping')
      expect(last.status).toBe(200)
    }
    const over = await request(app).post('/ping')
    expect(over.status).toBe(429)
    expect(over.body.message).toMatch(/Too many auth attempts/)
    // этап 43 (аудит kimi #5): клиент должен знать, когда повторять
    expect(Number(over.headers['retry-after'])).toBeGreaterThan(0)
  })

  it('apiLimiter: лимит 600/min, превышение -> 429', async () => {
    const app = createApp(makeApiLimiter())
    for (let i = 0; i < 600; i++) {
      await request(app).post('/ping')
    }
    const over = await request(app).post('/ping')
    expect(over.status).toBe(429)
    expect(over.body.message).toMatch(/Too many requests/)
  })

  it('разные экземпляры считаются независимо', async () => {
    const a = createApp(makeAuthLimiter())
    for (let i = 0; i < 1000; i++) await request(a).post('/ping')
    expect((await request(a).post('/ping')).status).toBe(429)
    // свежий экземпляр — свежий счётчик
    const b = createApp(makeAuthLimiter())
    expect((await request(b).post('/ping')).status).toBe(200)
  })

  it('вложенные лимитеры с разными prefix не роняют запрос (регрессия ERR_ERL_DOUBLE_COUNT)', async () => {
    // Прод-сценарий: RedisStore НЕ имеет localKeys → storeKey = constructor.name ("RedisStore")
    // ОБЩИЙ для ВСЕХ лимитеров. Запрос /api/auth/* проходит ДВА лимитера: глобальный
    // app.use('/api/', apiLimiter) и app.use('/api/auth/', authLimiter) — на одном ключе
    // раньше кидало ValidationError ERR_ERL_DOUBLE_COUNT → 500.
    // Фикс (limiters.js): уникальный store.prefix (rl:api:/rl:auth:) — prefixedKey различается.
    class Store {
      constructor(prefix) {
        this.prefix = prefix
        this.map = new Map()
      }
      async increment(key) {
        const hits = (this.map.get(key) || 0) + 1
        this.map.set(key, hits)
        return { totalHits: hits, resetTime: new Date(Date.now() + 60_000) }
      }
      async decrement() {}
      async resetKey() {}
      async resetAll() {}
      init() {}
    }
    const app = express()
    app.use('/api/', rateLimit({ store: new Store('rl:api:'), windowMs: 60_000, max: 1000 }))
    app.use('/api/auth/', rateLimit({ store: new Store('rl:auth:'), windowMs: 60_000, max: 1000 }))
    app.post('/api/auth/register', (_req, res) => res.status(201).json({ ok: true }))
    const res = await request(app).post('/api/auth/register')
    expect(res.status).toBe(201)
  })
})
