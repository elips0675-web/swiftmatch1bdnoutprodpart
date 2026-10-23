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
import analyticsRoutes from '../routes/admin/analytics.js'

function createApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/admin', analyticsRoutes)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/admin/analytics/overview', () => {
  it('считает конверсию и ARPU при ненулевом числе юзеров', async () => {
    pool.query
      .mockResolvedValueOnce([[{ total: 200 }]])
      .mockResolvedValueOnce([[{ premium: 30 }]])
    const res = await request(createApp()).get('/api/admin/analytics/overview')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ mau: '200', conversionRate: '15.0%', arpu: '0.00' })
  })

  it('ноль юзеров — конверсия 0% и ARPU 0 (ветка total falsy)', async () => {
    pool.query
      .mockResolvedValueOnce([[{ total: 0 }]])
      .mockResolvedValueOnce([[{ premium: 0 }]])
    const res = await request(createApp()).get('/api/admin/analytics/overview')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ mau: '0', conversionRate: '0%', arpu: '0' })
  })

  it('падение запроса — wrap отдаёт пустой массив, а не 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp()).get('/api/admin/analytics/overview')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })
})

describe('GET /api/admin/analytics/retention', () => {
  it('день сдвигается на +1 и rate округляется, отсутствующий rate → 0', async () => {
    pool.query.mockResolvedValueOnce([
      [{ day: 0, rate: 42.6 }, { day: 5, rate: null }],
    ])
    const res = await request(createApp()).get('/api/admin/analytics/retention')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([
      { day: 'Day 1', rate: 43 },
      { day: 'Day 6', rate: 0 },
    ])
  })

  it('удержание считается по analytics_events, а не по пустому activity_log', async () => {
    pool.query.mockResolvedValueOnce([[]])
    await request(createApp()).get('/api/admin/analytics/retention')
    const sql = pool.query.mock.calls[0][0]
    expect(sql).toContain('LEFT JOIN analytics_events')
    expect(sql).not.toContain('activity_log')
  })

  it('падение запроса — wrap отдаёт пустой массив', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp()).get('/api/admin/analytics/retention')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })
})

describe('GET /api/admin/analytics/revenue-mix', () => {
  it('раскладывает тарифы в проценты с цветом и именем', async () => {
    pool.query.mockResolvedValueOnce([[{ tier: 'gold', cnt: 3 }, { tier: 'plus', cnt: 1 }]])
    const res = await request(createApp()).get('/api/admin/analytics/revenue-mix')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([
      { name: 'Gold', value: 75, color: '#f59e0b' },
      { name: 'Plus', value: 25, color: '#3b82f6' },
    ])
  })

  it('неизвестный тариф сохраняет имя и получает серый цвет; пусто — делитель 1', async () => {
    pool.query.mockResolvedValueOnce([[{ tier: 'custom', cnt: 0 }]])
    const res = await request(createApp()).get('/api/admin/analytics/revenue-mix')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([{ name: 'custom', value: 0, color: '#94a3b8' }])
  })

  it('пустой список — пустой ответ', async () => {
    pool.query.mockResolvedValueOnce([[]])
    const res = await request(createApp()).get('/api/admin/analytics/revenue-mix')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })
})

describe('GET /api/admin/analytics/registrations', () => {
  it('отдаёт строки как есть', async () => {
    const rows = [{ day: '2026-10-01', users: 5 }]
    pool.query.mockResolvedValueOnce([rows])
    const res = await request(createApp()).get('/api/admin/analytics/registrations')
    expect(res.status).toBe(200)
    expect(res.body).toEqual(rows)
  })

  it('падение запроса — wrap отдаёт пустой массив', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp()).get('/api/admin/analytics/registrations')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })
})

describe('GET /api/admin/analytics/product-metrics', () => {
  function mockCounts({ registered, liked, matched, d7Cohort, d7Retained, messaged, avgSeconds }) {
    pool.query
      .mockResolvedValueOnce([[{ cnt: registered }]])
      .mockResolvedValueOnce([[{ cnt: liked }]])
      .mockResolvedValueOnce([[{ cnt: matched }]])
      .mockResolvedValueOnce([[{ cohort: d7Cohort, retained: d7Retained }]])
      .mockResolvedValueOnce([[{ cnt: messaged, avg_seconds: avgSeconds }]])
  }

  it('считает воронку из analytics_events и messages: проценты, часы и статусы', async () => {
    mockCounts({ registered: 200, liked: 90, matched: 50, d7Cohort: 100, d7Retained: 18, messaged: 60, avgSeconds: 36000 })
    const res = await request(createApp()).get('/api/admin/analytics/product-metrics')
    expect(res.status).toBe(200)
    expect(res.body.cohort).toEqual({ registered: 200, liked: 90, matched: 50, messaged: 60, d7Cohort: 100 })
    expect(res.body.metrics).toEqual([
      { key: 'like_rate', value: 45, unit: '%', target: 40, direction: 'min', status: 'ok' },
      { key: 'match_rate', value: 25, unit: '%', target: 20, direction: 'min', status: 'ok' },
      { key: 'd7_retention', value: 18, unit: '%', target: 15, direction: 'min', status: 'ok' },
      { key: 'first_message_hours', value: 10, unit: 'h', target: 24, direction: 'max', status: 'ok' },
    ])
    expect(pool.query.mock.calls[1][0]).toContain('analytics_events')
    expect(pool.query.mock.calls[1][0]).toContain("'super_like'")
    expect(pool.query.mock.calls[2][0]).toContain("JSON_EXTRACT(metadata, '$.matched')")
    expect(pool.query.mock.calls[3][0]).toContain('INTERVAL 7 DAY')
    expect(pool.query.mock.calls[4][0]).toContain('FROM messages')
  })

  it('пустая база — значения null и статус unknown, а не 0 и не деление на ноль', async () => {
    mockCounts({ registered: 0, liked: 0, matched: 0, d7Cohort: 0, d7Retained: 0, messaged: 0, avgSeconds: null })
    const res = await request(createApp()).get('/api/admin/analytics/product-metrics')
    expect(res.status).toBe(200)
    expect(res.body.cohort.registered).toBe(0)
    expect(res.body.metrics.map((m) => [m.value, m.status])).toEqual([
      [null, 'unknown'],
      [null, 'unknown'],
      [null, 'unknown'],
      [null, 'unknown'],
    ])
  })

  it('ровно на цели — ok, а перелёт по верхней границе — warn', async () => {
    mockCounts({ registered: 10, liked: 4, matched: 2, d7Cohort: 40, d7Retained: 6, messaged: 1, avgSeconds: 86400 })
    const onTarget = await request(createApp()).get('/api/admin/analytics/product-metrics')
    expect(onTarget.body.metrics.map((m) => m.status)).toEqual(['ok', 'ok', 'ok', 'ok'])

    pool.query.mockReset()
    mockCounts({ registered: 100, liked: 10, matched: 0, d7Cohort: 100, d7Retained: 0, messaged: 1, avgSeconds: 90000 })
    const offTarget = await request(createApp()).get('/api/admin/analytics/product-metrics')
    expect(offTarget.body.metrics.map((m) => m.status)).toEqual(['warn', 'warn', 'warn', 'warn'])
    expect(offTarget.body.metrics[3].value).toBe(25)
  })

  it('падение БД — статус 200 и пустая воронка, админка не падает', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp()).get('/api/admin/analytics/product-metrics')
    expect(res.status).toBe(200)
    expect(res.body.cohort.registered).toBe(0)
    expect(res.body.metrics.every((m) => m.status === 'unknown' && m.value === null)).toBe(true)
  })
})
