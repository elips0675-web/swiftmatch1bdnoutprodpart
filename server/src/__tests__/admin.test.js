import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
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
import adminDashboard from '../routes/admin/dashboard.js'
import adminUsers from '../routes/admin/users.js'
import adminFeatures from '../routes/admin/features.js'
import adminAnalytics from '../routes/admin/analytics.js'
import adminMonetization from '../routes/admin/monetization.js'
import adminContent from '../routes/admin/content.js'
import adminReports from '../routes/admin/reports.js'
import adminMessaging from '../routes/admin/messaging.js'

const JWT_SECRET = 'change-me-in-production'

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

function adminToken() {
  return jwt.sign({ userId: 1, id: 1, role: 'admin' }, JWT_SECRET, { expiresIn: '1h' })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/admin/stats (dashboard)', () => {
  const app = createAdminApp(adminDashboard)

  it('returns dashboard stats', async () => {
    pool.query
      .mockResolvedValueOnce([[{ total: 100 }], []])
      .mockResolvedValueOnce([[{ activeToday: 10 }], []])
      .mockResolvedValueOnce([[{ totalMatches: 5 }], []])
      .mockResolvedValueOnce([[{ revenue: 200 }], []])
      .mockResolvedValueOnce([[{ activeSubs: 20 }], []])
      .mockResolvedValueOnce([[{ newToday: 30 }], []])

    const res = await request(app)
      .get('/api/admin/stats')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('totalUsers')
    expect(res.body).toHaveProperty('newToday')
    expect(res.body).toHaveProperty('activeToday')
    expect(res.body).toHaveProperty('activeSubs')
    expect(res.body).toHaveProperty('totalMatches')
  })

  it('handles database error', async () => {
    pool.query.mockRejectedValue(new Error('DB error'))
    const res = await request(app)
      .get('/api/admin/stats')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(500)
  })
})

describe('GET /api/admin/users (admin users route)', () => {
  const app = createAdminApp(adminUsers)

  it('returns user list', async () => {
    pool.query
      .mockResolvedValueOnce([[{ total: 1 }], []])
      .mockResolvedValueOnce([[{ id: 1, email: 'test@test.com', role: 'user' }], []])
      .mockResolvedValueOnce([[{ cities: '["Moscow","SPb"]' }], []])
    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('users')
    expect(res.body.users).toHaveLength(1)
    expect(res.body).toHaveProperty('total')
  })

  it('filters the list by plan (premium=plus)', async () => {
    pool.query
      .mockResolvedValueOnce([[{ total: 0 }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ cities: '[]' }], []])
    const res = await request(app)
      .get('/api/admin/users?premium=plus')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(200)
    const [countSql, countParams] = pool.query.mock.calls[0]
    expect(countSql).toContain("FROM subscriptions s WHERE s.user_id = u.id AND s.is_active = 1 AND s.expires_at > NOW() LIMIT 1), 'free') = ?")
    expect(countParams).toEqual(['plus'])
    const [listSql, listParams] = pool.query.mock.calls[1]
    expect(listSql).toContain("), 'free') = ?")
    expect(listParams.slice(-3)).toEqual(['plus', 15, 0])
  })

  it('ignores the plan filter when premium=all', async () => {
    pool.query
      .mockResolvedValueOnce([[{ total: 1 }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ cities: '[]' }], []])
    const res = await request(app)
      .get('/api/admin/users?premium=all')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(200)
    expect(pool.query.mock.calls[0][0]).toContain('WHERE 1=1')
    expect(pool.query.mock.calls[0][1]).toEqual([])
  })

  it('handles database error', async () => {
    pool.query.mockRejectedValue(new Error('DB error'))
    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(500)
  })
})

describe('GET /api/admin/features', () => {
  const app = createAdminApp(adminFeatures)

  it('returns feature flags as object', async () => {
    pool.query.mockResolvedValue([[{ id: 1, video_calls_enabled: 1, ai_icebreakers_enabled: 1, ai_compatibility_enabled: 1, groups_page_enabled: 1, contest_enabled: 1, show_ads: 0, autosearch_enabled: 1 }], []])
    const res = await request(app)
      .get('/api/admin/features')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(200)
    expect(typeof res.body).toBe('object')
    expect(res.body).toHaveProperty('videoCalls')
    expect(res.body).toHaveProperty('aiIcebreakers')
  })

  it('profileActivity трактуется как «включено», если колонки ещё нет (миграция не применена)', async () => {
    pool.query.mockResolvedValue([[{ id: 1, video_calls_enabled: 1 }], []])
    const res = await request(app)
      .get('/api/admin/features')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.profileActivity).toBe(true)
  })

  it('profileActivity отражает колонку profile_activity_enabled', async () => {
    pool.query.mockResolvedValue([[{ id: 1, profile_activity_enabled: 0 }], []])
    const res = await request(app)
      .get('/api/admin/features')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.profileActivity).toBe(false)
  })

  it('returns defaults when no row', async () => {
    pool.query.mockResolvedValue([[], []])
    const res = await request(app)
      .get('/api/admin/features')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.videoCalls).toBe(true)
  })

  it('handles database error', async () => {
    pool.query.mockRejectedValue(new Error('DB error'))
    const res = await request(app)
      .get('/api/admin/features')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(500)
  })
})

describe('PUT /api/admin/features', () => {
  const app = createAdminApp(adminFeatures)

  it('requires at least one known flag key', async () => {
    const res = await request(app)
      .put('/api/admin/features')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({})
    expect(res.status).toBe(400)
  })

  it('updates features', async () => {
    pool.query
      .mockResolvedValueOnce([[], []])
    const res = await request(app)
      .put('/api/admin/features')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ videoCalls: true, aiIcebreakers: false })
    expect(res.status).toBe(200)
  })

  it('принимает profileActivity и пишет profile_activity_enabled', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(app)
      .put('/api/admin/features')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ profileActivity: false })
    expect(res.status).toBe(200)
    const updateCall = pool.query.mock.calls.find(([sql]) => /profile_activity_enabled/.test(sql))
    expect(updateCall).toBeTruthy()
    expect(updateCall[1][9]).toBe(false)
  })
})

describe('GET /api/admin/analytics/overview', () => {
  const app = createAdminApp(adminAnalytics)

  it('returns analytics overview', async () => {
    pool.query
      .mockResolvedValueOnce([[{ total: 100 }], []])
      .mockResolvedValueOnce([[{ premium: 5 }], []])

    const res = await request(app)
      .get('/api/admin/analytics/overview')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('mau')
    expect(res.body).toHaveProperty('conversionRate')
    expect(res.body).toHaveProperty('arpu')
  })
})

describe('GET /api/admin/analytics/registrations', () => {
  const app = createAdminApp(adminAnalytics)

  it('returns registration data', async () => {
    pool.query.mockResolvedValue([[{ day: '2024-01-01', users: 5 }], []])
    const res = await request(app)
      .get('/api/admin/analytics/registrations')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })
})

describe('GET /api/admin/monetization/revenue', () => {
  const app = createAdminApp(adminMonetization)

  it('returns revenue data', async () => {
    pool.query
      .mockResolvedValueOnce([[], []])

    const res = await request(app)
      .get('/api/admin/monetization/revenue')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(200)
  })
})

describe('GET /api/admin/content', () => {
  const app = createAdminApp(adminContent)

  it('returns content config', async () => {
    pool.query.mockResolvedValueOnce([[{
      id: 1, interests: '["interest.sport","interest.music"]',
      dating_goals: '["goal.serious_relationship"]',
      education: '["education.higher"]',
      banned_words: '["badword"]',
    }], []])
      .mockResolvedValueOnce([[{ city: 'Moscow' }, { city: 'SPb' }], []])

    const res = await request(app).get('/api/admin/content')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('interests')
    expect(res.body).toHaveProperty('cities')
    expect(res.body.cities).toContain('Moscow')
  })

  it('handles database error', async () => {
    pool.query.mockRejectedValue(new Error('DB error'))
    const res = await request(app).get('/api/admin/content')
    expect(res.status).toBe(500)
  })
})

describe('PUT /api/admin/content/:section', () => {
  const app = createAdminApp(adminContent)

  it('validates section param', async () => {
    const res = await request(app)
      .put('/api/admin/content/invalid')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(400)
  })

  it('requires items in body', async () => {
    pool.query.mockResolvedValue([[{ id: 1, interests: '[]', dating_goals: '[]', education: '[]', banned_words: '[]' }], []])
    const res = await request(app)
      .put('/api/admin/content/interests')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ items: ['interest.sport'] })
    expect(res.status).toBe(200)
  })

  it('handles database error', async () => {
    pool.query.mockRejectedValue(new Error('DB error'))
    const res = await request(app)
      .put('/api/admin/content/interests')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ items: [] })
    expect(res.status).toBe(500)
  })
})

describe('GET /api/admin/reports', () => {
  const app = createAdminApp(adminReports)

  it('returns reports list', async () => {
    pool.query.mockResolvedValueOnce([[{
      id: 1, reason: 'spam', description: 'Spammy', status: 'pending',
      date: '2024-01-01', reporterName: 'Alice', reportedUserName: 'Bob', evidence: null,
    }], []])

    const res = await request(app).get('/api/admin/reports')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body[0]).toHaveProperty('reporterName')
  })

  it('handles database error', async () => {
    pool.query.mockRejectedValue(new Error('DB error'))
    const res = await request(app).get('/api/admin/reports')
    expect(res.status).toBe(500)
  })
})

describe('POST /api/admin/reports/:id/status', () => {
  const app = createAdminApp(adminReports)

  it('validates status', async () => {
    const res = await request(app)
      .post('/api/admin/reports/1/status')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ status: 'invalid' })
    expect(res.status).toBe(400)
  })

  it('updates report status to reviewed', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(app)
      .post('/api/admin/reports/1/status')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ status: 'reviewed' })
    expect(res.status).toBe(200)
  })

  it('bans user when action_taken', async () => {
    pool.query
      .mockResolvedValueOnce([[], []])         // UPDATE reports
      .mockResolvedValueOnce([[{ reported_id: 5 }], []]) // SELECT reported_id
      .mockResolvedValueOnce([[], []])          // UPDATE users
      .mockResolvedValueOnce([[], []])          // INSERT moderation_log

    const res = await request(app)
      .post('/api/admin/reports/1/status')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ status: 'action_taken' })
    expect(res.status).toBe(200)
  })

  it('handles database error', async () => {
    pool.query.mockRejectedValue(new Error('DB error'))
    const res = await request(app)
      .post('/api/admin/reports/1/status')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ status: 'reviewed' })
    expect(res.status).toBe(500)
  })
})

describe('GET /api/admin/moderation-log', () => {
  const app = createAdminApp(adminReports)

  it('returns moderation log', async () => {
    pool.query.mockResolvedValueOnce([[{
      id: 1, date: '2024-01-01', admin: 'Admin', action: 'banned', targetUser: 'Bob', reason: 'Spam',
    }], []])

    const res = await request(app).get('/api/admin/moderation-log')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('handles database error', async () => {
    pool.query.mockRejectedValue(new Error('DB error'))
    const res = await request(app).get('/api/admin/moderation-log')
    expect(res.status).toBe(500)
  })
})

describe('GET /api/admin/campaigns', () => {
  const app = createAdminApp(adminMessaging)

  it('returns campaign list', async () => {
    pool.query.mockResolvedValueOnce([[{
      id: 1, title: 'Welcome', body: 'Hello!', target: 'all', channel: 'push',
      status: 'sent', sentAt: '2024-01-01', delivered: 10, opened: 5, clicked: 2,
    }], []])

    const res = await request(app).get('/api/admin/campaigns')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('handles database error', async () => {
    pool.query.mockRejectedValue(new Error('DB error'))
    const res = await request(app).get('/api/admin/campaigns')
    expect(res.status).toBe(500)
  })
})

describe('POST /api/admin/campaigns', () => {
  const app = createAdminApp(adminMessaging)

  it('validates title and body', async () => {
    const res = await request(app)
      .post('/api/admin/campaigns')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ title: '' })
    expect(res.status).toBe(400)
  })

  it('creates campaign', async () => {
    pool.query.mockResolvedValueOnce([{ insertId: 42 }, []])
    const res = await request(app)
      .post('/api/admin/campaigns')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ title: 'Sale', body: 'Big sale!' })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe(42)
  })

  it('handles database error', async () => {
    pool.query.mockRejectedValue(new Error('DB error'))
    const res = await request(app)
      .post('/api/admin/campaigns')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ title: 'Sale', body: 'Big sale!' })
    expect(res.status).toBe(500)
  })
})
