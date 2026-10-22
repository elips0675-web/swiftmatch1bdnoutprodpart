import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }))

vi.mock('../logger.js', () => {
  const mock = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
  return { default: mock, createLogger: () => ({ ...mock }), rootLogger: mock }
})

vi.mock('../middleware.js', () => ({
  auth: (req, _res, next) => { req.userId = Number(req.headers['x-user-id']) || 1; next() },
  optionalAuth: (req, _res, next) => { req.userId = Number(req.headers['x-user-id']) || 1; next() },
}))

vi.mock('../sms.js', () => ({
  sendSMS: vi.fn().mockResolvedValue({ success: true, mock: true }),
  isSMSConfigured: vi.fn().mockReturnValue(false),
}))

import pool from '../db.js'
import { sendSMS } from '../sms.js'
import smsRoutes from '../routes/sms.js'

const T0 = Date.parse('2026-01-01T00:00:00Z')
const HOUR = 3600000

const app = express()
app.use(express.json())
app.use(smsRoutes)

const sendCodeLayer = smsRoutes.stack.find((layer) => layer.route?.path === '/api/sms/send-code').route
const sendCodeHandler = sendCodeLayer.stack[sendCodeLayer.stack.length - 1].handle

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this },
  }
}

async function callSendCode(userId) {
  const res = fakeRes()
  await sendCodeHandler(
    { body: { phone: '+79161234567' }, userId, headers: { 'x-user-id': String(userId) } },
    res,
  )
  return res
}

describe('routes/sms.js — уборка карты антифлуда', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pool.query.mockResolvedValue([[], []])
    sendSMS.mockResolvedValue({ success: true, mock: true })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('при 10000+ ключах протухшие записи уходят, активный лимит сохраняется', { timeout: 180000 }, async () => {
    for (let userId = 1; userId <= 10000; userId += 1) {
      const filled = await callSendCode(userId)
      expect(filled.statusCode).toBe(200)
    }

    vi.setSystemTime(T0 + 2 * HOUR)

    const active = 999999
    for (let i = 0; i < 3; i += 1) {
      const ok = await request(app)
        .post('/api/sms/send-code')
        .set('x-user-id', String(active))
        .send({ phone: '+79161234567' })
      expect(ok.status).toBe(200)
    }

    const over = await request(app)
      .post('/api/sms/send-code')
      .set('x-user-id', String(active))
      .send({ phone: '+79161234567' })
    expect(over.status).toBe(429)
    expect(over.body.error).toBe('RATE_LIMITED')
    expect(over.body.retryAfter).toBeGreaterThan(0)

    const stale = await request(app)
      .post('/api/sms/send-code')
      .set('x-user-id', '1')
      .send({ phone: '+79161234567' })
    expect(stale.status).toBe(200)
    expect(sendSMS).toHaveBeenCalled()
  })
})
