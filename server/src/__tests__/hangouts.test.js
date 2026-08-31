vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'
import { getIO } from '../ws.js'

vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
    getConnection: vi.fn(),
  },
}))

vi.mock('../ws.js', () => ({
  getIO: vi.fn(() => ({
    to: vi.fn(() => ({ emit: vi.fn() })),
  })),
}))

vi.mock('../banned-words.js', () => ({
  getBannedWords: vi.fn(async () => []),
  containsBannedWord: vi.fn(() => false),
}))

vi.mock('./push.js', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  sendPushToUser: vi.fn(async () => {}),
  sendPushToAll: vi.fn(),
}))

vi.mock('./experiments.js', () => ({
  trackEvent: vi.fn(async () => {}),
}))

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import pool from '../db.js'
import hangoutsRoutes from '../routes/hangouts.js'
import adminHangouts from '../routes/admin/hangouts.js'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

function createApp(router) {
  const app = express()
  app.use(express.json())
  app.use(router)
  return app
}

function createAdminApp(router) {
  const app = express()
  app.use(express.json())
  app.use('/api/admin', (req, res, next) => {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) return next()
    try {
      const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET)
      req.admin = decoded
      next()
    } catch { next() }
  })
  app.use('/api/admin', router)
  return app
}

function authToken(userId = 1) {
  return jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })
}

function adminToken() {
  return jwt.sign({ userId: 1, role: 'admin' }, JWT_SECRET, { expiresIn: '1h' })
}

function mockConnection(handlers) {
  const conn = {
    execute: vi.fn(async (sql, params) => handlers.execute(sql, params)),
    query: vi.fn(async (sql, params) => handlers.query(sql, params)),
    release: vi.fn(),
  }
  pool.getConnection.mockResolvedValue(conn)
  return conn
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/hangouts (feed)', () => {
  it('returns feed without auth (anonymous)', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 1, title: 'Cinema' }], []])
    const res = await request(createApp(hangoutsRoutes)).get('/api/hangouts')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].title).toBe('Cinema')
  })

  it('applies category filter', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(createApp(hangoutsRoutes)).get('/api/hangouts?category=cinema')
    expect(res.status).toBe(200)
    const sql = pool.query.mock.calls[0][0]
    expect(sql).toContain('h.category = ?')
    expect(pool.query.mock.calls[0][1]).toContain('cinema')
  })

  it('applies free price filter', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(createApp(hangoutsRoutes)).get('/api/hangouts?price=free')
    expect(res.status).toBe(200)
    const sql = pool.query.mock.calls[0][0]
    expect(sql).toContain('(h.price IS NULL OR h.price = 0)')
  })

  it('applies paid price filter with max_price range', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(createApp(hangoutsRoutes)).get('/api/hangouts?price=paid&max_price=1500')
    expect(res.status).toBe(200)
    const sql = pool.query.mock.calls[0][0]
    expect(sql).toContain('(h.price IS NOT NULL AND h.price > 0)')
    expect(sql).toContain('h.price <= ?')
    expect(pool.query.mock.calls[0][1]).toContain(1500)
  })

  it('ignores price filter when value is unknown', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    await request(createApp(hangoutsRoutes)).get('/api/hangouts?price=hack')
    const sql = pool.query.mock.calls[0][0]
    expect(sql).not.toContain('h.price IS NULL OR h.price = 0')
    expect(sql).not.toContain('h.price > 0')
  })

  it('applies radius filter with ST_Distance_Sphere', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(createApp(hangoutsRoutes)).get('/api/hangouts?lat=55.75&lng=37.61&radius=5')
    expect(res.status).toBe(200)
    const sql = pool.query.mock.calls[0][0]
    expect(sql).toContain('ST_Distance_Sphere')
    expect(sql).toContain('HAVING distance_km <= ?')
    const params = pool.query.mock.calls[0][1]
    expect(params).toContain(5)
  })

  it('rejects unknown category silently (no filter)', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    await request(createApp(hangoutsRoutes)).get('/api/hangouts?category=hack')
    const sql = pool.query.mock.calls[0][0]
    expect(sql).not.toContain('h.category = ?')
  })

  it('applies text search across title/description/place/city', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(createApp(hangoutsRoutes)).get('/api/hangouts?q=йога')
    expect(res.status).toBe(200)
    const sql = pool.query.mock.calls[0][0]
    expect(sql).toContain('h.title LIKE ? OR h.description LIKE ? OR h.place_name LIKE ? OR h.city LIKE ?')
    const params = pool.query.mock.calls[0][1]
    expect(params).toContain('%йога%')
    expect(params.filter((p) => p === '%йога%').length).toBe(4)
  })

  it('ignores empty/whitespace search query', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    await request(createApp(hangoutsRoutes)).get('/api/hangouts?q=   ')
    const sql = pool.query.mock.calls[0][0]
    expect(sql).not.toContain('h.title LIKE ?')
  })

  it('joins partner offer and returns offer fields', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 1, title: 'Cinema', offer_id: 12, offer_price: '500.00' }], []])
    const res = await request(createApp(hangoutsRoutes)).get('/api/hangouts')
    expect(res.status).toBe(200)
    const sql = pool.query.mock.calls[0][0]
    expect(sql).toContain('LEFT JOIN partner_offers po ON po.id = h.partner_offer_id')
    expect(sql).toContain('po.id AS offer_id')
    expect(res.body[0]).toMatchObject({ offer_id: 12, offer_price: '500.00' })
  })

  it('returns offer_pinned and sorts pinned offers first', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 2, offer_id: 5, offer_pinned: 1 }], []])
    const res = await request(createApp(hangoutsRoutes)).get('/api/hangouts')
    expect(res.status).toBe(200)
    const sql = pool.query.mock.calls[0][0]
    expect(sql).toContain('po.pinned AS offer_pinned')
    expect(sql).toMatch(/ORDER BY \(h\.boosted = 1\) DESC, \(po\.pinned IS NOT NULL AND po\.pinned = 1\) DESC/)
    expect(res.body[0]).toMatchObject({ offer_id: 5, offer_pinned: 1 })
  })

  it('selects boosted flag for hangouts', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 3, boosted: 1 }], []])
    const res = await request(createApp(hangoutsRoutes)).get('/api/hangouts')
    expect(res.status).toBe(200)
    const sql = pool.query.mock.calls[0][0]
    expect(sql).toContain('h.boosted')
    expect(res.body[0]).toMatchObject({ boosted: 1 })
  })
})

describe('POST /api/hangouts', () => {
  it('requires auth', async () => {
    const res = await request(createApp(hangoutsRoutes)).post('/api/hangouts').send({})
    expect(res.status).toBe(401)
  })

  it('creates hangout with valid data', async () => {
    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ cnt: 0 }], []])
      .mockResolvedValueOnce([{ insertId: 10 }, []])
    const res = await request(createApp(hangoutsRoutes))
      .post('/api/hangouts')
      .set('Authorization', `Bearer ${authToken(2)}`)
      .send({
        category: 'cafe',
        title: 'Coffee in the center',
        event_date: new Date(Date.now() + 86_400_000).toISOString(),
        max_companions: 2,
      })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe(10)
  })

  it('emits hangout:new to feed room when a hangout is created', async () => {
    const feedEmit = vi.fn()
    const toMock = vi.fn(() => ({ emit: feedEmit }))
    vi.mocked(getIO).mockReturnValue({ to: toMock })

    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ cnt: 0 }], []])
      .mockResolvedValueOnce([{ insertId: 55 }, []])
    const res = await request(createApp(hangoutsRoutes))
      .post('/api/hangouts')
      .set('Authorization', `Bearer ${authToken(2)}`)
      .send({
        category: 'cafe',
        title: 'Feed live test',
        city: 'Moscow',
        hangout_type: 'company',
        event_date: new Date(Date.now() + 86_400_000).toISOString(),
        max_companions: 3,
      })
    expect(res.status).toBe(201)
    expect(toMock).toHaveBeenCalledWith('hangout:feed')
    expect(feedEmit).toHaveBeenCalledWith('hangout:new', expect.objectContaining({ hangoutId: 55, category: 'cafe', title: 'Feed live test', hangoutType: 'company' }))
    vi.mocked(getIO).mockReturnValue({ to: vi.fn(() => ({ emit: vi.fn() })) })
  })

  it('rejects second daily hangout for free user', async () => {
    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ cnt: 1 }], []])
    const res = await request(createApp(hangoutsRoutes))
      .post('/api/hangouts')
      .set('Authorization', `Bearer ${authToken(2)}`)
      .send({
        category: 'cafe',
        title: 'Second today',
        event_date: new Date(Date.now() + 86_400_000).toISOString(),
        max_companions: 2,
      })
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('HANGOUT_DAILY_LIMIT')
  })

  it('skips daily limit for premium subscriber', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 5 }], []])
      .mockResolvedValueOnce([{ insertId: 11 }, []])
    const res = await request(createApp(hangoutsRoutes))
      .post('/api/hangouts')
      .set('Authorization', `Bearer ${authToken(2)}`)
      .send({
        category: 'cafe',
        title: 'Premium plan',
        event_date: new Date(Date.now() + 86_400_000).toISOString(),
        max_companions: 2,
      })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe(11)
    const countCall = pool.query.mock.calls.find(([sql]) => sql.includes('COUNT(*) AS cnt'))
    expect(countCall).toBeUndefined()
  })

  it('rejects past event_date', async () => {
    const res = await request(createApp(hangoutsRoutes))
      .post('/api/hangouts')
      .set('Authorization', `Bearer ${authToken(2)}`)
      .send({ category: 'cafe', title: 'Old plan', event_date: '2020-01-01T10:00:00Z' })
    expect(res.status).toBe(400)
  })

  it('rejects max_companions out of range', async () => {
    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ cnt: 0 }], []])
    const res = await request(createApp(hangoutsRoutes))
      .post('/api/hangouts')
      .set('Authorization', `Bearer ${authToken(2)}`)
      .send({
        category: 'cafe',
        title: 'Too many',
        event_date: new Date(Date.now() + 86_400_000).toISOString(),
        max_companions: 11,
      })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('COMPANIONS_LIMIT')
  })

  it('rejects invalid category', async () => {
    const res = await request(createApp(hangoutsRoutes))
      .post('/api/hangouts')
      .set('Authorization', `Bearer ${authToken(2)}`)
      .send({ category: 'bank_robbery', title: 'X', event_date: new Date(Date.now() + 86_400_000).toISOString() })
    expect(res.status).toBe(400)
  })
})

describe('PUT /api/hangouts/:id', () => {
  it('forbids editing by non-author', async () => {
    pool.query
      .mockResolvedValueOnce([[{ user_id: 99, status: 'active' }], []])
    const res = await request(createApp(hangoutsRoutes))
      .put('/api/hangouts/1')
      .set('Authorization', `Bearer ${authToken(2)}`)
      .send({ title: 'Hack' })
    expect(res.status).toBe(403)
  })

  it('forbids editing non-active hangout', async () => {
    pool.query.mockResolvedValueOnce([[{ user_id: 2, status: 'completed' }], []])
    const res = await request(createApp(hangoutsRoutes))
      .put('/api/hangouts/1')
      .set('Authorization', `Bearer ${authToken(2)}`)
      .send({ title: 'New title' })
    expect(res.status).toBe(409)
  })

  it('updates title for author', async () => {
    pool.query
      .mockResolvedValueOnce([[{ user_id: 2, status: 'active' }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
    const res = await request(createApp(hangoutsRoutes))
      .put('/api/hangouts/1')
      .set('Authorization', `Bearer ${authToken(2)}`)
      .send({ title: 'Updated <b>title</b>' })
    expect(res.status).toBe(200)
    expect(pool.query.mock.calls[1][1]).toContain('Updated title')
  })
})

describe('DELETE /api/hangouts/:id', () => {
  it('soft-cancels own hangout', async () => {
    pool.query
      .mockResolvedValueOnce([[{ user_id: 2, status: 'active' }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[], []])
    const res = await request(createApp(hangoutsRoutes))
      .delete('/api/hangouts/5')
      .set('Authorization', `Bearer ${authToken(2)}`)
    expect(res.status).toBe(200)
    expect(res.body.message).toBe('Hangout cancelled')
    expect(pool.query.mock.calls[1][0]).toContain("status = 'cancelled'")
  })

  it('cancel inserts hangout_cancelled notification for respondents', async () => {
    pool.query
      .mockResolvedValueOnce([[{ user_id: 2, status: 'active' }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[{ user_id: 3 }], []])
      .mockResolvedValueOnce([{ insertId: 91 }, []])
      .mockResolvedValueOnce([[{ id: 91, type: 'hangout_cancelled', payload: '{}', is_read: 0, created_at: new Date() }], []])

    const res = await request(createApp(hangoutsRoutes))
      .delete('/api/hangouts/5')
      .set('Authorization', `Bearer ${authToken(2)}`)

    expect(res.status).toBe(200)
    const notifInsert = pool.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO notifications'))
    expect(notifInsert).toBeTruthy()
    expect(notifInsert[1][0]).toBe(3)
    expect(notifInsert[1][1]).toBe('hangout_cancelled')
  })
})

describe('POST /api/hangouts/:id/respond', () => {
  function respond(app, body = {}) {
    return request(app)
      .post('/api/hangouts/7/respond')
      .set('Authorization', `Bearer ${authToken(3)}`)
      .send({ message: 'Take me!', ...body })
  }

  it('rejects respond to own hangout', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 7, user_id: 3, status: 'active', title: 'T' }], []])
    const res = await respond(createApp(hangoutsRoutes))
    expect(res.status).toBe(400)
  })

  it('returns 409 on duplicate response (uq_hangout_user)', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 7, user_id: 1, status: 'active', title: 'T' }], []])
      .mockRejectedValueOnce(Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' }))
    const res = await respond(createApp(hangoutsRoutes))
    expect(res.status).toBe(409)
  })

  it('rejects respond on non-active hangout', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 7, user_id: 1, status: 'blocked', title: 'T' }], []])
    const res = await respond(createApp(hangoutsRoutes))
    expect(res.status).toBe(409)
  })

  it('creates pending response and notifies author', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 7, user_id: 1, status: 'active', title: 'Dune' }], []])
      .mockResolvedValueOnce([{ insertId: 55 }, []])
      .mockResolvedValueOnce([[{ display_name: 'Anna' }], []])
      .mockResolvedValueOnce([{ insertId: 77 }, []])
      .mockResolvedValueOnce([[{ id: 77, type: 'hangout_response', payload: '{}', created_at: new Date() }], []])
    const res = await respond(createApp(hangoutsRoutes))
    expect(res.status).toBe(201)
    expect(res.body.id).toBe(55)
  })

  it('returns PAYMENT_REQUIRED for paid hangout without ticket', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 7, user_id: 1, status: 'active', title: 'Gala', price: 500.0, capacity: 5, max_companions: 1, hangout_type: 'date' }], []])
      .mockResolvedValueOnce([[], []])
    const res = await respond(createApp(hangoutsRoutes))
    expect(res.status).toBe(402)
    expect(res.body.message).toBe('PAYMENT_REQUIRED')
  })

  it('returns CAPACITY_FULL when sold out', async () => {
    const paidHangout = { id: 7, user_id: 1, status: 'active', title: 'Gala', price: 500.0, capacity: 2, max_companions: 1, hangout_type: 'date' }
    pool.query
      .mockResolvedValueOnce([[paidHangout], []])
      .mockResolvedValueOnce([[{ status: 'paid' }], []])
      .mockResolvedValueOnce([[{ cnt: 2 }], []])
      .mockResolvedValueOnce([[{ cnt: 1 }], []])
    const res = await respond(createApp(hangoutsRoutes))
    expect(res.status).toBe(409)
    expect(res.body.message).toBe('CAPACITY_FULL')
  })

  it('allows respond when paid ticket exists and capacity available', async () => {
    const paidHangout = { id: 7, user_id: 1, status: 'active', title: 'Gala', price: 500.0, capacity: 5, max_companions: 1, hangout_type: 'date' }
    pool.query
      .mockResolvedValueOnce([[paidHangout], []])
      .mockResolvedValueOnce([[{ status: 'paid' }], []])
      .mockResolvedValueOnce([[{ cnt: 1 }], []])
      .mockResolvedValueOnce([[{ cnt: 0 }], []])
      .mockResolvedValueOnce([{ insertId: 55 }, []])
      .mockResolvedValueOnce([[{ display_name: 'Anna' }], []])
      .mockResolvedValueOnce([{ insertId: 77 }, []])
      .mockResolvedValueOnce([[{ id: 77, type: 'hangout_response', payload: '{}', created_at: new Date() }], []])

    const res = await respond(createApp(hangoutsRoutes))
    expect(res.status).toBe(201)
    expect(res.body.id).toBe(55)
  })
})

describe('POST /api/hangouts/:id/purchase (ticket checkout)', () => {
  it('requires auth', async () => {
    const res = await request(createApp(hangoutsRoutes)).post('/api/hangouts/7/purchase')
    expect(res.status).toBe(401)
  })

  it('rejects free hangout purchase', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 7, user_id: 1, status: 'active', title: 'T', price: 0, capacity: null, max_companions: 1, hangout_type: 'date' }], []])
    const res = await request(createApp(hangoutsRoutes))
      .post('/api/hangouts/7/purchase')
      .set('Authorization', `Bearer ${authToken(2)}`)
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('This hangout is free')
  })

  it('mocks immediate paid ticket when STRIPE_SECRET_KEY is absent', async () => {
    delete process.env.STRIPE_SECRET_KEY
    pool.query
      .mockResolvedValueOnce([[{ id: 7, user_id: 1, status: 'active', title: 'Gala', price: 500.0, capacity: 5, max_companions: 1, hangout_type: 'date' }], []])
      .mockResolvedValueOnce([[{ cnt: 0 }], []])
    const res = await request(createApp(hangoutsRoutes))
      .post('/api/hangouts/7/purchase')
      .set('Authorization', `Bearer ${authToken(2)}`)
    expect(res.status).toBe(201)
    expect(res.body.paid).toBe(true)
    expect(res.body.mock).toBe(true)
    const insertCall = pool.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO hangout_tickets'))
    expect(insertCall).toBeTruthy()
  })

  it('returns CAPACITY_FULL when tickets exceed capacity', async () => {
    delete process.env.STRIPE_SECRET_KEY
    pool.query
      .mockResolvedValueOnce([[{ id: 7, user_id: 1, status: 'active', title: 'Gala', price: 500.0, capacity: 2, max_companions: 1, hangout_type: 'date' }], []])
      .mockResolvedValueOnce([[{ cnt: 2 }], []])
    const res = await request(createApp(hangoutsRoutes))
      .post('/api/hangouts/7/purchase')
      .set('Authorization', `Bearer ${authToken(2)}`)
    expect(res.status).toBe(409)
    expect(res.body.message).toBe('CAPACITY_FULL')
  })
})

describe('GET /api/hangouts/:id/responses', () => {
  it('forbids responses list for non-author', async () => {
    pool.query.mockResolvedValueOnce([[{ user_id: 42 }], []])
    const res = await request(createApp(hangoutsRoutes))
      .get('/api/hangouts/7/responses')
      .set('Authorization', `Bearer ${authToken(3)}`)
    expect(res.status).toBe(403)
  })
})

describe('PUT /api/hangouts/:id/responses/:responseId (accept/decline)', () => {
  it('accept creates chat + participants + hangout_chats link', async () => {
    pool.query
      .mockResolvedValueOnce([{ insertId: 88 }, []])
      .mockResolvedValueOnce([[{ id: 88, type: 'hangout_accepted', payload: '{}', is_read: 0, created_at: new Date() }], []])
      .mockResolvedValueOnce([[{ display_name: 'Author' }], []])
    const conn = mockConnection({
      execute: vi.fn(async (sql) => {
        if (sql.startsWith('SELECT id, user_id, status')) return [[{ id: 7, user_id: 1, status: 'active', max_companions: 1 }], []]
        if (sql.startsWith('SELECT id, user_id, status FROM hangout_responses')) return [[{ id: 9, user_id: 3, status: 'pending' }], []]
        if (sql.includes('COUNT(*) AS cnt FROM hangout_responses')) return [[{ cnt: 0 }], []]
        if (sql.startsWith('INSERT INTO chats')) return [{ insertId: 123 }, []]
        if (sql.startsWith('INSERT INTO chat_participants')) return [{ insertId: 0 }, []]
        if (sql.startsWith('INSERT IGNORE INTO hangout_chats')) return [{ insertId: 0 }, []]
        if (sql.startsWith('UPDATE hangout_responses')) return [{ affectedRows: 1 }, []]
        if (sql.includes('COUNT(*) AS cntAccepted')) return [[{ cntAccepted: 1 }], []]
        if (sql.startsWith("UPDATE hangouts SET status")) return [{ affectedRows: 1 }, []]
        return [[], []]
      }),
      query: vi.fn(async (sql) => {
        if (sql.includes('FROM chats c') && sql.includes('cp1')) return [[], []]
        return [[], []]
      }),
    })

    const res = await request(createApp(hangoutsRoutes))
      .put('/api/hangouts/7/responses/9')
      .set('Authorization', `Bearer ${authToken(1)}`)
      .send({ status: 'accepted' })

    expect(res.status).toBe(200)
    expect(res.body.chat_id).toBe(123)

    const executedInsertChats = conn.execute.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO chats'))
    const executedParticipants = conn.execute.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO chat_participants'))
    const executedLink = conn.execute.mock.calls.some(([sql]) => sql.startsWith('INSERT IGNORE INTO hangout_chats'))
    const completedUpdate = conn.execute.mock.calls.some(([sql]) => sql.includes("'completed'"))
    expect(executedInsertChats).toBe(true)
    expect(executedParticipants).toBe(true)
    expect(executedLink).toBe(true)
    expect(completedUpdate).toBe(true)

    const notifCall = pool.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO notifications'))
    expect(notifCall).toBeTruthy()
    expect(notifCall[1][1]).toBe('hangout_accepted')
  })

  it('declines without creating a chat', async () => {
    mockConnection({
      execute: vi.fn(async (sql) => {
        if (sql.startsWith('SELECT id, user_id, status')) return [[{ id: 7, user_id: 1, status: 'active', max_companions: 1 }], []]
        if (sql.startsWith('SELECT id, user_id, status FROM hangout_responses')) return [[{ id: 9, user_id: 3, status: 'pending' }], []]
        if (sql.startsWith('UPDATE hangout_responses')) return [{ affectedRows: 1 }, []]
        return [[], []]
      }),
      query: vi.fn(async () => [[], []]),
    })

    const res = await request(createApp(hangoutsRoutes))
      .put('/api/hangouts/7/responses/9')
      .set('Authorization', `Bearer ${authToken(1)}`)
      .send({ status: 'declined' })

    expect(res.status).toBe(200)
    expect(res.body.chat_id).toBeNull()
  })

  it('validates status value', async () => {
    const res = await request(createApp(hangoutsRoutes))
      .put('/api/hangouts/7/responses/9')
      .set('Authorization', `Bearer ${authToken(1)}`)
      .send({ status: 'maybe' })
    expect(res.status).toBe(400)
  })
})

describe('My listings & responses', () => {
  it('GET /api/hangouts/my returns own listings', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 1 }], []])
    const res = await request(createApp(hangoutsRoutes))
      .get('/api/hangouts/my')
      .set('Authorization', `Bearer ${authToken(2)}`)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
  })

  it('GET /api/hangouts/responses/my returns my responses', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 9, response_status: 'pending' }], []])
    const res = await request(createApp(hangoutsRoutes))
      .get('/api/hangouts/responses/my')
      .set('Authorization', `Bearer ${authToken(3)}`)
    expect(res.status).toBe(200)
    expect(res.body[0].response_status).toBe('pending')
  })

  it('DELETE /api/hangouts/:id/respond cancels own response', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }, []])
    const res = await request(createApp(hangoutsRoutes))
      .delete('/api/hangouts/7/respond')
      .set('Authorization', `Bearer ${authToken(3)}`)
    expect(res.status).toBe(200)
  })
})

describe('Admin moderation', () => {
  const adminApp = createAdminApp(adminHangouts)

  it('blocks a hangout', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }, []])
    const res = await request(adminApp)
      .put('/api/admin/hangouts/7')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ status: 'blocked' })
    expect(res.status).toBe(200)
    expect(pool.query.mock.calls[0]).toEqual(
      expect.arrayContaining(["UPDATE hangouts SET status = ? WHERE id = ?"]),
    )
  })

  it('filtered GET returns blocked hangout after block', async () => {
    pool.query
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[{ id: 7, status: 'blocked' }], []])

    await request(adminApp)
      .put('/api/admin/hangouts/7')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ status: 'blocked' })

    const res = await request(adminApp)
      .get('/api/admin/hangouts?status=blocked')
      .set('Authorization', `Bearer ${adminToken()}`)

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body[0].status).toBe('blocked')
  })

  it('rejects invalid status', async () => {
    const res = await request(adminApp)
      .put('/api/admin/hangouts/7')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ status: 'deleted' })
    expect(res.status).toBe(400)
  })

  it('returns array on DB error (not object)', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await request(adminApp)
      .get('/api/admin/hangouts')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })
})

describe('GET /api/hangouts/by-chat/:chatId', () => {
  it('returns hangout context for chat participant', async () => {
    pool.query
      .mockResolvedValueOnce([[{ ok: 1 }], []])
      .mockResolvedValueOnce([[{ id: 5, title: 'Dune 2', category: 'cinema', status: 'active', event_date: new Date() }], []])

    const res = await request(createApp(hangoutsRoutes))
      .get('/api/hangouts/by-chat/123')
      .set('Authorization', `Bearer ${authToken(2)}`)

    expect(res.status).toBe(200)
    expect(res.body.title).toBe('Dune 2')
  })

  it('returns null when chat has no linked hangout', async () => {
    pool.query
      .mockResolvedValueOnce([[{ ok: 1 }], []])
      .mockResolvedValueOnce([[], []])

    const res = await request(createApp(hangoutsRoutes))
      .get('/api/hangouts/by-chat/123')
      .set('Authorization', `Bearer ${authToken(2)}`)

    expect(res.status).toBe(200)
    expect(res.body).toBeNull()
  })

  it('rejects non-participant with 403', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(createApp(hangoutsRoutes))
      .get('/api/hangouts/by-chat/123')
      .set('Authorization', `Bearer ${authToken(3)}`)
    expect(res.status).toBe(403)
  })

  it('rejects invalid chatId with 400', async () => {
    const res = await request(createApp(hangoutsRoutes))
      .get('/api/hangouts/by-chat/abc')
      .set('Authorization', `Bearer ${authToken(2)}`)
    expect(res.status).toBe(400)
  })
})

describe('Boost / unboost (premium perk)', () => {
  it('requires auth', async () => {
    const res = await request(createApp(hangoutsRoutes)).post('/api/hangouts/1/boost')
    expect(res.status).toBe(401)
  })

  it('forbids boost by non-author', async () => {
    pool.query.mockResolvedValueOnce([[{ user_id: 99, status: 'active' }], []])
    const res = await request(createApp(hangoutsRoutes))
      .post('/api/hangouts/1/boost')
      .set('Authorization', `Bearer ${authToken(2)}`)
    expect(res.status).toBe(403)
  })

  it('rejects boost for free user with PREMIUM_REQUIRED', async () => {
    pool.query
      .mockResolvedValueOnce([[{ user_id: 2, status: 'active' }], []])
      .mockResolvedValueOnce([[], []])
    const res = await request(createApp(hangoutsRoutes))
      .post('/api/hangouts/1/boost')
      .set('Authorization', `Bearer ${authToken(2)}`)
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('PREMIUM_REQUIRED')
  })

  it('limits to 1 boosted hangout at a time', async () => {
    pool.query
      .mockResolvedValueOnce([[{ user_id: 2, status: 'active' }], []])
      .mockResolvedValueOnce([[{ id: 5 }], []])
      .mockResolvedValueOnce([[{ cnt: 1 }], []])
    const res = await request(createApp(hangoutsRoutes))
      .post('/api/hangouts/1/boost')
      .set('Authorization', `Bearer ${authToken(2)}`)
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('BOOST_LIMIT')
  })

  it('boosts own hangout for premium user', async () => {
    pool.query
      .mockResolvedValueOnce([[{ user_id: 2, status: 'active' }], []])
      .mockResolvedValueOnce([[{ id: 5 }], []])
      .mockResolvedValueOnce([[{ cnt: 0 }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
    const res = await request(createApp(hangoutsRoutes))
      .post('/api/hangouts/1/boost')
      .set('Authorization', `Bearer ${authToken(2)}`)
    expect(res.status).toBe(200)
    expect(res.body.boosted).toBe(true)
  })

  it('unboosts own hangout', async () => {
    pool.query
      .mockResolvedValueOnce([[{ user_id: 2 }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
    const res = await request(createApp(hangoutsRoutes))
      .post('/api/hangouts/1/unboost')
      .set('Authorization', `Bearer ${authToken(2)}`)
    expect(res.status).toBe(200)
    expect(res.body.boosted).toBe(false)
  })
})
