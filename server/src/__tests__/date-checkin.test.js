vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'

vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
    execute: vi.fn(),
    getConnection: vi.fn(),
  },
}))

import pool from '../db.js'
import checkinRoutes from '../routes/date-checkin.js'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

function createApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/checkin', checkinRoutes)
  return app
}

function authToken(userId = 1) {
  return jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/checkin/contacts', () => {
  it('creates a contact with trimmed fields', async () => {
    pool.execute.mockResolvedValueOnce([{ insertId: 4 }, []])
    const res = await request(createApp())
      .post('/api/checkin/contacts')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ name: '  Мама  ', phone: '+79161234567', email: 'a@b.c', relation: 'Мать' })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe(4)
    const [sql, params] = pool.execute.mock.calls[0]
    expect(sql).toContain('INSERT INTO emergency_contacts')
    expect(params).toEqual([1, 'Мама', '+79161234567', 'a@b.c', 'Мать'])
  })

  it('truncates overlong fields to column sizes instead of 500', async () => {
    pool.execute.mockResolvedValueOnce([{ insertId: 5 }, []])
    const res = await request(createApp())
      .post('/api/checkin/contacts')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ name: 'n'.repeat(300), phone: '1'.repeat(50), email: 'e'.repeat(260), relation: 'r'.repeat(150) })
    expect(res.status).toBe(201)
    const params = pool.execute.mock.calls[0][1]
    expect(params[1]).toHaveLength(255)
    expect(params[2]).toHaveLength(20)
    expect(params[3]).toHaveLength(255)
    expect(params[4]).toHaveLength(100)
  })

  it('rejects a too-short name without touching the DB', async () => {
    const res = await request(createApp())
      .post('/api/checkin/contacts')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ name: 'a' })
    expect(res.status).toBe(400)
    expect(pool.execute).not.toHaveBeenCalled()
  })
})