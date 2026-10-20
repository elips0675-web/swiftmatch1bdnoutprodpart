vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
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
import { rootLogger } from '../logger.js'
import { adminAuth } from '../middleware/adminAuth.js'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

function mockReqRes() {
  const req = { headers: {} }
  const res = {
    status: vi.fn(() => res),
    json: vi.fn(() => res),
  }
  const next = vi.fn()
  return { req, res, next }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('adminAuth middleware', () => {
  it('passes valid cookie without header', async () => {
    const cookieToken = jwt.sign({ userId: 7, role: 'admin' }, JWT_SECRET, { expiresIn: '1h' })
    pool.query.mockResolvedValueOnce([[{ id: 7, email: 'a@b.c', role: 'admin' }], []])
    const { req, res, next } = mockReqRes()
    req.cookies = { sm_token: cookieToken }
    await adminAuth(req, res, next)
    expect(next).toHaveBeenCalled()
    expect(req.admin.id).toBe(7)
  })

  it('falls back to valid cookie when Authorization token is stale', async () => {
    const cookieToken = jwt.sign({ userId: 9, role: 'admin' }, JWT_SECRET, { expiresIn: '1h' })
    pool.query.mockResolvedValueOnce([[{ id: 9, email: 'a@b.c', role: 'admin' }], []])
    const { req, res, next } = mockReqRes()
    req.headers.authorization = 'Bearer stale-token-from-legacy-storage'
    req.cookies = { sm_token: cookieToken }
    await adminAuth(req, res, next)
    expect(res.status).not.toHaveBeenCalledWith(401)
    expect(next).toHaveBeenCalled()
    expect(req.admin.id).toBe(9)
  })

  it('prefers valid admin cookie over valid non-admin Bearer from legacy storage', async () => {
    const bearerToken = jwt.sign({ userId: 5, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })
    const cookieToken = jwt.sign({ userId: 7, role: 'admin' }, JWT_SECRET, { expiresIn: '1h' })
    pool.query.mockResolvedValueOnce([[{ id: 7, email: 'a@b.c', role: 'admin' }], []])
    const { req, res, next } = mockReqRes()
    req.headers.authorization = `Bearer ${bearerToken}`
    req.cookies = { sm_token: cookieToken }
    await adminAuth(req, res, next)
    expect(res.status).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalled()
    expect(req.admin.id).toBe(7)
  })

  it('returns 401 ADMIN_REQUIRED when all tokens invalid', async () => {
    const { req, res, next } = mockReqRes()
    req.headers.authorization = 'Bearer bad-token'
    req.cookies = { sm_token: 'also-bad' }
    await adminAuth(req, res, next)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ message: 'ADMIN_REQUIRED' })
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 403 for non-admin user', async () => {
    const cookieToken = jwt.sign({ userId: 5, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })
    pool.query.mockResolvedValueOnce([[], []])
    const { req, res, next } = mockReqRes()
    req.cookies = { sm_token: cookieToken }
    await adminAuth(req, res, next)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(next).not.toHaveBeenCalled()
  })

  it('passes valid Bearer when request has no cookies at all', async () => {
    const bearerToken = jwt.sign({ userId: 7, role: 'admin' }, JWT_SECRET, { expiresIn: '1h' })
    pool.query.mockResolvedValueOnce([[{ id: 7, email: 'a@b.c', role: 'admin' }], []])
    pool.query.mockResolvedValueOnce([[{ team_id: 3 }], []])
    const { req, res, next } = mockReqRes()
    req.headers.authorization = `Bearer ${bearerToken}`
    await adminAuth(req, res, next)
    expect(res.status).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalled()
    expect(req.admin.id).toBe(7)
    expect(req.admin.teams).toEqual([3])
  })

  it('degrades to empty teams when teams lookup returns null rows', async () => {
    const cookieToken = jwt.sign({ userId: 7, role: 'admin' }, JWT_SECRET, { expiresIn: '1h' })
    pool.query.mockResolvedValueOnce([[{ id: 7, email: 'a@b.c', role: 'admin' }], []])
    pool.query.mockResolvedValueOnce([null, []])
    const { req, res, next } = mockReqRes()
    req.cookies = { sm_token: cookieToken }
    await adminAuth(req, res, next)
    expect(next).toHaveBeenCalled()
    expect(req.admin.teams).toEqual([])
    expect(rootLogger.warn).not.toHaveBeenCalled()
  })

  it('returns 500 ADMIN_CHECK_FAILED on DB error', async () => {
    const cookieToken = jwt.sign({ userId: 7, role: 'admin' }, JWT_SECRET, { expiresIn: '1h' })
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const { req, res, next } = mockReqRes()
    req.cookies = { sm_token: cookieToken }
    await adminAuth(req, res, next)
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ message: 'ADMIN_CHECK_FAILED' })
    expect(next).not.toHaveBeenCalled()
    expect(rootLogger.error).toHaveBeenCalledWith('adminAuth DB error:', expect.any(Error))
  })
})
