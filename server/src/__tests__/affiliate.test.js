import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../db.js', () => ({
  default: { query: vi.fn(), getConnection: vi.fn() },
}))

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import pool from '../db.js'
import affiliateRoutes from '../routes/affiliate.js'

function createApp() {
  const app = express()
  app.use(express.json())
  app.use(affiliateRoutes)
  return app
}

const app = createApp()

const sampleOffers = [
  { id: 1, partner_id: 3, category: 'restaurant', title: 'Rest', description: 'd', image_url: null, deeplink: 'https://go/x', price: '2500.00', city: 'Москва', partner_name: 'Restoclub', commission_rate: '12.00', pinned: 1, created_at: '2026-08-30T00:00:00Z' },
  { id: 2, partner_id: 4, category: 'hotel', title: 'Hotel', description: 'd2', image_url: null, deeplink: 'https://go/y', price: '6000.00', city: 'СПб', partner_name: 'Ostrovok', commission_rate: '4.00', pinned: 0, created_at: '2026-08-30T00:00:01Z' },
]

beforeEach(() => {
  pool.query.mockReset()
})

describe('GET /api/affiliate/offers', () => {
  it('returns offers and maps numeric fields', async () => {
    pool.query.mockResolvedValueOnce([sampleOffers, []])
    const res = await request(app).get('/api/affiliate/offers')
    expect(res.status).toBe(200)
    expect(res.body.offers).toHaveLength(2)
    expect(res.body.offers[0].price).toBe(2500)
    expect(res.body.offers[0].commission_rate).toBe(12)
    expect(res.body.offers[0].deeplink).toBe('https://go/x')
  })

  it('passes city filter and limit into query params', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    await request(app).get('/api/affiliate/offers?city=Москва&limit=3')
    const [sql, params] = pool.query.mock.calls[0]
    expect(params).toContain('Москва')
    expect(params[params.length - 1]).toBe(3)
    expect(sql).toContain('po.city = ?')
    expect(sql).toContain('po.status = \'active\'')
  })

  it('passes category filter into query params', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    await request(app).get('/api/affiliate/offers?category=restaurant')
    const [sql, params] = pool.query.mock.calls[0]
    expect(params).toContain('restaurant')
    expect(sql).toContain('po.category = ?')
  })

  it('ignores unknown category filter (no WHERE category clause)', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    await request(app).get('/api/affiliate/offers?category=unknown')
    const [sql] = pool.query.mock.calls[0]
    expect(sql).not.toContain('po.category = ?')
  })

  it('handles error with 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).get('/api/affiliate/offers')
    expect(res.status).toBe(500)
  })
})
