/**
 * Непокрытые ветки routes/profile.js (Stage 157): интерес без английского
 * названия, бинарные флаги приватности (0/1) и show_* в историю изменений,
 * `req.body || {}` без body-парсера, падение сброса кэша (инвалидации).
 */
vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
  delete process.env.REDIS_URL
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
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

const { invalidateMock } = vi.hoisted(() => ({ invalidateMock: vi.fn() }))
vi.mock('../cache.js', () => ({
  cacheRoutePerUser: () => (_req, _res, next) => next(),
  invalidate: invalidateMock,
}))

import pool from '../db.js'
import profileRoutes from '../routes/profile.js'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

function createApp({ json = true } = {}) {
  const app = express()
  if (json) app.use(express.json())
  app.use(profileRoutes)
  return app
}

function authToken(userId = 1) {
  return jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockReset()
  pool.query.mockResolvedValue([[], []])
  invalidateMock.mockReset()
  invalidateMock.mockResolvedValue(undefined)
})

describe('GET /api/profile/:id — интерес без английского названия', () => {
  it('строка интереса с name_en = null даёт пустой slug и сопоставляется каноном', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1, display_name: 'Test', email: 't@t.com' }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ id: 5, name_ru: 'Хобби', name_en: null }], []])
      .mockResolvedValueOnce([[{ interests: '[""]' }], []])
      .mockResolvedValueOnce([[{ id: 1, name_en: 'Sport' }, { id: 5, name_en: null }], []])

    const res = await request(createApp()).get('/api/profile/1').set('Authorization', `Bearer ${authToken(1)}`)

    expect(res.status).toBe(200)
    expect(res.body.interests).toEqual([{ id: 5, name_ru: 'Хобби', name_en: null }])
    const canon = pool.query.mock.calls.find((c) => String(c[0]).includes('FROM interests'))
    expect(canon).toBeDefined()
  })
})

describe('PUT /api/settings/privacy — бинарные флаги в истории изменений', () => {
  it('incognito/passport_mode = false пишутся битом 0, show_* = true — битом 1', async () => {
    pool.query
      .mockResolvedValueOnce([[{ incognito: 1, passport_mode: 1, show_online: 0, show_last_seen: 0 }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])

    const res = await request(createApp())
      .put('/api/settings/privacy')
      .set('Authorization', `Bearer ${authToken(1)}`)
      .send({ incognito: false, passport_mode: false, show_online: true, show_last_seen: true })

    expect(res.status).toBe(200)

    const update = pool.query.mock.calls.find((c) => String(c[0]).includes('UPDATE user_profiles'))
    expect(update[1]).toEqual([false, false, undefined, undefined, undefined, true, true, 1])

    const audit = pool.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO audit_log'))
    expect(audit[1][4]).toBe('{"incognito":0,"passport_mode":0,"show_online":1,"show_last_seen":1}')
  })
})

describe('сброс кэша при обновлении приватности', () => {
  it('упавшая инвалидация не роняет ответ: кэш профиля и кэш мэтчей сбрасываются', async () => {
    invalidateMock.mockRejectedValue(new Error('redis down'))
    pool.query
      .mockResolvedValueOnce([[{ incognito: 0, passport_mode: 0, show_online: 0, show_last_seen: 0 }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])

    const res = await request(createApp())
      .put('/api/settings/privacy')
      .set('Authorization', `Bearer ${authToken(1)}`)
      .send({ show_online: true })

    expect(res.status).toBe(200)
    await flush()
    expect(invalidateMock).toHaveBeenCalledWith('user:*:/api/profile/1*')
    expect(invalidateMock).toHaveBeenCalledWith('user:*:/api/matches*')
  })
})

describe('роуты без body-парсера: req.body || {}', () => {
  it('создание псевдонима без тела — 400 по длине, а не падение на деструктуризации', async () => {
    const res = await request(createApp({ json: false }))
      .post('/api/profile/aliases')
      .set('Authorization', `Bearer ${authToken(1)}`)
      .send({ alias: 'Маша' })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/2-50/)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('заявка на верификацию без тела — 400 по photo_url, а не падение', async () => {
    const res = await request(createApp({ json: false }))
      .post('/api/profile/verification')
      .set('Authorization', `Bearer ${authToken(1)}`)
      .send({ photo_url: '/v.jpg' })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/photo_url/)
    expect(pool.query).not.toHaveBeenCalled()
  })
})

describe('сброс кэша при сохранении профиля', () => {
  it('упавшая инвалидация не мешает сохранению анкеты', async () => {
    invalidateMock.mockRejectedValue(new Error('redis down'))
    pool.query
      .mockResolvedValueOnce([[{ id: 1, display_name: 'Old', age: 30 }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ id: 1, display_name: 'New', age: 30 }], []])

    const res = await request(createApp())
      .put('/api/profile/1')
      .set('Authorization', `Bearer ${authToken(1)}`)
      .send({ display_name: 'New' })

    expect(res.status).toBe(200)
    expect(res.body.display_name).toBe('New')
    await flush()
    expect(invalidateMock).toHaveBeenCalledWith('user:*:/api/profile/1*')
  })
})
