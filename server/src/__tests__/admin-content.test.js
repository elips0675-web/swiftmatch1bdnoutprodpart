import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}))

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import pool from '../db.js'
import logger from '../logger.js'
import adminContent from '../routes/admin/content.js'

function createApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/admin', adminContent)
  return app
}

const app = createApp()

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/admin/content — разбор JSON-колонок', () => {
  it('колонки уже массивы (MySQL JSON-тип) → отдаются как есть', async () => {
    pool.query.mockResolvedValueOnce([[{
      id: 1,
      interests: ['interest.sport'],
      dating_goals: ['goal.serious_relationship'],
      education: ['education.higher'],
      banned_words: ['badword'],
      cities: ['Moscow'],
    }], []])

    const res = await request(app).get('/api/admin/content')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      interests: ['interest.sport'],
      dating_goals: ['goal.serious_relationship'],
      education: ['education.higher'],
      banned_words: ['badword'],
      cities: ['Moscow'],
    })
  })

  it('валидные JSON-строки парсятся в массивы', async () => {
    pool.query.mockResolvedValueOnce([[{
      id: 1,
      interests: '["interest.sport","interest.music"]',
      dating_goals: '["goal.serious_relationship"]',
      education: '["education.higher"]',
      banned_words: '["badword"]',
      cities: '["Kazan"]',
    }], []])

    const res = await request(app).get('/api/admin/content')
    expect(res.status).toBe(200)
    expect(res.body.interests).toEqual(['interest.sport', 'interest.music'])
    expect(res.body.cities).toEqual(['Kazan'])
  })

  it('невалидный JSON → fallback на пустой массив, а не 500', async () => {
    pool.query.mockResolvedValueOnce([[{
      id: 1,
      interests: '{broken',
      dating_goals: null,
      education: undefined,
      banned_words: 'not-json',
      cities: '{broken',
    }], []])
      .mockResolvedValueOnce([[], []])

    const res = await request(app).get('/api/admin/content')
    expect(res.status).toBe(200)
    expect(res.body.interests).toEqual([])
    expect(res.body.dating_goals).toEqual([])
    expect(res.body.education).toEqual([])
    expect(res.body.banned_words).toEqual([])
    expect(res.body.cities).toEqual([])
  })

  it('строка с валидным JSON, но не массивом → p отдаёт значение, pa → null', async () => {
    pool.query.mockResolvedValueOnce([[{
      id: 1,
      interests: '{"a":1}',
      dating_goals: '42',
      education: '"str"',
      banned_words: 'true',
      cities: '{"a":1}',
    }], []])
      .mockResolvedValueOnce([[{ city: 'Moscow' }], []])

    const res = await request(app).get('/api/admin/content')
    expect(res.status).toBe(200)
    expect(res.body.interests).toEqual({ a: 1 })
    expect(res.body.dating_goals).toBe(42)
    expect(res.body.education).toBe('str')
    expect(res.body.banned_words).toBe(true)
    expect(res.body.cities).toEqual(['Moscow'])
  })

  it('cities === null в конфиге → города берутся из user_profiles', async () => {
    pool.query
      .mockResolvedValueOnce([[{
        id: 1, interests: '[]', dating_goals: '[]', education: '[]', banned_words: '[]', cities: null,
      }], []])
      .mockResolvedValueOnce([[{ city: 'Moscow' }, { city: 'SPb' }], []])

    const res = await request(app).get('/api/admin/content')
    expect(res.status).toBe(200)
    expect(res.body.cities).toEqual(['Moscow', 'SPb'])
    const [sql] = pool.query.mock.calls[1]
    expect(String(sql)).toContain('SELECT DISTINCT city FROM user_profiles')
  })

  it('нет строки конфига вообще → пустые списки без второго запроса', async () => {
    pool.query.mockResolvedValueOnce([[], []])

    const res = await request(app).get('/api/admin/content')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ interests: [], dating_goals: [], education: [], banned_words: [], cities: [] })
    expect(pool.query).toHaveBeenCalledTimes(1)
  })

  it('падение БД → 500 и лог ошибки', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await request(app).get('/api/admin/content')
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to fetch content')
    expect(logger.error).toHaveBeenCalled()
  })
})

describe('PUT /api/admin/content/:section — конфиг отсутствует', () => {
  it('конфига нет → создаётся строка со всеми секциями и cities = null', async () => {
    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }])

    const res = await request(app)
      .put('/api/admin/content/interests')
      .send({ items: ['interest.sport'] })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ message: 'interests updated', items: ['interest.sport'] })

    const [sql, params] = pool.query.mock.calls[1]
    expect(String(sql)).toContain('INSERT INTO content_config')
    expect(params).toEqual(['["interest.sport"]', '[]', '[]', '[]', null, '["interest.sport"]'])
  })

  it('cities не массив → в колонку идёт null', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1, interests: '[]', dating_goals: '[]', education: '[]', banned_words: '[]', cities: null }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }])

    const res = await request(app).put('/api/admin/content/interests').send({ items: ['x'] })
    expect(res.status).toBe(200)
    expect(pool.query.mock.calls[1][1][4]).toBeNull()
  })

  it('items отсутствует → сохраняется пустой массив', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1, interests: '[]', dating_goals: '[]', education: '[]', banned_words: '[]', cities: ['Moscow'] }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }])

    const res = await request(app).put('/api/admin/content/interests').send({})
    expect(res.status).toBe(200)
    expect(res.body.items).toEqual([])
    expect(pool.query.mock.calls[1][1][4]).toBe('["Moscow"]')
  })

  it('недопустимая секция → 400 без обращения к БД', async () => {
    const res = await request(app).put('/api/admin/content/hackers').send({ items: [] })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Invalid section')
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('падение записи → 500 и лог', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1, interests: '[]', dating_goals: '[]', education: '[]', banned_words: '[]', cities: ['Moscow'] }], []])
      .mockRejectedValueOnce(new Error('write down'))

    const res = await request(app).put('/api/admin/content/cities').send({ items: ['Kazan'] })
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to update content')
    expect(logger.error).toHaveBeenCalled()
  })
})
