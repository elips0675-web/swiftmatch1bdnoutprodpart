import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../db.js', () => ({
  default: { query: vi.fn(), execute: vi.fn() },
}))

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import pool from '../db.js'
import reportsRoutes from '../routes/admin/reports.js'

/** Мини-гейт как в проде: подставляет req.admin (id + teams) и req.userId.
 *  `undefined` — admin вообще не выставлен (проверка optional-chain). */
function createApp(admin = { id: 9, teams: [] }) {
  const app = express()
  app.use(express.json())
  app.use((req, res, next) => {
    if (admin !== undefined) {
      req.admin = admin
      req.userId = admin.id
    }
    next()
  })
  app.use('/api/admin', reportsRoutes)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/admin/reports', () => {
  it('без команд модератора — запрос без WHERE и строки как есть', async () => {
    const rows = [{ id: 1, reason: 'spam', teamId: null }]
    pool.query.mockResolvedValueOnce([rows])
    const res = await request(createApp()).get('/api/admin/reports')
    expect(res.status).toBe(200)
    expect(res.body).toEqual(rows)
    const [sql, params] = pool.query.mock.calls[0]
    expect(sql).not.toContain('WHERE r.team_id IN (?)')
    expect(params).toEqual([])
  })

  it('с командами — запрос скоупится по team_id', async () => {
    pool.query.mockResolvedValueOnce([[]])
    const res = await request(createApp({ id: 9, teams: [3, 4] })).get('/api/admin/reports')
    expect(res.status).toBe(200)
    const [sql, params] = pool.query.mock.calls[0]
    expect(sql).toContain('WHERE r.team_id IN (?)')
    expect(params).toEqual([[3, 4]])
  })

  it('admin.teams не массив — трактуется как «без скоупа»', async () => {
    pool.query.mockResolvedValueOnce([[]])
    await request(createApp({ id: 9, teams: 'oops' })).get('/api/admin/reports')
    const [sql, params] = pool.query.mock.calls[0]
    expect(sql).not.toContain('WHERE r.team_id IN (?)')
    expect(params).toEqual([])
  })

  it('req.admin отсутствует — трактуется как «без скоупа» (optional-chain)', async () => {
    pool.query.mockResolvedValueOnce([[]])
    await request(createApp(undefined)).get('/api/admin/reports')
    const [sql, params] = pool.query.mock.calls[0]
    expect(sql).not.toContain('WHERE r.team_id IN (?)')
    expect(params).toEqual([])
  })

  it('падение БД — 500 с сообщением', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp()).get('/api/admin/reports')
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to fetch reports')
  })
})

describe('POST /api/admin/reports/:id/status', () => {
  it('недопустимый статус — 400 без обращения к БД', async () => {
    const res = await request(createApp()).post('/api/admin/reports/5/status').send({ status: 'nope' })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Invalid status')
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('без команд — простое обновление статуса', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }])
    const res = await request(createApp()).post('/api/admin/reports/5/status').send({ status: 'reviewed' })
    expect(res.status).toBe(200)
    expect(res.body.message).toBe('Report #5 marked as reviewed')
    expect(pool.query).toHaveBeenCalledTimes(1)
    expect(pool.query.mock.calls[0][1]).toEqual(['reviewed', '5'])
  })

  it('с командами — жалоба не найдена → 404', async () => {
    pool.query.mockResolvedValueOnce([[]])
    const res = await request(createApp({ id: 9, teams: [3] }))
      .post('/api/admin/reports/5/status')
      .send({ status: 'reviewed' })
    expect(res.status).toBe(404)
    expect(res.body.message).toBe('Report not found')
  })

  it('с командами — жалоба вне скоупа → 403 REPORT_OUT_OF_SCOPE (IDOR закрыт)', async () => {
    pool.query.mockResolvedValueOnce([[{ team_id: 7 }]])
    const res = await request(createApp({ id: 9, teams: [3] }))
      .post('/api/admin/reports/5/status')
      .send({ status: 'reviewed' })
    expect(res.status).toBe(403)
    expect(res.body.message).toBe('REPORT_OUT_OF_SCOPE')
    expect(pool.query).toHaveBeenCalledTimes(1)
  })

  it('с командами — жалоба без team_id вне скоупа → 403', async () => {
    pool.query.mockResolvedValueOnce([[{ team_id: null }]])
    const res = await request(createApp({ id: 9, teams: [3] }))
      .post('/api/admin/reports/5/status')
      .send({ status: 'reviewed' })
    expect(res.status).toBe(403)
  })

  it('с командами — жалоба в скоупе обновляется', async () => {
    pool.query
      .mockResolvedValueOnce([[{ team_id: 3 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
    const res = await request(createApp({ id: 9, teams: [3] }))
      .post('/api/admin/reports/5/status')
      .send({ status: 'dismissed' })
    expect(res.status).toBe(200)
    expect(pool.query).toHaveBeenCalledTimes(2)
  })

  it('action_taken — бан пользователя и запись в moderation_log', async () => {
    pool.query
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ reported_id: 77 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
    const res = await request(createApp()).post('/api/admin/reports/5/status').send({ status: 'action_taken' })
    expect(res.status).toBe(200)
    const calls = pool.query.mock.calls
    expect(calls[2][0]).toContain('UPDATE users SET is_active = 0')
    expect(calls[2][1]).toEqual([77])
    expect(calls[3][0]).toContain('INSERT INTO moderation_log')
    expect(calls[3][1]).toEqual([9, 77, 'banned', 'Automatic ban from report'])
  })

  it('action_taken — жалоба исчезла между запросами — бан не выполняется', async () => {
    pool.query
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[]])
    const res = await request(createApp()).post('/api/admin/reports/5/status').send({ status: 'action_taken' })
    expect(res.status).toBe(200)
    expect(pool.query).toHaveBeenCalledTimes(2)
  })

  it('падение БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp()).post('/api/admin/reports/5/status').send({ status: 'reviewed' })
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to update report')
  })
})

describe('GET /api/admin/moderation-log', () => {
  it('отдаёт строки как есть', async () => {
    const rows = [{ id: 1, action: 'banned' }]
    pool.query.mockResolvedValueOnce([rows])
    const res = await request(createApp()).get('/api/admin/moderation-log')
    expect(res.status).toBe(200)
    expect(res.body).toEqual(rows)
  })

  it('падение БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp()).get('/api/admin/moderation-log')
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to fetch moderation log')
  })
})

describe('GET /api/admin/verifications', () => {
  it('отдаёт ожидающие проверки как есть', async () => {
    const rows = [{ id: 1, status: 'pending' }]
    pool.query.mockResolvedValueOnce([rows])
    const res = await request(createApp()).get('/api/admin/verifications')
    expect(res.status).toBe(200)
    expect(res.body).toEqual(rows)
  })

  it('падение БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp()).get('/api/admin/verifications')
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to fetch verifications')
  })
})

describe('PUT /api/admin/verifications/:id', () => {
  it('нечисловой id — 400 без БД', async () => {
    const res = await request(createApp()).put('/api/admin/verifications/abc').send({ status: 'verified' })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Invalid id')
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('недопустимый статус — 400 без БД', async () => {
    const res = await request(createApp()).put('/api/admin/verifications/5').send({ status: 'pending' })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('status must be verified or rejected')
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('нет строки — 404', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 0 }])
    const res = await request(createApp()).put('/api/admin/verifications/5').send({ status: 'rejected' })
    expect(res.status).toBe(404)
    expect(res.body.message).toBe('Verification not found')
  })

  it('rejected — без простановки photo_verified', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }])
    const res = await request(createApp()).put('/api/admin/verifications/5').send({ status: 'rejected' })
    expect(res.status).toBe(200)
    expect(res.body.message).toBe('Verification rejected')
    expect(pool.query).toHaveBeenCalledTimes(1)
  })

  it('verified — проставляет photo_verified пользователю', async () => {
    pool.query
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ user_id: 42 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
    const res = await request(createApp()).put('/api/admin/verifications/5').send({ status: 'verified' })
    expect(res.status).toBe(200)
    expect(pool.query.mock.calls[2][0]).toContain('UPDATE user_profiles SET photo_verified = 1')
    expect(pool.query.mock.calls[2][1]).toEqual([42])
  })

  it('verified — запись исчезла между запросами — профиль не трогается', async () => {
    pool.query
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[]])
    const res = await request(createApp()).put('/api/admin/verifications/5').send({ status: 'verified' })
    expect(res.status).toBe(200)
    expect(pool.query).toHaveBeenCalledTimes(2)
  })

  it('admin_note отсутствует — пишется null, reviewed_by из req.userId', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }])
    await request(createApp({ id: 9, teams: [] })).put('/api/admin/verifications/5').send({ status: 'rejected' })
    expect(pool.query.mock.calls[0][1]).toEqual(['rejected', null, 9, '5'])
  })

  it('без тела запроса — admin_note null (req.body || {})', async () => {
    const res = await request(createApp()).put('/api/admin/verifications/5')
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('status must be verified or rejected')
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('req.userId отсутствует — reviewed_by null', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }])
    await request(createApp({ teams: [] })).put('/api/admin/verifications/5').send({ status: 'rejected' })
    expect(pool.query.mock.calls[0][1]).toEqual(['rejected', null, null, '5'])
  })

  it('падение БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp()).put('/api/admin/verifications/5').send({ status: 'rejected' })
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to update verification')
  })
})
