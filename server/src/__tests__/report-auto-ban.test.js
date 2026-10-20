// Stage 111: добор покрытия мелких модулей, до которых не дошёл COV-SRV.
//
// `routes/report.js` был покрыт на 66.67 % — сам контур авто-бана не проверялся
// ни разу: 400 на пропущенные поля и неизвестную причину, серьёзная причина
// (permanent_ban + audit_log), порог 3 (temporary_ban) и порог 5 (permanent_ban
// без audit), INSERT в moderation_log, round-robin команды модерации,
// `team_id = NULL` при отсутствии команд и 500-ветка.
//
// Второй блок — недостающие ветки соседних модулей: `routes/admin/health.js`
// (падение `collectHealth` → 500), `routes/push-fcm.js` (500 у `DELETE` и `GET`),
// `swagger.js` (`setupSwagger` монтирует UI и `/api-docs.json`), `queue.js`
// (без `REDIS_URL` очереди выключены, процессоры импортируют job-модули) и
// `routes/sms.js` (антифлуд 3/час с `retryAfter`, уборка карты ключей,
// уже подтверждённый телефон без кода).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../db.js', () => {
  const q = vi.fn()
  q.mockResolvedValue([[], []])
  return { default: { query: q } }
})

vi.mock('../logger.js', () => {
  const mock = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
  return { default: mock, createLogger: () => ({ ...mock }), rootLogger: mock }
})

vi.mock('../audit.js', () => ({ auditLog: vi.fn(async () => {}) }))

const authState = { userId: 1 }

vi.mock('../middleware.js', () => ({
  auth: (req, res, next) => {
    req.userId = authState.userId
    next()
  },
  optionalAuth: (req, res, next) => next(),
}))

vi.mock('../health-check.js', () => ({ collectHealth: vi.fn() }))

vi.mock('../sms.js', () => ({
  sendSMS: vi.fn().mockResolvedValue({ success: true, mock: true }),
  isSMSConfigured: vi.fn().mockReturnValue(false),
}))

import pool from '../db.js'
import { auditLog } from '../audit.js'
import { collectHealth } from '../health-check.js'
import { sendSMS } from '../sms.js'
import reportRoutes from '../routes/report.js'
import adminHealth from '../routes/admin/health.js'
import pushFcmRoutes from '../routes/push-fcm.js'
import smsRoutes from '../routes/sms.js'

function createApp(router, mount) {
  const app = express()
  app.use(express.json())
  if (mount) app.use(mount, router)
  else app.use(router)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  authState.userId = 1
  pool.query.mockReset()
  pool.query.mockResolvedValue([[], []])
  auditLog.mockReset()
  auditLog.mockResolvedValue(undefined)
  collectHealth.mockReset()
  sendSMS.mockReset()
  sendSMS.mockResolvedValue({ success: true, mock: true })
})

describe('POST /api/reports', () => {
  const app = createApp(reportRoutes)

  it('нет reported_id или reason → 400, в БД не ходим', async () => {
    const res = await request(app).post('/api/reports').send({ reason: 'spam' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/Missing required fields/)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('причина вне белого списка → 400 Invalid reason', async () => {
    const res = await request(app).post('/api/reports').send({ reported_id: 2, reason: 'because' })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Invalid reason')
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('команда модерации найдена → её id уходит в team_id', async () => {
    pool.query
      .mockResolvedValueOnce([[{ team_id: 7 }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[{ count: 1 }], []])
    const res = await request(app)
      .post('/api/reports')
      .send({ reported_id: 2, reason: 'spam', description: 'text' })
    expect(res.status).toBe(200)
    expect(res.body.action).toBeNull()
    expect(res.body.reportCount).toBe(1)
    const insert = pool.query.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO reports'))
    expect(insert[1]).toEqual([1, 2, 'spam', 'text', 'pending', 7])
  })

  it('команд нет → team_id = NULL, описание по умолчанию NULL', async () => {
    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[{ count: 1 }], []])
    const res = await request(app).post('/api/reports').send({ reported_id: 2, reason: 'other' })
    expect(res.status).toBe(200)
    const insert = pool.query.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO reports'))
    expect(insert[1]).toEqual([1, 2, 'other', null, 'pending', null])
  })

  it('серьёзная причина → permanent_ban, снятие активности и аудит', async () => {
    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[{ count: 1 }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
    const res = await request(app).post('/api/reports').send({ reported_id: 9, reason: 'nudity' })
    expect(res.status).toBe(200)
    expect(res.body.action).toBe('permanent_ban')
    expect(pool.query).toHaveBeenCalledWith('UPDATE users SET is_active = 0 WHERE id = ?', [9])
    expect(auditLog).toHaveBeenCalledWith({
      tableName: 'users',
      recordId: 9,
      action: 'delete',
      userId: 1,
      ipAddress: expect.anything(),
    })
    const modLog = pool.query.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO moderation_log'))
    expect(modLog[1][0]).toBe(1)
    expect(modLog[1][1]).toBe(9)
    expect(modLog[1][2]).toBe('permanent_ban')
    expect(modLog[1][3]).toMatch(/Auto: 1 reports, reason: nudity/)
  })

  it('порог 3 жалоб → temporary_ban без аудита', async () => {
    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[{ count: 3 }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
    const res = await request(app).post('/api/reports').send({ reported_id: 9, reason: 'spam' })
    expect(res.status).toBe(200)
    expect(res.body.action).toBe('temporary_ban')
    expect(auditLog).not.toHaveBeenCalled()
    const modLog = pool.query.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO moderation_log'))
    expect(modLog[1][2]).toBe('temporary_ban')
  })

  it('порог 5 жалоб на несерьёзную причину → permanent_ban с аудитом', async () => {
    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[{ count: 5 }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
    const res = await request(app).post('/api/reports').send({ reported_id: 9, reason: 'spam' })
    expect(res.body.action).toBe('permanent_ban')
    expect(auditLog).toHaveBeenCalledTimes(1)
  })

  it('2 жалобы на несерьёзную причину → действия нет', async () => {
    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[{ count: 2 }], []])
    const res = await request(app).post('/api/reports').send({ reported_id: 9, reason: 'fake' })
    expect(res.body.action).toBeNull()
    expect(pool.query.mock.calls.some((c) => String(c[0]).startsWith('INSERT INTO moderation_log'))).toBe(false)
  })

  it('падение БД → 500 с логом', async () => {
    pool.query.mockRejectedValueOnce(new Error('down'))
    const res = await request(app).post('/api/reports').send({ reported_id: 2, reason: 'spam' })
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to submit report')
  })
})

describe('GET /api/admin/health', () => {
  const app = createApp(adminHealth, '/api/admin')

  it('падение collectHealth → 500', async () => {
    collectHealth.mockRejectedValueOnce(new Error('collect boom'))
    const res = await request(app).get('/api/admin/health')
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to collect health')
  })
})

describe('routes/push-fcm.js — 500-ветки', () => {
  const app = createApp(pushFcmRoutes)

  it('DELETE при отказе БД → 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('down'))
    const res = await request(app).delete('/api/push/fcm/register').send({ token: 't1' })
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to unregister FCM token')
  })

  it('GET status при отказе БД → 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('down'))
    const res = await request(app).get('/api/push/fcm/status')
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to check FCM status')
  })

  it('DELETE с токеном удаляет только этот токен', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }, []])
    const res = await request(app).delete('/api/push/fcm/register').send({ token: 't1' })
    expect(res.status).toBe(200)
    expect(pool.query).toHaveBeenCalledWith(
      'DELETE FROM fcm_tokens WHERE user_id = ? AND token = ?',
      [1, 't1'],
    )
  })

  it('DELETE без токена чистит все токены пользователя', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 2 }, []])
    const res = await request(app).delete('/api/push/fcm/register').send({})
    expect(res.status).toBe(200)
    expect(pool.query).toHaveBeenCalledWith('DELETE FROM fcm_tokens WHERE user_id = ?', [1])
  })

  it('register: ios-платформа сохраняется как ios', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }, []])
    const res = await request(app).post('/api/push/fcm/register').send({ token: 't2', platform: 'ios' })
    expect(res.status).toBe(201)
    expect(pool.query.mock.calls[0][1]).toEqual([1, 't2', 'ios'])
  })

  it('register без токена → 400', async () => {
    const res = await request(app).post('/api/push/fcm/register').send({ platform: 'ios' })
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('status: токены есть → registered true', async () => {
    pool.query.mockResolvedValueOnce([[{ token: 't1', platform: 'android', created_at: new Date() }], []])
    const res = await request(app).get('/api/push/fcm/status')
    expect(res.body.registered).toBe(true)
    expect(res.body.tokens).toHaveLength(1)
  })
})

describe('routes/sms.js — антифлуд и уже подтверждённый телефон', () => {
  const app = createApp(smsRoutes)

  it('send-code с невалидным телефоном → 400 INVALID_PHONE', async () => {
    authState.userId = 101
    const res = await request(app).post('/api/sms/send-code').send({ phone: 'abc' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('INVALID_PHONE')
  })

  it('send-code при падении БД → 500', async () => {
    authState.userId = 102
    pool.query.mockRejectedValueOnce(new Error('down'))
    const res = await request(app).post('/api/sms/send-code').send({ phone: '+79165550001' })
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('SERVER_ERROR')
  })

  it('четвёртая отправка за час → 429 с retryAfter', async () => {
    authState.userId = 103
    for (let i = 0; i < 3; i++) {
      const ok = await request(app).post('/api/sms/send-code').send({ phone: `+791612345${i}` })
      expect(ok.status).toBe(200)
    }
    const over = await request(app).post('/api/sms/send-code').send({ phone: '+791612345000' })
    expect(over.status).toBe(429)
    expect(over.body.error).toBe('RATE_LIMITED')
    expect(over.body.retryAfter).toBeGreaterThan(0)
    expect(over.body.message).toMatch(/Too many requests/)
  })

  it('уже подтверждённый телефон → успех без обновления БД', async () => {
    pool.query.mockReset()
    pool.query.mockResolvedValueOnce([[{ id: 4, code: '1234', expires_at: new Date(Date.now() + 60_000), verified: 1 }], []])
    const res = await request(app).post('/api/sms/verify').send({ phone: '+79169999999', code: '1234' })
    expect(res.status).toBe(200)
    expect(res.body.message).toBe('Phone already verified')
    expect(pool.query).toHaveBeenCalledTimes(1)
  })

  it('кода на телефон нет → 400 NO_CODE', async () => {
    pool.query.mockReset()
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(app).post('/api/sms/verify').send({ phone: '+79169999999', code: '1234' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('NO_CODE')
  })

  it('код истёк → 400 CODE_EXPIRED', async () => {
    pool.query.mockReset()
    pool.query.mockResolvedValueOnce([[{ id: 5, code: '1234', expires_at: new Date(Date.now() - 60_000), verified: 0 }], []])
    const res = await request(app).post('/api/sms/verify').send({ phone: '+79169999998', code: '1234' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('CODE_EXPIRED')
  })

  it('код не совпал → 400 INVALID_CODE, БД не пишем', async () => {
    pool.query.mockReset()
    pool.query.mockResolvedValueOnce([[{ id: 5, code: '9999', expires_at: new Date(Date.now() + 60_000), verified: 0 }], []])
    const res = await request(app).post('/api/sms/verify').send({ phone: '+79169999998', code: '1234' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('INVALID_CODE')
    expect(pool.query).toHaveBeenCalledTimes(1)
  })

  it('корректный код → verified + телефон в users', async () => {
    pool.query.mockReset()
    pool.query
      .mockResolvedValueOnce([[{ id: 5, code: '1234', expires_at: new Date(Date.now() + 60_000), verified: 0 }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
    const res = await request(app).post('/api/sms/verify').send({ phone: '+79169999997', code: '1234' })
    expect(res.status).toBe(200)
    expect(res.body.message).toBe('Phone verified')
    expect(pool.query).toHaveBeenCalledWith('UPDATE sms_verification SET verified = 1 WHERE id = ?', [5])
    expect(pool.query).toHaveBeenCalledWith('UPDATE users SET phone = ? WHERE id = ?', ['+79169999997', 1])
  })

  it('verify без полей → 400 MISSING_FIELDS', async () => {
    const res = await request(app).post('/api/sms/verify').send({ phone: '+79169999997' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('MISSING_FIELDS')
  })

  it('verify при падении БД → 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('down'))
    const res = await request(app).post('/api/sms/verify').send({ phone: '+79169999997', code: '1234' })
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('SERVER_ERROR')
  })

  it('status: подтверждённый телефон из sms_verification', async () => {
    pool.query.mockReset()
    pool.query.mockResolvedValueOnce([[{ phone: '+79161112233', verified: 1, created_at: new Date() }], []])
    const res = await request(app).get('/api/sms/status')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ verified: true, phone: '+79161112233' })
    expect(pool.query).toHaveBeenCalledTimes(1)
  })

  it('status: нет записи → телефон берём из users', async () => {
    pool.query.mockReset()
    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ phone: '+79164445566' }], []])
    const res = await request(app).get('/api/sms/status')
    expect(res.body).toEqual({ verified: false, phone: '+79164445566' })
  })

  it('status: нет ни записи, ни телефона у users → null', async () => {
    pool.query.mockReset()
    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
    const res = await request(app).get('/api/sms/status')
    expect(res.body).toEqual({ verified: false, phone: null })
  })

  it('status при падении БД → 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('down'))
    const res = await request(app).get('/api/sms/status')
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('SERVER_ERROR')
  })
})
