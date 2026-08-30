vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
  delete process.env.OPENAI_API_KEY
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'

vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
    getConnection: vi.fn(),
  },
}))

vi.mock('../ws.js', () => ({
  getIO: vi.fn(() => ({ to: vi.fn(() => ({ emit: vi.fn() })) })),
}))

vi.mock('../banned-words.js', () => ({
  getBannedWords: vi.fn(async () => []),
  containsBannedWord: vi.fn(() => false),
}))

vi.mock('./push.js', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  sendPushToUser: vi.fn(async () => {}),
  sendPushToAll: vi.fn(),
}))

vi.mock('./experiments.js', () => ({
  trackEvent: vi.fn(async () => {}),
}))

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('../circuit-breaker.js', () => ({
  createBreaker: (fn) => ({ fire: (args) => fn(args) }),
}))

import pool from '../db.js'
import hangoutsRoutes from '../routes/hangouts.js'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

function createApp() {
  const app = express()
  app.use(express.json())
  app.use(hangoutsRoutes)
  return app
}

const app = createApp()

function authToken(userId = 1) {
  return jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })
}

const meProfile = { display_name: 'Ann', age: 25, bio: 'love art', city: 'Moscow', dating_goal: 'relationship' }

beforeEach(() => {
  pool.query.mockReset()
})

describe('POST /api/hangouts/suggest (AI-подбор встреч под пару)', () => {
  it('requires auth', async () => {
    const res = await request(app).post('/api/hangouts/suggest').send({})
    expect(res.status).toBe(401)
  })

  it('rejects non-premium user with 403 PREMIUM_REQUIRED', async () => {
    // нет активной подписки → cap = FREE
    pool.query.mockResolvedValueOnce([[], []]) // subscriptions
    const res = await request(app)
      .post('/api/hangouts/suggest')
      .set('Authorization', `Bearer ${authToken(3)}`)
      .send({})
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('PREMIUM_REQUIRED')
  })

  it('returns static suggestions for premium when no DB hangouts and no OpenAI key', async () => {
    // call1 subscriptions (premium), call2 me profile, call3 hangouts fallback (empty)
    pool.query
      .mockResolvedValueOnce([[{ id: 1 }], []])          // subscriptions → premium
      .mockResolvedValueOnce([[meProfile], []])           // me profile
      .mockResolvedValueOnce([[], []])                    // hangouts fallback empty
    const res = await request(app)
      .post('/api/hangouts/suggest')
      .set('Authorization', `Bearer ${authToken(5)}`)
      .send({})
    expect(res.status).toBe(200)
    expect(res.body.source).toBe('static')
    expect(Array.isArray(res.body.suggestions)).toBe(true)
    expect(res.body.suggestions.length).toBeGreaterThan(0)
    expect(res.body.suggestions[0]).toHaveProperty('title')
    expect(res.body.suggestions[0]).toHaveProperty('category')
  })

  it('returns db suggestions (existing active hangouts) for premium', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1 }], []])          // subscriptions → premium
      .mockResolvedValueOnce([[meProfile], []])           // me profile
      .mockResolvedValueOnce([[{ id: 99, category: 'cinema', title: 'Dune 2', place_name: 'Aurora', city: 'Moscow' }], []]) // hangouts fallback
    const res = await request(app)
      .post('/api/hangouts/suggest')
      .set('Authorization', `Bearer ${authToken(7)}`)
      .send({ language: 'ru' })
    expect(res.status).toBe(200)
    expect(res.body.source).toBe('db')
    expect(res.body.suggestions.length).toBeGreaterThan(0)
  })

  it('works when partner user_id passed (fetch partner profile)', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1 }], []])          // subscriptions → premium
      .mockResolvedValueOnce([[meProfile], []])           // me profile
      .mockResolvedValueOnce([[{ display_name: 'Bob', age: 30, bio: 'sport', city: 'SPb' }], []]) // partner profile
      .mockResolvedValueOnce([[], []])                    // hangouts fallback empty
    const res = await request(app)
      .post('/api/hangouts/suggest')
      .set('Authorization', `Bearer ${authToken(9)}`)
      .send({ user_id: 42 })
    expect(res.status).toBe(200)
    expect(res.body.source).toBe('static')
  })

  it('handles db error with 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app)
      .post('/api/hangouts/suggest')
      .set('Authorization', `Bearer ${authToken(2)}`)
      .send({})
    expect(res.status).toBe(500)
  })
})
