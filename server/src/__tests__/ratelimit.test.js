vi.hoisted(() => {
  delete process.env.REDIS_URL
})

// Этап 40 (слепые зоны, аудит kimi): rate-limit spec — 61-й запрос к auth -> 429
//
// Питфолл «падение 1 из 4 = гонка по времени, а не флак»: 1600 запросов через
// `request(app)` поднимали отдельный эфемерный сервер на КАЖДЫЙ вызов. В полном
// параллельном прогоне это исчерпывало порты (`EADDRINUSE`) и роняло воркер —
// тест был зелёным в одиночку и падал в общем прогоне. Здесь сервер слушается
// один раз и переиспользуется, счётчик лимитера тот же (ключ по IP), поведение
// проверки не меняется, а churn портов падает с ~1600 до 4.

import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import rateLimit from 'express-rate-limit'
import { makeAuthLimiter, makeApiLimiter } from '../middleware/limiters.js'

// Один слушающий сервер на приложение: supertest при передаче URL не стартует
// новый сокет-сервер, значит порт занимается один раз.
function listen(app) {
  const server = app.listen(0)
  return { server, url: `http://127.0.0.1:${server.address().port}` }
}

describe('rate limiters', () => {
  it('authLimiter: первые 1000 запросов проходят, 1001-й -> 429', async () => {
    const app = express()
    app.use(makeAuthLimiter())
    app.post('/ping', (_req, res) => res.json({ ok: true }))
    const { server, url } = listen(app)
    try {
      let last
      for (let i = 0; i < 1000; i++) {
        last = await request(url).post('/ping')
        expect(last.status).toBe(200)
      }
      const over = await request(url).post('/ping')
      expect(over.status).toBe(429)
      expect(over.body.message).toMatch(/Too many auth attempts/)
      // этап 43 (аудит kimi #5): клиент должен знать, когда повторять
      expect(Number(over.headers['retry-after'])).toBeGreaterThan(0)
    } finally {
      server.close()
    }
  })

  it('apiLimiter: лимит 600/min, превышение -> 429', async () => {
    const app = express()
    app.use(makeApiLimiter())
    app.post('/ping', (_req, res) => res.json({ ok: true }))
    const { server, url } = listen(app)
    try {
      for (let i = 0; i < 600; i++) {
        await request(url).post('/ping')
      }
      const over = await request(url).post('/ping')
      expect(over.status).toBe(429)
      expect(over.body.message).toMatch(/Too many requests/)
    } finally {
      server.close()
    }
  })

  it('разные экземпляры считаются независимо', async () => {
    const appA = express()
    appA.use(makeAuthLimiter())
    appA.post('/ping', (_req, res) => res.json({ ok: true }))
    const a = listen(appA)
    try {
      for (let i = 0; i < 1000; i++) await request(a.url).post('/ping')
      expect((await request(a.url).post('/ping')).status).toBe(429)
      // свежий экземпляр — свежий счётчик
      const appB = express()
      appB.use(makeAuthLimiter())
      appB.post('/ping', (_req, res) => res.json({ ok: true }))
      const b = listen(appB)
      try {
        expect((await request(b.url).post('/ping')).status).toBe(200)
      } finally {
        b.server.close()
      }
    } finally {
      a.server.close()
    }
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
