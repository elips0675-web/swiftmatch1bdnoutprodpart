import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../db.js', () => ({
  default: { query: vi.fn(), execute: vi.fn() },
}))

vi.mock('../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  rootLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import pool from '../db.js'
import monetizationRoutes from '../routes/admin/monetization.js'

function createApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/admin', monetizationRoutes)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/admin/monetization/pricing', () => {
  it('собирает цены трёх тарифов из строк по длительности', async () => {
    pool.query.mockResolvedValueOnce([[
      { tier: 'plus', p1: 299, p6: 1499, p12: 2599 },
      { tier: 'gold', p1: 599, p6: 2999, p12: 4999 },
    ]])
    const res = await request(createApp()).get('/api/admin/monetization/pricing')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(3)
    const plus = res.body.find((t) => t.key === 'plus')
    expect(plus).toMatchObject({ tier: 'Plus', color: '#3b82f6', prices: { 1: 299, 6: 1499, 12: 2599 } })
    const gold = res.body.find((t) => t.key === 'gold')
    expect(gold.prices).toEqual({ 1: 599, 6: 2999, 12: 4999 })
  })

  it('тариф без строк в БД получает нулевые цены', async () => {
    pool.query.mockResolvedValueOnce([[]])
    const res = await request(createApp()).get('/api/admin/monetization/pricing')
    expect(res.status).toBe(200)
    const platinum = res.body.find((t) => t.key === 'platinum')
    expect(platinum.prices).toEqual({ 1: 0, 6: 0, 12: 0 })
  })

  it('неизвестный тариф из БД не добавляет новых пунктов меню', async () => {
    pool.query.mockResolvedValueOnce([[
      { tier: 'ghost', p1: 1, p6: 2, p12: 3 },
    ]])
    const res = await request(createApp()).get('/api/admin/monetization/pricing')
    expect(res.body).toHaveLength(3)
    expect(res.body.map((t) => t.key)).toEqual(['plus', 'gold', 'platinum'])
  })

  it('падение БД даёт 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp()).get('/api/admin/monetization/pricing')
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to fetch pricing')
  })
})

describe('GET /api/admin/monetization/revenue', () => {
  it('отдаёт строки выручки как есть', async () => {
    const rows = [{ month: 'Jan', subscriptions: 1000, ads: 0, boosts: 0 }]
    pool.query.mockResolvedValueOnce([rows])
    const res = await request(createApp()).get('/api/admin/monetization/revenue')
    expect(res.status).toBe(200)
    expect(res.body).toEqual(rows)
  })

  it('падение БД даёт 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp()).get('/api/admin/monetization/revenue')
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to fetch revenue')
  })
})

describe('PUT /api/admin/monetization/pricing', () => {
  it('сохраняет массив tiers в конфиг как JSON', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }])
    const tiers = [{ key: 'plus', prices: { 1: 299 } }]
    const res = await request(createApp()).put('/api/admin/monetization/pricing').send({ tiers })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ message: 'Pricing saved' })
    const [sql, params] = pool.query.mock.calls[0]
    expect(sql).toContain('INSERT INTO config')
    expect(params[0]).toBe(JSON.stringify(tiers))
  })

  it('не-массив tiers отбит 400 без записи в БД', async () => {
    const res = await request(createApp()).put('/api/admin/monetization/pricing').send({ tiers: 'nope' })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('tiers array required')
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('отсутствие tiers отбито 400', async () => {
    const res = await request(createApp()).put('/api/admin/monetization/pricing').send({})
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('падение БД даёт 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp()).put('/api/admin/monetization/pricing').send({ tiers: [] })
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to save pricing')
  })
})

describe('GET /api/admin/monetization/ads', () => {
  it('строки конфига нет — отдаёт дефолтную рекламу', async () => {
    pool.query.mockResolvedValueOnce([[]])
    const res = await request(createApp()).get('/api/admin/monetization/ads')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      google: true,
      yandex: false,
      googleId: 'ca-app-pub-3940256099942544/5224354917',
      yandexId: 'R-M-DEMO-rewarded',
    })
  })

  it('конфиг строкой парсится в JSON', async () => {
    pool.query.mockResolvedValueOnce([[{ config_value: JSON.stringify({ google: false, yandex: true }) }]])
    const res = await request(createApp()).get('/api/admin/monetization/ads')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ google: false, yandex: true })
  })

  it('конфиг уже объектом отдаётся без парсинга', async () => {
    pool.query.mockResolvedValueOnce([[{ config_value: { google: true, yandex: true } }]])
    const res = await request(createApp()).get('/api/admin/monetization/ads')
    expect(res.body).toEqual({ google: true, yandex: true })
  })

  it('падение БД даёт 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp()).get('/api/admin/monetization/ads')
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to fetch ad config')
  })
})

describe('PUT /api/admin/monetization/ads', () => {
  it('сохраняет четыре поля конфига рекламы', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }])
    const res = await request(createApp())
      .put('/api/admin/monetization/ads')
      .send({ google: true, yandex: false, googleId: 'gid', yandexId: 'yid' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ message: 'Ad config saved' })
    const params = pool.query.mock.calls[0][1]
    expect(params[0]).toBe(JSON.stringify({ google: true, yandex: false, googleId: 'gid', yandexId: 'yid' }))
  })

  it('падение БД даёт 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp()).put('/api/admin/monetization/ads').send({ google: true })
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to save ad config')
  })
})

describe('GET /api/admin/monetization/funnel', () => {
  it('строит воронку из четырёх COUNT-запросов', async () => {
    pool.query
      .mockResolvedValueOnce([[{ registrations: 100 }]])
      .mockResolvedValueOnce([[{ profiles: 80 }]])
      .mockResolvedValueOnce([[{ firstLike: 60 }]])
      .mockResolvedValueOnce([[{ premium: 10 }]])
    const res = await request(createApp()).get('/api/admin/monetization/funnel')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([
      { stage: 'Посетители', count: 0 },
      { stage: 'Регистрации', count: 100 },
      { stage: 'Заполнили профиль', count: 80 },
      { stage: 'Первый лайк', count: 60 },
      { stage: 'Premium', count: 10 },
    ])
    expect(pool.query).toHaveBeenCalledTimes(4)
  })

  it('падение любого запроса даёт 500', async () => {
    pool.query
      .mockResolvedValueOnce([[{ registrations: 1 }]])
      .mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp()).get('/api/admin/monetization/funnel')
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to fetch funnel')
  })
})
