vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-prod-guard-secret-0123456789abcdef'
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'
import { healthHandler } from '../health.js'
import { integrationModes, refuseMockPayment, requirePhotoModerationOrRefuse, photoModerationMode, initialPhotoModerationStatus } from '../runtime.js'

vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
    getConnection: vi.fn(),
  },
}))

vi.mock('../ws.js', () => ({
  getIO: vi.fn(() => ({ to: vi.fn(() => ({ emit: vi.fn() })) })),
  initIO: vi.fn(),
}))

vi.mock('../banned-words.js', () => ({
  getBannedWords: vi.fn(async () => []),
  containsBannedWord: vi.fn(() => false),
}))

vi.mock('../routes/push.js', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  sendPushToUser: vi.fn(async () => {}),
  sendPushToAll: vi.fn(),
}))

vi.mock('../routes/experiments.js', () => ({
  trackEvent: vi.fn(async () => {}),
}))

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import pool from '../db.js'
import hangoutsRoutes from '../routes/hangouts.js'
import partnerDashboardRoutes from '../routes/partner-dashboard.js'
import premiumRoutes from '../routes/premium.js'
import eventsRoutes from '../routes/events.js'
import partnersRoutes from '../routes/partners.js'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

function authToken(userId) {
  return jwt.sign({ id: userId, userId }, JWT_SECRET)
}

function createApp(...routers) {
  const app = express()
  app.use(express.json())
  for (const router of routers) app.use(router)
  return app
}

const writtenSql = () =>
  pool.query.mock.calls
    .map(([sql]) => String(sql))
    .filter((sql) => /^INSERT|^UPDATE/i.test(sql.trim()))

describe('прод без STRIPE_SECRET_KEY: платное не выдаётся молча', () => {
  let saved

  beforeEach(() => {
    saved = {
      NODE_ENV: process.env.NODE_ENV,
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
      STRIPE_LIVE: process.env.STRIPE_LIVE,
    }
    process.env.NODE_ENV = 'production'
    delete process.env.STRIPE_SECRET_KEY
    delete process.env.STRIPE_LIVE
    pool.query.mockReset()
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('POST /api/hangouts/:id/purchase отказывает и не пишет билет как paid', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 7, user_id: 1, status: 'active', title: 'Gala', price: 500, capacity: 5, max_companions: 1, hangout_type: 'date' }], []])
      .mockResolvedValueOnce([[{ cnt: 0 }], []])

    const res = await request(createApp(hangoutsRoutes))
      .post('/api/hangouts/7/purchase')
      .set('Authorization', `Bearer ${authToken(2)}`)

    expect(res.status).toBe(503)
    expect(res.body.code).toBe('STRIPE_NOT_CONFIGURED')
    expect(res.body.paid).toBeUndefined()
    expect(writtenSql().some((sql) => sql.includes('hangout_tickets'))).toBe(false)
  })

  it('POST /api/partner/subscribe не выдаёт Pro и не меняет комиссию', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 5, user_id: 2, status: 'active', commission_rate: 10 }], []])

    const res = await request(createApp(partnerDashboardRoutes))
      .post('/api/partner/subscribe')
      .set('Authorization', `Bearer ${authToken(2)}`)
      .send({ tier: 'pro' })

    expect(res.status).toBe(503)
    expect(res.body.code).toBe('STRIPE_NOT_CONFIGURED')
    expect(res.body.mock).toBeUndefined()
    expect(writtenSql().some((sql) => sql.includes('partner_subscriptions'))).toBe(false)
    expect(writtenSql().some((sql) => sql.includes('commission_rate'))).toBe(false)
  })

  it('POST /api/premium/create-checkout не создаёт подписку', async () => {
    const res = await request(createApp(premiumRoutes))
      .post('/api/premium/create-checkout')
      .set('Authorization', `Bearer ${authToken(2)}`)
      .send({ tier: 'plus', duration_months: 1 })

    expect(res.status).toBe(503)
    expect(res.body.code).toBe('STRIPE_NOT_CONFIGURED')
    expect(writtenSql().some((sql) => sql.includes('subscriptions'))).toBe(false)
  })

  it('POST /api/events/:id/purchase отказывает единым кодом', async () => {
    const ev = { id: 1, partner_id: 5, title: 'Stand-up', price: 1000, status: 'active', end_at: new Date(Date.now() + 86400000), partner_name: 'Club', commission_rate: 15, partner_status: 'active' }
    pool.query
      .mockResolvedValueOnce([[ev], []])
      .mockResolvedValueOnce([[null], []])

    const res = await request(createApp(eventsRoutes))
      .post('/api/events/1/purchase')
      .set('Authorization', `Bearer ${authToken(2)}`)

    expect(res.status).toBe(503)
    expect(res.body.code).toBe('STRIPE_NOT_CONFIGURED')
    expect(writtenSql().some((sql) => sql.includes('event_tickets'))).toBe(false)
  })

  it('POST /api/partners/order отказывает единым кодом', async () => {
    const offer = { id: 8, partner_id: 5, title: 'Букет', price: 2500, deeplink: 'https://flowwow.ru', partner_name: 'Flowwow', commission_rate: 15, partner_status: 'active' }
    pool.query.mockResolvedValueOnce([[offer], []])

    const res = await request(createApp(partnersRoutes))
      .post('/api/partners/order')
      .set('Authorization', `Bearer ${authToken(2)}`)
      .send({ offer_id: 8, recipient_name: 'Аня', recipient_address: 'Москва' })

    expect(res.status).toBe(503)
    expect(res.body.code).toBe('STRIPE_NOT_CONFIGURED')
    expect(writtenSql().some((sql) => sql.includes('partner_orders'))).toBe(false)
  })

  it('вне прода mock-путь встречи остаётся рабочим', async () => {
    process.env.NODE_ENV = 'test'
    pool.query
      .mockResolvedValueOnce([[{ id: 7, user_id: 1, status: 'active', title: 'Gala', price: 500, capacity: 5, max_companions: 1, hangout_type: 'date' }], []])
      .mockResolvedValueOnce([[{ cnt: 0 }], []])

    const res = await request(createApp(hangoutsRoutes))
      .post('/api/hangouts/7/purchase')
      .set('Authorization', `Bearer ${authToken(2)}`)

    expect(res.status).toBe(201)
    expect(res.body.mock).toBe(true)
    expect(res.body.paid).toBe(true)
  })

  it('вне прода mock-путь партнёра остаётся рабочим', async () => {
    process.env.NODE_ENV = 'test'
    pool.query
      .mockResolvedValueOnce([[{ id: 5, user_id: 2, status: 'active', commission_rate: 10 }], []])
      .mockResolvedValueOnce([{ insertId: 9 }, []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])

    const res = await request(createApp(partnerDashboardRoutes))
      .post('/api/partner/subscribe')
      .set('Authorization', `Bearer ${authToken(2)}`)
      .send({ tier: 'pro' })

    expect(res.status).toBe(200)
    expect(res.body.mock).toBe(true)
  })

  it('STRIPE_LIVE=true без ключа тоже отказывает', async () => {
    process.env.NODE_ENV = 'test'
    process.env.STRIPE_LIVE = 'true'

    const res = await request(createApp(premiumRoutes))
      .post('/api/premium/create-checkout')
      .set('Authorization', `Bearer ${authToken(2)}`)
      .send({ tier: 'plus', duration_months: 1 })

    expect(res.status).toBe(503)
    expect(res.body.code).toBe('STRIPE_NOT_CONFIGURED')
    expect(res.body.message).toBe('Stripe not configured in live mode')
  })
})

describe('режим интеграций виден в /health', () => {
  const saved = {}

  beforeEach(() => {
    for (const key of ['NODE_ENV', 'STRIPE_SECRET_KEY', 'SMTP_HOST', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'FCM_SERVER_KEY', 'FCM_SERVICE_ACCOUNT', 'REDIS_URL']) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
    pool.query.mockReset()
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  const fakeRes = () => {
    const res = { statusCode: 200, body: null }
    res.json = (body) => { res.body = body; return res }
    res.status = (code) => { res.statusCode = code; return res }
    return res
  }

  it('все интеграции без ключей помечены mock, ключи не публикуются', async () => {
    process.env.NODE_ENV = 'production'
    process.env.STRIPE_SECRET_KEY = 'sk_live_secret_value'
    pool.query.mockResolvedValueOnce([[{ 1: 1 }], []])
    const res = fakeRes()
    await healthHandler({}, res)

    expect(res.statusCode).toBe(200)
    expect(res.body.integrations.stripe).toBe('live')
    expect(res.body.integrations.smtp).toBe('mock')
    expect(res.body.integrations.sms).toBe('mock')
    expect(res.body.integrations.fcm).toBe('mock')
    expect(res.body.integrations.redis).toBe('mock')
    expect(JSON.stringify(res.body)).not.toContain('sk_live_secret_value')
  })

  it('при падении БД отвечает 503 и всё равно показывает режим интеграций', async () => {
    process.env.NODE_ENV = 'production'
    pool.query.mockRejectedValueOnce(new Error('down'))
    const res = fakeRes()
    await healthHandler({}, res)

    expect(res.statusCode).toBe(503)
    expect(res.body.status).toBe('error')
    expect(res.body.integrations.stripe).toBe('mock')
  })

  it('integrationModes совпадает с тем, что читает код', () => {
    process.env.SMTP_HOST = 'smtp.example.com'
    process.env.TWILIO_ACCOUNT_SID = 'AC1'
    process.env.TWILIO_AUTH_TOKEN = 'token'
    process.env.REDIS_URL = 'redis://localhost:6379'
    expect(integrationModes()).toEqual({ stripe: 'mock', smtp: 'live', sms: 'live', fcm: 'mock', redis: 'live', moderation: 'mock' })
  })

  it('sms считается live только с парой ключей', () => {
    process.env.TWILIO_ACCOUNT_SID = 'AC1'
    expect(integrationModes().sms).toBe('mock')
  })
})

describe('refuseMockPayment', () => {
  const saved = {}

  beforeEach(() => {
    saved.NODE_ENV = process.env.NODE_ENV
    saved.STRIPE_LIVE = process.env.STRIPE_LIVE
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('вне прода и не в live-режиме пропускает mock молча', () => {
    process.env.NODE_ENV = 'test'
    delete process.env.STRIPE_LIVE
    const res = { status: vi.fn(), json: vi.fn() }
    expect(refuseMockPayment(res)).toBe(false)
    expect(res.status).not.toHaveBeenCalled()
  })
})

describe('requirePhotoModerationOrRefuse (N3, P0-E)', () => {
  const envKeys = ['NODE_ENV', 'ALLOW_UNMODERATED_PHOTOS', 'OPENAI_API_KEY', 'AWS_ACCESS_KEY_ID']
  let saved

  beforeEach(() => {
    saved = {}
    for (const key of envKeys) saved[key] = process.env[key]
    delete process.env.OPENAI_API_KEY
    delete process.env.AWS_ACCESS_KEY_ID
    delete process.env.ALLOW_UNMODERATED_PHOTOS
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  const makeRes = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn() })

  it('прод без ключей AI: отказ 503 с машиночитаемым кодом', () => {
    process.env.NODE_ENV = 'production'
    const res = makeRes()
    expect(requirePhotoModerationOrRefuse(res)).toBe(true)
    expect(res.status).toHaveBeenCalledWith(503)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'PHOTO_MODERATION_UNAVAILABLE' }))
  })

  it('прод с ключом OpenAI: пропускает', () => {
    process.env.NODE_ENV = 'production'
    process.env.OPENAI_API_KEY = 'sk-test-moderation'
    const res = makeRes()
    expect(requirePhotoModerationOrRefuse(res)).toBe(false)
    expect(res.status).not.toHaveBeenCalled()
  })

  it('прод с AWS-ключом: пропускает', () => {
    process.env.NODE_ENV = 'production'
    process.env.AWS_ACCESS_KEY_ID = 'AKIA-test-moderation'
    const res = makeRes()
    expect(requirePhotoModerationOrRefuse(res)).toBe(false)
  })

  it('вне прода без разрешения: отказ', () => {
    process.env.NODE_ENV = 'development'
    const res = makeRes()
    expect(requirePhotoModerationOrRefuse(res)).toBe(true)
    expect(res.status).toHaveBeenCalledWith(503)
  })

  it('вне прода с ALLOW_UNMODERATED_PHOTOS=true: пропускает', () => {
    process.env.NODE_ENV = 'development'
    process.env.ALLOW_UNMODERATED_PHOTOS = 'true'
    const res = makeRes()
    expect(requirePhotoModerationOrRefuse(res)).toBe(false)
  })

  it('тестовое окружение без флага разрешает по умолчанию', () => {
    process.env.NODE_ENV = 'test'
    const res = makeRes()
    expect(requirePhotoModerationOrRefuse(res)).toBe(false)
  })

  it('тестовое окружение с ALLOW_UNMODERATED_PHOTOS=false отказывает', () => {
    process.env.NODE_ENV = 'test'
    process.env.ALLOW_UNMODERATED_PHOTOS = 'false'
    const res = makeRes()
    expect(requirePhotoModerationOrRefuse(res)).toBe(true)
  })

  it('integrationModes: в проде без ключей moderation = unavailable', () => {
    process.env.NODE_ENV = 'production'
    expect(integrationModes().moderation).toBe('unavailable')
  })

  it('integrationModes: с ключом moderation = live', () => {
    process.env.NODE_ENV = 'production'
    process.env.OPENAI_API_KEY = 'sk-test-moderation'
    expect(integrationModes().moderation).toBe('live')
  })

  it('integrationModes: вне прода без ключей moderation = mock', () => {
    process.env.NODE_ENV = 'development'
    expect(integrationModes().moderation).toBe('mock')
  })
})

describe('photoModerationMode / initialPhotoModerationStatus (N3-вторая, вариант Б)', () => {
  const envKeys = ['NODE_ENV', 'ALLOW_UNMODERATED_PHOTOS', 'PHOTO_MODERATION_MODE']
  let saved

  beforeEach(() => {
    saved = {}
    for (const key of envKeys) saved[key] = process.env[key]
    delete process.env.PHOTO_MODERATION_MODE
    delete process.env.ALLOW_UNMODERATED_PHOTOS
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('в проде без явного режима — strict', () => {
    process.env.NODE_ENV = 'production'
    expect(photoModerationMode()).toBe('strict')
  })

  it('вне прода без явного режима — permissive', () => {
    process.env.NODE_ENV = 'development'
    expect(photoModerationMode()).toBe('permissive')
  })

  it('явный режим перебивает дефолт', () => {
    process.env.NODE_ENV = 'production'
    process.env.PHOTO_MODERATION_MODE = 'permissive'
    expect(photoModerationMode()).toBe('permissive')
    process.env.NODE_ENV = 'development'
    process.env.PHOTO_MODERATION_MODE = 'strict'
    expect(photoModerationMode()).toBe('strict')
  })

  it('strict: новое фото всегда pending', () => {
    process.env.NODE_ENV = 'production'
    process.env.PHOTO_MODERATION_MODE = 'strict'
    expect(initialPhotoModerationStatus()).toBe('pending')
  })

  it('permissive в проде всё равно pending (некому публиковать без модератора)', () => {
    process.env.NODE_ENV = 'production'
    process.env.PHOTO_MODERATION_MODE = 'permissive'
    expect(initialPhotoModerationStatus()).toBe('pending')
  })

  it('permissive + ALLOW_UNMODERATED_PHOTOS вне прода: approved (иначе dev-фото невидимо)', () => {
    process.env.NODE_ENV = 'development'
    process.env.PHOTO_MODERATION_MODE = 'permissive'
    process.env.ALLOW_UNMODERATED_PHOTOS = 'true'
    expect(initialPhotoModerationStatus()).toBe('approved')
  })

  it('permissive в тестовом окружении по умолчанию: approved', () => {
    process.env.NODE_ENV = 'test'
    expect(initialPhotoModerationStatus()).toBe('approved')
  })
})
