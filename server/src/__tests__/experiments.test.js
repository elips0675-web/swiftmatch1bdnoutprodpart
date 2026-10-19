vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'

vi.mock('../db.js', () => ({
  default: { query: vi.fn(), execute: vi.fn(), getConnection: vi.fn() },
}))

vi.mock('../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  rootLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../middleware/adminAuth.js', () => ({
  adminAuth: (req, res, next) => { req.admin = { id: 1, role: 'admin' }; next() },
}))

import pool from '../db.js'
import { rootLogger } from '../logger.js'
import experimentsRoutes from '../routes/experiments.js'

const JWT_SECRET = process.env.JWT_SECRET

function createApp() {
  const app = express()
  app.use(express.json())
  app.use(experimentsRoutes)
  return app
}

function token(userId = 7) {
  return jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })
}

function expectedVariant(key, userId) {
  const hash = crypto.createHash('md5').update(`${key}:${userId}`).digest('hex')
  return parseInt(hash.slice(0, 8), 16) % 2 === 0 ? 'variant_b' : 'variant_a'
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/experiments/:key — назначение варианта', () => {
  it('неизвестный эксперимент отдаёт control без включения', async () => {
    pool.query.mockResolvedValueOnce([[]])
    const res = await request(createApp())
      .get('/api/experiments/pricing')
      .set('Authorization', `Bearer ${token()}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ key: 'pricing', variant: 'control', enabled: false })
    expect(pool.query).toHaveBeenCalledTimes(1)
  })

  it('выключенный эксперимент (enabled=0) тоже отдаёт control', async () => {
    pool.query.mockResolvedValueOnce([[{ enabled: 0 }]])
    const res = await request(createApp())
      .get('/api/experiments/pricing')
      .set('Authorization', `Bearer ${token()}`)
    expect(res.body).toEqual({ key: 'pricing', variant: 'control', enabled: false })
  })

  it('сохранённое назначение возвращается как есть, без вставки', async () => {
    pool.query
      .mockResolvedValueOnce([[{ enabled: 1 }]])
      .mockResolvedValueOnce([[{ variant: 'variant_a' }]])
    const res = await request(createApp())
      .get('/api/experiments/pricing')
      .set('Authorization', `Bearer ${token(7)}`)
    expect(res.body).toEqual({ key: 'pricing', variant: 'variant_a', enabled: true })
    expect(pool.query).toHaveBeenCalledTimes(2)
  })

  it('новому пользователю назначает детерминированный вариант и пишет его INSERT IGNORE', async () => {
    pool.query
      .mockResolvedValueOnce([[{ enabled: 1 }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
    const res = await request(createApp())
      .get('/api/experiments/pricing')
      .set('Authorization', `Bearer ${token(7)}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ key: 'pricing', variant: expectedVariant('pricing', 7), enabled: true })
    const [sql, params] = pool.query.mock.calls[2]
    expect(sql).toContain('INSERT IGNORE INTO experiment_assignments')
    expect(params).toEqual(['pricing', 7, expectedVariant('pricing', 7)])
  })

  it('два одинаковых запроса дают один и тот же вариант (50/50 по хэшу стабилен)', async () => {
    const variants = []
    for (let i = 0; i < 2; i += 1) {
      pool.query
        .mockResolvedValueOnce([[{ enabled: 1 }]])
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
      const res = await request(createApp())
        .get('/api/experiments/onboarding')
        .set('Authorization', `Bearer ${token(42)}`)
      variants.push(res.body.variant)
    }
    expect(variants[0]).toBe(variants[1])
  })

  it('ключ обрезается до 64 символов', async () => {
    pool.query.mockResolvedValueOnce([[]])
    await request(createApp())
      .get(`/api/experiments/${'k'.repeat(100)}`)
      .set('Authorization', `Bearer ${token()}`)
    expect(pool.query.mock.calls[0][1][0]).toHaveLength(64)
  })

  it('ошибка БД отдаёт 500 SERVER_ERROR и пишет лог', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp())
      .get('/api/experiments/pricing')
      .set('Authorization', `Bearer ${token()}`)
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'SERVER_ERROR' })
    expect(rootLogger.error).toHaveBeenCalledWith('Experiment assign error:', expect.any(Error))
  })

  it('без токена — 401 и никаких запросов в БД', async () => {
    const res = await request(createApp()).get('/api/experiments/pricing')
    expect(res.status).toBe(401)
    expect(pool.query).not.toHaveBeenCalled()
  })
})

describe('POST /api/analytics/track', () => {
  it('без event_type — 400 и БД не трогается', async () => {
    const res = await request(createApp())
      .post('/api/analytics/track')
      .set('Authorization', `Bearer ${token()}`)
      .send({ metadata: { a: 1 } })
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'MISSING_EVENT_TYPE' })
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('нестроковый event_type тоже отвергается', async () => {
    const res = await request(createApp())
      .post('/api/analytics/track')
      .set('Authorization', `Bearer ${token()}`)
      .send({ event_type: 42 })
    expect(res.status).toBe(400)
  })

  it('пишет событие с userId и метаданными', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }])
    const res = await request(createApp())
      .post('/api/analytics/track')
      .set('Authorization', `Bearer ${token(7)}`)
      .send({ event_type: 'first_like', metadata: { source: 'feed' } })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    const [sql, params] = pool.query.mock.calls[0]
    expect(sql).toContain('INSERT INTO analytics_events')
    expect(params).toEqual(['first_like', 7, JSON.stringify({ source: 'feed' })])
  })

  it('нестроковые метаданные заменяются на {}, длинный тип обрезается до 100', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }])
    await request(createApp())
      .post('/api/analytics/track')
      .set('Authorization', `Bearer ${token(7)}`)
      .send({ event_type: 'x'.repeat(150), metadata: 'not-an-object' })
    const params = pool.query.mock.calls[0][1]
    expect(params[0]).toHaveLength(100)
    expect(params[2]).toBe('{}')
  })

  it('падение аналитики не ломает ответ: 200 ok, ошибка в логе', async () => {
    pool.query.mockRejectedValueOnce(new Error('insert failed'))
    const res = await request(createApp())
      .post('/api/analytics/track')
      .set('Authorization', `Bearer ${token()}`)
      .send({ event_type: 'first_like' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(rootLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Analytics track "first_like" failed'), 'insert failed')
  })
})

describe('GET/POST/PUT/DELETE /api/admin/experiments', () => {
  it('список экспериментов со счётчиками отдаётся как есть', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 1, experiment_key: 'pricing', variant_a_count: 3, variant_b_count: 4 }]])
    const res = await request(createApp()).get('/api/admin/experiments')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([{ id: 1, experiment_key: 'pricing', variant_a_count: 3, variant_b_count: 4 }])
    expect(pool.query.mock.calls[0][0]).toContain('FROM experiments e')
  })

  it('создание без name/key — 400 MISSING_FIELDS', async () => {
    const res = await request(createApp()).post('/api/admin/experiments').send({ name: 'Pricing' })
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'MISSING_FIELDS' })
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('создание обрезает поля до размеров колонок и отдаёт insertId', async () => {
    pool.query.mockResolvedValueOnce([{ insertId: 9 }])
    const res = await request(createApp())
      .post('/api/admin/experiments')
      .send({ name: 'n'.repeat(150), experiment_key: 'k'.repeat(100), description: 'd'.repeat(400) })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: 9 })
    const params = pool.query.mock.calls[0][1]
    expect(params[0]).toHaveLength(100)
    expect(params[1]).toHaveLength(64)
    expect(params[2]).toHaveLength(300)
  })

  it('создание без описания пишет NULL', async () => {
    pool.query.mockResolvedValueOnce([{ insertId: 10 }])
    await request(createApp()).post('/api/admin/experiments').send({ name: 'Pricing', experiment_key: 'pricing' })
    expect(pool.query.mock.calls[0][1][2]).toBeNull()
  })

  it('переключатель enabled переводится в 1/0', async () => {
    pool.query.mockResolvedValueOnce([{}])
    await request(createApp()).put('/api/admin/experiments/3').send({ enabled: true })
    expect(pool.query.mock.calls[0][1]).toEqual([1, '3'])

    vi.clearAllMocks()
    pool.query.mockResolvedValueOnce([{}])
    await request(createApp()).put('/api/admin/experiments/3').send({})
    expect(pool.query.mock.calls[0][1]).toEqual([0, '3'])
  })

  it('удаление существующего эксперимента чистит назначения и саму строку', async () => {
    pool.query
      .mockResolvedValueOnce([[{ experiment_key: 'pricing' }]])
      .mockResolvedValueOnce([{ affectedRows: 4 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
    const res = await request(createApp()).delete('/api/admin/experiments/5')
    expect(res.body).toEqual({ ok: true })
    expect(pool.query).toHaveBeenCalledTimes(3)
    expect(pool.query.mock.calls[1][1]).toEqual(['pricing'])
    expect(pool.query.mock.calls[1][0]).toContain('DELETE FROM experiment_assignments')
    expect(pool.query.mock.calls[2][1]).toEqual(['5'])
  })

  it('удаление несуществующего — ok без DELETE', async () => {
    pool.query.mockResolvedValueOnce([[]])
    const res = await request(createApp()).delete('/api/admin/experiments/404')
    expect(res.body).toEqual({ ok: true })
    expect(pool.query).toHaveBeenCalledTimes(1)
  })

  it('ошибки админ-роутов отдают 500 SERVER_ERROR', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const list = await request(createApp()).get('/api/admin/experiments')
    expect(list.status).toBe(500)

    vi.clearAllMocks()
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const create = await request(createApp()).post('/api/admin/experiments').send({ name: 'A', experiment_key: 'a' })
    expect(create.status).toBe(500)

    vi.clearAllMocks()
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const toggle = await request(createApp()).put('/api/admin/experiments/1').send({ enabled: true })
    expect(toggle.status).toBe(500)

    vi.clearAllMocks()
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const del = await request(createApp()).delete('/api/admin/experiments/1')
    expect(del.status).toBe(500)
  })
})
