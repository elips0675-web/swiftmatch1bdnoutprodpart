/**
 * Непокрытые ветки routes/partner-dashboard.js (Stage 153):
 * гарды `req.body || {}` без body-парсера, фолбэк пустого title,
 * падение инвалидации кэша офферов, сессия подписки без metadata.
 */
vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'

vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
    execute: vi.fn(),
    getConnection: vi.fn(),
  },
}))

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

const { invalidateMock } = vi.hoisted(() => ({ invalidateMock: vi.fn(async () => {}) }))
vi.mock('../cache.js', () => ({
  getCached: vi.fn(async () => null),
  setCached: vi.fn(async () => {}),
  invalidate: invalidateMock,
}))

import pool from '../db.js'
import partnerDashboardRoutes, { applyPartnerSubscription } from '../routes/partner-dashboard.js'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'
const PARTNER = { id: 3, user_id: 7, name: 'Partner', type: 'deeplink', status: 'active', commission_rate: 10 }

function createApp({ json = true } = {}) {
  const app = express()
  if (json) app.use(express.json())
  app.use(partnerDashboardRoutes)
  return app
}

function authToken(userId = 7) {
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

describe('роуты партнёрского дашборда без body-парсера', () => {
  it('регистрация без тела — 400 по имени партнёра', async () => {
    const res = await request(createApp({ json: false }))
      .post('/api/partner/register')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ name: 'My Shop' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/min 2 chars/)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('создание оффера без тела — 400 по категории', async () => {
    pool.query.mockResolvedValueOnce([[PARTNER], []])
    const res = await request(createApp({ json: false }))
      .post('/api/partner/offers')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ category: 'restaurant', title: 'Ужин', deeplink: 'https://x' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/category must be one of/)
  })

  it('правка оффера без тела — 400 No fields to update', async () => {
    pool.query
      .mockResolvedValueOnce([[PARTNER], []])
      .mockResolvedValueOnce([[{ id: 5 }], []])
    const res = await request(createApp({ json: false }))
      .put('/api/partner/offers/5')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ title: 'Новое' })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('No fields to update')
  })

  it('подписка без тела — 400 по тарифу', async () => {
    pool.query.mockResolvedValueOnce([[PARTNER], []])
    const res = await request(createApp({ json: false }))
      .post('/api/partner/subscribe')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ tier: 'pro' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/tier must be one of/)
  })
})

describe('правка оффера — фолбэк пустого title', () => {
  it('title = null пишется пустой строкой, а не NULL', async () => {
    pool.query
      .mockResolvedValueOnce([[PARTNER], []])
      .mockResolvedValueOnce([[{ id: 5 }], []])
      .mockResolvedValueOnce([[], []])
    const res = await request(createApp())
      .put('/api/partner/offers/5')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ title: null })
    expect(res.status).toBe(200)
    expect(res.body.message).toBe('Offer updated')
    const params = pool.query.mock.calls[2][1]
    expect(params[0]).toBe('')
    expect(params[1]).toBe('5')
  })
})

describe('падение инвалидации кэша офферов не роняет ответ', () => {
  it('создание оффера — 201 даже при отказе кэша', async () => {
    invalidateMock.mockRejectedValue(new Error('redis down'))
    pool.query
      .mockResolvedValueOnce([[PARTNER], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ count: 0 }], []])
      .mockResolvedValueOnce([{ insertId: 9 }, []])
      .mockResolvedValueOnce([[], []])
    const res = await request(createApp())
      .post('/api/partner/offers')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ category: 'restaurant', title: 'Ужин', deeplink: 'https://x' })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe(9)
    expect(invalidateMock).toHaveBeenCalledWith('partner:offers:*')
    await flush()
  })

  it('правка оффера — 200 даже при отказе кэша', async () => {
    invalidateMock.mockRejectedValue(new Error('redis down'))
    pool.query
      .mockResolvedValueOnce([[PARTNER], []])
      .mockResolvedValueOnce([[{ id: 5 }], []])
      .mockResolvedValueOnce([[], []])
    const res = await request(createApp())
      .put('/api/partner/offers/5')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ title: 'Новое' })
    expect(res.status).toBe(200)
    expect(res.body.message).toBe('Offer updated')
    expect(invalidateMock).toHaveBeenCalledWith('partner:offers:*')
    await flush()
  })

  it('удаление оффера — 200 даже при отказе кэша', async () => {
    invalidateMock.mockRejectedValue(new Error('redis down'))
    pool.query
      .mockResolvedValueOnce([[PARTNER], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
    const res = await request(createApp())
      .delete('/api/partner/offers/5')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.message).toBe('Offer deleted')
    expect(invalidateMock).toHaveBeenCalledWith('partner:offers:*')
    await flush()
  })
})

describe('applyPartnerSubscription без metadata', () => {
  it('partner_id не определён — запросы уходят с NaN, подписка не выдаётся', async () => {
    const conn = { query: vi.fn().mockResolvedValue([[], []]) }
    await applyPartnerSubscription({ data: { object: { id: 'cs_test_1' } } }, conn)
    expect(conn.query).toHaveBeenCalledTimes(3)
    expect(conn.query.mock.calls[0][1][0]).toBeNaN()
    expect(conn.query.mock.calls[1][1][0]).toBeNaN()
    expect(conn.query.mock.calls[2][1][0]).toBeNaN()
  })
})
