import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }))
vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))
vi.mock('../redis.js', () => ({ withRedis: vi.fn() }))

import pool from '../db.js'
import { withRedis } from '../redis.js'
import { collectHealth } from '../health-check.js'
import { liveHandler, readyHandler } from '../health.js'
import adminHealth from '../routes/admin/health.js'

const ENV_KEYS = ['NODE_ENV', 'STRIPE_SECRET_KEY', 'SMTP_HOST', 'FCM_SERVER_KEY', 'FCM_SERVICE_ACCOUNT', 'REDIS_URL', 'OPENAI_API_KEY', 'AWS_ACCESS_KEY_ID', 'ALLOW_UNMODERATED_PHOTOS']
const saved = {}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
  process.env.NODE_ENV = 'test'
  pool.query.mockReset()
  withRedis.mockReset()
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

const byName = (report, name) => report.services.find((s) => s.name === name)

describe('collectHealth', () => {
  it('БД отвечает, Redis не настроен → ok, БД ok, Redis mock, интеграции mock', async () => {
    pool.query.mockResolvedValueOnce([[{ 1: 1 }], []])
    const report = await collectHealth()

    expect(report.status).toBe('ok')
    expect(report.checkedAt).toBeTruthy()
    expect(report.services.length).toBe(6)

    const db = byName(report, 'database')
    expect(db.status).toBe('ok')
    expect(db.kind).toBe('probe')

    const redis = byName(report, 'redis')
    expect(redis.status).toBe('mock')
    expect(redis.mode).toBe('mock')

    for (const name of ['smtp', 'stripe', 'openai', 'fcm']) {
      expect(byName(report, name).mode).toBe('mock')
      expect(byName(report, name).kind).toBe('config')
    }
  })

  it('БД упала → database error и status degraded', async () => {
    pool.query.mockRejectedValueOnce(new Error('down'))
    const report = await collectHealth()

    expect(report.status).toBe('degraded')
    expect(byName(report, 'database').status).toBe('error')
  })

  it('Redis настроен и отвечает PONG → ok; Stripe с ключом → live/ok', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379'
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'
    pool.query.mockResolvedValueOnce([[{ 1: 1 }], []])
    withRedis.mockResolvedValueOnce('PONG')

    const report = await collectHealth()

    expect(byName(report, 'redis').status).toBe('ok')
    expect(byName(report, 'redis').mode).toBe('live')
    expect(byName(report, 'stripe').mode).toBe('live')
    expect(byName(report, 'stripe').status).toBe('ok')
  })

  it('Redis настроен, но не отвечает → error и degraded', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379'
    pool.query.mockResolvedValueOnce([[{ 1: 1 }], []])
    withRedis.mockResolvedValueOnce(null)

    const report = await collectHealth()

    expect(byName(report, 'redis').status).toBe('error')
    expect(report.status).toBe('degraded')
  })

  it('withRedis выполняет ping-колбэк и получает PONG', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379'
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'
    pool.query.mockResolvedValueOnce([[{ 1: 1 }], []])
    const ping = vi.fn().mockResolvedValue('PONG')
    withRedis.mockImplementationOnce((fn) => fn({ ping }))

    const report = await collectHealth()

    expect(ping).toHaveBeenCalledTimes(1)
    expect(byName(report, 'redis').status).toBe('ok')
  })

  it('интеграция с недоступным режимом → status error и degraded', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'
    pool.query.mockResolvedValueOnce([[{ 1: 1 }], []])
    const modes = { smtp: 'mock', stripe: 'unavailable', moderation: 'mock', fcm: 'mock', redis: 'mock' }
    vi.doMock('../runtime.js', () => ({ integrationModes: () => modes }))
    vi.resetModules()
    const { collectHealth: freshCollect } = await import('../health-check.js')

    const report = await freshCollect()

    expect(byName(report, 'stripe').status).toBe('error')
    expect(byName(report, 'stripe').mode).toBe('unavailable')
    expect(report.status).toBe('degraded')
    vi.doUnmock('../runtime.js')
    vi.resetModules()
  })
})

describe('GET /api/admin/health', () => {
  const app = express()
  app.use('/api/admin', adminHealth)

  it('возвращает отчёт о подсистемах', async () => {
    pool.query.mockResolvedValueOnce([[{ 1: 1 }], []])
    const res = await request(app).get('/api/admin/health')

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
    expect(Array.isArray(res.body.services)).toBe(true)
    expect(res.body.services.map((s) => s.name)).toEqual(['database', 'redis', 'smtp', 'stripe', 'openai', 'fcm'])
  })
})

describe('/health/live и /health/ready', () => {
  const fakeRes = () => {
    const res = { statusCode: 200, body: null }
    res.json = (body) => { res.body = body; return res }
    res.status = (code) => { res.statusCode = code; return res }
    return res
  }

  it('live отвечает 200 без обращения к БД', () => {
    const res = fakeRes()
    liveHandler({}, res)

    expect(res.statusCode).toBe(200)
    expect(res.body.status).toBe('ok')
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('ready отвечает 200 при живой БД', async () => {
    pool.query.mockResolvedValueOnce([[{ 1: 1 }], []])
    const res = fakeRes()
    await readyHandler({}, res)

    expect(res.statusCode).toBe(200)
    expect(res.body.status).toBe('ready')
  })

  it('ready отвечает 503 при мёртвой БД', async () => {
    pool.query.mockRejectedValueOnce(new Error('down'))
    const res = fakeRes()
    await readyHandler({}, res)

    expect(res.statusCode).toBe(503)
    expect(res.body.status).toBe('unavailable')
  })
})
