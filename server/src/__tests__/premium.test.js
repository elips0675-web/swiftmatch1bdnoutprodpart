vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
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

import pool from '../db.js'
import premiumRoutes from '../routes/premium.js'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'
const app = express()
app.use(express.json())
app.use(premiumRoutes)

function authToken(userId = 1) {
  return jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })
}

function mockTransaction() {
  const conn = { query: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() }
  pool.getConnection.mockResolvedValue(conn)
  return conn
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/premium/tiers', () => {
  it('returns all tiers', async () => {
    const res = await request(app).get('/api/premium/tiers')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(3)
    expect(res.body[0].id).toBe('plus')
    expect(res.body[1].id).toBe('gold')
    expect(res.body[2].id).toBe('platinum')
  })
})

describe('GET /api/premium/my', () => {
  it('requires auth', async () => {
    const res = await request(app).get('/api/premium/my')
    expect(res.status).toBe(401)
  })

  it('returns null when no active subscription', async () => {
    pool.query.mockResolvedValue([[], []])
    const res = await request(app)
      .get('/api/premium/my')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(200)
    expect(res.body).toBeNull()
  })

  it('returns active subscription', async () => {
    pool.query.mockResolvedValue([[{ tier: 'gold', duration_months: 1, price: 699, started_at: '2025-01-01', expires_at: '2025-02-01', is_active: 1 }], []])
    const res = await request(app)
      .get('/api/premium/my')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.tier).toBe('gold')
  })
})

describe('POST /api/premium/create-checkout', () => {
  it('requires auth', async () => {
    const res = await request(app).post('/api/premium/create-checkout').send({ tier: 'plus', duration_months: 1 })
    expect(res.status).toBe(401)
  })

  it('rejects invalid body', async () => {
    const res = await request(app)
      .post('/api/premium/create-checkout')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({})
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/required/i)
  })

  it('rejects invalid tier', async () => {
    const res = await request(app)
      .post('/api/premium/create-checkout')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ tier: 'nonexistent', duration_months: 1 })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/invalid tier/i)
  })

  it('rejects invalid duration_months value', async () => {
    const res = await request(app)
      .post('/api/premium/create-checkout')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ tier: 'plus', duration_months: 'abc' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/duration_months/)
  })

  it('rejects zero duration_months', async () => {
    const res = await request(app)
      .post('/api/premium/create-checkout')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ tier: 'plus', duration_months: 0 })
    expect(res.status).toBe(400)
  })

  it('creates mock subscription without Stripe', async () => {
    pool.query.mockResolvedValue([[], []])
    mockTransaction()
    const res = await request(app)
      .post('/api/premium/create-checkout')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ tier: 'plus', duration_months: 1 })
    expect(res.status).toBe(201)
    expect(res.body.message).toMatch(/mock/i)
    expect(pool.getConnection).toHaveBeenCalled()
  })
})

describe('POST /api/premium/cancel', () => {
  it('requires auth', async () => {
    const res = await request(app).post('/api/premium/cancel')
    expect(res.status).toBe(401)
  })

  it('cancels active subscription', async () => {
    pool.query.mockResolvedValue([{ affectedRows: 1 }, []])
    const res = await request(app)
      .post('/api/premium/cancel')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.message).toMatch(/cancelled/i)
  })

  it('returns 404 when no active subscription', async () => {
    pool.query.mockResolvedValue([{ affectedRows: 0 }, []])
    const res = await request(app)
      .post('/api/premium/cancel')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(404)
  })
})
