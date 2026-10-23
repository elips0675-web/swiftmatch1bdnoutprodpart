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

import pool from '../db.js'
import profileRoutes from '../routes/profile.js'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'
const VIEWER = 7
const TARGET = 42

const app = express()
app.use(express.json())
app.use(profileRoutes)

function token(userId = VIEWER) {
  return jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })
}

function postView(id = TARGET) {
  return request(app).post(`/api/profile/${id}/view`).set('Authorization', `Bearer ${token()}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockReset()
  pool.query.mockResolvedValue([[], []])
})

describe('POST /api/profile/:id/view — визит в ленте активности', () => {
  it('нечисловой id — 400 без обращения к БД', async () => {
    const res = await postView('abc')
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/Invalid id/)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('свой профиль — 400 без обращения к БД', async () => {
    const res = await postView(VIEWER)
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/yourself/)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('чужой профиль не найден или заблокирован — 404 без записи', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await postView()
    expect(res.status).toBe(404)
    const sql = pool.query.mock.calls[0][0]
    expect(sql).toContain('user_blocks')
    expect(sql).toContain('is_active = 1')
    expect(pool.query.mock.calls.filter(([q]) => String(q).includes('INSERT INTO activity_log'))).toHaveLength(0)
  })

  it('первый просмотр пишет profile_view с окном дедупа 24 часа', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: TARGET }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
    const res = await postView()
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ viewed: true })
    const [sql, params] = pool.query.mock.calls[1]
    expect(sql).toContain('INSERT INTO activity_log')
    expect(sql).toContain("'profile_view'")
    expect(sql).toContain('INTERVAL 24 HOUR')
    expect(sql).toContain('NOT EXISTS')
    expect(params).toEqual([VIEWER, TARGET, VIEWER, TARGET])
  })

  it('повторный просмотр в течение суток не создаёт запись (viewed false)', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: TARGET }], []])
      .mockResolvedValueOnce([{ affectedRows: 0 }, []])
    const res = await postView()
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ viewed: false })
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await postView()
    expect(res.status).toBe(500)
    expect(res.body.message).toMatch(/Failed to record view/)
  })
})
