vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
  delete process.env.REDIS_URL
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'

vi.mock('../db.js', () => ({ default: { query: vi.fn(), getConnection: vi.fn() } }))
vi.mock('../ws.js', () => ({ getIO: vi.fn(() => ({ to: vi.fn(() => ({ emit: vi.fn() })) })) }))
vi.mock('../banned-words.js', () => ({
  getBannedWords: vi.fn(async () => []),
  containsBannedWord: vi.fn(() => false),
}))
vi.mock('../routes/push.js', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  sendPushToUser: vi.fn(async () => {}),
  sendPushToAll: vi.fn(),
}))
vi.mock('../routes/experiments.js', () => ({ trackEvent: vi.fn(async () => {}) }))
vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import pool from '../db.js'
import logger from '../logger.js'
import hangoutsRoutes from '../routes/hangouts.js'

const JWT_SECRET = 'test-secret'
const app = express()
app.use(express.json())
app.use(hangoutsRoutes)

const as = (userId = 1) => ({
  Authorization: `Bearer ${jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })}`,
})

const listRow = (over = {}) => ({
  id: 5,
  author_id: 2,
  category: 'cafe',
  title: 'Кофе',
  city: 'Сочи',
  event_date: '2026-11-10',
  status: 'active',
  attendees_csv: '',
  ...over,
})

const sqlCalls = () => pool.query.mock.calls.map((c) => String(c[0]))

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockReset()
  pool.getConnection.mockReset()
  pool.query.mockResolvedValue([[], []])
})

describe('GET /api/hangouts: фильтры и пагинация', () => {
  it('type, min_price, max_price и даты попадают в SQL и идут в правильном порядке', async () => {
    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ total: 0 }], []])
    const res = await request(app).get('/api/hangouts').query({
      type: 'company',
      price: 'paid',
      min_price: 100,
      max_price: 500,
      date_from: '2026-11-01',
      date_to: '2026-12-01',
      limit: 999,
      page: 2,
    })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ items: [], total: 0 })
    const [sql, params] = pool.query.mock.calls[0]
    expect(sql).toContain('h.hangout_type = ?')
    expect(sql).toContain('h.price >= ?')
    expect(sql).toContain('h.price <= ?')
    expect(sql).toContain('h.event_date >= ?')
    expect(sql).toContain('h.event_date <= ?')
    expect(params).toEqual(['company', 100, 500, '2026-11-01', '2026-12-01', 50, 50])
    expect(pool.query.mock.calls[1][1]).toEqual(['company', 100, 500, '2026-11-01', '2026-12-01'])
  })

  it('неизвестный type не добавляет фильтр, limit ограничен 50', async () => {
    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ total: 0 }], []])
    const res = await request(app).get('/api/hangouts').query({ type: 'party', limit: 999 })
    expect(res.status).toBe(200)
    const [sql, params] = pool.query.mock.calls[0]
    expect(sql).not.toContain('h.hangout_type = ?')
    expect(params).toEqual([50, 0])
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).get('/api/hangouts')
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Hangouts feed error:', expect.any(Error))
  })
})

describe('Мои встречи и отклики: ошибки', () => {
  it('GET /api/hangouts/my — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).get('/api/hangouts/my').set(as())
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('My hangouts error:', expect.any(Error))
  })

  it('GET /api/hangouts/responses/my — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).get('/api/hangouts/responses/my').set(as())
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('My hangout responses error:', expect.any(Error))
  })
})

describe('Серии: ошибки', () => {
  it('POST /api/hangouts/series — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).post('/api/hangouts/series').set(as()).send({ title: 'Серия' })
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Hangout series create error:', expect.any(Error))
  })

  it('GET /api/hangouts/series — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).get('/api/hangouts/series').set(as())
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Hangout series list error:', expect.any(Error))
  })

  it('PUT /api/hangouts/:id/series — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).put('/api/hangouts/5/series').set(as()).send({ series_id: 3 })
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Hangout series assign error:', expect.any(Error))
  })
})

describe('GET /api/hangouts/:id/related: серия и похожие', () => {
  it('отдаёт участников из attendees_csv, фильтрует по городу и исключает серию из похожих', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 5, category: 'cafe', city: 'Сочи', series_id: 7 }], []])
      .mockResolvedValueOnce([[listRow({ id: 6, attendees_csv: '2|Маша|/a.png;3|Петя|' })], []])
      .mockResolvedValueOnce([[listRow({ id: 8, attendees_csv: '' })], []])
    const res = await request(app).get('/api/hangouts/5/related').set(as())
    expect(res.status).toBe(200)
    expect(res.body.sameSeries).toHaveLength(1)
    expect(res.body.sameSeries[0].attendees).toEqual([
      { user_id: 2, display_name: 'Маша', avatar_url: '/a.png' },
      { user_id: 3, display_name: 'Петя', avatar_url: null },
    ])
    expect(res.body.sameSeries[0].attendees_csv).toBeUndefined()
    expect(res.body.similar).toHaveLength(1)

    const sameSeriesSql = String(pool.query.mock.calls[1][0])
    expect(sameSeriesSql).toContain('h.series_id = ?')
    expect(pool.query.mock.calls[1][1]).toEqual([7, '5', 1, 1])

    const similarSql = String(pool.query.mock.calls[2][0])
    expect(similarSql).toContain('h.city = ?')
    expect(similarSql).toContain('(h.series_id IS NULL OR h.series_id != ?)')
    expect(pool.query.mock.calls[2][1]).toEqual(['cafe', '5', 1, 1, 'Сочи', 7])
  })

  it('без серии sameSeries пустой, город в похожие не добавляется', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 5, category: 'cafe', city: null, series_id: null }], []])
      .mockResolvedValueOnce([[], []])
    const res = await request(app).get('/api/hangouts/5/related')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ sameSeries: [], similar: [] })
    const similarSql = String(pool.query.mock.calls[1][0])
    expect(similarSql).not.toContain('h.city = ?')
    expect(similarSql).not.toContain('(h.series_id IS NULL OR h.series_id != ?)')
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).get('/api/hangouts/5/related')
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Hangout related error:', expect.any(Error))
  })
})

describe('GET /api/hangouts/:id/related: tombstone', () => {
  it('слитая встреча не отдаётся как база — 404', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(app).get('/api/hangouts/5/related')
    expect(res.status).toBe(404)
    expect(sqlCalls()[0]).toContain('merged_into IS NULL')
  })
})
