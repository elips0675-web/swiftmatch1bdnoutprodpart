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

vi.mock('multer', () => {
  const mockSingle = vi.fn()
  return {
    default: Object.assign(() => ({ single: () => mockSingle }), { diskStorage: vi.fn(() => ({})) }),
    __mockSingle: mockSingle,
  }
})

import pool from '../db.js'
import profileRoutes from '../routes/profile.js'
import uploadRoutes from '../routes/upload.js'
import pushRoutes from '../routes/push.js'
import iapRoutes from '../routes/iap.js'
import socialRoutes from '../routes/social.js'
import { __mockSingle as mockSingle } from 'multer'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

const VICTIM = 7
const ATTACKER = 99

function token(userId) {
  return jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })
}

function createApp() {
  const app = express()
  app.use(express.json())
  app.use(profileRoutes)
  app.use(uploadRoutes)
  app.use(pushRoutes)
  app.use(iapRoutes)
  app.use(socialRoutes)
  return app
}

function sqlCalls(prefix) {
  return pool.query.mock.calls.filter((c) => typeof c[0] === 'string' && c[0].includes(prefix))
}

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockResolvedValue([[], []])
})

describe('PUT /api/profile/:id — mass assignment в чужой профиль', () => {
  it('без токена → 401 и ни одного запроса в БД', async () => {
    const res = await request(createApp())
      .put(`/api/profile/${VICTIM}`)
      .send({ display_name: 'Hacked', bio: 'owned' })

    expect(res.status).toBe(401)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('токен чужого пользователя → 403 и ни одного UPDATE/INSERT', async () => {
    const res = await request(createApp())
      .put(`/api/profile/${VICTIM}`)
      .set('Authorization', `Bearer ${token(ATTACKER)}`)
      .send({ display_name: 'Hacked', bio: 'owned', interests: [1, 2] })

    expect(res.status).toBe(403)
    expect(sqlCalls('UPDATE user_profiles')).toHaveLength(0)
    expect(sqlCalls('user_interests')).toHaveLength(0)
  })

  it('владелец правит свой профиль (id из токена)', async () => {
    pool.query.mockResolvedValueOnce([[{ id: VICTIM, display_name: 'Старое' }], []])
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }, []])
    pool.query.mockResolvedValueOnce([[{ id: VICTIM, display_name: 'Моё' }], []])

    const res = await request(createApp())
      .put(`/api/profile/${VICTIM}`)
      .set('Authorization', `Bearer ${token(VICTIM)}`)
      .send({ display_name: 'Моё' })

    expect(res.status).toBe(200)
    const update = sqlCalls('UPDATE user_profiles')[0]
    expect(update[1][update[1].length - 1]).toBe(String(VICTIM))
  })

  it('владелец может удалить и пересобрать только свои интересы', async () => {
    pool.query.mockResolvedValueOnce([[{ id: VICTIM, display_name: 'Старое' }], []])
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }, []])
    pool.query.mockResolvedValueOnce([[{ interests: '[]' }], []])
    pool.query.mockResolvedValueOnce([[], []])
    pool.query.mockResolvedValue([[], []])

    const res = await request(createApp())
      .put(`/api/profile/${VICTIM}`)
      .set('Authorization', `Bearer ${token(VICTIM)}`)
      .send({ interests: [1] })

    expect(res.status).toBe(200)
    const del = sqlCalls('DELETE FROM user_interests')[0]
    expect(del[1]).toEqual([String(VICTIM)])
  })
})

describe('GET /api/profile/:id — приватные поля чужого профиля', () => {
  it('без токена → 401 (профиль не должен читаться анонимно)', async () => {
    const res = await request(createApp()).get(`/api/profile/${VICTIM}`)

    expect(res.status).toBe(401)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('SQL не выбирает email, координаты и ghost/passport-поля', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: VICTIM, display_name: 'Ann' }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ interests: '[]' }], []])
      .mockResolvedValueOnce([[], []])

    const res = await request(createApp())
      .get(`/api/profile/${VICTIM}`)
      .set('Authorization', `Bearer ${token(ATTACKER)}`)

    expect(res.status).toBe(200)
    expect(res.body.display_name).toBe('Ann')

    const sql = sqlCalls('FROM user_profiles')[0][0]
    expect(sql).not.toMatch(/up\.\*/)
    expect(sql).not.toMatch(/JOIN\s+users/)
    for (const col of ['email', 'lat', 'lng', 'passport_lat', 'passport_lng', 'passport_city', 'passport_mode', 'last_location_update', 'location']) {
      expect(sql).not.toMatch(new RegExp(`\\bup\\.${col}\\b`))
    }
  })

  it('мягко удалённый профиль (deleted_at) отдаёт 404, а не профиль', async () => {
    pool.query.mockResolvedValue([[], []])

    const res = await request(createApp())
      .get(`/api/profile/${VICTIM}`)
      .set('Authorization', `Bearer ${token(ATTACKER)}`)

    expect(res.status).toBe(404)
    expect(sqlCalls('FROM user_profiles')[0][0]).toContain('deleted_at IS NULL')
  })
})

describe('POST /api/upload — запись в чужую галерею', () => {
  it('без токена → 401, и multer даже не вызывается (файл не пишется на диск)', async () => {
    const res = await request(createApp())
      .post('/api/upload')
      .field('user_id', String(VICTIM))
      .attach('photo', Buffer.from('x'), { filename: 'a.jpg', contentType: 'image/jpeg' })

    expect(res.status).toBe(401)
    expect(mockSingle).not.toHaveBeenCalled()
    expect(sqlCalls('INSERT INTO user_photos')).toHaveLength(0)
  })

  it('user_id из тела запроса игнорируется, фото вешается на владельца токена', async () => {
    mockSingle.mockImplementationOnce((req, res, cb) => {
      req.file = { filename: 'a.jpg', originalname: 'a.jpg' }
      cb(null)
    })
    pool.query.mockResolvedValueOnce([{ insertId: 1 }, []])

    const res = await request(createApp())
      .post('/api/upload')
      .set('Authorization', `Bearer ${token(ATTACKER)}`)
      .field('user_id', String(VICTIM))
      .attach('photo', Buffer.from('x'), { filename: 'a.jpg', contentType: 'image/jpeg' })

    expect(res.status).toBe(200)
    const insert = sqlCalls('INSERT INTO user_photos')[0]
    expect(insert[1][0]).toBe(ATTACKER)
  })
})

describe('DELETE /api/photos/:id — удаление чужого фото', () => {
  it('SELECT ограничен владельцем (id + user_id из токена)', async () => {
    pool.query
      .mockResolvedValueOnce([[{ url: '/uploads/a.jpg' }], []])
      .mockResolvedValueOnce([[], []])

    const res = await request(createApp())
      .delete('/api/photos/555')
      .set('Authorization', `Bearer ${token(ATTACKER)}`)

    expect(res.status).toBe(200)
    const select = sqlCalls('FROM user_photos')[0]
    expect(select[0]).toContain('user_id = ?')
    expect(select[1]).toEqual(['555', ATTACKER])
  })

  it('чужое фото → 404, файл не удаляется и DELETE в БД не уходит', async () => {
    pool.query.mockResolvedValue([[], []])

    const res = await request(createApp())
      .delete('/api/photos/555')
      .set('Authorization', `Bearer ${token(ATTACKER)}`)

    expect(res.status).toBe(404)
    expect(sqlCalls('DELETE FROM user_photos')).toHaveLength(0)
  })
})

describe('POST/DELETE /api/push/subscribe — подписка на чужой аккаунт', () => {
  it('без токена → 401 и подписки не создаётся', async () => {
    const res = await request(createApp())
      .post('/api/push/subscribe')
      .send({ endpoint: 'https://attacker.example/push', p256dh: 'k', auth: 'a' })

    expect(res.status).toBe(401)
    expect(sqlCalls('INSERT INTO push_subscriptions')).toHaveLength(0)
  })

  it('user_id берётся из токена (раньше был хардкот `req.userId || 1`)', async () => {
    const res = await request(createApp())
      .post('/api/push/subscribe')
      .set('Authorization', `Bearer ${token(ATTACKER)}`)
      .send({ endpoint: 'https://attacker.example/push', p256dh: 'k', auth: 'a' })

    expect(res.status).toBe(201)
    expect(sqlCalls('INSERT INTO push_subscriptions')[0][1][0]).toBe(ATTACKER)
  })

  it('отписка без токена → 401, чужие подписки не удаляются', async () => {
    const res = await request(createApp())
      .delete('/api/push/subscribe')
      .send({ endpoint: 'https://victim.example/push' })

    expect(res.status).toBe(401)
    expect(sqlCalls('DELETE FROM push_subscriptions')).toHaveLength(0)
  })
})

describe('GET /api/iap/status — статус подписки чужого юзера', () => {
  it('без токена → 401 (раньше читался по ?userId=)', async () => {
    const res = await request(createApp()).get(`/api/iap/status?userId=${VICTIM}`)

    expect(res.status).toBe(401)
    expect(sqlCalls('FROM subscriptions')).toHaveLength(0)
  })

  it('?userId= игнорируется, берётся владелец токена', async () => {
    const res = await request(createApp())
      .get(`/api/iap/status?userId=${VICTIM}`)
      .set('Authorization', `Bearer ${token(ATTACKER)}`)

    expect(res.status).toBe(200)
    expect(sqlCalls('FROM subscriptions')[0][1]).toEqual([ATTACKER])
  })
})

describe('регресс: существующие проверки доступа в чатах не разъехались', () => {
  it('GET /api/chats/:chatId не-участнику → 404', async () => {
    pool.query.mockResolvedValue([[], []])
    const res = await request(createApp())
      .get('/api/chats/12')
      .set('Authorization', `Bearer ${token(ATTACKER)}`)

    expect(res.status).toBe(404)
  })

  it('GET /api/chats/:chatId/messages не-участнику → 403', async () => {
    pool.query.mockResolvedValue([[], []])
    const res = await request(createApp())
      .get('/api/chats/12/messages')
      .set('Authorization', `Bearer ${token(ATTACKER)}`)

    expect(res.status).toBe(403)
    expect(sqlCalls('FROM messages')).toHaveLength(0)
  })

  it('POST /api/chats/:chatId/messages не-участнику → 403, INSERT не уходит', async () => {
    pool.query.mockResolvedValue([[], []])
    const res = await request(createApp())
      .post('/api/chats/12/messages')
      .set('Authorization', `Bearer ${token(ATTACKER)}`)
      .send({ text: 'привет' })

    expect(res.status).toBe(403)
    expect(sqlCalls('INSERT INTO messages')).toHaveLength(0)
  })

  it('реакция на чужое сообщение → 403', async () => {
    pool.query.mockResolvedValue([[], []])
    const res = await request(createApp())
      .post('/api/chats/12/messages/900/reactions')
      .set('Authorization', `Bearer ${token(ATTACKER)}`)
      .send({ emoji: '👍' })

    expect(res.status).toBe(403)
    expect(sqlCalls('INSERT INTO message_reactions')).toHaveLength(0)
  })

  it('удаление чужого сообщения → 403, DELETE не уходит', async () => {
    pool.query.mockResolvedValueOnce([[{ sender_id: VICTIM }], []])
    const res = await request(createApp())
      .delete('/api/chats/12/messages/900')
      .set('Authorization', `Bearer ${token(ATTACKER)}`)

    expect(res.status).toBe(403)
    expect(sqlCalls('DELETE FROM messages')).toHaveLength(0)
  })
})
