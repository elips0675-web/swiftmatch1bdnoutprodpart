vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
  delete process.env.STRIPE_SECRET_KEY
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
}))

vi.mock('../ws.js', () => ({
  getIO: vi.fn(() => null),
}))

vi.mock('../cache.js', () => ({
  getCached: vi.fn(() => Promise.resolve(null)),
  setCached: vi.fn(() => Promise.resolve()),
  invalidate: vi.fn(() => Promise.resolve()),
}))

import pool from '../db.js'
import eventsRoutes from '../routes/events.js'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

function createApp() {
  const app = express()
  app.use(express.json())
  app.use(eventsRoutes)
  return app
}

const app = createApp()

function authToken(userId = 1) {
  return jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })
}

const sampleEvent = {
  id: 1, partner_id: 3, category: 'event', title: 'Speed-dating', description: 'Test',
  poster_url: null, price: 1500, city: 'Москва', location: 'Лофт',
  event_start: '2026-12-01T18:00:00Z', event_end: null, event_url: null,
  deeplink: null, capacity: 40, tickets_sold: 5, remaining: 35, partner_name: 'Wild Events',
}

beforeEach(() => {
  pool.query.mockReset()
})

describe('GET /api/events', () => {
  it('requires auth', async () => {
    const res = await request(app).get('/api/events')
    expect(res.status).toBe(401)
  })

  it('returns array of events with sold_out flags', async () => {
    pool.query.mockResolvedValueOnce([[{ ...sampleEvent, tickets_sold: 40, remaining: 0 }], []])
    const res = await request(app)
      .get('/api/events')
      .set('Authorization', `Bearer ${authToken(2)}`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body[0].sold_out).toBe(true)
    expect(res.body[0].remaining).toBe(0)
  })

  it('returns empty array on db error', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app)
      .get('/api/events')
      .set('Authorization', `Bearer ${authToken(2)}`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.length).toBe(0)
  })
})

describe('GET /api/events/:id', () => {
  it('rejects non-numeric id', async () => {
    const res = await request(app)
      .get('/api/events/abc')
      .set('Authorization', `Bearer ${authToken(2)}`)
    expect(res.status).toBe(400)
  })

  it('returns 404 when event not found', async () => {
    pool.query.mockResolvedValueOnce([[undefined], []])
    const res = await request(app)
      .get('/api/events/999')
      .set('Authorization', `Bearer ${authToken(2)}`)
    expect(res.status).toBe(404)
  })

  it('returns event details with my_ticket', async () => {
    pool.query
      .mockResolvedValueOnce([[sampleEvent], []])
      .mockResolvedValueOnce([[{ id: 7, status: 'paid', stripe_session_id: 'cs_1', amount: 1500 }], []])
    const res = await request(app)
      .get('/api/events/1')
      .set('Authorization', `Bearer ${authToken(5)}`)
    expect(res.status).toBe(200)
    expect(res.body.title).toBe('Speed-dating')
    expect(res.body.my_ticket.status).toBe('paid')
  })
})

describe('POST /api/events/:id/purchase', () => {
  it('rejects non-numeric id', async () => {
    const res = await request(app)
      .post('/api/events/xyz/purchase')
      .set('Authorization', `Bearer ${authToken(2)}`)
    expect(res.status).toBe(400)
  })

  it('requires auth', async () => {
    const res = await request(app).post('/api/events/1/purchase')
    expect(res.status).toBe(401)
  })

  it('returns 404 for ended/unknown event', async () => {
    pool.query.mockResolvedValueOnce([[undefined], []])
    const res = await request(app)
      .post('/api/events/999/purchase')
      .set('Authorization', `Bearer ${authToken(2)}`)
    expect(res.status).toBe(404)
  })

  it('returns 400 for unticketed event', async () => {
    pool.query.mockResolvedValueOnce([[{ ...sampleEvent, price: 0 }], []])
    const res = await request(app)
      .post('/api/events/1/purchase')
      .set('Authorization', `Bearer ${authToken(2)}`)
    expect(res.status).toBe(400)
  })

  it('returns 409 sold out', async () => {
    pool.query.mockResolvedValueOnce([[{ ...sampleEvent, capacity: 40, tickets_sold: 40 }], []])
    const res = await request(app)
      .post('/api/events/1/purchase')
      .set('Authorization', `Bearer ${authToken(2)}`)
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('SOLD_OUT')
  })

  it('returns 409 on already purchased ticket', async () => {
    pool.query
      .mockResolvedValueOnce([[sampleEvent], []])
      .mockResolvedValueOnce([[{ id: 7, status: 'paid' }], []])
    const res = await request(app)
      .post('/api/events/1/purchase')
      .set('Authorization', `Bearer ${authToken(2)}`)
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('ALREADY_PURCHASED')
  })

  it('purchases ticket via mock flow', async () => {
    pool.query
      .mockResolvedValueOnce([[sampleEvent], []])
      .mockResolvedValueOnce([[null], []])
      .mockResolvedValueOnce([{ insertId: 100 }, []])
      .mockResolvedValueOnce([{ insertId: 50 }, []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
    const res = await request(app)
      .post('/api/events/1/purchase')
      .set('Authorization', `Bearer ${authToken(2)}`)
    expect(res.status).toBe(201)
    expect(res.body.mock).toBe(true)
    expect(res.body.ticket_id).toBe(50)
    expect(pool.query.mock.calls.length).toBe(6)
  })
})

describe('POST /api/events/order/webhook', () => {
  it('returns received when stripe not configured', async () => {
    const res = await request(app).post('/api/events/order/webhook').send({})
    expect(res.status).toBe(200)
    expect(res.body.received).toBe(true)
  })
})
