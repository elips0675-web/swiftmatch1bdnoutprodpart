import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}))

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('../middleware.js', () => ({
  auth: (req, res, next) => { req.userId = 1; next() },
  optionalAuth: (req, res, next) => { req.userId = 1; next() },
  verifyToken: vi.fn(),
}))

vi.mock('../audit.js', () => ({ auditLog: vi.fn() }))

import pool from '../db.js'
import { adminAuth } from '../middleware/adminAuth.js'
import reportRoutes from '../routes/report.js'
import adminReports from '../routes/admin/reports.js'

function scopedApp(teams) {
  const app = express()
  app.use(express.json())
  app.use('/api/admin', (req, res, next) => { req.admin = { id: 9, role: 'admin', teams }; next() })
  app.use('/api/admin', adminReports)
  return app
}

function publicApp() {
  const app = express()
  app.use(express.json())
  app.use(reportRoutes)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('adminAuth: резолв команд модератора (P3 #31)', () => {
  it('кладёт team_id-ы модератора в req.admin.teams', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 7, email: 'a@b.c', role: 'admin' }], []])
      .mockResolvedValueOnce([[{ team_id: 3 }, { team_id: 5 }], []])
    const req = { headers: {}, cookies: { sm_token: 'x' } }
    const res = { status: vi.fn(() => res), json: vi.fn(() => res) }
    const next = vi.fn()
    const { verifyToken } = await import('../middleware.js')
    verifyToken.mockReturnValue({ userId: 7, role: 'admin' })

    await adminAuth(req, res, next)
    expect(next).toHaveBeenCalled()
    expect(req.admin.teams).toEqual([3, 5])
  })

  it('без команд (или при сбое запроса) teams = [] — супер-админ, а не 500', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 7, email: 'a@b.c', role: 'admin' }], []])
      .mockRejectedValueOnce(new Error('ER_NO_SUCH_TABLE'))
    const req = { headers: {}, cookies: { sm_token: 'x' } }
    const res = { status: vi.fn(() => res), json: vi.fn(() => res) }
    const next = vi.fn()
    const { verifyToken } = await import('../middleware.js')
    verifyToken.mockReturnValue({ userId: 7, role: 'admin' })

    await adminAuth(req, res, next)
    expect(next).toHaveBeenCalled()
    expect(req.admin.teams).toEqual([])
  })
})

describe('GET /api/admin/reports: скоуп по команде', () => {
  it('модератор с командой фильтрует жалобы по r.team_id IN (?)', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 1, status: 'pending', teamName: 'Основная' }], []])
    const res = await request(scopedApp([3])).get('/api/admin/reports')
    expect(res.status).toBe(200)
    const [sql, params] = pool.query.mock.calls[0]
    expect(String(sql)).toMatch(/WHERE r\.team_id IN \(\?\)/)
    expect(params).toEqual([[3]])
  })

  it('супер-админ (нет команд) получает все жалобы без фильтра', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(scopedApp([])).get('/api/admin/reports')
    expect(res.status).toBe(200)
    const [sql] = pool.query.mock.calls[0]
    expect(String(sql)).not.toMatch(/WHERE r\.team_id/)
  })
})

describe('POST /api/admin/reports/:id/status: 403 вне своих команд', () => {
  it('жалоба чужой команды → 403 REPORT_OUT_OF_SCOPE, UPDATE не выполняется', async () => {
    pool.query.mockResolvedValueOnce([[{ team_id: 4 }], []])
    const res = await request(scopedApp([3]))
      .post('/api/admin/reports/1/status')
      .send({ status: 'reviewed' })
    expect(res.status).toBe(403)
    expect(res.body.message).toBe('REPORT_OUT_OF_SCOPE')
    expect(pool.query.mock.calls.length).toBe(1)
  })

  it('жалоба своей команды → 200, статус обновляется', async () => {
    pool.query
      .mockResolvedValueOnce([[{ team_id: 3 }], []])
      .mockResolvedValueOnce([[], []])
    const res = await request(scopedApp([3]))
      .post('/api/admin/reports/1/status')
      .send({ status: 'reviewed' })
    expect(res.status).toBe(200)
    expect(pool.query.mock.calls.length).toBe(2)
  })

  it('несуществующая жалоба в скоупе → 404', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(scopedApp([3]))
      .post('/api/admin/reports/999/status')
      .send({ status: 'reviewed' })
    expect(res.status).toBe(404)
  })

  it('супер-админ не проверяет скоуп — одно UPDATE', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(scopedApp([]))
      .post('/api/admin/reports/1/status')
      .send({ status: 'reviewed' })
    expect(res.status).toBe(200)
    expect(pool.query.mock.calls.length).toBe(1)
  })
})

describe('POST /api/reports: авто-назначение команды (round-robin)', () => {
  it('пишет team_id выбранной команды в INSERT', async () => {
    pool.query
      .mockResolvedValueOnce([[{ team_id: 2 }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ count: 1 }], []])
    const res = await request(publicApp())
      .post('/api/reports')
      .send({ reported_id: 5, reason: 'spam' })
    expect(res.status).toBe(200)
    const insertCall = pool.query.mock.calls.find(([sql]) => /INSERT INTO reports/.test(String(sql)))
    expect(insertCall).toBeTruthy()
    expect(String(insertCall[0])).toMatch(/team_id/)
    expect(insertCall[1][5]).toBe(2)
  })

  it('команд нет → team_id = null, жалоба сохраняется', async () => {
    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ count: 1 }], []])
    const res = await request(publicApp())
      .post('/api/reports')
      .send({ reported_id: 5, reason: 'spam' })
    expect(res.status).toBe(200)
    const insertCall = pool.query.mock.calls.find(([sql]) => /INSERT INTO reports/.test(String(sql)))
    expect(insertCall[1][5]).toBeNull()
  })
})
