import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../db.js', () => {
  const q = vi.fn()
  q.mockResolvedValue([[], []])
  return { default: { query: q } }
})

vi.mock('../logger.js', () => {
  const mock = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
  return {
    default: mock,
    createLogger: () => ({ ...mock }),
    rootLogger: mock,
  }
})

vi.mock('../middleware.js', () => ({
  auth: (req, res, next) => { req.userId = 1; next() },
  optionalAuth: (req, res, next) => { req.userId = 1; next() },
}))

vi.mock('../sms.js', () => ({
  sendSMS: vi.fn().mockResolvedValue({ success: true, mock: true }),
  isSMSConfigured: vi.fn().mockReturnValue(false),
}))

import pool from '../db.js'
import { sendSMS } from '../sms.js'
import smsRoutes from '../routes/sms.js'

function createApp() {
  const app = express()
  app.use(express.json())
  app.use(smsRoutes)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockResolvedValue([[], []])
  sendSMS.mockResolvedValue({ success: true, mock: true })
})

describe('POST /api/sms/send-code', () => {
  const app = createApp()

  it('validates phone number', async () => {
    const res = await request(app)
      .post('/api/sms/send-code')
      .send({ phone: 'invalid' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('INVALID_PHONE')
  })

  it('sends code for valid phone', async () => {
    pool.query.mockReset()
    sendSMS.mockResolvedValueOnce({ success: true, mock: true })

    const res = await request(app)
      .post('/api/sms/send-code')
      .send({ phone: '+79161234567' })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  it('handles database error', async () => {
    pool.query.mockReset()
    pool.query.mockRejectedValue(new Error('DB error'))

    const res = await request(app)
      .post('/api/sms/send-code')
      .send({ phone: '+79161234567' })
    expect(res.status).toBe(500)
  })
})

describe('POST /api/sms/verify', () => {
  const app = createApp()

  it('validates required fields', async () => {
    const res = await request(app)
      .post('/api/sms/verify')
      .send({ phone: '+79161234567' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('MISSING_FIELDS')
  })

  it('verifies valid code', async () => {
    const future = new Date(Date.now() + 120000).toISOString()
    pool.query.mockReset()
    pool.query
      .mockResolvedValueOnce([[{ id: 1, code: '1234', expires_at: future, verified: 0 }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])

    const res = await request(app)
      .post('/api/sms/verify')
      .send({ phone: '+79161234567', code: '1234' })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  it('rejects expired code', async () => {
    const past = new Date(Date.now() - 120000).toISOString()
    pool.query.mockReset()
    pool.query.mockResolvedValueOnce([[{ id: 1, code: '1234', expires_at: past, verified: 0 }], []])

    const res = await request(app)
      .post('/api/sms/verify')
      .send({ phone: '+79161234567', code: '1234' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('CODE_EXPIRED')
  })

  it('rejects wrong code', async () => {
    const future = new Date(Date.now() + 120000).toISOString()
    pool.query.mockReset()
    pool.query.mockResolvedValueOnce([[{ id: 1, code: '1234', expires_at: future, verified: 0 }], []])

    const res = await request(app)
      .post('/api/sms/verify')
      .send({ phone: '+79161234567', code: '0000' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('INVALID_CODE')
  })

  it('handles database error', async () => {
    pool.query.mockReset()
    pool.query.mockRejectedValue(new Error('DB error'))

    const res = await request(app)
      .post('/api/sms/verify')
      .send({ phone: '+79161234567', code: '1234' })
    expect(res.status).toBe(500)
  })
})

describe('GET /api/sms/status', () => {
  const app = createApp()

  it('returns verified status', async () => {
    pool.query.mockReset()
    pool.query.mockResolvedValueOnce([[{ phone: '+79161234567', verified: 1, created_at: '2026-01-01T00:00:00.000Z' }], []])

    const res = await request(app).get('/api/sms/status')
    expect(res.status).toBe(200)
    expect(res.body.verified).toBe(true)
    expect(res.body.phone).toBe('+79161234567')
  })

  it('returns unverified when no record', async () => {
    pool.query.mockReset()
    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ phone: null }], []])

    const res = await request(app).get('/api/sms/status')
    expect(res.status).toBe(200)
    expect(res.body.verified).toBe(false)
  })

  it('handles database error', async () => {
    pool.query.mockReset()
    pool.query.mockRejectedValue(new Error('DB error'))

    const res = await request(app).get('/api/sms/status')
    expect(res.status).toBe(500)
  })
})
