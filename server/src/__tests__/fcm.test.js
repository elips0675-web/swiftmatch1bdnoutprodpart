import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

const mockQuery = vi.fn()

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

import pool from '../db.js'
import fcmRoutes from '../routes/push-fcm.js'

function createApp() {
  const app = express()
  app.use(express.json())
  app.use(fcmRoutes)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockResolvedValue([[], []])
})

describe('POST /api/push/fcm/register', () => {
  const app = createApp()

  it('validates token is required', async () => {
    const res = await request(app)
      .post('/api/push/fcm/register')
      .send({})
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('token is required')
  })

  it('registers token successfully', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(app)
      .post('/api/push/fcm/register')
      .send({ token: 'fcm-token-123', platform: 'android' })
    expect(res.status).toBe(201)
    expect(res.body.message).toBe('FCM token registered')
  })

  it('handles database error', async () => {
    pool.query.mockRejectedValue(new Error('DB error'))
    const res = await request(app)
      .post('/api/push/fcm/register')
      .send({ token: 'fcm-token-123', platform: 'android' })
    expect(res.status).toBe(500)
  })
})

describe('DELETE /api/push/fcm/register', () => {
  const app = createApp()

  it('unregisters specific token', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(app)
      .delete('/api/push/fcm/register')
      .send({ token: 'fcm-token-123' })
    expect(res.status).toBe(200)
  })

  it('unregisters all tokens when no token provided', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(app)
      .delete('/api/push/fcm/register')
      .send({})
    expect(res.status).toBe(200)
  })
})

describe('parseServiceAccount', () => {
  it('parses raw JSON string', async () => {
    const { parseServiceAccount } = await import('../fcm.js')
    const sa = await parseServiceAccount('{"project_id":"raw-json"}')
    expect(sa.project_id).toBe('raw-json')
  })

  it('parses base64-encoded JSON', async () => {
    const { parseServiceAccount } = await import('../fcm.js')
    const b64 = Buffer.from('{"project_id":"base64-json"}').toString('base64')
    const sa = await parseServiceAccount(b64)
    expect(sa.project_id).toBe('base64-json')
  })

  it('parses JSON from file path', async () => {
    const { parseServiceAccount } = await import('../fcm.js')
    const os = await import('os')
    const path = await import('path')
    const fs = await import('fs')
    const file = path.join(os.tmpdir(), `sa-test-${Date.now()}.json`)
    fs.writeFileSync(file, '{"project_id":"file-json"}')
    const sa = await parseServiceAccount(file)
    fs.unlinkSync(file)
    expect(sa.project_id).toBe('file-json')
  })
})
  describe('GET /api/push/fcm/status', () => {
  const app = createApp()

  it('returns registered false when no tokens', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(app).get('/api/push/fcm/status')
    expect(res.status).toBe(200)
    expect(res.body.registered).toBe(false)
  })

  it('returns tokens list when registered', async () => {
    pool.query.mockResolvedValueOnce([[
      { token: 'tok1', platform: 'android', created_at: '2026-01-01T00:00:00.000Z' },
      { token: 'tok2', platform: 'android', created_at: '2026-01-02T00:00:00.000Z' },
    ], []])
    const res = await request(app).get('/api/push/fcm/status')
    expect(res.status).toBe(200)
    expect(res.body.registered).toBe(true)
    expect(res.body.tokens).toHaveLength(2)
  })
})
