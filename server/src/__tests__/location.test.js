vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'

vi.mock('../db.js', () => ({
  default: { query: vi.fn(), execute: vi.fn() },
}))

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import pool from '../db.js'
import locationRoutes from '../routes/location.js'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

function createApp() {
  const app = express()
  app.use(express.json())
  app.use(locationRoutes)
  return app
}

function authToken(userId = 1) {
  return jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })
}

const auth = (r) => r.set('Authorization', `Bearer ${authToken()}`)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PUT /api/location', () => {
  it('сохраняет координаты с SRID POINT и последним временем', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }])
    const res = await auth(request(createApp()).put('/api/location')).send({ lat: 55.75, lng: 37.61 })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ message: 'Location updated' })
    const [sql, params] = pool.query.mock.calls[0]
    expect(sql).toContain('ST_SRID(POINT(?, ?), 4326)')
    expect(params).toEqual([55.75, 37.61, 37.61, 55.75, 1])
  })

  it('строки координат приводятся к числам через parseFloat', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }])
    const res = await auth(request(createApp()).put('/api/location')).send({ lat: '10.5', lng: '20.25' })
    expect(res.status).toBe(200)
    expect(pool.query.mock.calls[0][1]).toEqual([10.5, 20.25, 20.25, 10.5, 1])
  })

  it('без lat или lng — 400 без обращения к БД', async () => {
    const res = await auth(request(createApp()).put('/api/location')).send({ lat: 10 })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('lat and lng are required')
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('нечисловые координаты — 400', async () => {
    const res = await auth(request(createApp()).put('/api/location')).send({ lat: 'abc', lng: 'def' })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Invalid coordinates')
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('широта вне диапазона — 400', async () => {
    const res = await auth(request(createApp()).put('/api/location')).send({ lat: 91, lng: 0 })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Invalid coordinates')
  })

  it('долгота вне диапазона — 400', async () => {
    const res = await auth(request(createApp()).put('/api/location')).send({ lat: 0, lng: 181 })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Invalid coordinates')
  })

  it('падение БД даёт 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await auth(request(createApp()).put('/api/location')).send({ lat: 1, lng: 2 })
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to update location')
  })

  it('без токена — 401 без обращения к БД', async () => {
    const res = await request(createApp()).put('/api/location').send({ lat: 1, lng: 2 })
    expect(res.status).toBe(401)
    expect(pool.query).not.toHaveBeenCalled()
  })
})

describe('GET /api/location', () => {
  it('возвращает координаты и время обновления', async () => {
    const row = { lat: 55.75, lng: 37.61, last_location_update: '2026-01-01' }
    pool.query.mockResolvedValueOnce([[row]])
    const res = await auth(request(createApp()).get('/api/location'))
    expect(res.status).toBe(200)
    expect(res.body).toEqual(row)
    expect(pool.query.mock.calls[0][1]).toEqual([1])
  })

  it('нет профиля — 404', async () => {
    pool.query.mockResolvedValueOnce([[]])
    const res = await auth(request(createApp()).get('/api/location'))
    expect(res.status).toBe(404)
    expect(res.body.message).toBe('Profile not found')
  })

  it('падение БД даёт 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await auth(request(createApp()).get('/api/location'))
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to get location')
  })
})
