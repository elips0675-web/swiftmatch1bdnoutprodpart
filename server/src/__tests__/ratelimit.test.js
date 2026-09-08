// Этап 40 (слепые зоны, аудит kimi): rate-limit spec — 61-й запрос к auth -> 429
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import express from 'express'
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
})
