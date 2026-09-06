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
      .mockResolvedValueOnce([[{ interests: '["sport","music"]' }], []])
      .mockResolvedValueOnce([[{ id: 1, name_en: 'Sport' }, { id: 2, name_en: 'Music' }], []])

    const res = await request(app).get('/api/profile/1')
    expect(res.status).toBe(200)
    expect(res.body.display_name).toBe('Test')
    expect(res.body.photos).toHaveLength(1)
    expect(res.body.interests).toHaveLength(1)
  })

  it('returns birth_date along with profile fields', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1, display_name: 'Test', age: 30, birth_date: '1995-06-15', email: 't@t.com' }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ interests: '[]' }], []])
      .mockResolvedValueOnce([[], []])

    const res = await request(app).get('/api/profile/1')
    expect(res.status).toBe(200)
    expect(res.body.birth_date).toBe('1995-06-15')
    expect(res.body.age).toBe(30)
  })

  it('drops interests absent from canonical content_config (e.g. Animals/Politics)', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1, display_name: 'Test', email: 'test@test.com' }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([
        [
          { id: 13, name_ru: 'Животные', name_en: 'Animals' },
          { id: 1, name_ru: 'Спорт', name_en: 'Sport' },
        ],
        [],
      ])
      .mockResolvedValueOnce([[{ interests: '["sport"]' }], []])
      .mockResolvedValueOnce([[{ id: 13, name_en: 'Animals' }, { id: 1, name_en: 'Sport' }], []])

    const res = await request(app).get('/api/profile/1')
    expect(res.status).toBe(200)
    expect(res.body.interests).toHaveLength(1)
    expect(res.body.interests[0].id).toBe(1)
    expect(res.body.interests[0].name_ru).toBe('Спорт')
  })

  it('sanitizes legacy XSS payload stored in bio (defense in depth on read)', async () => {
    pool.query
      .mockResolvedValueOnce(
        [[{ id: 2, display_name: 'Ann <b>x</b>', bio: '<script>alert("xss")</script>', email: 'a@t.com' }], []],
      )
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ interests: '[]' }], []])
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
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ interests: '["sport","music"]' }], []])
      .mockResolvedValueOnce([[{ id: 1, name_en: 'Sport' }, { id: 2, name_en: 'Music' }], []])
      .mockResolvedValue([[], []])

    const res = await request(app)
      .put('/api/profile/1')
      .send({ display_name: 'Test', interests: [1, 2, 3] })
    expect(res.status).toBe(200)
    const insertCalls = pool.query.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].startsWith('INSERT IGNORE INTO user_interests'),
    )
    expect(insertCalls).toHaveLength(2)
  })

  it('filters out non-canonical interest ids on save (e.g. Animals/Politics)', async () => {
    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ interests: '["sport"]' }], []])
      .mockResolvedValueOnce([[{ id: 13, name_en: 'Animals' }, { id: 1, name_en: 'Sport' }], []])
      .mockResolvedValue([[], []])

    const res = await request(app)
      .put('/api/profile/1')
      .send({ display_name: 'Test', interests: [13, 1] })
    expect(res.status).toBe(200)
    const insertCalls = pool.query.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].startsWith('INSERT IGNORE INTO user_interests'),
    )
    expect(insertCalls.map((c) => c[1][1])).toEqual([1])
  })

  it('keeps canonical interests added later (Coffee=26, Design=37) and drops Animals(13)', async () => {
    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ interests: '["sport","coffee","design"]' }], []])
      .mockResolvedValueOnce([
        [
          { id: 13, name_en: 'Animals' },
          { id: 26, name_en: 'Coffee' },
          { id: 37, name_en: 'Design' },
        ],
        [],
      ])
      .mockResolvedValue([[], []])

    const res = await request(app)
      .put('/api/profile/1')
      .send({ display_name: 'Test', interests: [26, 37, 13] })
    expect(res.status).toBe(200)
    const insertCalls = pool.query.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].startsWith('INSERT IGNORE INTO user_interests'),
    )
    expect(insertCalls.map((c) => c[1][1])).toEqual([26, 37])
  })

  it('recomputes age from birth_date on save and stores birth_date', async () => {
    const bd = new Date('2000-01-01')
    const today = new Date()
    let expectedAge = today.getFullYear() - bd.getFullYear()
    const m = today.getMonth() - bd.getMonth()
    if (m < 0 || (m === 0 && today.getDate() < bd.getDate())) expectedAge -= 1
    expectedAge = Math.max(18, expectedAge)

    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ id: 1, display_name: 'Updated' }], []])

    const res = await request(app)
      .put('/api/profile/1')
      .send({ display_name: 'Updated', birth_date: '2000-01-01' })
    expect(res.status).toBe(200)

    const updateCall = pool.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].startsWith('UPDATE user_profiles'),
    )
    expect(updateCall).toBeDefined()
    const params = updateCall[1]
    expect(params[2]).toBe(expectedAge)
    expect(params[3]).toBe('2000-01-01')
  })

  it('clamps very recent birth_date to min age 18', async () => {
    const bd = new Date()
    const birthDateStr = `${bd.getFullYear()}-${String(bd.getMonth() + 1).padStart(2, '0')}-${String(bd.getDate()).padStart(2, '0')}`

    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ id: 1, display_name: 'Baby' }], []])

    const res = await request(app)
      .put('/api/profile/1')
      .send({ display_name: 'Baby', birth_date: birthDateStr })
    expect(res.status).toBe(200)

    const updateCall = pool.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].startsWith('UPDATE user_profiles'),
    )
    expect(updateCall[1][2]).toBe(18)
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
