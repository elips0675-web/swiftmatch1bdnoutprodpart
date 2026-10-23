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

vi.mock('../ws.js', () => ({
  getIO: vi.fn(() => null),
}))

vi.mock('../banned-words.js', () => ({
  getBannedWords: vi.fn(() => []),
  containsBannedWord: vi.fn(() => false),
}))

vi.mock('../routes/push.js', () => ({
  sendPushToUser: vi.fn(async () => 0),
  sendPushToAll: vi.fn(async () => 0),
  default: {},
}))

import pool from '../db.js'
import socialRoutes from '../routes/social.js'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'
const ACTOR = 11
const TARGET = 22

function token(userId) {
  return jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })
}

function createApp() {
  const app = express()
  app.use(express.json())
  app.use(socialRoutes)
  return app
}

function auth(method, path, body) {
  const req = request(createApp())[method](path).set('Authorization', `Bearer ${token(ACTOR)}`)
  return body === undefined ? req : req.send(body)
}

function activityInserts() {
  return pool.query.mock.calls.filter((c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO activity_log'))
}

function mockDb({ reciprocal = false, likeInserted = true } = {}) {
  pool.query.mockImplementation(async (sql) => {
    if (typeof sql !== 'string') return [[], []]
    if (sql.includes('FROM subscription') || sql.includes('FROM subscriptions')) return [[{ id: 1 }], []]
    if (sql.includes('COUNT(*) AS cnt')) return [[{ cnt: 0 }], []]
    if (sql.includes('INSERT IGNORE INTO likes')) return [{ affectedRows: likeInserted ? 1 : 0 }, []]
    if (sql.includes('SELECT id FROM likes WHERE from_user_id')) {
      return [reciprocal ? [{ id: 7 }] : [], []]
    }
    if (sql.includes('INSERT IGNORE INTO matches')) return [{ affectedRows: 1 }, []]
    if (sql.includes('INSERT INTO activity_log')) return [{ insertId: 100 }, []]
    if (sql.includes('INSERT INTO notifications')) return [{ insertId: 200 }, []]
    if (sql.includes('SELECT id, type, payload, created_at FROM notifications')) {
      return [[{ id: 200, type: 'like', payload: '{}', created_at: '2026-10-23 10:00:00' }], []]
    }
    if (sql.includes('display_name')) return [[{ display_name: 'Ann' }], []]
    return [[], []]
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockResolvedValue([[], []])
})

describe('POST /api/likes — запись в activity_log', () => {
  it('обычный лайк пишет activity_log: актор, получатель, тип like', async () => {
    mockDb()
    const res = await auth('post', '/api/likes', { liked_user_id: TARGET, type: 'like' })
    expect(res.status).toBe(201)
    const inserts = activityInserts()
    expect(inserts).toHaveLength(1)
    expect(inserts[0][1]).toEqual([ACTOR, TARGET, 'like', JSON.stringify({ like_type: 'like' })])
  })

  it('супер-лайк сохраняет исходный тип в metadata', async () => {
    mockDb()
    const res = await auth('post', '/api/likes', { liked_user_id: TARGET, type: 'super_like' })
    expect(res.status).toBe(201)
    expect(activityInserts()[0][1]).toEqual([ACTOR, TARGET, 'like', JSON.stringify({ like_type: 'super_like' })])
  })

  it('взаимный лайк пишется как match, а не like', async () => {
    mockDb({ reciprocal: true })
    const res = await auth('post', '/api/likes', { liked_user_id: TARGET, type: 'like' })
    expect(res.status).toBe(201)
    expect(res.body.matched).toBe(true)
    expect(activityInserts()[0][1]).toEqual([ACTOR, TARGET, 'match', JSON.stringify({ like_type: 'like' })])
  })

  it('повторный лайк (INSERT IGNORE без вставки) не плодит записи в activity_log', async () => {
    mockDb({ likeInserted: false })
    const res = await auth('post', '/api/likes', { liked_user_id: TARGET, type: 'like' })
    expect(res.status).toBe(201)
    expect(activityInserts()).toHaveLength(0)
  })
})
