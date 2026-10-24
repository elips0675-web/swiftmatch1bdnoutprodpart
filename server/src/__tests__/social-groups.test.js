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

const { emitMock, toMock } = vi.hoisted(() => {
  const emit = vi.fn()
  const to = vi.fn(() => ({ emit }))
  return { emitMock: emit, toMock: to }
})

vi.mock('../ws.js', () => ({ getIO: vi.fn(() => ({ to: toMock })) }))

vi.mock('../banned-words.js', () => ({
  getBannedWords: vi.fn(() => []),
  containsBannedWord: vi.fn(() => false),
}))

vi.mock('./push.js', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  sendPushToUser: vi.fn(),
  sendPushToAll: vi.fn(),
}))

const { isAllowedMock } = vi.hoisted(() => ({ isAllowedMock: vi.fn(async () => true) }))
vi.mock('../notification-prefs.js', () => ({
  getPrefs: vi.fn(async () => ({})),
  isAllowed: isAllowedMock,
  isAllowedIn: vi.fn(() => true),
}))

import pool from '../db.js'
import logger from '../logger.js'
import socialRoutes from '../routes/social.js'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'
const app = express()
app.use(express.json())
app.use(socialRoutes)

const as = (userId = 1) => ({
  Authorization: `Bearer ${jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })}`,
})

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockReset()
  pool.query.mockResolvedValue([[], []])
  isAllowedMock.mockResolvedValue(true)
})

describe('POST /api/invites', () => {
  it('без invitee_id или type — 400 без запросов в БД', async () => {
    const res = await request(app).post('/api/invites').set(as()).send({ type: 'coffee' })
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('неизвестный тип приглашения — 400 без запросов в БД', async () => {
    const res = await request(app).post('/api/invites').set(as()).send({ invitee_id: 5, type: 'bogus' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/Invalid invite type/)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('принимает пикник, выставку и музей — их предлагает страница профиля', async () => {
    isAllowedMock.mockResolvedValue(false)
    for (const type of ['picnic', 'exhibition', 'museum']) {
      pool.query.mockReset()
      pool.query.mockResolvedValue([[], []])
      const res = await request(app).post('/api/invites').set(as()).send({ invitee_id: 5, type })
      expect(res.status).toBe(201)
      const invite = pool.query.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO invites'))
      expect(invite[1]).toEqual([1, 5, type, null, 'pending'])
    }
  })

  it('создаёт приглашение, уведомление и пушит его по WS, текст обрезан до 500', async () => {
    pool.query
      .mockResolvedValueOnce([{ insertId: 1 }, []])
      .mockResolvedValueOnce([{ insertId: 42 }, []])
      .mockResolvedValueOnce([[{ id: 42, type: 'invite', payload: '{}' }], []])
    const res = await request(app)
      .post('/api/invites')
      .set(as())
      .send({ invitee_id: 5, type: 'coffee', message: 'x'.repeat(700) })
    expect(res.status).toBe(201)
    const invite = pool.query.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO invites'))
    expect(invite[1]).toEqual([1, 5, 'coffee', 'x'.repeat(500), 'pending'])
    const notif = pool.query.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO notifications'))
    expect(notif[1][0]).toBe(5)
    expect(toMock).toHaveBeenCalledWith('user:5')
    expect(emitMock).toHaveBeenCalledWith('notification:new', expect.objectContaining({ id: 42 }))
  })

  it('приглашение без уведомления, когда получатель выключил in-app', async () => {
    isAllowedMock.mockResolvedValue(false)
    const res = await request(app).post('/api/invites').set(as()).send({ invitee_id: 5, type: 'walk' })
    expect(res.status).toBe(201)
    expect(pool.query.mock.calls.some((c) => String(c[0]).startsWith('INSERT INTO notifications'))).toBe(false)
    expect(toMock).not.toHaveBeenCalled()
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).post('/api/invites').set(as()).send({ invitee_id: 5, type: 'walk' })
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Invite error:', expect.any(Error))
  })
})

describe('GET /api/invites и PUT /api/invites/:id/status', () => {
  it('отдаёт полученные приглашения', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 1, type: 'coffee', sender_name: 'Маша' }], []])
    const res = await request(app).get('/api/invites').set(as())
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].sender_name).toBe('Маша')
    expect(pool.query.mock.calls[0][0]).toContain('up.age as sender_age')
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).get('/api/invites').set(as())
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Invites fetch error:', expect.any(Error))
  })

  it('недопустимый статус — 400 без запросов в БД', async () => {
    const res = await request(app).put('/api/invites/3/status').set(as()).send({ status: 'maybe' })
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('accepted обновляет статус только своего приглашения', async () => {
    const res = await request(app).put('/api/invites/3/status').set(as()).send({ status: 'accepted' })
    expect(res.status).toBe(200)
    expect(res.body.message).toBe('Invite accepted')
    const update = pool.query.mock.calls[0]
    expect(update[0]).toContain('UPDATE invites SET status = ?')
    expect(update[1]).toEqual(['accepted', '3', 1])
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).put('/api/invites/3/status').set(as()).send({ status: 'declined' })
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Invite status error:', expect.any(Error))
  })
})

describe('GET /api/groups/:groupId', () => {
  it('отдаёт группу', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 3, name_ru: 'Спорт', name_en: 'Sport' }], []])
    const res = await request(app).get('/api/groups/3').set(as())
    expect(res.status).toBe(200)
    expect(res.body.name_ru).toBe('Спорт')
  })

  it('нет группы — 404', async () => {
    const res = await request(app).get('/api/groups/999').set(as())
    expect(res.status).toBe(404)
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).get('/api/groups/3').set(as())
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Group fetch error:', expect.any(Error))
  })
})

describe('GET /api/groups/:groupId/chat', () => {
  it('существующий чат: участник уже есть — новых INSERT нет', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 11 }], []])
      .mockResolvedValueOnce([[{ chat_id: 11 }], []])
    const res = await request(app).get('/api/groups/3/chat').set(as())
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: 11, isGroup: true })
    expect(pool.query).toHaveBeenCalledTimes(2)
  })

  it('существующий чат: пользователя добавляют в участники', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 11 }], []])
      .mockResolvedValueOnce([[], []])
    const res = await request(app).get('/api/groups/3/chat').set(as())
    expect(res.status).toBe(200)
    const insert = pool.query.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO chat_participants'))
    expect(insert[1]).toEqual([11, 1])
  })

  it('чата нет: создаётся групповой чат и участники одним INSERT ... SELECT', async () => {
    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ insertId: 77 }, []])
    const res = await request(app).get('/api/groups/3/chat').set(as())
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: 77, isGroup: true })
    const create = pool.query.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO chats'))
    expect(create[1]).toEqual(['3', ''])
    const bulk = pool.query.mock.calls.find((c) => String(c[0]).includes('SELECT ?, gm.user_id FROM group_members'))
    expect(bulk[1]).toEqual([77, '3'])
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).get('/api/groups/3/chat').set(as())
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Group chat error:', expect.any(Error))
  })
})

describe('GET /api/groups/:groupId/posts', () => {
  it('собирает ленту: картинки из JSON-строки, лайки, комментарии по постам', async () => {
    pool.query
      .mockResolvedValueOnce([[
        { id: 10, group_id: 3, user_id: 5, text: 'привет', images: '["a.jpg"]', created_at: '2026-10-20', display_name: 'Маша', avatar_url: null, likes_count: 2, liked_by_me: 1 },
      ], []])
      .mockResolvedValueOnce([[
        { id: 1, post_id: 10, user_id: 6, text: 'класс', image_url: null, created_at: '2026-10-20', display_name: 'Петя', avatar_url: '/p.jpg' },
      ], []])
    const res = await request(app).get('/api/groups/3/posts').set(as())
    expect(res.status).toBe(200)
    expect(res.body[0]).toMatchObject({
      id: 10,
      groupId: 3,
      text: 'привет',
      images: ['a.jpg'],
      likes: 2,
      likedByMe: true,
      author: 'Маша',
    })
    expect(res.body[0].comments).toHaveLength(1)
    expect(res.body[0].comments[0]).toMatchObject({ id: 1, postId: 10, text: 'класс', author: 'Петя', avatar: '/p.jpg' })
  })

  it('images уже массивом (JSON-колонка) и null не ломают разбор', async () => {
    pool.query
      .mockResolvedValueOnce([[
        { id: 10, group_id: 3, user_id: 5, text: 'a', images: ['b.jpg'], created_at: '2026-10-20', display_name: 'A', avatar_url: null, likes_count: 0, liked_by_me: 0 },
        { id: 11, group_id: 3, user_id: 5, text: 'b', images: null, created_at: '2026-10-20', display_name: 'A', avatar_url: null, likes_count: 0, liked_by_me: 0 },
      ], []])
      .mockResolvedValueOnce([[], []])
    const res = await request(app).get('/api/groups/3/posts').set(as())
    expect(res.body[0].images).toEqual(['b.jpg'])
    expect(res.body[1].images).toEqual([])
  })

  it('пустая лента не запрашивает комментарии (IN () — некорректный SQL)', async () => {
    const res = await request(app).get('/api/groups/3/posts').set(as())
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
    expect(pool.query).toHaveBeenCalledTimes(1)
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).get('/api/groups/3/posts').set(as())
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Group posts error:', expect.any(Error))
  })
})

describe('POST /api/groups/:groupId/posts', () => {
  it('без текста и картинок — 400 без запросов в БД', async () => {
    const res = await request(app).post('/api/groups/3/posts').set(as()).send({ images: [] })
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('текст очищается от HTML, картинки уходят JSON-строкой', async () => {
    pool.query
      .mockResolvedValueOnce([{ insertId: 20 }, []])
      .mockResolvedValueOnce([[{ id: 20, group_id: 3, user_id: 1, text: 'привет', images: '["a.jpg"]', created_at: '2026-10-20', display_name: 'Я', avatar_url: null }], []])
    const res = await request(app).post('/api/groups/3/posts').set(as()).send({ text: '<b>привет</b>', images: ['a.jpg'] })
    expect(res.status).toBe(201)
    const insert = pool.query.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO group_posts'))
    expect(insert[1]).toEqual(['3', 1, 'привет', '["a.jpg"]'])
    expect(res.body.images).toEqual(['a.jpg'])
    expect(res.body.likes).toBe(0)
    expect(res.body.comments).toEqual([])
  })

  it('только картинки: текст пишется NULL, пост создаётся', async () => {
    pool.query
      .mockResolvedValueOnce([{ insertId: 21 }, []])
      .mockResolvedValueOnce([[{ id: 21, group_id: 3, user_id: 1, text: null, images: null, created_at: '2026-10-20', display_name: 'Я', avatar_url: null }], []])
    const res = await request(app).post('/api/groups/3/posts').set(as()).send({ images: ['a.jpg'] })
    expect(res.status).toBe(201)
    const insert = pool.query.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO group_posts'))
    expect(insert[1][2]).toBeNull()
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).post('/api/groups/3/posts').set(as()).send({ text: 'x' })
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Group post create error:', expect.any(Error))
  })
})

describe('POST /api/groups/:groupId/posts/:postId/like', () => {
  it('повторный лайк снимается', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 5 }], []])
    const res = await request(app).post('/api/groups/3/posts/20/like').set(as())
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ liked: false })
    expect(pool.query.mock.calls.some((c) => String(c[0]).startsWith('DELETE FROM group_post_likes'))).toBe(true)
  })

  it('первый лайк ставится', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(app).post('/api/groups/3/posts/20/like').set(as())
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ liked: true })
    const insert = pool.query.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO group_post_likes'))
    expect(insert[1]).toEqual(['20', 1])
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).post('/api/groups/3/posts/20/like').set(as())
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Group post like error:', expect.any(Error))
  })
})

describe('POST /api/groups/:groupId/posts/:postId/comments', () => {
  it('без текста и картинки — 400 без запросов в БД', async () => {
    const res = await request(app).post('/api/groups/3/posts/20/comments').set(as()).send({})
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('комментарий создаётся и возвращается с автором', async () => {
    pool.query
      .mockResolvedValueOnce([{ insertId: 30 }, []])
      .mockResolvedValueOnce([[{ id: 30, post_id: 20, user_id: 1, text: 'класс', image_url: null, created_at: '2026-10-20', display_name: 'Я', avatar_url: null }], []])
    const res = await request(app).post('/api/groups/3/posts/20/comments').set(as()).send({ text: 'класс' })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ id: 30, postId: 20, text: 'класс', author: 'Я' })
  })

  it('комментарий только с картинкой', async () => {
    pool.query
      .mockResolvedValueOnce([{ insertId: 31 }, []])
      .mockResolvedValueOnce([[{ id: 31, post_id: 20, user_id: 1, text: null, image_url: '/c.jpg', created_at: '2026-10-20', display_name: 'Я', avatar_url: null }], []])
    const res = await request(app).post('/api/groups/3/posts/20/comments').set(as()).send({ image_url: '/c.jpg' })
    expect(res.status).toBe(201)
    const insert = pool.query.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO group_post_comments'))
    expect(insert[1]).toEqual(['20', 1, null, '/c.jpg'])
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).post('/api/groups/3/posts/20/comments').set(as()).send({ text: 'x' })
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Group post comment error:', expect.any(Error))
  })
})
