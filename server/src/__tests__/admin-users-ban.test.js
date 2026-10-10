import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'

vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}))

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

const ioMock = {
  to: vi.fn().mockReturnThis(),
  emit: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  disconnectSockets: vi.fn().mockReturnThis(),
}
vi.mock('../ws.js', () => ({
  getIO: vi.fn(() => ioMock),
}))

vi.mock('../audit.js', () => ({
  softDelete: vi.fn().mockResolvedValue([{}]),
  softDeleteWhere: vi.fn().mockResolvedValue([{}]),
  auditLog: vi.fn().mockResolvedValue(undefined),
}))

import pool from '../db.js'
import adminUsers from '../routes/admin/users.js'

const JWT_SECRET = 'change-me-in-production'

function createAdminApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/admin', (req, res, next) => {
    req.admin = { id: 1, userId: 1, role: 'admin' }
    next()
  })
  app.use('/api/admin', adminUsers)
  return app
}

function adminToken() {
  return jwt.sign({ userId: 1, id: 1, role: 'admin' }, JWT_SECRET, { expiresIn: '1h' })
}

const app = createAdminApp()

beforeEach(() => {
  vi.clearAllMocks()
})

describe('admin ban chain → WS user:banned', () => {
  it('emits user:banned and disconnects the banned user socket on single ban', async () => {
    pool.query.mockResolvedValue([{}])
    const res = await request(app)
      .post('/api/admin/users/42/ban')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ reason: 'spam' })

    expect(res.status).toBe(200)
    expect(ioMock.to).toHaveBeenCalledWith('user:42')
    expect(ioMock.emit).toHaveBeenCalledWith('user:banned', { userId: 42 })
    await new Promise((r) => setTimeout(r, 150))
    expect(ioMock.in).toHaveBeenCalledWith('user:42')
    expect(ioMock.disconnectSockets).toHaveBeenCalledWith(true)
  })

  it('emits user:banned for each id on bulk ban', async () => {
    pool.query.mockResolvedValue([{}])
    const res = await request(app)
      .post('/api/admin/users/bulk')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ids: [5, 7], action: 'ban' })

    expect(res.status).toBe(200)
    expect(ioMock.to).toHaveBeenCalledWith('user:5')
    expect(ioMock.to).toHaveBeenCalledWith('user:7')
    expect(ioMock.emit).toHaveBeenCalledWith('user:banned', { userId: 5 })
    expect(ioMock.emit).toHaveBeenCalledWith('user:banned', { userId: 7 })
  })

  it('emits user:banned for each id on bulk suspend', async () => {
    pool.query.mockResolvedValue([{}])
    const res = await request(app)
      .post('/api/admin/users/bulk')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ids: [9], action: 'suspend' })

    expect(res.status).toBe(200)
    expect(ioMock.to).toHaveBeenCalledWith('user:9')
    expect(ioMock.emit).toHaveBeenCalledWith('user:banned', { userId: 9 })
  })

  it('does not emit when getIO returns null (no WS server)', async () => {
    const { getIO } = await import('../ws.js')
    getIO.mockReturnValueOnce(null)
    pool.query.mockResolvedValue([{}])
    const res = await request(app)
      .post('/api/admin/users/3/ban')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({})

    expect(res.status).toBe(200)
    expect(ioMock.emit).not.toHaveBeenCalled()
  })
})
