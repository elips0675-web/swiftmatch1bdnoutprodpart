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

import pool from '../db.js'
import profileRoutes from '../routes/profile.js'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'
const app = express()
app.use(express.json())
app.use(profileRoutes)

function authToken(userId = 1) {
  return jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/profile/:id', () => {
  it('returns 404 for missing profile', async () => {
    pool.query.mockResolvedValue([[], []])
    const res = await request(app).get('/api/profile/999')
    expect(res.status).toBe(404)
    expect(res.body.message).toMatch(/not found/i)
  })

  it('returns profile with photos and interests', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1, display_name: 'Test', email: 'test@test.com' }], []])
      .mockResolvedValueOnce([[{ id: 1, url: '/photo.jpg', sort_order: 0, is_avatar: 1 }], []])
      .mockResolvedValueOnce([[{ id: 1, name_ru: 'Спорт', name_en: 'Sport' }], []])

    const res = await request(app).get('/api/profile/1')
    expect(res.status).toBe(200)
    expect(res.body.display_name).toBe('Test')
    expect(res.body.photos).toHaveLength(1)
    expect(res.body.interests).toHaveLength(1)
  })

  it('sanitizes legacy XSS payload stored in bio (defense in depth on read)', async () => {
    pool.query
      .mockResolvedValueOnce(
        [[{ id: 2, display_name: 'Ann <b>x</b>', bio: '<script>alert("xss")</script>', email: 'a@t.com' }], []],
      )
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])

    const res = await request(app).get('/api/profile/2')
    expect(res.status).toBe(200)
    expect(res.body.bio).not.toContain('<script>')
    expect(res.body.bio).not.toContain('alert(')
    expect(res.body.display_name).not.toContain('<b>')
  })

  it('handles database error', async () => {
    pool.query.mockRejectedValue(new Error('DB error'))
    const res = await request(app).get('/api/profile/1')
    expect(res.status).toBe(500)
  })
})

describe('PUT /api/profile/:id', () => {
  it('updates profile fields', async () => {
    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ id: 1, display_name: 'Updated', bio: 'New bio' }], []])

    const res = await request(app)
      .put('/api/profile/1')
      .send({ display_name: 'Updated', bio: 'New bio' })
    expect(res.status).toBe(200)
    expect(res.body.display_name).toBe('Updated')
  })

  it('updates interests if provided', async () => {
    pool.query
      .mockResolvedValue([[], []])
      .mockResolvedValue([[], []])
      .mockResolvedValue([[{ id: 1 }], []])

    const res = await request(app)
      .put('/api/profile/1')
      .send({ display_name: 'Test', interests: [1, 2, 3] })
    expect(res.status).toBe(200)
  })
})

describe('DELETE /api/profile/me', () => {
  it('requires auth', async () => {
    const res = await request(app).delete('/api/profile/me')
    expect(res.status).toBe(401)
  })

  it('deletes account', async () => {
    pool.query.mockResolvedValue([[], []])
    const res = await request(app)
      .delete('/api/profile/me')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.message).toMatch(/deleted/i)
  })
})

describe('Static routes before /:id (regression: shadowing)', () => {
  it('GET /api/profile/aliases must NOT be swallowed by /api/profile/:id', async () => {
    const res = await request(app).get('/api/profile/aliases')
    expect(res.status).toBe(401)
  })

  it('GET /api/profile/verification must NOT be swallowed by /api/profile/:id', async () => {
    const res = await request(app).get('/api/profile/verification')
    expect(res.status).toBe(401)
  })

  it('GET /api/profile/aliases returns aliases with auth', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 1, alias: 'Alex', is_primary: 1 }], []])
    const res = await request(app)
      .get('/api/profile/aliases')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].alias).toBe('Alex')
  })

  it('GET /api/profile/verification returns verification state with auth', async () => {
    pool.query.mockResolvedValueOnce([[{ photo_verified: 0 }], []])
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(app)
      .get('/api/profile/verification')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.verified).toBe(false)
  })
})
