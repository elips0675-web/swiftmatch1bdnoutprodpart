import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'

vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
  },
}))

import pool from '../db.js'
import authRoutes from '../routes/auth.js'

function createApp() {
  const app = express()
  app.use(express.json())
  app.use(authRoutes)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/auth/register', () => {
  it('requires email and password', async () => {
    const app = createApp()
    const res = await request(app).post('/api/auth/register').send({})
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/required/i)
  })

  it('rejects short password', async () => {
    const app = createApp()
    const res = await request(app).post('/api/auth/register').send({ email: 'test@test.com', password: '123' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/6 characters/i)
  })

  it('rejects duplicate email', async () => {
    pool.query.mockResolvedValue([[{ id: 1 }], []])
    const app = createApp()
    const res = await request(app).post('/api/auth/register').send({ email: 'exists@test.com', password: '123456' })
    expect(res.status).toBe(409)
    expect(res.body.message).toMatch(/already registered/i)
  })

  it('creates account successfully', async () => {
    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ insertId: 1 }, []])
      .mockResolvedValueOnce([[], []])
    const app = createApp()
    const res = await request(app).post('/api/auth/register').send({ email: 'new@test.com', password: '123456', displayName: 'Test' })
    expect(res.status).toBe(201)
    expect(res.body).toHaveProperty('token')
    expect(res.body).toHaveProperty('userId', 1)
  })

  it('records data_processing consent when consent=true', async () => {
    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ insertId: 42 }, []])
      .mockResolvedValueOnce([[], []])
    const app = createApp()
    const res = await request(app).post('/api/auth/register').send({ email: 'consent@test.com', password: '123456', displayName: 'Test', consent: true })
    expect(res.status).toBe(201)
    const consentCall = pool.query.mock.calls.find((c) => String(c[0]).includes('consent_log'))
    expect(consentCall).toBeTruthy()
    expect(consentCall[1].slice(0, 2)).toEqual([42, 'data_processing'])
  })

  it('does not record consent when consent absent', async () => {
    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ insertId: 43 }, []])
      .mockResolvedValueOnce([[], []])
    const app = createApp()
    const res = await request(app).post('/api/auth/register').send({ email: 'noconsent@test.com', password: '123456' })
    expect(res.status).toBe(201)
    expect(pool.query.mock.calls.some((c) => String(c[0]).includes('consent_log'))).toBe(false)
  })
})

describe('POST /api/auth/forgot-password', () => {
  it('requires email', async () => {
    const app = createApp()
    const res = await request(app).post('/api/auth/forgot-password').send({})
    expect(res.status).toBe(400)
  })

  it('returns generic message whether user exists or not', async () => {
    pool.query.mockResolvedValue([[], []])
    const app = createApp()
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'nonexistent@test.com' })
    expect(res.status).toBe(200)
    expect(res.body.message).toMatch(/If the email exists/i)
  })

  it('updates reset token for existing user', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1 }], []])
      .mockResolvedValueOnce([[], []])
    const app = createApp()
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'exists@test.com' })
    expect(res.status).toBe(200)
  })
})

describe('POST /api/auth/reset-password', () => {
  it('requires token and password', async () => {
    const app = createApp()
    const res = await request(app).post('/api/auth/reset-password').send({})
    expect(res.status).toBe(400)
  })

  it('rejects invalid token', async () => {
    pool.query.mockResolvedValue([[], []])
    const app = createApp()
    const res = await request(app).post('/api/auth/reset-password').send({ token: 'bad', password: '123456' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/Invalid/i)
  })
})

describe('POST /api/auth/verify-email', () => {
  it('requires token', async () => {
    const app = createApp()
    const res = await request(app).post('/api/auth/verify-email').send({})
    expect(res.status).toBe(400)
  })

  it('rejects invalid token', async () => {
    pool.query.mockResolvedValue([[], []])
    const app = createApp()
    const res = await request(app).post('/api/auth/verify-email').send({ token: 'bad' })
    expect(res.status).toBe(400)
  })
})

describe('POST /api/auth/refresh (rotation, этап 34)', () => {
  const validTokenRow = { id: 1, user_id: 7, family_id: 'fam-1', revoked: 0 }

  it('requires refresh token', async () => {
    const app = createApp()
    const res = await request(app).post('/api/auth/refresh').send({})
    expect(res.status).toBe(400)
  })

  it('rejects unknown/expired token', async () => {
    pool.query.mockResolvedValue([[], []])
    const app = createApp()
    const res = await request(app).post('/api/auth/refresh').send({ refresh_token: 'nope' })
    expect(res.status).toBe(401)
    expect(res.body.message).toMatch(/Invalid or expired/)
  })

  it('rotates: revokes old, issues new token in same family', async () => {
    pool.query
      .mockResolvedValueOnce([[validTokenRow], []]) // SELECT
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]) // atomic claim
      .mockResolvedValueOnce([{}, []]) // INSERT new
    const app = createApp()
    const res = await request(app).post('/api/auth/refresh').send({ refresh_token: 'tok' })
    expect(res.status).toBe(200)
    expect(res.body.token).toBeTruthy()
    expect(res.body.refresh_token).toBeTruthy()
    const insert = pool.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO refresh_tokens'))
    expect(insert[1]).toContain('fam-1')
    const claim = pool.query.mock.calls[1]
    expect(String(claim[0])).toContain('revoked = 0')
  })

  it('detects reuse of already-revoked token and revokes the whole family', async () => {
    pool.query
      .mockResolvedValueOnce([[{ ...validTokenRow, revoked: 1 }], []]) // SELECT: токен ротирован
      .mockResolvedValueOnce([{ affectedRows: 0 }, []]) // claim проигрывает
      .mockResolvedValueOnce([{}, []]) // UPDATE family
    const app = createApp()
    const res = await request(app).post('/api/auth/refresh').send({ refresh_token: 'stolen' })
    expect(res.status).toBe(401)
    expect(res.body.message).toMatch(/reuse/i)
    const familyRevoke = pool.query.mock.calls.find((c) => String(c[0]).includes('family_id'))
    expect(familyRevoke).toBeTruthy()
  })

  it('parallel race: loser of the atomic claim triggers family revoke', async () => {
    pool.query
      .mockResolvedValueOnce([[{ ...validTokenRow, revoked: 0 }], []])
      .mockResolvedValueOnce([{ affectedRows: 0 }, []])
      .mockResolvedValueOnce([{}, []])
    const app = createApp()
    const res = await request(app).post('/api/auth/refresh').send({ refresh_token: 'raced' })
    expect(res.status).toBe(401)
    expect(res.body.message).toMatch(/reuse/i)
  })
})

describe('POST /api/auth/logout-all (этап 34)', () => {
  it('requires auth', async () => {
    const app = createApp()
    const res = await request(app).post('/api/auth/logout-all')
    expect(res.status).toBe(401)
  })

  it('revokes all sessions and clears cookies', async () => {
    process.env.JWT_SECRET = 'change-me-in-production'
    pool.query.mockResolvedValue([{ affectedRows: 2 }, []])
    const app = createApp()
    const token = jwt.sign({ userId: 7, role: 'user' }, 'change-me-in-production', { expiresIn: '1h' })
    const res = await request(app).post('/api/auth/logout-all').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.message).toMatch(/All sessions revoked/i)
    const call = pool.query.mock.calls.find((c) => String(c[0]).includes('user_id = ? AND revoked = 0'))
    expect(call[1]).toEqual([7])
    expect(res.headers['set-cookie']).toBeTruthy()
  })
})

describe('POST /api/auth/reset-password revokes sessions (этап 34)', () => {
  it('revokes all refresh tokens on password change', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 9 }], []]) // SELECT by reset token
      .mockResolvedValueOnce([{}, []]) // UPDATE users
      .mockResolvedValueOnce([{ affectedRows: 3 }, []]) // revoke sessions
    const app = createApp()
    const res = await request(app).post('/api/auth/reset-password').send({ token: 't', password: '123456' })
    expect(res.status).toBe(200)
    const revoke = pool.query.mock.calls.find(
      (c) => String(c[0]).includes('UPDATE refresh_tokens SET revoked = 1 WHERE user_id'),
    )
    expect(revoke[1]).toEqual([9])
  })
})
