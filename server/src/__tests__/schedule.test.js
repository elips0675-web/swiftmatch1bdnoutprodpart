vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }))
vi.mock('../ws.js', () => ({ getIO: vi.fn() }))
vi.mock('../active-user.js', () => ({ activeUser: vi.fn(() => 'up.deleted_at IS NULL') }))

import pool from '../db.js'
import { getIO } from '../ws.js'
import { activeUser } from '../active-user.js'
import scheduleRoutes from '../routes/schedule.js'

const reqLog = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
const app = express()
app.use(express.json())
app.use((req, res, next) => {
  req.log = reqLog
  next()
})
app.use(scheduleRoutes)

function token(userId = 1) {
  return jwt.sign({ userId, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '1h' })
}

function ioSpy() {
  const emit = vi.fn()
  const to = vi.fn(() => ({ emit }))
  getIO.mockReturnValue({ to })
  return { to, emit }
}

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockReset()
  reqLog.error.mockReset()
  getIO.mockReset()
  getIO.mockReturnValue(null)
})

describe('GET /api/schedule', () => {
  it('401 без токена', async () => {
    const res = await request(app).get('/api/schedule')
    expect(res.status).toBe(401)
  })

  it('список: фильтр по владельцу + предикат activeUser, без фильтра статуса при status=all', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 1, status: 'pending' }], []])
    const res = await request(app).get('/api/schedule?status=all').set('Authorization', `Bearer ${token(5)}`)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    const [sql, params] = pool.query.mock.calls[0]
    expect(String(sql)).toContain('(ds.proposer_id = ? OR ds.invitee_id = ?)')
    expect(String(sql)).toContain('up.deleted_at IS NULL')
    expect(String(sql)).not.toContain('AND ds.status = ?')
    expect(params).toEqual([5, 5, 5])
    expect(activeUser).toHaveBeenCalledWith('up')
  })

  it('конкретный статус добавляет AND ds.status = ?', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    await request(app).get('/api/schedule?status=accepted').set('Authorization', `Bearer ${token(5)}`)
    const [sql, params] = pool.query.mock.calls[0]
    expect(String(sql)).toContain('AND ds.status = ?')
    expect(params).toEqual([5, 5, 5, 'accepted'])
  })

  it('ошибка БД → 500 через req.log', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await request(app).get('/api/schedule').set('Authorization', `Bearer ${token(5)}`)
    expect(res.status).toBe(500)
    expect(reqLog.error).toHaveBeenCalledWith('Schedule list error:', expect.any(Error))
  })
})

describe('POST /api/schedule', () => {
  it('400 без chat_id/scheduled_at и без запроса в БД', async () => {
    const res = await request(app).post('/api/schedule').set('Authorization', `Bearer ${token(1)}`).send({})
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('400 на невалидную дату', async () => {
    const res = await request(app).post('/api/schedule')
      .set('Authorization', `Bearer ${token(1)}`)
      .send({ chat_id: 10, scheduled_at: 'not-a-date' })
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('403 когда создатель не участник чата', async () => {
    pool.query.mockResolvedValueOnce([[{ user_id: 2 }, { user_id: 3 }], []])
    const res = await request(app).post('/api/schedule')
      .set('Authorization', `Bearer ${token(1)}`)
      .send({ chat_id: 10, scheduled_at: '2026-11-01T10:00:00Z' })
    expect(res.status).toBe(403)
    expect(pool.query).toHaveBeenCalledTimes(1)
  })

  it('400 когда в чате нет второго участника', async () => {
    pool.query.mockResolvedValueOnce([[{ user_id: 1 }], []])
    const res = await request(app).post('/api/schedule')
      .set('Authorization', `Bearer ${token(1)}`)
      .send({ chat_id: 10, scheduled_at: '2026-11-01T10:00:00Z' })
    expect(res.status).toBe(400)
  })

  it('201: создаёт приглашение, duration по умолчанию 60, событие обоим участникам', async () => {
    pool.query
      .mockResolvedValueOnce([[{ user_id: 1 }, { user_id: 2 }], []])
      .mockResolvedValueOnce([{ insertId: 55 }, []])
      .mockResolvedValueOnce([[{ id: 55, status: 'pending', proposer_id: 1, invitee_id: 2 }], []])
    const { to, emit } = ioSpy()

    const res = await request(app).post('/api/schedule')
      .set('Authorization', `Bearer ${token(1)}`)
      .send({ chat_id: 10, scheduled_at: '2026-11-01T10:00:00Z' })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe(55)
    const insertParams = pool.query.mock.calls[1][1]
    expect(insertParams[1]).toBe(1)
    expect(insertParams[2]).toBe(2)
    expect(insertParams[4]).toBe(60)
    expect(to).toHaveBeenCalledWith('user:1')
    expect(to).toHaveBeenCalledWith('user:2')
    expect(emit).toHaveBeenCalledTimes(2)
  })

  it('ошибка БД → 500 через req.log', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await request(app).post('/api/schedule')
      .set('Authorization', `Bearer ${token(1)}`)
      .send({ chat_id: 10, scheduled_at: '2026-11-01T10:00:00Z' })
    expect(res.status).toBe(500)
    expect(reqLog.error).toHaveBeenCalledWith('Schedule create error:', expect.any(Error))
  })
})

describe('PUT /api/schedule/:id/accept|decline|cancel', () => {
  it('accept: 404 если приглашение не найдено или уже отвечено', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(app).put('/api/schedule/55/accept').set('Authorization', `Bearer ${token(2)}`)
    expect(res.status).toBe(404)
    expect(pool.query).toHaveBeenCalledTimes(1)
  })

  it('accept: 200, статус accepted и событие обоим', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 55, proposer_id: 1, invitee_id: 2, status: 'pending' }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[{ id: 55, status: 'accepted', proposer_id: 1, invitee_id: 2 }], []])
    const { emit } = ioSpy()

    const res = await request(app).put('/api/schedule/55/accept').set('Authorization', `Bearer ${token(2)}`)
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('accepted')
    expect(pool.query.mock.calls[1][1]).toEqual(['accepted', '55'])
    expect(emit).toHaveBeenCalledTimes(2)
  })

  it('decline: 200 и статус declined', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 55, proposer_id: 1, invitee_id: 2, status: 'pending' }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[{ id: 55, status: 'declined' }], []])
    const res = await request(app).put('/api/schedule/55/decline').set('Authorization', `Bearer ${token(2)}`)
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('declined')
    expect(pool.query.mock.calls[1][1]).toEqual(['declined', '55'])
  })

  it('cancel: ищет по proposer_id и статусу pending/accepted', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 55, proposer_id: 1, invitee_id: 2, status: 'accepted' }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[{ id: 55, status: 'cancelled' }], []])
    const res = await request(app).put('/api/schedule/55/cancel').set('Authorization', `Bearer ${token(1)}`)
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('cancelled')
    const [selectSql, selectParams] = pool.query.mock.calls[0]
    expect(String(selectSql)).toContain('proposer_id = ?')
    expect(String(selectSql)).toContain('status IN (?, ?)')
    expect(selectParams).toEqual(['55', 1, 'pending', 'accepted'])
    expect(pool.query.mock.calls[1][1]).toEqual(['cancelled', '55'])
  })

  it('cancel: 404 когда чужое приглашение', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(app).put('/api/schedule/55/cancel').set('Authorization', `Bearer ${token(9)}`)
    expect(res.status).toBe(404)
  })

  it('401 без токена', async () => {
    const res = await request(app).put('/api/schedule/55/accept')
    expect(res.status).toBe(401)
  })
})
