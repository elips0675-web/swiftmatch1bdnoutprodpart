vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'

vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}))

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import pool from '../db.js'
import pushRoutes from '../routes/push.js'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

function authHeader(userId = 5) {
  return 'Bearer ' + jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })
}

function createApp() {
  const app = express()
  app.use(express.json())
  app.use(pushRoutes)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/push/vapid-public-key', () => {
  const app = createApp()

  it('returns empty key when not configured', async () => {
    const res = await request(app).get('/api/push/vapid-public-key')
    expect(res.status).toBe(200)
    expect(res.body.publicKey).toBe('')
  })
})

describe('POST /api/push/subscribe', () => {
  const app = createApp()

  it('validates required fields', async () => {
    const res = await request(app)
      .post('/api/push/subscribe')
      .set('Authorization', authHeader())
      .send({ endpoint: 'https://example.com' })
    expect(res.status).toBe(400)
  })

  it('creates subscription', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(app)
      .post('/api/push/subscribe')
      .set('Authorization', authHeader())
      .send({ endpoint: 'https://example.com', p256dh: 'key1', auth: 'auth1' })
    expect(res.status).toBe(201)
  })

  it('handles database error', async () => {
    pool.query.mockRejectedValue(new Error('DB error'))
    const res = await request(app)
      .post('/api/push/subscribe')
      .set('Authorization', authHeader())
      .send({ endpoint: 'https://example.com', p256dh: 'key1', auth: 'auth1' })
    expect(res.status).toBe(500)
  })
})

describe('DELETE /api/push/subscribe', () => {
  const app = createApp()

  it('unsubscribes successfully', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(app)
      .delete('/api/push/subscribe')
      .set('Authorization', authHeader())
      .send({ endpoint: 'https://example.com' })
    expect(res.status).toBe(200)
  })

  it('handles database error', async () => {
    pool.query.mockRejectedValue(new Error('DB error'))
    const res = await request(app)
      .delete('/api/push/subscribe')
      .set('Authorization', authHeader())
      .send({ endpoint: 'https://example.com' })
    expect(res.status).toBe(500)
  })
})
