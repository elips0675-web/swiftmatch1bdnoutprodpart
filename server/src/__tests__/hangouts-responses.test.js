vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
  delete process.env.REDIS_URL
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'

vi.mock('../db.js', () => ({ default: { query: vi.fn(), getConnection: vi.fn() } }))

const { emitMock, toMock, ioState } = vi.hoisted(() => {
  const state = { down: false, throwOnTo: false }
  const emit = vi.fn()
  const to = vi.fn(() => {
    if (state.throwOnTo) throw new Error('io down')
    return { emit }
  })
  return { emitMock: emit, toMock: to, ioState: state }
})
vi.mock('../ws.js', () => ({ getIO: vi.fn(() => (ioState.down ? null : { to: toMock })) }))

const { bannedState } = vi.hoisted(() => ({ bannedState: { banned: false } }))
vi.mock('../banned-words.js', () => ({
  getBannedWords: vi.fn(async () => []),
  containsBannedWord: vi.fn(() => bannedState.banned),
}))

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn(async () => {}) }))
vi.mock('../routes/push.js', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  sendPushToUser: pushMock,
  sendPushToAll: vi.fn(),
}))

vi.mock('../routes/experiments.js', () => ({ trackEvent: vi.fn(async () => {}) }))

const { prefsState } = vi.hoisted(() => ({ prefsState: { inApp: true, push: true } }))
vi.mock('../notification-prefs.js', () => ({
  getPrefs: vi.fn(async () => ({})),
  getPrefsMap: vi.fn(async () => ({})),
  isAllowed: vi.fn(() => true),
  isAllowedIn: vi.fn((_prefs, _userId, _type, channel) => (channel === 'push' ? prefsState.push : prefsState.inApp)),
}))

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import pool from '../db.js'
import logger from '../logger.js'
import hangoutsRoutes from '../routes/hangouts.js'

const JWT_SECRET = 'test-secret'
const app = express()
app.use(express.json())
app.use(hangoutsRoutes)

const as = (userId = 1) => ({
  Authorization: `Bearer ${jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })}`,
})

const hangoutRow = (over = {}) => ({
  id: 5,
  user_id: 2,
  status: 'active',
  title: 'Кофе',
  price: 0,
  capacity: null,
  max_companions: 2,
  hangout_type: 'date',
  ...over,
})

const responseRow = (over = {}) => ({ id: 11, user_id: 3, status: 'pending', ...over })

const { conn } = vi.hoisted(() => ({
  conn: { execute: vi.fn(), query: vi.fn(), release: vi.fn() },
}))

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockReset()
  pool.getConnection.mockReset()
  pool.query.mockResolvedValue([[], []])
  pool.getConnection.mockResolvedValue(conn)
  conn.execute.mockReset()
  conn.execute.mockResolvedValue([[], []])
  conn.query.mockReset()
  conn.query.mockResolvedValue([[], []])
  bannedState.banned = false
  prefsState.inApp = true
  prefsState.push = true
  ioState.down = false
  ioState.throwOnTo = false
  pushMock.mockResolvedValue(undefined)
})

describe('POST /api/hangouts/:id/respond', () => {
  it('нечисловой id — 400 без запросов в БД', async () => {
    const res = await request(app).post('/api/hangouts/abc/respond').set(as()).send({})
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('встреча не найдена — 404', async () => {
    const res = await request(app).post('/api/hangouts/5/respond').set(as()).send({})
    expect(res.status).toBe(404)
  })

  it('отклик на свою встречу — 400', async () => {
    pool.query.mockResolvedValueOnce([[hangoutRow({ user_id: 1 })], []])
    const res = await request(app).post('/api/hangouts/5/respond').set(as(1)).send({})
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/your own hangout/)
  })

  it('встреча не активна — 409', async () => {
    pool.query.mockResolvedValueOnce([[hangoutRow({ status: 'cancelled' })], []])
    const res = await request(app).post('/api/hangouts/5/respond').set(as(1)).send({})
    expect(res.status).toBe(409)
    expect(res.body.message).toBe('Hangout is cancelled')
  })

  it('платная встреча без оплаченного билета — 402 с ценой', async () => {
    pool.query
      .mockResolvedValueOnce([[hangoutRow({ price: 500 })], []])
      .mockResolvedValueOnce([[], []])
    const res = await request(app).post('/api/hangouts/5/respond').set(as(1)).send({})
    expect(res.status).toBe(402)
    expect(res.body).toEqual({ message: 'PAYMENT_REQUIRED', price: 500 })
  })

  it('capacity заполнен проданными билетами — 409 CAPACITY_FULL', async () => {
    pool.query
      .mockResolvedValueOnce([[hangoutRow({ price: 500, capacity: 2, hangout_type: 'company' })], []])
      .mockResolvedValueOnce([[{ status: 'paid' }], []])
      .mockResolvedValueOnce([[{ cnt: 2 }], []])
    const res = await request(app).post('/api/hangouts/5/respond').set(as(1)).send({})
    expect(res.status).toBe(409)
    expect(res.body.message).toBe('CAPACITY_FULL')
  })

  it('для date-встречи в capacity входят принятые отклики', async () => {
    pool.query
      .mockResolvedValueOnce([[hangoutRow({ price: 500, capacity: 2, hangout_type: 'date' })], []])
      .mockResolvedValueOnce([[{ status: 'paid' }], []])
      .mockResolvedValueOnce([[{ cnt: 0 }], []])
      .mockResolvedValueOnce([[{ cnt: 2 }], []])
    const res = await request(app).post('/api/hangouts/5/respond').set(as(1)).send({})
    expect(res.status).toBe(409)
    expect(res.body.message).toBe('CAPACITY_FULL')
  })

  it('запрещённое слово в сообщении — 403 до INSERT', async () => {
    bannedState.banned = true
    pool.query.mockResolvedValueOnce([[hangoutRow()], []])
    const res = await request(app).post('/api/hangouts/5/respond').set(as(1)).send({ message: 'плохо' })
    expect(res.status).toBe(403)
    expect(pool.query.mock.calls.some((c) => String(c[0]).startsWith('INSERT INTO hangout_responses'))).toBe(false)
  })

  it('повторный отклик — 409 Already responded', async () => {
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql)
      if (s.includes('FROM hangouts WHERE id = ?')) return [[hangoutRow()], []]
      if (s.startsWith('INSERT INTO hangout_responses')) {
        const err = new Error('dup')
        err.code = 'ER_DUP_ENTRY'
        throw err
      }
      return [[], []]
    })
    const res = await request(app).post('/api/hangouts/5/respond').set(as(1)).send({})
    expect(res.status).toBe(409)
    expect(res.body.message).toBe('Already responded to this hangout')
  })

  it('успех: новый чат, уведомление и push организатору', async () => {
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql)
      if (s.includes('FROM hangouts WHERE id = ?')) return [[hangoutRow()], []]
      if (s.startsWith('INSERT INTO hangout_responses')) return [{ insertId: 11 }, []]
      if (s.includes('SELECT c.id FROM chats c')) return [[], []]
      if (s.startsWith('INSERT INTO chats')) return [{ insertId: 77 }, []]
      if (s.startsWith('INSERT INTO chat_participants')) return [{}, []]
      if (s.includes('INSERT IGNORE INTO hangout_chats')) return [{}, []]
      if (s.includes('SELECT display_name FROM user_profiles')) return [[{ display_name: 'Маша' }], []]
      if (s.startsWith('INSERT INTO notifications')) return [{ insertId: 5 }, []]
      if (s.includes('FROM notifications WHERE id = ?')) return [[{ id: 5, type: 'hangout_response' }], []]
      return [[], []]
    })
    const res = await request(app).post('/api/hangouts/5/respond').set(as(1)).send({ message: '<b>Привет</b>' })
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ id: 11, message: 'Response sent', chat_id: 77 })
    const insertResponse = pool.query.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO hangout_responses'))
    expect(insertResponse[1]).toEqual(['5', 1, 'Привет'])
    const link = pool.query.mock.calls.find((c) => String(c[0]).includes('INSERT IGNORE INTO hangout_chats'))
    expect(link[1]).toEqual(['5', 11, 77])
    const participants = pool.query.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO chat_participants'))
    expect(participants[1]).toEqual([77, 1, 77, 2])
    expect(toMock).toHaveBeenCalledWith('user:2')
    expect(emitMock).toHaveBeenCalledWith('hangout:new_response', expect.objectContaining({ hangoutId: 5, responseId: 11, fromUserId: 1, fromName: 'Маша' }))
    expect(emitMock).toHaveBeenCalledWith('notification:new', expect.objectContaining({ id: 5 }))
    expect(pushMock).toHaveBeenCalledWith(2, 'SwiftMatch', 'Маша wants to join: Кофе')
  })

  it('успех: существующий личный чат переиспользуется', async () => {
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql)
      if (s.includes('FROM hangouts WHERE id = ?')) return [[hangoutRow()], []]
      if (s.startsWith('INSERT INTO hangout_responses')) return [{ insertId: 11 }, []]
      if (s.includes('SELECT c.id FROM chats c')) return [[{ id: 42 }], []]
      if (s.includes('INSERT IGNORE INTO hangout_chats')) return [{}, []]
      if (s.includes('SELECT display_name FROM user_profiles')) return [[{ display_name: 'Маша' }], []]
      return [[], []]
    })
    prefsState.inApp = false
    prefsState.push = false
    const res = await request(app).post('/api/hangouts/5/respond').set(as(1)).send({})
    expect(res.status).toBe(201)
    expect(res.body.chat_id).toBe(42)
    expect(pool.query.mock.calls.some((c) => String(c[0]).startsWith('INSERT INTO chats'))).toBe(false)
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('падение создания чата не фатально: 201, chat_id null, warn', async () => {
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql)
      if (s.includes('FROM hangouts WHERE id = ?')) return [[hangoutRow()], []]
      if (s.startsWith('INSERT INTO hangout_responses')) return [{ insertId: 11 }, []]
      if (s.includes('SELECT c.id FROM chats c')) throw new Error('chat down')
      if (s.includes('SELECT display_name FROM user_profiles')) return [[{ display_name: 'Маша' }], []]
      return [[], []]
    })
    prefsState.inApp = false
    prefsState.push = false
    const res = await request(app).post('/api/hangouts/5/respond').set(as(1)).send({})
    expect(res.status).toBe(201)
    expect(res.body.chat_id).toBeNull()
    expect(logger.warn).toHaveBeenCalledWith('Hangout pre-accept chat error (non-fatal):', expect.any(Error))
  })

  it('нулевой id найденного чата не привязывает его к отклику', async () => {
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql)
      if (s.includes('FROM hangouts WHERE id = ?')) return [[hangoutRow()], []]
      if (s.startsWith('INSERT INTO hangout_responses')) return [{ insertId: 11 }, []]
      if (s.includes('SELECT c.id FROM chats c')) return [[{ id: 0 }], []]
      if (s.includes('SELECT display_name FROM user_profiles')) return [[], []]
      return [[], []]
    })
    prefsState.inApp = false
    prefsState.push = false
    const res = await request(app).post('/api/hangouts/5/respond').set(as(1)).send({})
    expect(res.status).toBe(201)
    expect(res.body.chat_id).toBe(0)
    expect(pool.query.mock.calls.some((c) => String(c[0]).includes('INSERT IGNORE INTO hangout_chats'))).toBe(false)
  })

  it('пустое сообщение сохраняется как NULL', async () => {
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql)
      if (s.includes('FROM hangouts WHERE id = ?')) return [[hangoutRow()], []]
      if (s.startsWith('INSERT INTO hangout_responses')) return [{ insertId: 11 }, []]
      if (s.includes('SELECT c.id FROM chats c')) return [[{ id: 42 }], []]
      if (s.includes('SELECT display_name FROM user_profiles')) return [[], []]
      return [[], []]
    })
    prefsState.inApp = false
    prefsState.push = false
    const res = await request(app).post('/api/hangouts/5/respond').set(as(1)).send({ message: '<b></b>' })
    expect(res.status).toBe(201)
    const insertResponse = pool.query.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO hangout_responses'))
    expect(insertResponse[1]).toEqual(['5', 1, null])
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).post('/api/hangouts/5/respond').set(as(1)).send({})
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Hangout respond error:', expect.any(Error))
  })

  it('падение realtime-эмита не отменяет сохранённый отклик: 201 и warn', async () => {
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql)
      if (s.includes('FROM hangouts WHERE id = ?')) return [[hangoutRow()], []]
      if (s.startsWith('INSERT INTO hangout_responses')) return [{ insertId: 11 }, []]
      if (s.includes('SELECT c.id FROM chats c')) return [[{ id: 42 }], []]
      if (s.includes('SELECT display_name FROM user_profiles')) return [[{ display_name: 'Маша' }], []]
      if (s.startsWith('INSERT INTO notifications')) return [{ insertId: 5 }, []]
      return [[], []]
    })
    ioState.throwOnTo = true
    const res = await request(app).post('/api/hangouts/5/respond').set(as(1)).send({})
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ id: 11, message: 'Response sent', chat_id: 42 })
    expect(logger.warn).toHaveBeenCalledWith('Hangout respond realtime emit failed (non-fatal):', expect.any(Error))
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('профиль откликнувшегося не найден — push с «Someone»', async () => {
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql)
      if (s.includes('FROM hangouts WHERE id = ?')) return [[hangoutRow()], []]
      if (s.startsWith('INSERT INTO hangout_responses')) return [{ insertId: 11 }, []]
      if (s.includes('SELECT c.id FROM chats c')) return [[{ id: 42 }], []]
      if (s.includes('SELECT display_name FROM user_profiles')) return [[], []]
      return [[], []]
    })
    prefsState.inApp = false
    const res = await request(app).post('/api/hangouts/5/respond').set(as(1)).send({})
    expect(res.status).toBe(201)
    expect(pushMock).toHaveBeenCalledWith(2, 'SwiftMatch', 'Someone wants to join: Кофе')
  })

  it('сокеты не подняты — отклик сохраняется, эмитов нет', async () => {
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql)
      if (s.includes('FROM hangouts WHERE id = ?')) return [[hangoutRow()], []]
      if (s.startsWith('INSERT INTO hangout_responses')) return [{ insertId: 11 }, []]
      if (s.includes('SELECT c.id FROM chats c')) return [[{ id: 42 }], []]
      if (s.includes('SELECT display_name FROM user_profiles')) return [[{ display_name: 'Маша' }], []]
      if (s.startsWith('INSERT INTO notifications')) return [{ insertId: 5 }, []]
      return [[], []]
    })
    ioState.down = true
    const res = await request(app).post('/api/hangouts/5/respond').set(as(1)).send({})
    expect(res.status).toBe(201)
    expect(toMock).not.toHaveBeenCalled()
    expect(pool.query.mock.calls.some((c) => String(c[0]).startsWith('INSERT INTO notifications'))).toBe(true)
  })
})

describe('DELETE /api/hangouts/:id/respond', () => {
  it('нечисловой id — 400 без запросов в БД', async () => {
    const res = await request(app).delete('/api/hangouts/abc/respond').set(as())
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('нечего отменять — 404', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 0 }, []])
    const res = await request(app).delete('/api/hangouts/5/respond').set(as())
    expect(res.status).toBe(404)
  })

  it('успешная отмена — 200', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }, []])
    const res = await request(app).delete('/api/hangouts/5/respond').set(as())
    expect(res.status).toBe(200)
    expect(res.body.message).toBe('Response cancelled')
    expect(pool.query.mock.calls[0][1]).toEqual(['5', 1])
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).delete('/api/hangouts/5/respond').set(as())
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Hangout response cancel error:', expect.any(Error))
  })
})

describe('GET /api/hangouts/:id/responses', () => {
  it('нечисловой id — 400 без запросов в БД', async () => {
    const res = await request(app).get('/api/hangouts/abc/responses').set(as())
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('встреча не найдена — 404', async () => {
    const res = await request(app).get('/api/hangouts/5/responses').set(as())
    expect(res.status).toBe(404)
  })

  it('не автор — 403', async () => {
    pool.query.mockResolvedValueOnce([[{ user_id: 2 }], []])
    const res = await request(app).get('/api/hangouts/5/responses').set(as(1))
    expect(res.status).toBe(403)
  })

  it('автор получает список без отменённых', async () => {
    pool.query
      .mockResolvedValueOnce([[{ user_id: 1 }], []])
      .mockResolvedValueOnce([[{ id: 11, user_id: 3, status: 'pending', display_name: 'Маша' }], []])
    const res = await request(app).get('/api/hangouts/5/responses').set(as(1))
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].status).toBe('pending')
    expect(String(pool.query.mock.calls[1][0])).toContain("hr.status != 'cancelled'")
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).get('/api/hangouts/5/responses').set(as())
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Hangout responses error:', expect.any(Error))
  })
})

describe('PUT /api/hangouts/:id/responses/:responseId', () => {
  const route = (id = '5', responseId = '11') => `/api/hangouts/${id}/responses/${responseId}`

  it('нечисловые id — 400 без подключения к БД', async () => {
    for (const url of [route('abc', '11'), route('5', 'abc')]) {
      const res = await request(app).put(url).set(as()).send({ status: 'accepted' })
      expect(res.status).toBe(400)
    }
    expect(pool.getConnection).not.toHaveBeenCalled()
  })

  it('недопустимый статус — 400 без подключения к БД', async () => {
    const res = await request(app).put(route()).set(as()).send({ status: 'maybe' })
    expect(res.status).toBe(400)
    expect(pool.getConnection).not.toHaveBeenCalled()
  })

  const wire = (over = {}) => {
    const state = { hangout: hangoutRow({ user_id: 1 }), response: responseRow(), cnt: 0, cntAccepted: 1, existingPair: [], ...over }
    conn.execute.mockImplementation(async (sql) => {
      const s = String(sql)
      if (s.includes('FROM hangouts WHERE id = ?')) return [[state.hangout], []]
      if (s.includes('FROM hangout_responses WHERE id = ? AND hangout_id = ?')) return [[state.response], []]
      if (s.includes("COUNT(*) AS cnt FROM hangout_responses")) return [[{ cnt: state.cnt }], []]
      if (s.startsWith('INSERT INTO chats')) return [{ insertId: 88 }, []]
      if (s.startsWith('INSERT INTO chat_participants')) return [{}, []]
      if (s.includes('INSERT IGNORE INTO hangout_chats')) return [{}, []]
      if (s.includes('COUNT(*) AS cntAccepted')) return [[{ cntAccepted: state.cntAccepted }], []]
      return [{}, []]
    })
    conn.query.mockImplementation(async (sql) => {
      const s = String(sql)
      if (s.includes('SELECT chat_id FROM hangout_chats')) return [[{ chat_id: 5 }], []]
      if (s.includes('SELECT c.id FROM chats c')) return [state.existingPair, []]
      return [[], []]
    })
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql)
      if (s.startsWith('INSERT INTO notifications')) return [{ insertId: 7 }, []]
      if (s.includes('FROM notifications WHERE id = ?')) return [[{ id: 7, type: 'hangout_accepted' }], []]
      if (s.includes('SELECT display_name FROM user_profiles')) return [[{ display_name: 'Автор' }], []]
      return [[], []]
    })
    return state
  }

  it('встреча не найдена — 404 с release', async () => {
    wire({ hangout: null })
    const res = await request(app).put(route()).set(as()).send({ status: 'accepted' })
    expect(res.status).toBe(404)
    expect(conn.release).toHaveBeenCalled()
  })

  it('не автор — 403', async () => {
    wire({ hangout: hangoutRow({ user_id: 2 }) })
    const res = await request(app).put(route()).set(as(1)).send({ status: 'accepted' })
    expect(res.status).toBe(403)
    expect(conn.release).toHaveBeenCalled()
  })

  it('встреча не активна — 409', async () => {
    wire({ hangout: hangoutRow({ user_id: 1, status: 'completed' }) })
    const res = await request(app).put(route()).set(as(1)).send({ status: 'accepted' })
    expect(res.status).toBe(409)
    expect(res.body.message).toBe('Hangout is completed')
  })

  it('отклик не найден — 404', async () => {
    wire({ response: null })
    const res = await request(app).put(route()).set(as(1)).send({ status: 'accepted' })
    expect(res.status).toBe(404)
    expect(res.body.message).toBe('Response not found')
  })

  it('повторное принятие возвращает существующий chat_id', async () => {
    wire({ response: responseRow({ status: 'accepted' }) })
    const res = await request(app).put(route()).set(as(1)).send({ status: 'accepted' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ message: 'Already accepted', chat_id: 5 })
    expect(conn.release).toHaveBeenCalled()
  })

  it('лимит компаньонов достигнут — 409 без UPDATE', async () => {
    wire({ cnt: 2 })
    const res = await request(app).put(route()).set(as(1)).send({ status: 'accepted' })
    expect(res.status).toBe(409)
    expect(res.body.message).toBe('Max companions reached')
    expect(conn.execute.mock.calls.some((c) => String(c[0]).startsWith('UPDATE hangout_responses'))).toBe(false)
  })

  it('принятие: новый чат, уведомление, push и trackEvent', async () => {
    wire()
    const res = await request(app).put(route()).set(as(1)).send({ status: 'accepted' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ message: 'Response accepted', chat_id: 88 })
    expect(conn.execute.mock.calls.some((c) => String(c[0]).startsWith('INSERT INTO chats'))).toBe(true)
    expect(pushMock).toHaveBeenCalledWith(3, 'SwiftMatch', 'Автор accepted your response!')
    expect(emitMock).toHaveBeenCalledWith('hangout:response_accepted', expect.objectContaining({ hangoutId: 5, responseId: 11, chatId: 88, status: 'accepted' }))
    expect(emitMock).toHaveBeenCalledWith('notification:new', expect.objectContaining({ id: 7 }))
    expect(conn.release).toHaveBeenCalled()
  })

  it('принятие переиспользует существующий чат', async () => {
    wire({ existingPair: [{ id: 42 }] })
    const res = await request(app).put(route()).set(as(1)).send({ status: 'accepted' })
    expect(res.status).toBe(200)
    expect(res.body.chat_id).toBe(42)
    expect(conn.execute.mock.calls.some((c) => String(c[0]).startsWith('INSERT INTO chats'))).toBe(false)
  })

  it('последний принятый отклик закрывает встречу как completed', async () => {
    wire({ cntAccepted: 2 })
    const res = await request(app).put(route()).set(as(1)).send({ status: 'accepted' })
    expect(res.status).toBe(200)
    const completed = conn.execute.mock.calls.find((c) => String(c[0]).includes("UPDATE hangouts SET status = 'completed'"))
    expect(completed).toBeTruthy()
    expect(completed[1]).toEqual(['5'])
  })

  it('отказ: без чата, без push, статус declined', async () => {
    wire({ response: responseRow({ status: 'pending' }) })
    const res = await request(app).put(route()).set(as(1)).send({ status: 'declined' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ message: 'Response declined', chat_id: null })
    expect(conn.execute.mock.calls.some((c) => String(c[0]).startsWith('INSERT INTO chats'))).toBe(false)
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('падение в транзакции — release, 500 и лог', async () => {
    wire()
    conn.execute.mockImplementation(async (sql) => {
      const s = String(sql)
      if (s.includes('FROM hangouts WHERE id = ?')) return [[hangoutRow({ user_id: 1 })], []]
      if (s.includes('FROM hangout_responses WHERE id = ? AND hangout_id = ?')) throw new Error('db down')
      return [[], []]
    })
    const res = await request(app).put(route()).set(as(1)).send({ status: 'accepted' })
    expect(res.status).toBe(500)
    expect(conn.release).toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledWith('Hangout response decision error:', expect.any(Error))
  })

  it('повторное принятие без строки hangout_chats отдаёт chat_id null', async () => {
    wire({ response: responseRow({ status: 'accepted' }) })
    conn.query.mockImplementation(async () => [[], []])
    const res = await request(app).put(route()).set(as(1)).send({ status: 'accepted' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ message: 'Already accepted', chat_id: null })
    expect(conn.release).toHaveBeenCalled()
  })

  it('принятие при выключенном in-app: без уведомления и эмита, push остаётся', async () => {
    wire()
    prefsState.inApp = false
    ioState.down = true
    const res = await request(app).put(route()).set(as(1)).send({ status: 'accepted' })
    expect(res.status).toBe(200)
    expect(pool.query.mock.calls.some((c) => String(c[0]).startsWith('INSERT INTO notifications'))).toBe(false)
    expect(toMock).not.toHaveBeenCalled()
    expect(pushMock).toHaveBeenCalledWith(3, 'SwiftMatch', 'Автор accepted your response!')
  })

  it('принятие без сокетов: уведомление пишется, эмита нет', async () => {
    wire()
    ioState.down = true
    const res = await request(app).put(route()).set(as(1)).send({ status: 'accepted' })
    expect(res.status).toBe(200)
    expect(pool.query.mock.calls.some((c) => String(c[0]).startsWith('INSERT INTO notifications'))).toBe(true)
    expect(pool.query.mock.calls.some((c) => String(c[0]).includes('FROM notifications WHERE id = ?'))).toBe(false)
    expect(toMock).not.toHaveBeenCalled()
  })

  it('принятие при выключенном push: уведомление есть, push нет', async () => {
    wire()
    prefsState.push = false
    const res = await request(app).put(route()).set(as(1)).send({ status: 'accepted' })
    expect(res.status).toBe(200)
    expect(pushMock).not.toHaveBeenCalled()
    expect(pool.query.mock.calls.some((c) => String(c[0]).startsWith('INSERT INTO notifications'))).toBe(true)
  })

  it('автор без профиля — push с «The author»', async () => {
    wire()
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql)
      if (s.includes('SELECT display_name FROM user_profiles')) return [[], []]
      if (s.startsWith('INSERT INTO notifications')) return [{ insertId: 7 }, []]
      return [[], []]
    })
    const res = await request(app).put(route()).set(as(1)).send({ status: 'accepted' })
    expect(res.status).toBe(200)
    expect(pushMock).toHaveBeenCalledWith(3, 'SwiftMatch', 'The author accepted your response!')
  })
})
