import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'

process.env.JWT_SECRET = 'test-secret'

vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}))

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('../ws.js', () => ({
  getIO: vi.fn(() => null),
}))

vi.mock('../audit.js', () => ({
  softDelete: vi.fn().mockResolvedValue([{}]),
  softDeleteWhere: vi.fn().mockResolvedValue([{}]),
  auditLog: vi.fn().mockResolvedValue(undefined),
}))

import pool from '../db.js'
import { auditLog } from '../audit.js'
import adminUsers from '../routes/admin/users.js'

function createAdminApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/admin', (req, res, next) => {
    req.admin = { id: 1, email: 'admin@swiftmatch.local', role: 'admin' }
    next()
  })
  app.use('/api/admin', adminUsers)
  return app
}

const app = createAdminApp()

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockReset()
})

describe('POST /api/admin/impersonate/:userId', () => {
  it('нецелый id → 400 без запроса к БД', async () => {
    const res = await request(app).post('/api/admin/impersonate/abc')
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
    expect(auditLog).not.toHaveBeenCalled()
  })

  it('несуществующий/неактивный пользователь → 404', async () => {
    pool.query.mockResolvedValue([[], []])
    const res = await request(app).post('/api/admin/impersonate/999')
    expect(res.status).toBe(404)
    expect(auditLog).not.toHaveBeenCalled()
  })

  it('успех: отдаёт токен пользователя и пишет audit_log', async () => {
    pool.query.mockResolvedValue([[{ id: 5, email: 'target@example.com' }], []])
    const res = await request(app).post('/api/admin/impersonate/5')
    expect(res.status).toBe(200)
    expect(res.body.expiresIn).toBe(3600)
    expect(res.body.user).toEqual({ id: 5, email: 'target@example.com' })

    const decoded = jwt.verify(res.body.token, 'test-secret')
    expect(decoded.userId).toBe(5)
    expect(decoded.role).toBe('user')
    expect(decoded.impersonatedBy).toBe(1)

    expect(auditLog).toHaveBeenCalledTimes(1)
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({
      tableName: 'users',
      recordId: 5,
      action: 'impersonate',
      userId: 1,
    }))
  })

  it('ошибка БД → 500 и без аудита', async () => {
    pool.query.mockRejectedValue(new Error('db down'))
    const res = await request(app).post('/api/admin/impersonate/5')
    expect(res.status).toBe(500)
    expect(auditLog).not.toHaveBeenCalled()
  })
})
