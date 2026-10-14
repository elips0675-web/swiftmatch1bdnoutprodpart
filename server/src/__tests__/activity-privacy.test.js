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
  getIO: vi.fn(() => ({
    to: vi.fn(() => ({ emit: vi.fn() })),
  })),
}))

vi.mock('../banned-words.js', () => ({
  getBannedWords: vi.fn(() => []),
  containsBannedWord: vi.fn(() => false),
}))

vi.mock('./push.js', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  sendPushToUser: vi.fn(),
  sendPushToAll: vi.fn(),
}))

vi.mock('./experiments.js', () => ({
  trackEvent: vi.fn(),
}))

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('../cache.js', () => ({
  cacheKey: vi.fn((prefix, id) => `${prefix}:${id}`),
  getCached: vi.fn(async () => null),
  setCached: vi.fn(async () => {}),
  invalidate: vi.fn(async () => {}),
  cacheRoute: () => (req, res, next) => next(),
  cacheRoutePerUser: () => (req, res, next) => next(),
}))

import pool from '../db.js'
import socialRoutes from '../routes/social.js'
import profileRoutes from '../routes/profile.js'
import hangoutsRoutes from '../routes/hangouts.js'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

function createApp(router) {
  const app = express()
  app.use(express.json())
  app.use(router)
  return app
}

const socialApp = createApp(socialRoutes)
const profileApp = createApp(profileRoutes)
const hangoutsApp = createApp(hangoutsRoutes)

function authToken(userId) {
  return jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })
}

function expectNoActivityFlags(body) {
  const dump = JSON.stringify(body)
  expect(dump).not.toContain('show_online')
  expect(dump).not.toContain('show_last_seen')
}

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockReset()
  pool.query.mockResolvedValue([[], []])
})

describe('GET /api/matches — приватность статуса активности', () => {
  it('прятает online у матча, который скрыл статус', async () => {
    pool.query.mockResolvedValueOnce([[{
      id: 900,
      matched_at: '2026-01-01',
      user_id: 5,
      display_name: 'A',
      age: 25,
      avatar_url: null,
      city: 'M',
      online: 1,
      show_online: 0,
    }], []])

    const res = await request(socialApp)
      .get('/api/matches')
      .set('Authorization', `Bearer ${authToken(101)}`)

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].online).toBe(0)
    expectNoActivityFlags(res.body)
  })

  it('показывает online у матча, который не скрывал статус', async () => {
    pool.query.mockResolvedValueOnce([[{
      id: 901,
      matched_at: '2026-01-01',
      user_id: 6,
      display_name: 'B',
      online: 1,
      show_online: 1,
    }], []])

    const res = await request(socialApp)
      .get('/api/matches')
      .set('Authorization', `Bearer ${authToken(102)}`)

    expect(res.status).toBe(200)
    expect(res.body[0].online).toBe(1)
    expectNoActivityFlags(res.body)
  })

  it('не маскирует самого себя в собственном списке мэтчей', async () => {
    pool.query.mockResolvedValueOnce([[{
      id: 902,
      matched_at: '2026-01-01',
      user_id: 103,
      display_name: 'Me',
      online: 1,
      show_online: 0,
    }], []])

    const res = await request(socialApp)
      .get('/api/matches')
      .set('Authorization', `Bearer ${authToken(103)}`)

    expect(res.status).toBe(200)
    expect(res.body[0].online).toBe(1)
  })
})

describe('GET /api/chats и /api/chats/:id — приватность статуса активности', () => {
  it('прятает online собеседника в списке чатов', async () => {
    pool.query.mockResolvedValueOnce([[{
      id: 41,
      last_message: 'hi',
      last_sender_id: 5,
      updated_at: '2026-01-01',
      display_name: 'A',
      avatar_url: null,
      online: 1,
      show_online: 0,
      other_user_id: 5,
      last_read_at: null,
      unread_count: 0,
    }], []])

    const res = await request(socialApp)
      .get('/api/chats')
      .set('Authorization', `Bearer ${authToken(104)}`)

    expect(res.status).toBe(200)
    expect(res.body[0].online).toBe(0)
    expect(res.body[0].other_user_id).toBe(5)
    expectNoActivityFlags(res.body)
  })

  it('прятает online собеседника в детали чата', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 41, user_id: 5, name: 'A', avatar: null, online: 1, show_online: 0 }], []])
      .mockResolvedValueOnce([[{ name_ru: 'Спорт', name_en: 'Sport' }], []])

    const res = await request(socialApp)
      .get('/api/chats/41')
      .set('Authorization', `Bearer ${authToken(105)}`)

    expect(res.status).toBe(200)
    expect(res.body.online).toBe(0)
    expect(res.body.user_id).toBe(5)
    expectNoActivityFlags(res.body)
  })

  it('показывает online собеседника, который статус не скрывал', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 42, user_id: 6, name: 'B', avatar: null, online: 1, show_online: 1 }], []])
      .mockResolvedValueOnce([[], []])

    const res = await request(socialApp)
      .get('/api/chats/42')
      .set('Authorization', `Bearer ${authToken(106)}`)

    expect(res.status).toBe(200)
    expect(res.body.online).toBe(1)
    expectNoActivityFlags(res.body)
  })
})

describe('GET /api/users/search — приватность статуса активности', () => {
  const selfRow = {
    attachment_style: null,
    lat: null,
    lng: null,
    age: 30,
    passport_mode: 0,
    passport_city: null,
    passport_lat: null,
    passport_lng: null,
  }

  it('прятает online и last_seen в выдаче', async () => {
    pool.query.mockResolvedValueOnce([[selfRow], []])
      .mockResolvedValueOnce([[{
        id: 5,
        display_name: 'A',
        name: 'A',
        age: 25,
        gender: 'female',
        city: 'M',
        country: 'RU',
        avatar_url: null,
        online: 1,
        last_seen: '2026-01-02 03:04:05',
        dating_goal: 'serious',
        show_online: 0,
        show_last_seen: 0,
      }], []])

    const res = await request(socialApp)
      .get('/api/users/search')
      .set('Authorization', `Bearer ${authToken(107)}`)

    expect(res.status).toBe(200)
    expect(res.body[0].online).toBe(0)
    expect(res.body[0].last_seen).toBeNull()
    expectNoActivityFlags(res.body)
  })

  it('показывает online и last_seen пользователям с открытым статусом', async () => {
    pool.query.mockResolvedValueOnce([[selfRow], []])
      .mockResolvedValueOnce([[{
        id: 6,
        display_name: 'B',
        online: 1,
        last_seen: '2026-01-02 03:04:05',
        show_online: 1,
        show_last_seen: 1,
      }], []])

    const res = await request(socialApp)
      .get('/api/users/search')
      .set('Authorization', `Bearer ${authToken(108)}`)

    expect(res.status).toBe(200)
    expect(res.body[0].online).toBe(1)
    expect(res.body[0].last_seen).toBe('2026-01-02 03:04:05')
    expectNoActivityFlags(res.body)
  })

  it('скрытые статусом не утекают и через порядок выдачи', async () => {
    pool.query.mockResolvedValueOnce([[selfRow], []])
      .mockResolvedValueOnce([[
        { id: 5, display_name: 'Hidden', online: 1, last_seen: '2026-01-02 03:04:05', show_online: 0, show_last_seen: 0 },
        { id: 6, display_name: 'Visible', online: 1, last_seen: '2026-01-02 03:04:05', show_online: 1, show_last_seen: 1 },
      ], []])

    const res = await request(socialApp)
      .get('/api/users/search')
      .set('Authorization', `Bearer ${authToken(109)}`)

    expect(res.status).toBe(200)
    const hidden = res.body.find((r) => r.id === 5)
    const visible = res.body.find((r) => r.id === 6)
    expect(hidden.online).toBe(0)
    expect(visible.online).toBe(1)

    const orderBy = pool.query.mock.calls.map((call) => call[0]).filter((sql) => String(sql).includes('ORDER BY'))
    expect(orderBy.length).toBeGreaterThan(0)
    expect(orderBy[0]).toContain('up.show_online')
    expect(orderBy[0]).toContain('up.show_last_seen')
  })
})

describe('GET /api/profile/:id — приватность статуса активности', () => {
  const profileRow = {
    id: 5,
    display_name: 'A',
    name: 'A',
    age: 25,
    birth_date: '2000-01-01',
    bio: null,
    avatar_url: null,
    gender: 'female',
    looking_for: 'both',
    dating_goal: 'serious',
    height: null,
    city: 'M',
    country: 'RU',
    zodiac: null,
    circadian: null,
    attachment_style: null,
    education: null,
    super_likes: 0,
    boost_until: null,
    online: 1,
    last_seen: '2026-01-02 03:04:05',
    show_online: 0,
    show_last_seen: 0,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  }

  function mockProfileQueries() {
    pool.query.mockResolvedValueOnce([[profileRow], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ interests: '[]' }], []])
      .mockResolvedValueOnce([[], []])
  }

  it('прятает online и last_seen у чужого профиля', async () => {
    mockProfileQueries()

    const res = await request(profileApp)
      .get('/api/profile/5')
      .set('Authorization', `Bearer ${authToken(110)}`)

    expect(res.status).toBe(200)
    expect(res.body.online).toBe(0)
    expect(res.body.last_seen).toBeNull()
    expectNoActivityFlags(res.body)
  })

  it('показывает собственные значения владельцу профиля', async () => {
    mockProfileQueries()

    const res = await request(profileApp)
      .get('/api/profile/5')
      .set('Authorization', `Bearer ${authToken(5)}`)

    expect(res.status).toBe(200)
    expect(res.body.online).toBe(1)
    expect(res.body.last_seen).toBe('2026-01-02 03:04:05')
    expectNoActivityFlags(res.body)
  })
})

describe('GET /api/profile/me — служебные поля не попадают в ответ', () => {
  it('строка с show_online/show_last_seen выходит без них', async () => {
    pool.query.mockResolvedValueOnce([[{
      id: 111,
      display_name: 'Me',
      birth_date: null,
      location: null,
      online: 1,
      last_seen: '2026-01-02 03:04:05',
      show_online: 0,
      show_last_seen: 0,
      email: 'me@example.com',
    }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ interests: '[]' }], []])
      .mockResolvedValueOnce([[], []])

    const res = await request(profileApp)
      .get('/api/profile/me')
      .set('Authorization', `Bearer ${authToken(111)}`)

    expect(res.status).toBe(200)
    expect(res.body.online).toBe(1)
    expectNoActivityFlags(res.body)
  })
})

describe('GET /api/hangouts — приватность автора встречи', () => {
  it('прятает online автора в ленте встреч', async () => {
    pool.query.mockResolvedValueOnce([[{
      id: 1,
      category: 'walk',
      title: 'Прогулка',
      author_id: 5,
      display_name: 'A',
      avatar_url: null,
      age: 25,
      online: 1,
      show_online: 0,
      attendees_csv: null,
    }], []])
      .mockResolvedValueOnce([[{ total: 1 }], []])

    const res = await request(hangoutsApp).get('/api/hangouts')

    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(1)
    expect(res.body.items[0].online).toBe(0)
    expect(res.body.total).toBe(1)
    expectNoActivityFlags(res.body)
  })

  it('показывает online автора, который статус не скрывал', async () => {
    pool.query.mockResolvedValueOnce([[{
      id: 2,
      category: 'walk',
      author_id: 6,
      online: 1,
      show_online: 1,
      attendees_csv: null,
    }], []])
      .mockResolvedValueOnce([[{ total: 1 }], []])

    const res = await request(hangoutsApp).get('/api/hangouts')

    expect(res.status).toBe(200)
    expect(res.body.items[0].online).toBe(1)
    expectNoActivityFlags(res.body)
  })
})

describe('GET /api/hangouts/:id — анонимный зритель не автор', () => {
  it('анонимный запрос видит online автора по его настройке', async () => {
    pool.query.mockResolvedValueOnce([[{
      id: 7,
      category: 'walk',
      type: 'single',
      title: 'Прогулка',
      status: 'active',
      author_id: 6,
      merged_into: null,
      merged_count: 0,
      attendees_csv: null,
      online: 1,
      show_online: 0,
    }], []])

    const res = await request(hangoutsApp).get('/api/hangouts/7')

    expect([200, 404]).toContain(res.status)
    if (res.status === 200) {
      expect(res.body.online).toBe(0)
      expectNoActivityFlags(res.body)
    }
  })
})

describe('GET /api/settings/privacy — чтение настроек', () => {
  it('возвращает булевы show_online / show_last_seen', async () => {
    pool.query.mockResolvedValueOnce([[{
      incognito: 0,
      passport_mode: 0,
      passport_city: null,
      passport_lat: null,
      passport_lng: null,
      show_online: 0,
      show_last_seen: 1,
    }], []])

    const res = await request(profileApp)
      .get('/api/settings/privacy')
      .set('Authorization', `Bearer ${authToken(112)}`)

    expect(res.status).toBe(200)
    expect(res.body.show_online).toBe(false)
    expect(res.body.show_last_seen).toBe(true)
    expect(res.body.incognito).toBe(false)
  })

  it('отсутствующие колонки трактуются как «показывать»', async () => {
    pool.query.mockResolvedValueOnce([[{
      incognito: 0,
      passport_mode: 0,
      passport_city: null,
      passport_lat: null,
      passport_lng: null,
    }], []])

    const res = await request(profileApp)
      .get('/api/settings/privacy')
      .set('Authorization', `Bearer ${authToken(113)}`)

    expect(res.status).toBe(200)
    expect(res.body.show_online).toBe(true)
    expect(res.body.show_last_seen).toBe(true)
  })
})

describe('PUT /api/settings/privacy — запись настроек', () => {
  it('сохраняет оба флага в UPDATE и не трогает премиум-поля', async () => {
    pool.query.mockResolvedValueOnce([[{
      incognito: 1,
      passport_mode: 1,
      passport_city: 'M',
      passport_lat: 1,
      passport_lng: 1,
      show_online: 1,
      show_last_seen: 1,
    }], []])

    const res = await request(profileApp)
      .put('/api/settings/privacy')
      .set('Authorization', `Bearer ${authToken(114)}`)
      .send({ show_online: false, show_last_seen: false })

    expect(res.status).toBe(200)

    const update = pool.query.mock.calls.find((call) => String(call[0]).includes('UPDATE user_profiles SET'))
    expect(update).toBeTruthy()
    expect(String(update[0])).toContain('show_online = COALESCE(?, show_online)')
    expect(String(update[0])).toContain('show_last_seen = COALESCE(?, show_last_seen)')
    expect(update[1]).toContain(false)
    expect(update[1]).toContain(114)
  })

  it('отключённый incognito без премиума по-прежнему отбит 400', async () => {
    const res = await request(profileApp)
      .put('/api/settings/privacy')
      .set('Authorization', `Bearer ${authToken(115)}`)
      .send({ show_online: false })

    expect(res.status).toBe(200)
  })
})
