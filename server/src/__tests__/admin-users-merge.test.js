import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

process.env.JWT_SECRET = 'test-secret'

vi.mock('../db.js', () => ({
  default: { query: vi.fn(), getConnection: vi.fn() },
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
import { auditLog } from '../audit.js'
import adminUsers from '../routes/admin/users.js'

function createAdminApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/admin', (req, res, next) => {
    req.admin = { id: 1, userId: 1, role: 'admin' }
    Object.defineProperty(req, 'ip', { value: '127.0.0.1', configurable: true })
    next()
  })
  app.use('/api/admin', adminUsers)
  return app
}

const app = createAdminApp()

function mockTransaction() {
  const conn = {
    query: vi.fn().mockResolvedValue([{}]),
    beginTransaction: vi.fn().mockResolvedValue({}),
    commit: vi.fn().mockResolvedValue({}),
    rollback: vi.fn().mockResolvedValue({}),
    release: vi.fn().mockResolvedValue({}),
  }
  pool.getConnection.mockResolvedValue(conn)
  return conn
}

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockReset()
  pool.getConnection.mockReset()
})

describe('POST /api/admin/users/:id/merge', () => {
  it('нецелый id → 400 без запросов к БД', async () => {
    const res = await request(app).post('/api/admin/users/abc/merge').send({ keepId: 1 })
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
    expect(pool.getConnection).not.toHaveBeenCalled()
  })

  it('keepId не целое положительное → 400', async () => {
    const res = await request(app).post('/api/admin/users/2/merge').send({ keepId: 0 })
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('dupId === keepId → 400', async () => {
    const res = await request(app).post('/api/admin/users/2/merge').send({ keepId: 2 })
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('виктима не найдена → 404', async () => {
    pool.query.mockResolvedValue([[], []])
    const res = await request(app).post('/api/admin/users/999/merge').send({ keepId: 1 })
    expect(res.status).toBe(404)
    expect(pool.getConnection).not.toHaveBeenCalled()
  })

  it('виктима admin → 400', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 2, role: 'admin' }], []])
    const res = await request(app).post('/api/admin/users/2/merge').send({ keepId: 1 })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Cannot merge an admin account')
    expect(pool.getConnection).not.toHaveBeenCalled()
  })

  it('survivor не найден → 404', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 2, role: 'user' }], []])
      .mockResolvedValueOnce([[], []])
    const res = await request(app).post('/api/admin/users/2/merge').send({ keepId: 1 })
    expect(res.status).toBe(404)
    expect(pool.getConnection).not.toHaveBeenCalled()
  })

  it('успех: переносит FK-данные, чистит пары, пишет audit, удаляет виктиму, гасит сокеты', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 2, role: 'user' }], []])
      .mockResolvedValueOnce([[{ id: 1, role: 'user' }], []])
    const conn = mockTransaction()

    const res = await request(app).post('/api/admin/users/2/merge').send({ keepId: 1 })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ message: 'Users merged', mergedFrom: 2, mergedInto: 1 })

    expect(conn.beginTransaction).toHaveBeenCalledTimes(1)

    const q = conn.query.mock.calls.map((c) => c[0])
    expect(q[0]).toBe('UPDATE IGNORE `activity_log` SET `user_id` = ? WHERE `user_id` = ?')
    expect(conn.query.mock.calls[0][1]).toEqual([1, 2])
    expect(q).toContain('UPDATE IGNORE `matches` SET `user1_id` = ? WHERE `user1_id` = ?')
    expect(q).toContain('UPDATE IGNORE `messages` SET `sender_id` = ? WHERE `sender_id` = ?')
    expect(q).toContain('UPDATE IGNORE `moderation_log` SET `target_user_id` = ? WHERE `target_user_id` = ?')

    const pair = conn.query.mock.calls.find((c) => String(c[0]).startsWith('DELETE FROM `matches`'))
    expect(pair).toBeDefined()
    expect(pair[0]).toBe('DELETE FROM `matches` WHERE `user1_id` = ? AND `user2_id` = ?')
    expect(pair[1]).toEqual([1, 1])

    const profile = conn.query.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO user_profiles'))
    expect(profile).toBeDefined()
    const profileParams = profile[1]
    expect(profileParams[0]).toBe(1)
    expect(profileParams[1]).toBe(2)
    expect(profileParams[2]).toBe(1)

    const referred = conn.query.mock.calls.find((c) => String(c[0]).startsWith('UPDATE users SET referred_by'))
    expect(referred).toBeDefined()
    expect(referred[1]).toEqual([2])

    const audit = conn.query.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO audit_log'))
    expect(audit).toBeDefined()
    expect(audit[0]).toBe('INSERT INTO audit_log (table_name, record_id, action, old_values, new_values, user_id, ip_address) VALUES (?, ?, ?, NULL, ?, ?, ?)')
    expect(audit[1]).toEqual(['users', 2, 'merge', JSON.stringify({ mergedInto: 1 }), 1, '127.0.0.1'])

    const del = conn.query.mock.calls.find((c) => c[0] === 'DELETE FROM users WHERE id = ?')
    expect(del).toBeDefined()
    expect(del[1]).toEqual([2])

    expect(conn.commit).toHaveBeenCalledTimes(1)
    expect(conn.release).toHaveBeenCalledTimes(1)
    expect(conn.rollback).not.toHaveBeenCalled()

    expect(ioMock.to).toHaveBeenCalledWith('user:2')
    expect(ioMock.emit).toHaveBeenCalledWith('user:merged', { mergedInto: 1 })
    await new Promise((r) => setTimeout(r, 150))
    expect(ioMock.in).toHaveBeenCalledWith('user:2')
    expect(ioMock.disconnectSockets).toHaveBeenCalledWith(true)
  })

  it('ошибка БД в транзакции → 500 и rollback', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 2, role: 'user' }], []])
      .mockResolvedValueOnce([[{ id: 1, role: 'user' }], []])
    const conn = mockTransaction()
    conn.query.mockRejectedValue(new Error('db down'))

    const res = await request(app).post('/api/admin/users/2/merge').send({ keepId: 1 })
    expect(res.status).toBe(500)
    expect(conn.rollback).toHaveBeenCalledTimes(1)
    expect(conn.commit).not.toHaveBeenCalled()
    expect(conn.release).toHaveBeenCalledTimes(1)
    expect(auditLog).not.toHaveBeenCalled()
  })
})