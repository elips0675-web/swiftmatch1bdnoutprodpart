vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'

vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
  },
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

import pool from '../db.js'
import socialRoutes from '../routes/social.js'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

function createApp() {
  const app = express()
  app.use(express.json())
  app.use(socialRoutes)
  return app
}

function authToken(userId = 1) {
  return jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })
}

beforeEach(() => {
  vi.clearAllMocks()
  // Очередь `mockResolvedValueOnce` переживает `clearAllMocks`: недоеденные
  // значения уезжали в следующий тест и тот падал не по своей причине.
  pool.query.mockReset()
})

describe('GET /api/chats', () => {
  it('requires auth', async () => {
    const app = createApp()
    const res = await request(app).get('/api/chats')
    expect(res.status).toBe(401)
  })

  it('returns chat list with unread count', async () => {
    pool.query.mockResolvedValue([[{ id: 1, last_message: 'Hi', unread_count: 2 }], []])
    const app = createApp()
    const res = await request(app).get('/api/chats').set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0]).toHaveProperty('unread_count', 2)
  })
})

describe('PUT /api/chats/:chatId/read', () => {
  it('marks chat as read', async () => {
    pool.query.mockResolvedValue([[], []])
    const app = createApp()
    const res = await request(app).put('/api/chats/1/read').set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(200)
  })
})

describe('GET /api/chats/:chatId/messages', () => {
  // `desc(...ids)` — строки в том порядке, в котором их вернул бы DESC-запрос:
  // первым идёт самое новое. Наружу страница обязана уйти хронологически.
  function desc(...ids) {
    return ids.map((id) => ({ id, sender_id: 1, text: `msg-${id}`, created_at: new Date().toISOString() }))
  }

  function mockPage(fetched, reactionRows = []) {
    pool.query
      .mockResolvedValueOnce([[{ chat_id: 1 }], []])
      .mockResolvedValueOnce([fetched, []])
      .mockResolvedValueOnce([[{ user_id: 2, last_read_at: null }], []])
      .mockResolvedValueOnce([reactionRows, []])
  }

  function get(query = '') {
    const app = createApp()
    return request(app).get(`/api/chats/1/messages${query}`).set('Authorization', `Bearer ${authToken()}`)
  }

  it('returns messages with reactions', async () => {
    pool.query
      .mockResolvedValueOnce([[{ chat_id: 1 }], []])
      .mockResolvedValueOnce([[{ id: 1, sender_id: 1, text: 'Hello', created_at: new Date().toISOString() }], []])
      .mockResolvedValueOnce([[{ user_id: 2, last_read_at: new Date().toISOString() }], []])
      .mockResolvedValueOnce([[{ id: 10, message_id: 1, user_id: 2, emoji: '❤️', created_at: new Date().toISOString(), user_name: 'User2' }], []])
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.body.messages[0]).toHaveProperty('reactions')
    expect(res.body.messages[0].reactions).toHaveLength(1)
  })

  it('отдаёт объект с курсором, а не голый массив', async () => {
    mockPage(desc(9, 8), [{ id: 3, message_id: 8, user_id: 1, emoji: '👍', created_at: new Date().toISOString(), user_name: 'Me' }])
    const res = await get()
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(false)
    expect(res.body.has_more).toBe(false)
    expect(res.body.messages.map((m) => m.id)).toEqual([8, 9])
    expect(res.body.next_before).toBe(8)
    expect(res.body.messages[0].reactions).toHaveLength(1)
  })

  it('SQL берёт новые сообщения (DESC) и разворачивает страницу в хронологический порядок', async () => {
    mockPage(desc(9, 8, 7))
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.body.messages.map((m) => m.id)).toEqual([7, 8, 9])
    const [sql] = pool.query.mock.calls[1]
    expect(sql).toMatch(/ORDER BY m\.id DESC/)
    expect(sql).toMatch(/LIMIT \?/)
  })

  it('before=<id> добавляет курсор в WHERE и в параметры', async () => {
    mockPage(desc(7, 6))
    const res = await get('?before=8&limit=2')
    expect(res.status).toBe(200)
    const [sql, params] = pool.query.mock.calls[1]
    expect(sql).toMatch(/AND m\.id < \?/)
    expect(params).toEqual(['1', 8, 3])
    expect(res.body.next_before).toBe(6)
  })

  it('has_more=true, когда сервер вернул больше строк, чем просил клиент', async () => {
    mockPage(desc(10, 9, 8))
    const res = await get('?limit=2')
    expect(res.status).toBe(200)
    expect(res.body.has_more).toBe(true)
    expect(res.body.messages.map((m) => m.id)).toEqual([9, 10])
    expect(res.body.next_before).toBe(9)
  })

  it('limit клампится: 9999 → 100 (+1 на признак «есть ещё»), мусор → дефолт 50', async () => {
    for (const [query, expected] of [['?limit=9999', 101], ['?limit=abc', 51], ['?limit=-5', 51], ['', 51]]) {
      pool.query.mockReset()
      mockPage(desc(1))
      await get(query)
      const [, params] = pool.query.mock.calls[1]
      expect(params.at(-1)).toBe(expected)
    }
  })

  it('мусорный before игнорируется, а не превращается в 0 (иначе отдаётся вся история)', async () => {
    mockPage(desc(5, 4))
    const res = await get('?before=abc')
    expect(res.status).toBe(200)
    const [sql, params] = pool.query.mock.calls[1]
    expect(sql).not.toMatch(/AND m\.id < \?/)
    expect(params).toEqual(['1', 51])
  })

  it('пустая страница отдаёт next_before=null, а реакции не запрашиваются (IN () — некорректный SQL)', async () => {
    mockPage([])
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.body.messages).toEqual([])
    expect(res.body.next_before).toBeNull()
    expect(pool.query).toHaveBeenCalledTimes(3)
  })

  it('цитата: SQL джойнит quoted-сообщение, поля цитаты идут в ответ', async () => {
    pool.query
      .mockResolvedValueOnce([[{ chat_id: 1 }], []])
      .mockResolvedValueOnce([[{ id: 9, sender_id: 1, text: 'reply', reply_to: 5, reply_text: 'orig', reply_sender_name: 'Bob', created_at: new Date().toISOString() }], []])
      .mockResolvedValueOnce([[{ user_id: 2, last_read_at: null }], []])
      .mockResolvedValueOnce([[], []])
    const res = await get()
    expect(res.status).toBe(200)
    const [sql] = pool.query.mock.calls[1]
    expect(sql).toMatch(/LEFT JOIN messages rm ON rm\.id = m\.reply_to/)
    expect(res.body.messages[0].reply_text).toBe('orig')
    expect(res.body.messages[0].reply_sender_name).toBe('Bob')
  })
})

describe('POST /api/chats/:chatId/messages', () => {
  function post(body) {
    const app = createApp()
    return request(app).post('/api/chats/1/messages').set('Authorization', `Bearer ${authToken()}`).send(body)
  }

  it('без reply_to вставляет null и не делает проверочный SELECT', async () => {
    pool.query
      .mockResolvedValueOnce([[{ chat_id: 1 }], []])
      .mockResolvedValueOnce([{ insertId: 20 }, []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ id: 20, sender_id: 1, text: 'hi', reply_to: null, created_at: new Date().toISOString() }], []])
      .mockResolvedValueOnce([[], []])
    const res = await post({ text: 'hi' })
    expect(res.status).toBe(201)
    const insertCall = pool.query.mock.calls.find(([sql]) => /INSERT INTO messages/.test(sql))
    expect(insertCall).toBeTruthy()
    expect(insertCall[1]).toEqual(['1', 1, 'hi', null, null, null])
    expect(pool.query.mock.calls.filter(([sql]) => /SELECT id FROM messages WHERE id = \? AND chat_id = \?/.test(sql))).toHaveLength(0)
  })

  it('reply_to на сообщение того же чата проходит, id уезжает в INSERT и в ответ', async () => {
    pool.query
      .mockResolvedValueOnce([[{ chat_id: 1 }], []])
      .mockResolvedValueOnce([[{ id: 5 }], []])
      .mockResolvedValueOnce([{ insertId: 20 }, []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ id: 20, sender_id: 1, text: 'hi', reply_to: 5, reply_text: 'orig', reply_sender_name: 'Bob', created_at: new Date().toISOString() }], []])
      .mockResolvedValueOnce([[], []])
    const res = await post({ text: 'hi', reply_to: 5 })
    expect(res.status).toBe(201)
    const checkCall = pool.query.mock.calls.find(([sql]) => /SELECT id FROM messages WHERE id = \? AND chat_id = \?/.test(sql))
    expect(checkCall[1]).toEqual([5, '1'])
    const insertCall = pool.query.mock.calls.find(([sql]) => /INSERT INTO messages/.test(sql))
    expect(insertCall[1]).toEqual(['1', 1, 'hi', null, null, 5])
    expect(res.body.reply_to).toBe(5)
    expect(res.body.reply_text).toBe('orig')
    expect(res.body.reply_sender_name).toBe('Bob')
  })

  it('reply_to на сообщение чужого чата → 400, INSERT не уходит', async () => {
    pool.query
      .mockResolvedValueOnce([[{ chat_id: 1 }], []])
      .mockResolvedValueOnce([[], []])
    const res = await post({ text: 'hi', reply_to: 999 })
    expect(res.status).toBe(400)
    expect(pool.query.mock.calls.filter(([sql]) => /INSERT INTO messages/.test(sql))).toHaveLength(0)
  })

  it('нецелый или отрицательный reply_to → 400 без единого запроса к БД', async () => {
    for (const bad of ['abc', -3, 1.5, {}, true]) {
      pool.query.mockReset()
      const res = await post({ text: 'hi', reply_to: bad })
      expect(res.status).toBe(400)
      expect(pool.query).not.toHaveBeenCalled()
    }
  })
})

describe('POST /api/chats/:chatId/messages/:msgId/reactions', () => {
  it('toggles reaction', async () => {
    pool.query
      .mockResolvedValueOnce([[{ chat_id: 1 }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ insertId: 10 }, []])
      .mockResolvedValueOnce([[{ id: 10, message_id: 1, user_id: 1, emoji: '👍', created_at: new Date().toISOString(), user_name: 'Me' }], []])
    const app = createApp()
    const res = await request(app).post('/api/chats/1/messages/1/reactions').set('Authorization', `Bearer ${authToken()}`).send({ emoji: '👍' })
    expect(res.status).toBe(201)
    expect(res.body).toHaveProperty('emoji', '👍')
  })
})

describe('POST /api/likes', () => {
  it('requires auth', async () => {
    const app = createApp()
    const res = await request(app).post('/api/likes').send({ liked_user_id: 2 })
    expect(res.status).toBe(401)
  })

  it('sends like and creates notification', async () => {
    // Очередь полная: роут делает 7 запросов (существующий лайк, insert лайка,
    // insert уведомления, select уведомления, display_name, затем загрузка
    // настроек уведомлений). Раньше шестого значения не хватало, и тест
    // добирал его остатком очереди из предыдущего теста — зелёный по чужой
    // причине и красный в одиночном прогоне.
    pool.query
      .mockResolvedValueOnce([[{ id: 1 }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ insertId: 1 }, []])
      .mockResolvedValueOnce([[{ id: 1, type: 'like', payload: '{}', created_at: new Date().toISOString() }], []])
      .mockResolvedValueOnce([[{ display_name: 'Test' }], []])
      .mockResolvedValueOnce([[], []])
    const app = createApp()
    const res = await request(app).post('/api/likes').set('Authorization', `Bearer ${authToken()}`).send({ liked_user_id: 2 })
    expect(res.status).toBe(201)
  })
})
