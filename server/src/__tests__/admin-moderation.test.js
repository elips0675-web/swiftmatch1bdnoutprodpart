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

import pool from '../db.js'
import adminModeration from '../routes/admin-moderation.js'

const JWT_SECRET = 'change-me-in-production'

function createApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/admin', (req, res, next) => {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) return next()
    try {
      const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET)
      req.admin = decoded
      next()
    } catch { next() }
  })
  app.use('/api/admin', adminModeration)
  return app
}

function adminToken() {
  return jwt.sign({ userId: 1, role: 'admin' }, JWT_SECRET, { expiresIn: '1h' })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/admin/photos', () => {
  const app = createApp()

  it('returns all photos', async () => {
    pool.query.mockResolvedValueOnce([[{
      id: 1, url: '/uploads/1.jpg', user_id: 1, created_at: '2024-01-01',
      moderation_status: 'approved', display_name: 'Alice', avatar_url: null,
    }], []])

    const res = await request(app)
      .get('/api/admin/photos')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('handles database error', async () => {
    pool.query.mockRejectedValue(new Error('DB error'))
    const res = await request(app)
      .get('/api/admin/photos')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(500)
  })
})

describe('GET /api/admin/photos/pending', () => {
  const app = createApp()

  it('returns pending photos', async () => {
    pool.query.mockResolvedValueOnce([[{
      id: 1, url: '/uploads/1.jpg', user_id: 1, created_at: '2024-01-01',
      moderation_status: 'pending', display_name: 'Alice', avatar_url: null,
    }], []])

    const res = await request(app)
      .get('/api/admin/photos/pending')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(200)
  })

  it('returns empty array when none pending', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(app)
      .get('/api/admin/photos/pending')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })
})

describe('POST /api/admin/photos/:id/approve', () => {
  const app = createApp()

  it('approves photo', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }, []])
    const res = await request(app)
      .post('/api/admin/photos/1/approve')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(200)
  })

  it('отвечает 404, если строка не обновлена (фото не pending/нет)', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 0 }, []])
    const res = await request(app)
      .post('/api/admin/photos/1/approve')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(404)
  })

  it('handles database error', async () => {
    pool.query.mockRejectedValue(new Error('DB error'))
    const res = await request(app)
      .post('/api/admin/photos/1/approve')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(500)
  })
})

describe('POST /api/admin/photos/:id/reject', () => {
  const app = createApp()

  it('rejects photo with reason', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }, []])
    const res = await request(app)
      .post('/api/admin/photos/1/reject')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ reason: 'Inappropriate content' })
    expect(res.status).toBe(200)
  })

  it('rejects photo without reason', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }, []])
    const res = await request(app)
      .post('/api/admin/photos/1/reject')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(200)
  })

  it('отвечает 404, если строку не обновили', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 0 }, []])
    const res = await request(app)
      .post('/api/admin/photos/1/reject')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ reason: 'x' })
    expect(res.status).toBe(404)
  })

  it('handles database error', async () => {
    pool.query.mockRejectedValue(new Error('DB error'))
    const res = await request(app)
      .post('/api/admin/photos/1/reject')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(500)
  })
})
