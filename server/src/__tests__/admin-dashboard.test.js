import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../db.js', () => ({
  default: { query: vi.fn(), execute: vi.fn() },
}))

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import pool from '../db.js'
import dashboardRoutes from '../routes/admin/dashboard.js'

function createApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/admin', dashboardRoutes)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/admin/stats', () => {
  it('собирает шесть метрик, выручку округляет', async () => {
    pool.query
      .mockResolvedValueOnce([[{ total: 120 }]])
      .mockResolvedValueOnce([[{ activeToday: 30 }]])
      .mockResolvedValueOnce([[{ totalMatches: 55 }]])
      .mockResolvedValueOnce([[{ revenue: 1234.6 }]])
      .mockResolvedValueOnce([[{ activeSubs: 12 }]])
      .mockResolvedValueOnce([[{ newToday: 4 }]])
    const res = await request(createApp()).get('/api/admin/stats')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      totalUsers: 120,
      activeToday: 30,
      totalMatches: 55,
      revenue: 1235,
      activeSubs: 12,
      newToday: 4,
    })
  })

  it('падение любого запроса даёт 500', async () => {
    pool.query.mockResolvedValueOnce([[{ total: 1 }]]).mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp()).get('/api/admin/stats')
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to fetch stats')
  })
})

describe('GET /api/admin/revenue-by-month', () => {
  it('отдаёт строки выручки как есть', async () => {
    const rows = [{ month: '2026-01', revenue: 500 }]
    pool.query.mockResolvedValueOnce([rows])
    const res = await request(createApp()).get('/api/admin/revenue-by-month')
    expect(res.status).toBe(200)
    expect(res.body).toEqual(rows)
  })

  it('падение БД даёт 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp()).get('/api/admin/revenue-by-month')
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to fetch revenue data')
  })
})

describe('GET /api/admin/registration-trend', () => {
  it('дефолтный период 7 дней уходит в параметр запроса', async () => {
    pool.query.mockResolvedValueOnce([[{ date: '2026-01-01', users: 3 }]])
    const res = await request(createApp()).get('/api/admin/registration-trend')
    expect(res.status).toBe(200)
    expect(pool.query.mock.calls[0][1]).toEqual([7])
  })

  it('явный период берётся из query', async () => {
    pool.query.mockResolvedValueOnce([[]])
    await request(createApp()).get('/api/admin/registration-trend?period=30')
    expect(pool.query.mock.calls[0][1]).toEqual([30])
  })

  it('слишком большой период обрезается до 90', async () => {
    pool.query.mockResolvedValueOnce([[]])
    await request(createApp()).get('/api/admin/registration-trend?period=999')
    expect(pool.query.mock.calls[0][1]).toEqual([90])
  })

  it('ноль трактуется как отсутствие (дефолт 7), отрицательный период уходит в минимум 1', async () => {
    pool.query.mockResolvedValueOnce([[]])
    await request(createApp()).get('/api/admin/registration-trend?period=0')
    expect(pool.query.mock.calls[0][1]).toEqual([7])

    vi.clearAllMocks()
    pool.query.mockResolvedValueOnce([[]])
    await request(createApp()).get('/api/admin/registration-trend?period=-5')
    expect(pool.query.mock.calls[0][1]).toEqual([1])
  })

  it('мусор в периоде даёт дефолт 7', async () => {
    pool.query.mockResolvedValueOnce([[]])
    await request(createApp()).get('/api/admin/registration-trend?period=abc')
    expect(pool.query.mock.calls[0][1]).toEqual([7])
  })

  it('падение БД даёт 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp()).get('/api/admin/registration-trend')
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to fetch trend')
  })
})

describe('GET /api/admin/city-distribution', () => {
  it('отдаёт распределение по городам', async () => {
    const rows = [{ name: 'Москва', value: 40 }]
    pool.query.mockResolvedValueOnce([rows])
    const res = await request(createApp()).get('/api/admin/city-distribution')
    expect(res.status).toBe(200)
    expect(res.body).toEqual(rows)
  })

  it('падение БД даёт 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp()).get('/api/admin/city-distribution')
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to fetch city data')
  })
})

describe('GET /api/admin/recent-activity', () => {
  it('отдаёт последние действия', async () => {
    const rows = [{ id: 1, type: 'login', text: 'Иван login', time: '12:30' }]
    pool.query.mockResolvedValueOnce([rows])
    const res = await request(createApp()).get('/api/admin/recent-activity')
    expect(res.status).toBe(200)
    expect(res.body).toEqual(rows)
  })

  it('падение БД даёт 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp()).get('/api/admin/recent-activity')
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to fetch activity')
  })
})
