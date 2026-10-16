vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
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

import pool from '../db.js'
import notificationsRoutes from '../routes/notifications.js'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'
const app = express()
app.use(express.json())
app.use(notificationsRoutes)

function authToken(userId = 1) {
  return jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/notifications', () => {
  it('requires auth', async () => {
    const res = await request(app).get('/api/notifications')
    expect(res.status).toBe(401)
  })

  it('returns enriched items with parsed payload and unread count', async () => {
    pool.query
      .mockResolvedValueOnce([
        [{
          id: 5,
          type: 'hangout_response',
          payload: '{"from_user_id":3,"hangout_id":7}',
          is_read: 0,
          created_at: new Date('2026-08-23T12:00:00Z'),
          actor_name: 'Anna',
          hangout_title: 'Dune 2',
        }],
        [],
      ])
      .mockResolvedValueOnce([[{ unread: 2 }], []])

    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${authToken(9)}`)

    expect(res.status).toBe(200)
    expect(res.body.unread).toBe(2)
    expect(res.body.items).toHaveLength(1)
    expect(res.body.items[0].actor_name).toBe('Anna')
    expect(res.body.items[0].hangout_title).toBe('Dune 2')
  })

  it('returns empty list on DB error instead of crashing', async () => {
    pool.query.mockRejectedValue(new Error('db down'))
    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${authToken(9)}`)
    expect(res.status).toBe(500)
    expect(res.body.message).toBeTruthy()
  })
})

describe('PUT /api/notifications/read-all', () => {
  it('marks all as read for current user', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 3 }, []])
    const res = await request(app)
      .put('/api/notifications/read-all')
      .set('Authorization', `Bearer ${authToken(9)}`)
    expect(res.status).toBe(200)
    expect(pool.query.mock.calls[0][0]).toContain('is_read = 1')
    expect(pool.query.mock.calls[0][1]).toEqual([9])
  })
})

describe('PUT /api/notifications/:id/read', () => {
  it('rejects invalid id', async () => {
    const res = await request(app)
      .put('/api/notifications/abc/read')
      .set('Authorization', `Bearer ${authToken(9)}`)
    expect(res.status).toBe(400)
  })

  it('returns 404 when marking foreign notification', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 0 }, []])
    const res = await request(app)
      .put('/api/notifications/77/read')
      .set('Authorization', `Bearer ${authToken(9)}`)
    expect(res.status).toBe(404)
  })

  it('marks own notification as read', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }, []])
    const res = await request(app)
      .put('/api/notifications/77/read')
      .set('Authorization', `Bearer ${authToken(9)}`)
    expect(res.status).toBe(200)
    expect(pool.query.mock.calls[0][1]).toEqual(['77', 9])
  })
})

describe('GET /api/notifications — пагинация', () => {
  it('по умолчанию limit=30 и offset=0 (поведение до пагинации сохранено)', async () => {
    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ unread: 0 }], []])
    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${authToken(9)}`)
    expect(res.status).toBe(200)
    const [sql, params] = pool.query.mock.calls[0]
    expect(sql).toMatch(/LIMIT \? OFFSET \?/)
    expect(params).toEqual([9, 30, 0])
  })

  it('limit и offset из query уезжают в SQL и в параметры', async () => {
    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ unread: 0 }], []])
    const res = await request(app)
      .get('/api/notifications?limit=5&offset=10')
      .set('Authorization', `Bearer ${authToken(9)}`)
    expect(res.status).toBe(200)
    expect(pool.query.mock.calls[0][1]).toEqual([9, 5, 10])
  })

  it('limit сверх 100 урезается до 100, отрицательный offset — до 0', async () => {
    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ unread: 0 }], []])
    await request(app)
      .get('/api/notifications?limit=999&offset=-3')
      .set('Authorization', `Bearer ${authToken(9)}`)
    expect(pool.query.mock.calls[0][1]).toEqual([9, 100, 0])
  })
})

