vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
  delete process.env.REDIS_URL
})

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
import logger from '../logger.js'
import profileRoutes from '../routes/profile.js'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'
const app = express()
app.use(express.json())
app.use(profileRoutes)

const as = (userId = 1) => ({
  Authorization: `Bearer ${jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })}`,
})

const privacyRow = (over = {}) => ({
  incognito: 0,
  passport_mode: 0,
  passport_city: null,
  passport_lat: null,
  passport_lng: null,
  show_online: 1,
  show_last_seen: 1,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockResolvedValue([[], []])
})

describe('GET /api/settings/privacy', () => {
  it('нет строки профиля — 404', async () => {
    const res = await request(app).get('/api/settings/privacy').set(as())
    expect(res.status).toBe(404)
  })

  it('NULL в show_online/show_last_seen означает «показывать» (дефолт приватности)', async () => {
    pool.query.mockResolvedValueOnce([[{ ...privacyRow(), show_online: null, show_last_seen: null }], []])
    const res = await request(app).get('/api/settings/privacy').set(as())
    expect(res.status).toBe(200)
    expect(res.body.show_online).toBe(true)
    expect(res.body.show_last_seen).toBe(true)
    expect(res.body.incognito).toBe(false)
    expect(res.body.passport_mode).toBe(false)
  })

  it('1 в БД отдаётся булевым true', async () => {
    pool.query.mockResolvedValueOnce([[{ ...privacyRow(), incognito: 1, passport_mode: 1 }], []])
    const res = await request(app).get('/api/settings/privacy').set(as())
    expect(res.body.incognito).toBe(true)
    expect(res.body.passport_mode).toBe(true)
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).get('/api/settings/privacy').set(as())
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Privacy GET error:', expect.any(Error))
  })
})

describe('PUT /api/settings/privacy', () => {
  it('incognito без активной подписки — 403 PREMIUM_REQUIRED, апдейта нет', async () => {
    const res = await request(app).put('/api/settings/privacy').set(as()).send({ incognito: true })
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('PREMIUM_REQUIRED')
    expect(pool.query.mock.calls.some((c) => String(c[0]).includes('UPDATE user_profiles SET'))).toBe(false)
  })

  it('passport_mode с активной подпиской сохраняется и пишется в историю битом 1', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1 }], []])
      .mockResolvedValueOnce([[privacyRow()], []])
    const res = await request(app).put('/api/settings/privacy').set(as()).send({ passport_mode: true })
    expect(res.status).toBe(200)
    const audit = pool.query.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO audit_log'))
    expect(audit[1][4]).toContain('"passport_mode":1')
  })

  it('show_online без премиум-флага не требует подписки', async () => {
    pool.query.mockResolvedValueOnce([[privacyRow()], []])
    const res = await request(app).put('/api/settings/privacy').set(as()).send({ show_online: false })
    expect(res.status).toBe(200)
    const subChecks = pool.query.mock.calls.filter((c) => String(c[0]).includes('FROM subscriptions'))
    expect(subChecks).toHaveLength(0)
    const audit = pool.query.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO audit_log'))
    expect(audit[1][4]).toContain('"show_online":0')
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).put('/api/settings/privacy').set(as()).send({ show_online: true })
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Privacy PUT error:', expect.any(Error))
  })
})

describe('GET /api/profile/me', () => {
  it('нет профиля — 404', async () => {
    const res = await request(app).get('/api/profile/me').set(as())
    expect(res.status).toBe(404)
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).get('/api/profile/me').set(as())
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Profile GET /me error:', expect.any(Error))
  })

  it('канон интересов из админки приходит массивом — неканоничные отбрасываются', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1, display_name: 'Test', birth_date: '1995-06-15' }], []])
      .mockResolvedValueOnce([[{ id: 7, url: '/uploads/a.jpg', sort_order: 0, is_avatar: 1 }], []])
      .mockResolvedValueOnce([[
        { id: 1, name_ru: 'Спорт', name_en: 'Sport' },
        { id: 13, name_ru: 'Животные', name_en: 'Animals' },
      ], []])
      .mockResolvedValueOnce([[{ interests: ['sport'] }], []])
      .mockResolvedValueOnce([[{ id: 1, name_en: 'Sport' }, { id: 13, name_en: 'Animals' }], []])
    const res = await request(app).get('/api/profile/me').set(as())
    expect(res.status).toBe(200)
    expect(res.body.photos).toHaveLength(1)
    expect(res.body.interests).toEqual([{ id: 1, name_ru: 'Спорт', name_en: 'Sport' }])
  })

  it('битый JSON в content_config — интересы не падают, а отбрасываются', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1, display_name: 'Test' }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ id: 1, name_ru: 'Спорт', name_en: 'Sport' }], []])
      .mockResolvedValueOnce([[{ interests: '{not json' }], []])
      .mockResolvedValueOnce([[{ id: 1, name_en: 'Sport' }], []])
    const res = await request(app).get('/api/profile/me').set(as())
    expect(res.status).toBe(200)
    expect(res.body.interests).toEqual([])
  })
})

describe('PUT /api/profile/:id: прочие ветки', () => {
  it('возраст по дате рождения: день рождения завтра — ещё не прибавился', async () => {
    const today = new Date()
    const bd = new Date(today.getFullYear() - 30, today.getMonth(), today.getDate() + 1)
    const iso = `${bd.getFullYear()}-${String(bd.getMonth() + 1).padStart(2, '0')}-${String(bd.getDate()).padStart(2, '0')}`
    pool.query
      .mockResolvedValueOnce([[{ id: 1, birth_date: '1990-01-01' }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ id: 1, display_name: 'Test' }], []])
    const res = await request(app).put('/api/profile/1').set(as()).send({ birth_date: iso })
    expect(res.status).toBe(200)
    const update = pool.query.mock.calls.find((c) => String(c[0]).includes('UPDATE user_profiles SET'))
    expect(update[1][2]).toBe(29)
  })

  it('неожиданная ошибка БД — 500, а не 400', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).put('/api/profile/1').set(as()).send({ display_name: 'Test' })
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Profile PUT error:', expect.any(Error))
  })
})

describe('PUT /api/profile/score и DELETE /api/profile/me: ошибки', () => {
  it('score: ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).put('/api/profile/score').set(as())
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Profile score error:', expect.any(Error))
  })

  it('удаление аккаунта: ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).delete('/api/profile/me').set(as())
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Delete account error:', expect.any(Error))
  })

  it('история изменений: ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).get('/api/profile/activity').set(as())
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Profile activity error:', expect.any(Error))
  })
})

describe('POST /api/users/:id/watch', () => {
  it('нечисловой id — 400 без запросов в БД', async () => {
    const res = await request(app).post('/api/users/abc/watch').set(as())
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('подписка на себя — 400 без запросов в БД', async () => {
    const res = await request(app).post('/api/users/1/watch').set(as(1))
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/yourself/i)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('несуществующий пользователь — 404', async () => {
    const res = await request(app).post('/api/users/9/watch').set(as())
    expect(res.status).toBe(404)
    expect(res.body.message).toMatch(/not found/i)
  })

  it('успешная подписка — watching true и INSERT IGNORE', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 9 }], []])
    const res = await request(app).post('/api/users/9/watch').set(as())
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ watching: true })
    const insert = pool.query.mock.calls.find((c) => String(c[0]).includes('INSERT IGNORE INTO user_watches'))
    expect(insert[1]).toEqual([1, '9'])
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).post('/api/users/9/watch').set(as())
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('User watch error:', expect.any(Error))
  })
})

describe('DELETE /api/users/:id/watch', () => {
  it('нечисловой id — 400', async () => {
    const res = await request(app).delete('/api/users/abc/watch').set(as())
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('успешная отписка — watching false', async () => {
    const res = await request(app).delete('/api/users/9/watch').set(as())
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ watching: false })
    const del = pool.query.mock.calls.find((c) => String(c[0]).startsWith('DELETE FROM user_watches'))
    expect(del[1]).toEqual([1, '9'])
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).delete('/api/users/9/watch').set(as())
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('User unwatch error:', expect.any(Error))
  })
})

describe('GET /api/users/watching', () => {
  it('отдаёт список подписок', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 9, display_name: 'Маша', age: 27 }], []])
    const res = await request(app).get('/api/users/watching').set(as())
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].display_name).toBe('Маша')
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).get('/api/users/watching').set(as())
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Watching list error:', expect.any(Error))
  })
})

describe('PUT /api/profile/:id: ники и локация в историю и UPDATE (ветки :723-739)', () => {
  function auditInsertCall() {
    return pool.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO audit_log'),
    )
  }

  it('все текстовые поля и гео доезжают до UPDATE, а в историю попадает только they были присланы', async () => {
    const before = {
      id: 1,
      name: 'OldName',
      city: 'OldCity',
      country: 'OldCountry',
      education: null,
      dating_goal: null,
      zodiac: null,
      circadian: null,
      attachment_style: null,
      passport_city: null,
      passport_lat: null,
      passport_lng: null,
    }
    pool.query
      .mockResolvedValueOnce([[before], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ id: 1, display_name: 'Test' }], []])

    const res = await request(app)
      .put('/api/profile/1')
      .set(as())
      .send({
        name: 'NewName',
        city: 'NewCity',
        country: 'NewCountry',
        education: 'MSU',
        dating_goal: 'serious',
        zodiac: 'leo',
        circadian: 'owl',
        attachment_style: 'secure',
        passport_city: 'Berlin',
        passport_lat: 52.5,
        passport_lng: 13.4,
      })
    expect(res.status).toBe(200)

    const update = pool.query.mock.calls.find((c) => String(c[0]).includes('UPDATE user_profiles SET'))
    expect(update[1].slice(0, 21)).toEqual([
      undefined,
      'NewName',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'serious',
      undefined,
      'NewCity',
      undefined,
      undefined,
      'Berlin',
      52.5,
      13.4,
      'NewCountry',
      'leo',
      'owl',
      'secure',
      'MSU',
      '1',
    ])

    const call = auditInsertCall()
    expect(JSON.parse(call[1][4])).toEqual({
      name: 'NewName',
      city: 'NewCity',
      country: 'NewCountry',
      education: 'MSU',
      dating_goal: 'serious',
      zodiac: 'leo',
      circadian: 'owl',
      attachment_style: 'secure',
      passport_city: 'Berlin',
      passport_lat: 52.5,
      passport_lng: 13.4,
    })
  })

  it('неприсланные текстовые поля уезжают в UPDATE как undefined (COALESCE сохраняет прежнее), а в историю не попадают', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1, display_name: 'Test', name: 'KeepName', city: 'KeepCity' }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ id: 1, display_name: 'Test', name: 'KeepName', city: 'KeepCity' }], []])

    const res = await request(app)
      .put('/api/profile/1')
      .set(as())
      .send({ display_name: 'Test' })
    expect(res.status).toBe(200)

    const update = pool.query.mock.calls.find((c) => String(c[0]).includes('UPDATE user_profiles SET'))
    expect(update[1][0]).toBe('Test')
    expect(update[1][1]).toBeUndefined()
    expect(update[1][9]).toBeUndefined()
    expect(update[1][15]).toBeUndefined()

    const call = auditInsertCall()
    expect(call).toBeUndefined()
  })

  it('бинарные incognito/passport_mode доезжают до истории как 0/1', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1, incognito: 0, passport_mode: 0 }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ id: 1 }], []])

    const res = await request(app)
      .put('/api/profile/1')
      .set(as())
      .send({ incognito: 1, passport_mode: 1 })
    expect(res.status).toBe(200)
    const call = auditInsertCall()
    expect(JSON.parse(call[1][4])).toEqual({ incognito: 1, passport_mode: 1 })
  })

  it('gender и looking_for доезжают до UPDATE и истории', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1, gender: null, looking_for: null }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ id: 1 }], []])

    const res = await request(app)
      .put('/api/profile/1')
      .set(as())
      .send({ gender: 'male', looking_for: 'female' })
    expect(res.status).toBe(200)
    const update = pool.query.mock.calls.find((c) => String(c[0]).includes('UPDATE user_profiles SET'))
    expect(update[1][5]).toBe('male')
    expect(update[1][6]).toBe('female')
    const call = auditInsertCall()
    expect(JSON.parse(call[1][4])).toEqual({ gender: 'male', looking_for: 'female' })
  })
})

describe('GET /api/profile/activity: NULL в истории', () => {
  it('old_values/new_values = null отдаются как null, а не падают на JSON.parse', async () => {
    pool.query.mockResolvedValueOnce([[
      { id: 1, table_name: 'user_profiles', record_id: 1, action: 'update', old_values: null, new_values: null, created_at: '2026-01-01' },
    ], []])
    const res = await request(app).get('/api/profile/activity').set(as())
    expect(res.status).toBe(200)
    expect(res.body[0].old_values).toBeNull()
    expect(res.body[0].new_values).toBeNull()
  })
})

describe('PUT /api/settings/privacy: остальные поля приватности (ветки :324-328)', () => {
  it('passport_city/lat/lng и show_last_seen сохраняются и пишутся в историю', async () => {
    const before = { incognito: 0, passport_mode: 0, passport_city: null, passport_lat: null, passport_lng: null, show_online: 1, show_last_seen: 1 }
    pool.query
      .mockResolvedValueOnce([[{ id: 7 }], []])
      .mockResolvedValueOnce([[before], []])
      .mockResolvedValueOnce([[], []])

    const res = await request(app)
      .put('/api/settings/privacy')
      .set(as())
      .send({ passport_mode: 1, passport_city: 'Berlin', passport_lat: 52.5, passport_lng: 13.4, show_last_seen: false })
    expect(res.status).toBe(200)
    const update = pool.query.mock.calls.find((c) => String(c[0]).includes('UPDATE user_profiles SET'))
    expect(update[1]).toEqual([undefined, 1, 'Berlin', 52.5, 13.4, undefined, false, 1])
    const call = pool.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO audit_log'))
    expect(JSON.parse(call[1][4])).toEqual({
      passport_mode: 1,
      passport_city: 'Berlin',
      passport_lat: 52.5,
      passport_lng: 13.4,
      show_last_seen: 0,
    })
  })
})
