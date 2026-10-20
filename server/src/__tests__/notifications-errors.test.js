// Stage 109: 500-ветки `routes/notifications.js`, которые не ловятся обычными
// прогонами. `getPrefs`/`getQuiet` глотают ошибку БД (fail-open), поэтому catch
// роутов GET достижим только мок-модулем — здесь `notification-prefs.js` и
// `quiet-hours.js` замоканы так, чтобы чтение бросало. Запись и список падают
// от отказа `pool.query` напрямую. Плюс `safeParse` на битом JSON.

vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'

const { prefsMock, quietMock } = vi.hoisted(() => ({
  prefsMock: {
    getPrefs: vi.fn(),
    savePrefs: vi.fn(),
    normalizePrefs: vi.fn(() => ({ prefs: {}, invalid: [] })),
    defaultPrefs: vi.fn(() => ({})),
    describeMatrix: vi.fn(() => []),
    CHANNELS: ['inApp', 'push'],
  },
  quietMock: {
    getQuiet: vi.fn(),
    saveQuiet: vi.fn(),
    normalizeQuiet: vi.fn(() => ({ quiet: {}, invalid: [] })),
  },
}))

vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}))
vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))
vi.mock('../notification-prefs.js', () => prefsMock)
vi.mock('../quiet-hours.js', () => quietMock)

import pool from '../db.js'
import logger from '../logger.js'
import notificationsRoutes from '../routes/notifications.js'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

function createApp() {
  const app = express()
  app.use(express.json())
  app.use(notificationsRoutes)
  return app
}

function token(userId = 9) {
  return jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })
}

function authGet(path) {
  return request(createApp()).get(path).set('Authorization', `Bearer ${token()}`)
}

function authPut(path, body) {
  const req = request(createApp()).put(path).set('Authorization', `Bearer ${token()}`)
  return body === undefined ? req : req.send(body)
}

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockReset()
  pool.query.mockResolvedValue([[], []])
  // Сбрасываем реализации, которые могли остаться от предыдущего теста.
  prefsMock.getPrefs.mockResolvedValue(null)
  prefsMock.savePrefs.mockResolvedValue(undefined)
  prefsMock.normalizePrefs.mockReturnValue({ prefs: {}, invalid: [] })
  prefsMock.describeMatrix.mockReturnValue([])
  quietMock.getQuiet.mockResolvedValue({ enabled: false })
  quietMock.saveQuiet.mockResolvedValue(undefined)
  quietMock.normalizeQuiet.mockReturnValue({ quiet: {}, invalid: [] })
})

describe('GET /api/notifications/preferences — 500', () => {
  it('чтение настроек падает → 500 и лог', async () => {
    prefsMock.getPrefs.mockRejectedValue(new Error('db down'))
    const res = await authGet('/api/notifications/preferences')
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to fetch notification preferences')
    expect(logger.error).toHaveBeenCalledWith('Notification prefs read error:', expect.any(Error))
  })
})

describe('PUT /api/notifications/preferences — 500', () => {
  it('запись настроек падает → 500 и лог', async () => {
    prefsMock.savePrefs.mockRejectedValue(new Error('db down'))
    const res = await authPut('/api/notifications/preferences', { prefs: { like: { inApp: true } } })
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to save notification preferences')
    expect(logger.error).toHaveBeenCalledWith('Notification prefs write error:', expect.any(Error))
  })
})

describe('GET /api/notifications/quiet-hours — 500', () => {
  it('чтение тишины падает → 500 и лог', async () => {
    quietMock.getQuiet.mockRejectedValue(new Error('db down'))
    const res = await authGet('/api/notifications/quiet-hours')
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to fetch quiet hours')
    expect(logger.error).toHaveBeenCalledWith('Quiet hours read error:', expect.any(Error))
  })
})

describe('PUT /api/notifications/quiet-hours — 500', () => {
  it('запись тишины падает → 500 и лог', async () => {
    quietMock.saveQuiet.mockRejectedValue(new Error('db down'))
    const res = await authPut('/api/notifications/quiet-hours', { quiet: { enabled: true } })
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to save quiet hours')
    expect(logger.error).toHaveBeenCalledWith('Quiet hours write error:', expect.any(Error))
  })
})

describe('PUT /api/notifications/read-all — 500', () => {
  it('падение БД → 500 и лог', async () => {
    pool.query.mockRejectedValue(new Error('db down'))
    const res = await authPut('/api/notifications/read-all')
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to mark notifications')
    expect(logger.error).toHaveBeenCalledWith('Notifications read-all error:', expect.any(Error))
  })
})

describe('PUT /api/notifications/:id/read — 500', () => {
  it('падение БД → 500 и лог', async () => {
    pool.query.mockRejectedValue(new Error('db down'))
    const res = await authPut('/api/notifications/77/read')
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to mark notification')
    expect(logger.error).toHaveBeenCalledWith('Notifications read error:', expect.any(Error))
  })
})

describe('safeParse на битом payload', () => {
  it('некорректный JSON не роняет список и подменяется пустым объектом', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1, type: 'like', payload: '{not json', is_read: 0 }], []])
      .mockResolvedValueOnce([[{ unread: 0 }], []])
    const res = await authGet('/api/notifications')
    expect(res.status).toBe(200)
    expect(res.body.items[0].payload).toEqual({})
  })

  it('payload-null отдаётся как пустой объект', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 2, type: 'like', payload: null, is_read: 1 }], []])
      .mockResolvedValueOnce([[{ unread: 0 }], []])
    const res = await authGet('/api/notifications')
    expect(res.status).toBe(200)
    expect(res.body.items[0].payload).toEqual({})
  })

  it('payload-объект (не строка) отдаётся как есть', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 3, type: 'like', payload: { from_user_id: 4 }, is_read: 1 }], []])
      .mockResolvedValueOnce([[{ unread: 0 }], []])
    const res = await authGet('/api/notifications')
    expect(res.status).toBe(200)
    expect(res.body.items[0].payload).toEqual({ from_user_id: 4 })
  })
})
