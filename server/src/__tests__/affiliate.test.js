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

  it('maps null price/lat/lng/commission_rate to null instead of 0', async () => {
    pool.query.mockResolvedValueOnce([[
      { id: 9, partner_id: 5, category: 'gift', title: 'Gift', description: null, image_url: null, deeplink: 'https://go/z', price: null, city: null, lat: null, lng: null, partner_name: 'Shop', commission_rate: null },
      { id: 10, partner_id: 5, category: 'gift', title: 'Gift2', description: null, image_url: null, deeplink: 'https://go/w', price: '100', city: 'Сочи', lat: '43.6', lng: '39.7', partner_name: 'Shop', commission_rate: '5' },
    ], []])
    const res = await request(app).get('/api/affiliate/offers')
    expect(res.status).toBe(200)
    expect(res.body.offers[0].price).toBeNull()
    expect(res.body.offers[0].lat).toBeNull()
    expect(res.body.offers[0].lng).toBeNull()
    expect(res.body.offers[0].commission_rate).toBeNull()
    expect(res.body.offers[1].lat).toBe(43.6)
    expect(res.body.offers[1].lng).toBe(39.7)
  })

  it('clamps limit: below minimum -> 1, above maximum -> 12', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    await request(app).get('/api/affiliate/offers?limit=0')
    expect(pool.query.mock.calls[0][1].at(-1)).toBe(6)

    pool.query.mockResolvedValueOnce([[], []])
    await request(app).get('/api/affiliate/offers?limit=999')
    expect(pool.query.mock.calls[1][1].at(-1)).toBe(12)
  })

  it('combines city and known category filters', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    await request(app).get('/api/affiliate/offers?city=Казань&category=hotel')
    const [sql, params] = pool.query.mock.calls[0]
    expect(sql).toContain('po.category = ?')
    expect(sql).toContain('po.city = ?')
    expect(params).toContain('hotel')
    expect(params).toContain('Казань')
  })
})
