import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }))

const { log } = vi.hoisted(() => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('../logger.js', () => ({
  default: log,
  createLogger: () => log,
  rootLogger: log,
}))

const { reviewProfileMock, adminState } = vi.hoisted(() => ({
  reviewProfileMock: vi.fn(),
  adminState: { userId: 7 },
}))

vi.mock('../middleware.js', () => ({
  auth: (req, _res, next) => { req.userId = 1; next() },
}))

vi.mock('../middleware/adminAuth.js', () => ({
  adminAuth: (req, _res, next) => {
    if (adminState.userId !== null) req.userId = adminState.userId
    req.admin = { id: 7, role: 'admin' }
    next()
  },
}))

vi.mock('../ai-moderation.js', () => ({
  moderateText: vi.fn(),
  moderateImage: vi.fn(),
  reviewProfile: reviewProfileMock,
  isAIModerationConfigured: vi.fn(),
}))

import pool from '../db.js'
import logger from '../logger.js'
import moderationRoutes from '../routes/moderation.js'

function createApp() {
  const app = express()
  app.use(express.json())
  app.use(moderationRoutes)
  return app
}

const app = createApp()

beforeEach(() => {
  vi.clearAllMocks()
  adminState.userId = 7
})

describe('POST /api/moderation/review-profile (adminAuth)', () => {
  it('без userId → 400 MISSING_USER_ID без обращения к БД', async () => {
    const res = await request(app).post('/api/moderation/review-profile').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('MISSING_USER_ID')
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('пользователя нет → 404 NOT_FOUND, reviewProfile не вызывается', async () => {
    pool.query.mockResolvedValueOnce([[]])
    const res = await request(app).post('/api/moderation/review-profile').send({ userId: 999 })
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('NOT_FOUND')
    expect(reviewProfileMock).not.toHaveBeenCalled()
  })

  it('успех: reviewProfile по профилю, результат логируется в moderation_log и возвращается', async () => {
    pool.query
      .mockResolvedValueOnce([[{ display_name: 'Ann', bio: 'hi', city: 'Moscow' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
    reviewProfileMock.mockResolvedValueOnce({ safe: true, reasons: [] })

    const res = await request(app).post('/api/moderation/review-profile').send({ userId: 5 })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ safe: true, reasons: [] })
    expect(reviewProfileMock).toHaveBeenCalledWith({ display_name: 'Ann', bio: 'hi', city: 'Moscow' })

    const insert = pool.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO moderation_log'))
    expect(insert).toBeTruthy()
    const params = insert[1]
    expect(params[0]).toBe(7)
    expect(params[1]).toBe(5)
    expect(params[2]).toBe(JSON.stringify({ safe: true, reasons: [] }))
  })

  it('падение reviewProfile → 500 SERVER_ERROR', async () => {
    pool.query.mockResolvedValueOnce([[{ display_name: 'Ann', bio: '', city: '' }]])
    reviewProfileMock.mockRejectedValueOnce(new Error('ai down'))
    const res = await request(app).post('/api/moderation/review-profile').send({ userId: 5 })
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('SERVER_ERROR')
    expect(logger.error).toHaveBeenCalled()
  })

  it('admin_id без req.userId пишется как 0 (fallback)', async () => {
    adminState.userId = null
    pool.query
      .mockResolvedValueOnce([[{ display_name: 'Bob', bio: '', city: '' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
    reviewProfileMock.mockResolvedValueOnce({ safe: true, reasons: [] })
    const res = await request(app).post('/api/moderation/review-profile').send({ userId: 3 })
    expect(res.status).toBe(200)
    const insert = pool.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO moderation_log'))
    expect(insert[1][0]).toBe(0)
    adminState.userId = 7
  })
})
