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
import premiumRoutes, { applyPremiumCheckout } from '../routes/premium.js'

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

describe('ошибки БД на premium-роутах не отдают 200', () => {
  it('GET /api/premium/my при сбое БД → 500', async () => {
    pool.query.mockRejectedValue(new Error('db down'))
    const res = await request(app)
      .get('/api/premium/my')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(500)
    expect(res.body.message).toMatch(/failed to check/i)
  })

  it('POST /api/premium/cancel при сбое БД → 500', async () => {
    pool.query.mockRejectedValue(new Error('db down'))
    const res = await request(app)
      .post('/api/premium/cancel')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(500)
    expect(res.body.message).toMatch(/failed to cancel/i)
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

  it('отмена сохраняет доступ до конца оплаченного периода', async () => {
    pool.query
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[{ expires_at: '2026-12-01T00:00:00.000Z' }], []])
    const res = await request(app)
      .post('/api/premium/cancel')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('canceled')
    expect(res.body.activeUntil).toBe('2026-12-01T00:00:00.000Z')
    const cancelSql = String(pool.query.mock.calls[0][0])
    expect(cancelSql).toContain("SET status = 'canceled'")
    expect(cancelSql).not.toContain('is_active = 0')
  })

  it('returns 404 when no active subscription', async () => {
    pool.query.mockResolvedValue([{ affectedRows: 0 }, []])
    const res = await request(app)
      .post('/api/premium/cancel')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(404)
  })
})

describe('applyPremiumCheckout: подписка привязана к платежу и идемпотентна', () => {
  it('пишет provider=stripe и provider_subscription_id = session.id', async () => {
    const conn = mockTransaction()
    conn.query.mockImplementation(() => Promise.resolve([[], []]))
    const applied = await applyPremiumCheckout(
      { data: { object: { id: 'cs_123', metadata: { userId: '5', tier: 'plus', duration_months: '1' } } } },
      conn,
    )
    expect(applied).toBe(true)
    const insertCall = conn.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO subscriptions'))
    expect(String(insertCall[0])).toContain('provider_subscription_id')
    expect(String(insertCall[0])).toContain("'stripe'")
    expect(insertCall[1]).toContain('cs_123')
    expect(String(insertCall[0])).toContain("'active'")
  })

  it('повторная доставка того же платежа не продлевает подписку', async () => {
    const conn = mockTransaction()
    conn.query.mockImplementation((sql) =>
      String(sql).includes('FROM subscriptions WHERE provider')
        ? Promise.resolve([[{ id: 9 }], []])
        : Promise.resolve([{ affectedRows: 1 }, []]),
    )
    const applied = await applyPremiumCheckout(
      { data: { object: { id: 'cs_dup', metadata: { userId: '5', tier: 'plus' } } } },
      conn,
    )
    expect(applied).toBe(false)
    expect(conn.query.mock.calls.map((c) => String(c[0])).some((s) => s.includes('INSERT INTO subscriptions'))).toBe(false)
  })

  it('payload без session.id (старый формат) по-прежнему применяется', async () => {
    const conn = mockTransaction()
    conn.query.mockImplementation(() => Promise.resolve([[], []]))
    const applied = await applyPremiumCheckout(
      { data: { object: { metadata: { userId: '5', tier: 'plus' } } } },
      conn,
    )
    expect(applied).toBe(true)
    const insertCall = conn.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO subscriptions'))
    expect(insertCall[1][1]).toBeNull()
  })
})
