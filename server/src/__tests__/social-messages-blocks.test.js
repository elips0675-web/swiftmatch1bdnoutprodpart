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

const { bannedState } = vi.hoisted(() => ({ bannedState: { hit: false, fail: false } }))
vi.mock('../banned-words.js', () => ({
  getBannedWords: vi.fn(async () => {
    if (bannedState.fail) throw new Error('bw down')
    return []
  }),
  containsBannedWord: vi.fn(() => bannedState.hit),
}))

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }))
vi.mock('../routes/push.js', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  sendPushToUser: pushMock,
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

const messageRow = (over = {}) => ({
  id: 100,
  sender_id: 1,
  text: 'привет',
  image_url: null,
  reply_to: null,
  ttl_seconds: null,
  created_at: '2026-10-20T10:00:00.000Z',
  edited_at: null,
  sender_name: 'Я',
  reply_sender_name: null,
  reply_text: null,
  reply_image_url: null,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockReset()
  pool.query.mockResolvedValue([[], []])
  bannedState.hit = false
  bannedState.fail = false
  isAllowedMock.mockResolvedValue(true)
})

describe('POST /api/chats', () => {
  it('без participant_id — 400 без запросов в БД', async () => {
    const res = await request(app).post('/api/chats').set(as()).send({})
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/participant_id/)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('существующий личный чат возвращается с existing: true, новый не создаётся', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 5 }], []])
    const res = await request(app).post('/api/chats').set(as()).send({ participant_id: 2 })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: 5, existing: true })
    expect(pool.query.mock.calls.some((c) => String(c[0]).startsWith('INSERT INTO chats'))).toBe(false)
  })

  it('новый чат: создаётся строка чата и оба участника одним INSERT', async () => {
    pool.query.mockResolvedValueOnce([[], []]).mockResolvedValueOnce([{ insertId: 9 }, []])
    const res = await request(app).post('/api/chats').set(as()).send({ participant_id: 2 })
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ id: 9, existing: false })
    const participants = pool.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO chat_participants'))
    expect(participants[1]).toEqual([9, 1, 9, 2])
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).post('/api/chats').set(as()).send({ participant_id: 2 })
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Chat create error:', expect.any(Error))
  })
})

describe('GET /api/chats/:chatId/messages: ошибка', () => {
  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).get('/api/chats/5/messages').set(as())
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Messages error:', expect.any(Error))
  })
})

describe('POST /api/chats/:chatId/messages: валидация', () => {
  it('без текста и картинки — 400 без запросов в БД', async () => {
    const res = await request(app).post('/api/chats/5/messages').set(as()).send({})
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('нечисловой reply_to — 400 без запросов в БД', async () => {
    const res = await request(app).post('/api/chats/5/messages').set(as()).send({ text: 'a', reply_to: 'abc' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/Invalid reply target/)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('запрещённое слово — 403, сообщение не сохраняется', async () => {
    bannedState.hit = true
    const res = await request(app).post('/api/chats/5/messages').set(as()).send({ text: 'плохое' })
    expect(res.status).toBe(403)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('падение проверки banned words не блокирует отправку', async () => {
    bannedState.fail = true
    pool.query
      .mockResolvedValueOnce([[{ chat_id: 5 }], []])
      .mockResolvedValueOnce([{ insertId: 100 }, []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[messageRow()], []])
    const res = await request(app).post('/api/chats/5/messages').set(as()).send({ text: 'привет' })
    expect(res.status).toBe(201)
    expect(logger.error).toHaveBeenCalledWith('Banned words check error:', expect.any(Error))
  })

  it('не участник чата — 403', async () => {
    const res = await request(app).post('/api/chats/5/messages').set(as()).send({ text: 'привет' })
    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/Not a participant/)
  })

  it('reply_to ссылается на сообщение другого чата — 400', async () => {
    pool.query.mockResolvedValueOnce([[{ chat_id: 5 }], []]).mockResolvedValueOnce([[], []])
    const res = await request(app).post('/api/chats/5/messages').set(as()).send({ text: 'a', reply_to: 99 })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/Invalid reply target/)
  })
})

describe('POST /api/chats/:chatId/messages: отправка', () => {
  it('сохраняет текст без HTML, обновляет превью чата и пушит получателю', async () => {
    pool.query
      .mockResolvedValueOnce([[{ chat_id: 5 }], []])
      .mockResolvedValueOnce([{ insertId: 100 }, []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[messageRow()], []])
      .mockResolvedValueOnce([[{ user_id: 2 }], []])
      .mockResolvedValueOnce([[{ display_name: 'Я' }], []])
    const res = await request(app).post('/api/chats/5/messages').set(as()).send({ text: '<b>привет</b>', ttl_seconds: 60 })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe(100)
    const insert = pool.query.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO messages'))
    expect(insert[1]).toEqual(['5', 1, 'привет', null, 60, null])
    const preview = pool.query.mock.calls.find((c) => String(c[0]).startsWith('UPDATE chats SET last_message'))
    expect(preview[1]).toEqual(['привет', 1, '5'])
    expect(pushMock).toHaveBeenCalledWith(2, 'Я', 'привет', '/chats?matchId=2')
    expect(toMock).toHaveBeenCalledWith('user:2')
    expect(emitMock).toHaveBeenCalledWith('chat:message', expect.objectContaining({ chatId: 5 }))
  })

  it('сообщение только с картинкой: текст NULL, превью «📷 Photo», push не падает на undefined', async () => {
    pool.query
      .mockResolvedValueOnce([[{ chat_id: 5 }], []])
      .mockResolvedValueOnce([{ insertId: 100 }, []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[messageRow({ text: null, image_url: '/x.jpg' })], []])
      .mockResolvedValueOnce([[{ user_id: 2 }], []])
      .mockResolvedValueOnce([[{ display_name: 'Я' }], []])
    const res = await request(app).post('/api/chats/5/messages').set(as()).send({ image_url: '/x.jpg' })
    expect(res.status).toBe(201)
    const insert = pool.query.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO messages'))
    expect(insert[1][2]).toBeNull()
    const preview = pool.query.mock.calls.find((c) => String(c[0]).startsWith('UPDATE chats SET last_message'))
    expect(preview[1][0]).toBe('📷 Photo')
    expect(pushMock).toHaveBeenCalledWith(2, 'Я', '', '/chats?matchId=2')
  })

  it('получатель выключил push — WS-событие остаётся, push не уходит', async () => {
    isAllowedMock.mockResolvedValue(false)
    pool.query
      .mockResolvedValueOnce([[{ chat_id: 5 }], []])
      .mockResolvedValueOnce([{ insertId: 100 }, []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[messageRow()], []])
      .mockResolvedValueOnce([[{ user_id: 2 }], []])
      .mockResolvedValueOnce([[{ display_name: 'Я' }], []])
    const res = await request(app).post('/api/chats/5/messages').set(as()).send({ text: 'привет' })
    expect(res.status).toBe(201)
    expect(pushMock).not.toHaveBeenCalled()
    expect(emitMock).toHaveBeenCalledWith('chat:message', expect.any(Object))
  })

  it('в чате нет второго участника — ни push, ни WS', async () => {
    pool.query
      .mockResolvedValueOnce([[{ chat_id: 5 }], []])
      .mockResolvedValueOnce([{ insertId: 100 }, []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[messageRow()], []])
      .mockResolvedValueOnce([[], []])
    const res = await request(app).post('/api/chats/5/messages').set(as()).send({ text: 'привет' })
    expect(res.status).toBe(201)
    expect(pushMock).not.toHaveBeenCalled()
    expect(emitMock).not.toHaveBeenCalled()
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).post('/api/chats/5/messages').set(as()).send({ text: 'привет' })
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Message send error:', expect.any(Error))
  })
})

describe('DELETE /api/chats/:chatId/messages/:msgId', () => {
  it('сообщение не найдено — 404', async () => {
    const res = await request(app).delete('/api/chats/5/messages/100').set(as())
    expect(res.status).toBe(404)
  })

  it('чужое сообщение — 403, DELETE не выполняется', async () => {
    pool.query.mockResolvedValueOnce([[{ sender_id: 2 }], []])
    const res = await request(app).delete('/api/chats/5/messages/100').set(as(1))
    expect(res.status).toBe(403)
    expect(pool.query.mock.calls.some((c) => String(c[0]).startsWith('DELETE FROM messages'))).toBe(false)
  })

  it('своё сообщение удаляется', async () => {
    pool.query.mockResolvedValueOnce([[{ sender_id: 1 }], []])
    const res = await request(app).delete('/api/chats/5/messages/100').set(as(1))
    expect(res.status).toBe(200)
    const del = pool.query.mock.calls.find((c) => String(c[0]).startsWith('DELETE FROM messages'))
    expect(del[1]).toEqual(['100'])
  })
})

describe('PUT /api/chats/:chatId/messages/:msgId', () => {
  it('пустой текст — 400 без запросов в БД', async () => {
    const res = await request(app).put('/api/chats/5/messages/100').set(as()).send({ text: '   ' })
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('запрещённое слово — 403 без запросов в БД', async () => {
    bannedState.hit = true
    const res = await request(app).put('/api/chats/5/messages/100').set(as()).send({ text: 'плохое' })
    expect(res.status).toBe(403)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('падение проверки banned words не блокирует правку', async () => {
    bannedState.fail = true
    pool.query
      .mockResolvedValueOnce([[{ chat_id: 5 }], []])
      .mockResolvedValueOnce([[{ id: 100, sender_id: 1, created_at: new Date().toISOString() }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[messageRow({ text: 'новый' })], []])
      .mockResolvedValueOnce([[], []])
    const res = await request(app).put('/api/chats/5/messages/100').set(as()).send({ text: 'новый' })
    expect(res.status).toBe(200)
    expect(logger.error).toHaveBeenCalledWith('Banned words check error:', expect.any(Error))
  })

  it('не участник — 403', async () => {
    const res = await request(app).put('/api/chats/5/messages/100').set(as()).send({ text: 'новый' })
    expect(res.status).toBe(403)
  })

  it('сообщение не найдено — 404', async () => {
    pool.query.mockResolvedValueOnce([[{ chat_id: 5 }], []]).mockResolvedValueOnce([[], []])
    const res = await request(app).put('/api/chats/5/messages/100').set(as()).send({ text: 'новый' })
    expect(res.status).toBe(404)
  })

  it('чужое сообщение — 403', async () => {
    pool.query
      .mockResolvedValueOnce([[{ chat_id: 5 }], []])
      .mockResolvedValueOnce([[{ id: 100, sender_id: 2, created_at: new Date().toISOString() }], []])
    const res = await request(app).put('/api/chats/5/messages/100').set(as()).send({ text: 'новый' })
    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/Not your message/)
  })

  it('окно правки 15 минут истекло — 403', async () => {
    const old = new Date(Date.now() - 16 * 60 * 1000).toISOString()
    pool.query
      .mockResolvedValueOnce([[{ chat_id: 5 }], []])
      .mockResolvedValueOnce([[{ id: 100, sender_id: 1, created_at: old }], []])
    const res = await request(app).put('/api/chats/5/messages/100').set(as()).send({ text: 'новый' })
    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/Edit window expired/)
  })

  it('успешная правка обновляет текст и шлёт chat:message-edited', async () => {
    pool.query
      .mockResolvedValueOnce([[{ chat_id: 5 }], []])
      .mockResolvedValueOnce([[{ id: 100, sender_id: 1, created_at: new Date().toISOString() }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[messageRow({ text: 'новый' })], []])
      .mockResolvedValueOnce([[{ user_id: 2 }], []])
    const res = await request(app).put('/api/chats/5/messages/100').set(as()).send({ text: '  новый  ' })
    expect(res.status).toBe(200)
    expect(res.body.text).toBe('новый')
    const update = pool.query.mock.calls.find((c) => String(c[0]).startsWith('UPDATE messages SET text'))
    expect(update[1]).toEqual(['новый', '100'])
    expect(emitMock).toHaveBeenCalledWith('chat:message-edited', expect.objectContaining({ chatId: 5 }))
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).put('/api/chats/5/messages/100').set(as()).send({ text: 'новый' })
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Edit message error:', expect.any(Error))
  })
})

describe('POST /api/chats/:chatId/messages/:msgId/reactions', () => {
  it('без emoji — 400 без запросов в БД', async () => {
    const res = await request(app).post('/api/chats/5/messages/100/reactions').set(as()).send({})
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('не участник — 403', async () => {
    const res = await request(app).post('/api/chats/5/messages/100/reactions').set(as()).send({ emoji: '❤️' })
    expect(res.status).toBe(403)
  })

  it('повторная реакция снимается', async () => {
    pool.query.mockResolvedValueOnce([[{ chat_id: 5 }], []]).mockResolvedValueOnce([[{ id: 7 }], []])
    const res = await request(app).post('/api/chats/5/messages/100/reactions').set(as()).send({ emoji: '❤️' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ message: 'Reaction removed', action: 'removed' })
    const del = pool.query.mock.calls.find((c) => String(c[0]).startsWith('DELETE FROM message_reactions'))
    expect(del[1]).toEqual([7])
  })

  it('новая реакция создаётся', async () => {
    pool.query
      .mockResolvedValueOnce([[{ chat_id: 5 }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ insertId: 8 }, []])
      .mockResolvedValueOnce([[{ id: 8, message_id: 100, user_id: 1, emoji: '❤️', user_name: 'Я' }], []])
    const res = await request(app).post('/api/chats/5/messages/100/reactions').set(as()).send({ emoji: '❤️' })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe(8)
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).post('/api/chats/5/messages/100/reactions').set(as()).send({ emoji: '❤️' })
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Reaction error:', expect.any(Error))
  })
})

describe('GET /api/activity', () => {
  it('отдаёт ленту активности', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 1, action_type: 'like', user_name: 'Маша' }], []])
    const res = await request(app).get('/api/activity').set(as())
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).get('/api/activity').set(as())
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Activity error:', expect.any(Error))
  })
})

describe('POST /api/block', () => {
  it('без blocked_id — 400 без запросов в БД', async () => {
    const res = await request(app).post('/api/block').set(as()).send({})
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('блокировка себя — 400 без запросов в БД', async () => {
    const res = await request(app).post('/api/block').set(as(1)).send({ blocked_id: 1 })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/yourself/)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('блокировка чистит лайки и матчи в обе стороны', async () => {
    const res = await request(app).post('/api/block').set(as(1)).send({ blocked_id: 2 })
    expect(res.status).toBe(200)
    const block = pool.query.mock.calls[0]
    expect(block[0]).toContain('INSERT IGNORE INTO user_blocks')
    expect(block[1]).toEqual([1, 2])
    const likes = pool.query.mock.calls.find((c) => String(c[0]).startsWith('DELETE FROM likes'))
    expect(likes[1]).toEqual([1, 2, 2, 1])
    const matches = pool.query.mock.calls.find((c) => String(c[0]).startsWith('DELETE FROM matches'))
    expect(matches[1]).toEqual([1, 2, 2, 1])
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).post('/api/block').set(as()).send({ blocked_id: 2 })
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Block error:', expect.any(Error))
  })
})

describe('DELETE /api/block/:blocked_id', () => {
  it('разблокировка удаляет запись', async () => {
    const res = await request(app).delete('/api/block/2').set(as(1))
    expect(res.status).toBe(200)
    expect(pool.query.mock.calls[0][1]).toEqual([1, '2'])
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).delete('/api/block/2').set(as())
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Unblock error:', expect.any(Error))
  })
})

describe('GET /api/block/list', () => {
  it('отдаёт список заблокированных', async () => {
    pool.query.mockResolvedValueOnce([[{ blocked_id: 2, display_name: 'Маша' }], []])
    const res = await request(app).get('/api/block/list').set(as())
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).get('/api/block/list').set(as())
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Block list error:', expect.any(Error))
  })
})

describe('GET /api/users/search', () => {
  it('фильтры по интересу/полу/возрасту/городу и совместимость учитываются в SQL и параметрах', async () => {
    pool.query
      .mockResolvedValueOnce([[{ attachment_style: 'secure', lat: 50, lng: 30, passport_mode: 0 }], []])
      .mockResolvedValueOnce([[{ id: 5, display_name: 'Маша' }], []])
    const res = await request(app)
      .get('/api/users/search')
      .query({ interest: 'Спорт', gender: 'female', age_min: 25, age_max: 35, city: 'Москва', lat: 55.75, lng: 37.61, radius: 10 })
      .set(as())
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    const [sql, params] = pool.query.mock.calls[1]
    expect(sql).toContain('compatibility_scores')
    expect(sql).toContain('JOIN user_interests')
    expect(sql).toContain('HAVING distance < ?')
    expect(params).toEqual([37.61, 55.75, 'secure', 1, 1, 1, 'Спорт', 'Спорт', 'female', 25, 35, 'Москва', 10000])
  })

  it('без стиля привязанности и геолокации обходится без JOIN совместимости и HAVING', async () => {
    pool.query
      .mockResolvedValueOnce([[{ attachment_style: null, lat: null, lng: null, passport_mode: 0 }], []])
      .mockResolvedValueOnce([[], []])
    const res = await request(app).get('/api/users/search').set(as())
    expect(res.status).toBe(200)
    const [sql, params] = pool.query.mock.calls[1]
    expect(sql).not.toContain('compatibility_scores')
    expect(sql).not.toContain('HAVING distance')
    expect(params).toEqual([1, 1, 1])
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).get('/api/users/search').set(as())
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Search error:', expect.any(Error))
  })
})

describe('POST /api/likes и GET /api/matches: остаток веток', () => {
  it('лайк без liked_user_id — 400 без запросов в БД', async () => {
    const res = await request(app).post('/api/likes').set(as()).send({})
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('дневной лимит лайков без подписки — 403 LIKE_LIMIT, лайк не пишется', async () => {
    pool.query.mockResolvedValueOnce([[], []]).mockResolvedValueOnce([[{ cnt: 10 }], []])
    const res = await request(app).post('/api/likes').set(as()).send({ liked_user_id: 2 })
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('LIKE_LIMIT')
    expect(pool.query.mock.calls.some((c) => String(c[0]).startsWith('INSERT IGNORE INTO likes'))).toBe(false)
  })

  it('ошибка БД при лайке — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).post('/api/likes').set(as()).send({ liked_user_id: 2 })
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Like error:', expect.any(Error))
  })

  it('ошибка БД при списке матчей — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).get('/api/matches').set(as())
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Matches error:', expect.any(Error))
  })
})
