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
    execute: vi.fn(),
    getConnection: vi.fn(),
  },
}))

import pool from '../db.js'
import partnerDashboardRoutes from '../routes/partner-dashboard.js'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

function createApp() {
  const app = express()
  app.use(express.json())
  app.use(partnerDashboardRoutes)
  return app
}

function authToken(userId = 7) {
  return jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })
}

const PARTNER = { id: 3, user_id: 7, name: 'Partner', type: 'deeplink', status: 'active', commission_rate: 10 }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/partner/register', () => {
  it('creates a partner with default deeplink type', async () => {
    pool.query
      .mockResolvedValueOnce([[undefined], []])
      .mockResolvedValueOnce([[undefined], []])
      .mockResolvedValueOnce([{ insertId: 11 }, []])
    const res = await request(createApp())
      .post('/api/partner/register')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ name: '   My Shop   ' })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe(11)
    const insert = pool.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO partners'))
    expect(insert[1][1]).toBe('My Shop')
    expect(insert[1][2]).toBe('deeplink')
  })

  it('rejects invalid partner type with 400 and no DB writes', async () => {
    const res = await request(createApp())
      .post('/api/partner/register')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ name: 'My Shop', type: 'bogus' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/type must be one of/)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('truncates an overlong partner name to the column size', async () => {
    pool.query
      .mockResolvedValueOnce([[undefined], []])
      .mockResolvedValueOnce([[undefined], []])
      .mockResolvedValueOnce([{ insertId: 12 }, []])
    const res = await request(createApp())
      .post('/api/partner/register')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ name: 'x'.repeat(300) })
    expect(res.status).toBe(201)
    const insert = pool.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO partners'))
    expect(insert[1][1]).toHaveLength(100)
  })
})

describe('POST /api/partner/offers', () => {
  it('creates a valid offer with normalized fields', async () => {
    pool.query
      .mockResolvedValueOnce([[PARTNER], []])
      .mockResolvedValueOnce([[undefined], []])
      .mockResolvedValueOnce([[{ count: 0 }], []])
      .mockResolvedValueOnce([{ insertId: 9 }, []])
      .mockResolvedValueOnce([[], []])
    const res = await request(createApp())
      .post('/api/partner/offers')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ category: 'restaurant', title: 'Ужин', deeplink: 'https://swiftmatch.app/go/1', price: '1490.50', city: 'Москва', capacity: '12' })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe(9)
    const insert = pool.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO partner_offers'))
    expect(insert[1][0]).toBe(3)
    expect(insert[1][2]).toBe('Ужин')
    expect(insert[1][4]).toBe('https://swiftmatch.app/go/1')
    expect(insert[1][5]).toBe(1490.5)
    expect(insert[1][6]).toBe('Москва')
    expect(insert[1][7]).toBe('chat')
    expect(insert[1][13]).toBe(12)
  })

  it('rejects garbage price with 400 and no writes', async () => {
    pool.query.mockResolvedValueOnce([[PARTNER], []])
    const res = await request(createApp())
      .post('/api/partner/offers')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ category: 'restaurant', title: 'Ужин', deeplink: 'https://x', price: 'abc' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/price/)
    expect(pool.query).toHaveBeenCalledTimes(1)
  })

  it('rejects negative capacity with 400', async () => {
    pool.query.mockResolvedValueOnce([[PARTNER], []])
    const res = await request(createApp())
      .post('/api/partner/offers')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ category: 'restaurant', title: 'Ужин', deeplink: 'https://x', capacity: -3 })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/capacity/)
  })

  it('rejects garbage event date with 400 instead of 500', async () => {
    pool.query.mockResolvedValueOnce([[PARTNER], []])
    const res = await request(createApp())
      .post('/api/partner/offers')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ category: 'restaurant', title: 'Ужин', deeplink: 'https://x', event_start: 'garbage' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/event_start/)
  })
})

describe('PUT /api/partner/offers/:offerId', () => {
  it('turns empty price into a NULL update instead of 500', async () => {
    pool.query
      .mockResolvedValueOnce([[PARTNER], []])
      .mockResolvedValueOnce([[{ id: 5 }], []])
      .mockResolvedValueOnce([[], []])
    const res = await request(createApp())
      .put('/api/partner/offers/5')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ price: '' })
    expect(res.status).toBe(200)
    const update = pool.query.mock.calls.find(([sql]) => sql.includes('UPDATE partner_offers'))
    expect(update[0]).toContain('price = ?')
    expect(update[1][0]).toBeUndefined()
  })

  it('rejects garbage price with 400', async () => {
    pool.query
      .mockResolvedValueOnce([[PARTNER], []])
      .mockResolvedValueOnce([[{ id: 5 }], []])
    const res = await request(createApp())
      .put('/api/partner/offers/5')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ price: 'abc' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/price/)
  })

  it('rejects garbage capacity with 400', async () => {
    pool.query
      .mockResolvedValueOnce([[PARTNER], []])
      .mockResolvedValueOnce([[{ id: 5 }], []])
    const res = await request(createApp())
      .put('/api/partner/offers/5')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ capacity: 'abc' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/capacity/)
  })

  it('rejects garbage event_start with 400 instead of 500', async () => {
    pool.query
      .mockResolvedValueOnce([[PARTNER], []])
      .mockResolvedValueOnce([[{ id: 5 }], []])
    const res = await request(createApp())
      .put('/api/partner/offers/5')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ event_start: 'bogus' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/event_start/)
  })

  it('truncates an overlong title to the column size', async () => {
    pool.query
      .mockResolvedValueOnce([[PARTNER], []])
      .mockResolvedValueOnce([[{ id: 5 }], []])
      .mockResolvedValueOnce([[], []])
    const res = await request(createApp())
      .put('/api/partner/offers/5')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ title: 't'.repeat(300) })
    expect(res.status).toBe(200)
    const update = pool.query.mock.calls.find(([sql]) => sql.includes('UPDATE partner_offers'))
    expect(update[1][0]).toHaveLength(255)
  })
})