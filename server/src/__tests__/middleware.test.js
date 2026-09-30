vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import jwt from 'jsonwebtoken'
import { auth, optionalAuth, JWT_SECRET } from '../middleware.js'

function mockReqRes() {
  const req = { headers: {}, cookies: undefined }
  const res = {
    status: vi.fn(() => res),
    json: vi.fn(() => res),
  }
  const next = vi.fn()
  return { req, res, next }
}

describe('auth middleware', () => {
  it('returns 401 without Authorization header', () => {
    const { req, res, next } = mockReqRes()
    auth(req, res, next)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ message: 'Authentication required' })
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 401 with malformed header', () => {
    const { req, res, next } = mockReqRes()
    req.headers.authorization = 'Basic token'
    auth(req, res, next)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 401 with invalid token', () => {
    const { req, res, next } = mockReqRes()
    req.headers.authorization = 'Bearer invalid-token'
    auth(req, res, next)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ message: 'Invalid or expired token' })
    expect(next).not.toHaveBeenCalled()
  })

  it('calls next with valid token', () => {
    const token = jwt.sign({ userId: 1, role: 'user' }, JWT_SECRET(), { expiresIn: '1h' })
    const { req, res, next } = mockReqRes()
    req.headers.authorization = `Bearer ${token}`
    auth(req, res, next)
    expect(next).toHaveBeenCalled()
    expect(req.userId).toBe(1)
  })

  it('sets userId from token payload', () => {
    const token = jwt.sign({ userId: 42, role: 'admin' }, JWT_SECRET(), { expiresIn: '1h' })
    const { req, res, next } = mockReqRes()
    req.headers.authorization = `Bearer ${token}`
    auth(req, res, next)
    expect(req.userId).toBe(42)
  })

  it('accepts token from httpOnly cookie (no Authorization header)', () => {
    const token = jwt.sign({ userId: 5, role: 'user' }, JWT_SECRET(), { expiresIn: '1h' })
    const { req, res, next } = mockReqRes()
    req.cookies = { sm_token: token }
    auth(req, res, next)
    expect(next).toHaveBeenCalled()
    expect(req.userId).toBe(5)
  })

  it('returns 401 with invalid cookie token', () => {
    const { req, res, next } = mockReqRes()
    req.cookies = { sm_token: 'bad-token' }
    auth(req, res, next)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('prefers valid cookie session over legacy Authorization header', () => {
    const headerToken = jwt.sign({ userId: 11, role: 'user' }, JWT_SECRET(), { expiresIn: '1h' })
    const cookieToken = jwt.sign({ userId: 22, role: 'user' }, JWT_SECRET(), { expiresIn: '1h' })
    const { req, res, next } = mockReqRes()
    req.headers.authorization = `Bearer ${headerToken}`
    req.cookies = { sm_token: cookieToken }
    auth(req, res, next)
    expect(req.userId).toBe(22)
  })

  it('falls back to valid cookie when Authorization token is stale', () => {
    const cookieToken = jwt.sign({ userId: 22, role: 'user' }, JWT_SECRET(), { expiresIn: '1h' })
    const { req, res, next } = mockReqRes()
    req.headers.authorization = 'Bearer stale-token-from-legacy-storage'
    req.cookies = { sm_token: cookieToken }
    auth(req, res, next)
    expect(res.status).not.toHaveBeenCalledWith(401)
    expect(next).toHaveBeenCalled()
    expect(req.userId).toBe(22)
  })
})

describe('optionalAuth middleware', () => {
  it('sets userId to null without header', () => {
    const { req, res, next } = mockReqRes()
    optionalAuth(req, res, next)
    expect(req.userId).toBeNull()
    expect(next).toHaveBeenCalled()
  })
  it('sets userId with valid token', () => {
    const token = jwt.sign({ userId: 7, role: 'user' }, JWT_SECRET(), { expiresIn: '1h' })
    const { req, res, next } = mockReqRes()
    req.headers.authorization = `Bearer ${token}`
    optionalAuth(req, res, next)
    expect(req.userId).toBe(7)
    expect(next).toHaveBeenCalled()
  })

  it('sets userId to null with invalid token', () => {
    const { req, res, next } = mockReqRes()
    req.headers.authorization = 'Bearer bad-token'
    optionalAuth(req, res, next)
    expect(req.userId).toBeNull()
    expect(next).toHaveBeenCalled()
  })

  it('falls back to valid cookie when header token is invalid', () => {
    const cookieToken = jwt.sign({ userId: 33, role: 'user' }, JWT_SECRET(), { expiresIn: '1h' })
    const { req, res, next } = mockReqRes()
    req.headers.authorization = 'Bearer bad-token'
    req.cookies = { sm_token: cookieToken }
    optionalAuth(req, res, next)
    expect(req.userId).toBe(33)
    expect(next).toHaveBeenCalled()
  })
})

// Этап 20 (P0-C). Прод поднимался с JWT_SECRET из публичного .env.example:
// rsync --delete стирал .env на VPS, следом шло `cp .env.example .env`, и ключ
// подписи становился константой из репозитория — по нему подписывается admin.
describe('JWT_SECRET: прода не принимает публичный плейсхолдер', () => {
  const savedNodeEnv = process.env.NODE_ENV
  const savedSecret = process.env.JWT_SECRET

  beforeEach(() => {
    process.env.NODE_ENV = 'production'
  })

  afterEach(() => {
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = savedNodeEnv
    process.env.JWT_SECRET = savedSecret
  })

  it('кидает, если секрет не задан вовсе', () => {
    delete process.env.JWT_SECRET
    expect(() => JWT_SECRET()).toThrow(/must be set/)
  })

  it.each([
    'change-me-to-a-long-random-secret',
    'change-this-to-a-random-256-bit-secret',
    'change-me-in-production',
    'change-me',
  ])('кидает на плейсхолдер из репозитория: %s', (placeholder) => {
    process.env.JWT_SECRET = placeholder
    expect(() => JWT_SECRET()).toThrow(/placeholder/)
  })

  it('кидает на плейсхолдер, отличающийся регистром и пробелами', () => {
    process.env.JWT_SECRET = '  Change-Me-To-A-Long-Random-Secret  '
    expect(() => JWT_SECRET()).toThrow(/placeholder/)
  })

  it('кидает на слишком короткий секрет (HS256 перебирается тривиально)', () => {
    process.env.JWT_SECRET = 'a'.repeat(31)
    expect(() => JWT_SECRET()).toThrow(/shorter than 32/)
  })

  it('пропускает настоящий длинный секрет', () => {
    process.env.JWT_SECRET = 'f'.repeat(64)
    expect(JWT_SECRET()).toBe('f'.repeat(64))
  })

  it('в dev плейсхолдер пропускает — локальный запуск не должен ломаться', () => {
    process.env.NODE_ENV = 'development'
    process.env.JWT_SECRET = 'change-me-to-a-long-random-secret'
    expect(JWT_SECRET()).toBe('change-me-to-a-long-random-secret')
  })
})
