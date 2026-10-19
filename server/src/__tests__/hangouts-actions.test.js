vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
  delete process.env.REDIS_URL
  delete process.env.STRIPE_SECRET_KEY
  delete process.env.STRIPE_LIVE
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'

vi.mock('../db.js', () => ({ default: { query: vi.fn(), getConnection: vi.fn() } }))

const { emitMock, toMock } = vi.hoisted(() => {
  const emit = vi.fn()
  return { emitMock: emit, toMock: vi.fn(() => ({ emit })) }
})
vi.mock('../ws.js', () => ({ getIO: vi.fn(() => ({ to: toMock })) }))

vi.mock('../banned-words.js', () => ({
  getBannedWords: vi.fn(async () => []),
  containsBannedWord: vi.fn(() => false),
}))

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn(async () => {}) }))
vi.mock('../routes/push.js', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  sendPushToUser: pushMock,
  sendPushToAll: vi.fn(),
}))

vi.mock('../routes/experiments.js', () => ({ trackEvent: vi.fn(async () => {}) }))

const { prefsState } = vi.hoisted(() => ({ prefsState: { inApp: true, push: true, allowed: true } }))
vi.mock('../notification-prefs.js', () => ({
  getPrefs: vi.fn(async () => ({})),
  getPrefsMap: vi.fn(async () => ({})),
  isAllowed: vi.fn(() => prefsState.allowed),
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
  hangout_type: 'date',
  status: 'active',
  title: 'Кофе',
  price: 0,
  capacity: null,
  max_companions: 2,
  ...over,
})

function wire(over = {}) {
  const st = {
    hangout: null,
    ticket: null,
    sold: 0,
    accepted: 0,
    mutual: [],
    existingPair: [],
    newChatId: 88,
    notifId: 7,
    authorName: 'Автор',
    joinerName: 'Маша',
    existing: null,
    count: 0,
    countAfter: 2,
    existingGroupChat: null,
    alreadyParticipant: null,
    updateAffected: 1,
    owner: { user_id: 2 },
    byChatMember: null,
    byChatRow: null,
    fail: null,
    failCode: null,
    ...over,
  }
  pool.query.mockImplementation(async (sql) => {
    const s = String(sql)
    if (st.fail && s.includes(st.fail)) {
      const err = new Error('boom')
      if (st.failCode) err.code = st.failCode
      throw err
    }
    if (s.includes('COUNT(*) AS cnt FROM hangout_tickets')) return [[{ cnt: st.sold }], []]
    if (s.includes('COUNT(*) AS cnt FROM hangout_responses')) return [[{ cnt: st.accepted }], []]
    if (s.includes('COUNT(*) AS cntAfter FROM hangout_participants')) return [[{ cntAfter: st.countAfter }], []]
    if (s.includes("COUNT(*) AS cnt FROM hangout_participants WHERE hangout_id = ? AND status = 'joined'")) return [[{ cnt: st.count }], []]
    if (s.includes('FROM hangout_tickets')) return [st.ticket ? [{ status: 'paid' }] : [], []]
    if (s.includes('SELECT user_id FROM hangouts WHERE id = ?')) return [[st.owner], []]
    if (s.includes('FROM hangouts WHERE id = ?')) return [[st.hangout], []]
    if (s.includes('INSERT INTO hangout_likes')) return [{}, []]
    if (s.includes('FROM hangout_likes WHERE hangout_id = ? AND user_id = ?')) return [st.mutual, []]
    if (s.includes('SELECT c.id FROM chats c')) return [st.existingPair, []]
    if (s.includes('INSERT INTO chats')) return [{ insertId: st.newChatId }, []]
    if (s.includes('INSERT IGNORE INTO hangout_chats')) return [{}, []]
    if (s.includes('INSERT INTO chat_participants')) return [{}, []]
    if (s.includes('INSERT IGNORE INTO chat_participants')) return [{}, []]
    if (s.includes('INSERT INTO notifications')) return [{ insertId: st.notifId }, []]
    if (s.includes('FROM notifications WHERE id = ?')) return [[{ id: st.notifId, type: 'notif' }], []]
    if (s.includes('SELECT up.display_name FROM user_profiles up')) return [[{ display_name: st.authorName }], []]
    if (s.includes('SELECT display_name FROM user_profiles')) return [[{ display_name: st.joinerName }], []]
    if (s.includes('FROM hangout_participants WHERE hangout_id = ? AND user_id = ?')) return [[st.existing].filter(Boolean), []]
    if (s.includes("UPDATE hangout_participants SET status = 'joined'")) return [{ affectedRows: 1 }, []]
    if (s.includes('INSERT INTO hangout_participants')) return [{}, []]
    if (s.includes('FROM hangout_chats hc') && s.includes('JOIN hangouts h')) return [[st.byChatRow], []]
    if (s.includes('FROM hangout_chats hc')) return [[st.existingGroupChat].filter(Boolean), []]
    if (s.includes('SELECT 1 FROM chat_participants WHERE chat_id = ? AND user_id = ?')) return [st.alreadyParticipant ? [{ 1: 1 }] : [], []]
    if (s.includes("UPDATE hangout_participants SET status = 'left'")) return [{ affectedRows: st.updateAffected }, []]
    if (s.includes('SELECT user_id FROM hangouts WHERE id = ?')) return [[st.owner], []]
    if (s.includes('SELECT 1 AS ok FROM chat_participants')) return [st.byChatMember ? [{ ok: 1 }] : [], []]
    return [[], []]
  })
  return st
}

const sqlCalls = () => pool.query.mock.calls.map((c) => String(c[0]))

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockReset()
  pool.getConnection.mockReset()
  pool.query.mockResolvedValue([[], []])
  prefsState.inApp = true
  prefsState.push = true
  prefsState.allowed = true
  pushMock.mockResolvedValue(undefined)
})

describe('GET /api/hangouts/by-chat/:chatId', () => {
  it('нечисловой id — 400 без запросов в БД', async () => {
    const res = await request(app).get('/api/hangouts/by-chat/abc').set(as())
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('не участник чата — 403', async () => {
    wire()
    const res = await request(app).get('/api/hangouts/by-chat/9').set(as())
    expect(res.status).toBe(403)
  })

  it('в чате нет встречи — null без ошибки', async () => {
    wire({ byChatMember: true, byChatRow: null })
    const res = await request(app).get('/api/hangouts/by-chat/9').set(as())
    expect(res.status).toBe(200)
    expect(res.body).toBeNull()
  })

  it('контекст встречи отдаётся участнику', async () => {
    wire({ byChatMember: true, byChatRow: { id: 5, title: 'Кофе', category: 'cafe', status: 'active', event_date: '2026-11-10' } })
    const res = await request(app).get('/api/hangouts/by-chat/9').set(as())
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: 5, title: 'Кофе', category: 'cafe', status: 'active', event_date: '2026-11-10' })
    expect(pool.query.mock.calls[0][1]).toEqual(['9', 1])
  })

  it('ошибка БД — 500', async () => {
    wire({ fail: 'SELECT 1 AS ok FROM chat_participants' })
    const res = await request(app).get('/api/hangouts/by-chat/9').set(as())
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Hangout by-chat error:', expect.any(Error))
  })
})

describe('POST /api/hangouts/:id/like', () => {
  it('нечисловой id — 400 без запросов в БД', async () => {
    const res = await request(app).post('/api/hangouts/abc/like').set(as()).send({})
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('встреча не найдена — 404', async () => {
    wire({ hangout: null })
    const res = await request(app).post('/api/hangouts/5/like').set(as()).send({})
    expect(res.status).toBe(404)
  })

  it('своя встреча — 400', async () => {
    wire({ hangout: hangoutRow({ user_id: 1 }) })
    const res = await request(app).post('/api/hangouts/5/like').set(as(1)).send({})
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/your own hangout/)
  })

  it('неактивная встреча — 409', async () => {
    wire({ hangout: hangoutRow({ status: 'completed' }) })
    const res = await request(app).post('/api/hangouts/5/like').set(as()).send({})
    expect(res.status).toBe(409)
    expect(res.body.message).toBe('Hangout is not active')
  })

  it('лайк только для date-встреч — 400', async () => {
    wire({ hangout: hangoutRow({ hangout_type: 'company' }) })
    const res = await request(app).post('/api/hangouts/5/like').set(as()).send({})
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/only for date-type/)
  })

  it('без оплаченного билета — 402', async () => {
    wire({ hangout: hangoutRow({ price: 500 }) })
    const res = await request(app).post('/api/hangouts/5/like').set(as()).send({})
    expect(res.status).toBe(402)
    expect(res.body.message).toBe('PAYMENT_REQUIRED')
  })

  it('взаимности нет — liked true, mutual false', async () => {
    wire({ hangout: hangoutRow(), mutual: [] })
    const res = await request(app).post('/api/hangouts/5/like').set(as()).send({})
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ liked: true, mutual: false, chat_id: null })
    const insert = pool.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO hangout_likes'))
    expect(insert[1]).toEqual(['5', 1, 'like'])
    expect(toMock).not.toHaveBeenCalled()
  })

  it('взаимный лайк с существующим чатом — chat_id без создания', async () => {
    wire({ hangout: hangoutRow(), mutual: [{ 1: 1 }], existingPair: [{ id: 42 }] })
    prefsState.inApp = false
    prefsState.push = false
    const res = await request(app).post('/api/hangouts/5/like').set(as()).send({})
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ liked: true, mutual: true, chat_id: 42 })
    expect(toMock).toHaveBeenCalledWith('user:2')
    expect(emitMock).toHaveBeenCalledWith('hangout:mutual_like', { hangoutId: 5, chatId: 42, fromUserId: 1 })
    expect(sqlCalls().some((s) => s.startsWith('INSERT INTO chats'))).toBe(false)
  })

  it('взаимный лайк создаёт чат, уведомление и push', async () => {
    wire({ hangout: hangoutRow(), mutual: [{ 1: 1 }], existingPair: [] })
    const res = await request(app).post('/api/hangouts/5/like').set(as()).send({})
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ liked: true, mutual: true, chat_id: 88 })
    const participants = pool.query.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO chat_participants'))
    expect(participants[1]).toEqual([88, 1, 88, 2])
    expect(emitMock).toHaveBeenCalledWith('notification:new', expect.objectContaining({ id: 7 }))
    expect(pushMock).toHaveBeenCalledWith(2, 'SwiftMatch', 'Автор liked your hangout: Кофе')
  })

  it('дубль лайка — 200 без 500', async () => {
    wire({ hangout: hangoutRow(), fail: 'INSERT INTO hangout_likes', failCode: 'ER_DUP_ENTRY' })
    const res = await request(app).post('/api/hangouts/5/like').set(as()).send({})
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ liked: true, mutual: false })
  })

  it('ошибка БД — 500', async () => {
    wire({ fail: 'FROM hangouts WHERE id = ?' })
    const res = await request(app).post('/api/hangouts/5/like').set(as()).send({})
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Hangout like error:', expect.any(Error))
  })
})

describe('POST /api/hangouts/:id/skip', () => {
  it('нечисловой id — 400 без запросов в БД', async () => {
    const res = await request(app).post('/api/hangouts/abc/skip').set(as()).send({})
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('встреча не найдена — 404', async () => {
    wire({ hangout: null })
    const res = await request(app).post('/api/hangouts/5/skip').set(as()).send({})
    expect(res.status).toBe(404)
  })

  it('скип только для date-встреч — 400', async () => {
    wire({ hangout: hangoutRow({ hangout_type: 'company' }) })
    const res = await request(app).post('/api/hangouts/5/skip').set(as()).send({})
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/only for date-type/)
  })

  it('успешный скип пишет статус skip', async () => {
    wire({ hangout: hangoutRow() })
    const res = await request(app).post('/api/hangouts/5/skip').set(as()).send({})
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ skipped: true })
    const insert = pool.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO hangout_likes'))
    expect(insert[1]).toEqual(['5', 1, 'skip'])
  })

  it('ошибка БД — 500', async () => {
    wire({ hangout: hangoutRow(), fail: 'INSERT INTO hangout_likes' })
    const res = await request(app).post('/api/hangouts/5/skip').set(as()).send({})
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Hangout skip error:', expect.any(Error))
  })
})

describe('POST /api/hangouts/:id/join', () => {
  it('нечисловой id — 400 без запросов в БД', async () => {
    const res = await request(app).post('/api/hangouts/abc/join').set(as()).send({})
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('встреча не найдена — 404', async () => {
    wire({ hangout: null })
    const res = await request(app).post('/api/hangouts/5/join').set(as()).send({})
    expect(res.status).toBe(404)
  })

  it('join только для company-встреч — 400', async () => {
    wire({ hangout: hangoutRow({ hangout_type: 'date' }) })
    const res = await request(app).post('/api/hangouts/5/join').set(as()).send({})
    expect(res.status).toBe(400)
  })

  it('неактивная встреча — 409', async () => {
    wire({ hangout: hangoutRow({ hangout_type: 'company', status: 'cancelled' }) })
    const res = await request(app).post('/api/hangouts/5/join').set(as()).send({})
    expect(res.status).toBe(409)
    expect(res.body.message).toBe('Hangout is not active')
  })

  it('организатор не может join — 400', async () => {
    wire({ hangout: hangoutRow({ hangout_type: 'company', user_id: 1 }) })
    const res = await request(app).post('/api/hangouts/5/join').set(as(1)).send({})
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('You are the organizer')
  })

  it('без оплаченного билета — 402', async () => {
    wire({ hangout: hangoutRow({ hangout_type: 'company', price: 500 }) })
    const res = await request(app).post('/api/hangouts/5/join').set(as()).send({})
    expect(res.status).toBe(402)
    expect(res.body.message).toBe('PAYMENT_REQUIRED')
  })

  it('уже участвует — 409', async () => {
    wire({ hangout: hangoutRow({ hangout_type: 'company' }), existing: { id: 9, status: 'joined' } })
    const res = await request(app).post('/api/hangouts/5/join').set(as()).send({})
    expect(res.status).toBe(409)
    expect(res.body.message).toBe('Already joined')
  })

  it('удалённый участник — 403', async () => {
    wire({ hangout: hangoutRow({ hangout_type: 'company' }), existing: { id: 9, status: 'removed' } })
    const res = await request(app).post('/api/hangouts/5/join').set(as()).send({})
    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/removed/)
  })

  it('мест нет — 409', async () => {
    wire({ hangout: hangoutRow({ hangout_type: 'company' }), count: 2 })
    const res = await request(app).post('/api/hangouts/5/join').set(as()).send({})
    expect(res.status).toBe(409)
    expect(res.body.message).toBe('Hangout is full')
  })

  it('успех: новый групповой чат и push организатору', async () => {
    wire({ hangout: hangoutRow({ hangout_type: 'company' }), countAfter: 2 })
    const res = await request(app).post('/api/hangouts/5/join').set(as()).send({})
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ joined: true, chat_id: 88, participant_count: 2 })
    const insertMember = pool.query.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO hangout_participants'))
    expect(insertMember[1]).toEqual(['5', 1, 'member', 'joined'])
    const groupInsert = pool.query.mock.calls.find((c) => String(c[0]).includes('INSERT IGNORE INTO chat_participants'))
    expect(groupInsert[1]).toEqual([88, '5'])
    const link = pool.query.mock.calls.find((c) => String(c[0]).includes('INSERT IGNORE INTO hangout_chats'))
    expect(link[1]).toEqual(['5', 88])
    expect(emitMock).toHaveBeenCalledWith('hangout:new_participant', { hangoutId: 5, userId: 1, participantCount: 2 })
    expect(pushMock).toHaveBeenCalledWith(2, 'SwiftMatch', 'Маша joined your hangout: Кофе')
  })

  it('успех: повторный join после left обновляет запись', async () => {
    wire({ hangout: hangoutRow({ hangout_type: 'company' }), existing: { id: 9, status: 'left' }, countAfter: 1 })
    const res = await request(app).post('/api/hangouts/5/join').set(as()).send({})
    expect(res.status).toBe(201)
    expect(res.body.chat_id).toBeNull()
    const update = pool.query.mock.calls.find((c) => String(c[0]).includes("SET status = 'joined'"))
    expect(update[1]).toEqual([9])
    expect(sqlCalls().some((s) => s.startsWith('INSERT INTO hangout_participants'))).toBe(false)
  })

  it('успех: существующий групповой чат, участник добавляется', async () => {
    wire({
      hangout: hangoutRow({ hangout_type: 'company' }),
      existingGroupChat: { chat_id: 42 },
      alreadyParticipant: null,
      countAfter: 3,
    })
    const res = await request(app).post('/api/hangouts/5/join').set(as()).send({})
    expect(res.status).toBe(201)
    expect(res.body.chat_id).toBe(42)
    const add = pool.query.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO chat_participants'))
    expect(add[1]).toEqual([42, 1])
  })

  it('успех: уже в групповом чате — повторно не добавляется', async () => {
    wire({
      hangout: hangoutRow({ hangout_type: 'company' }),
      existingGroupChat: { chat_id: 42 },
      alreadyParticipant: { 1: 1 },
    })
    const res = await request(app).post('/api/hangouts/5/join').set(as()).send({})
    expect(res.status).toBe(201)
    expect(res.body.chat_id).toBe(42)
    expect(sqlCalls().some((s) => s.startsWith('INSERT INTO chat_participants'))).toBe(false)
  })

  it('push выключен настройками — не отправляется', async () => {
    prefsState.allowed = false
    wire({ hangout: hangoutRow({ hangout_type: 'company' }), countAfter: 2 })
    const res = await request(app).post('/api/hangouts/5/join').set(as()).send({})
    expect(res.status).toBe(201)
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('гонка вставки — 409 Already joined', async () => {
    wire({ hangout: hangoutRow({ hangout_type: 'company' }), fail: 'INSERT INTO hangout_participants', failCode: 'ER_DUP_ENTRY' })
    const res = await request(app).post('/api/hangouts/5/join').set(as()).send({})
    expect(res.status).toBe(409)
    expect(res.body.message).toBe('Already joined')
  })

  it('ошибка БД — 500', async () => {
    wire({ fail: 'FROM hangouts WHERE id = ?' })
    const res = await request(app).post('/api/hangouts/5/join').set(as()).send({})
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Hangout join error:', expect.any(Error))
  })
})

describe('DELETE /api/hangouts/:id/join', () => {
  it('нечисловой id — 400 без запросов в БД', async () => {
    const res = await request(app).delete('/api/hangouts/abc/join').set(as())
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('не участник — 404', async () => {
    wire({ updateAffected: 0 })
    const res = await request(app).delete('/api/hangouts/5/join').set(as())
    expect(res.status).toBe(404)
    expect(res.body.message).toBe('Not a participant')
  })

  it('успешный выход уведомляет организатора', async () => {
    wire({ updateAffected: 1 })
    const res = await request(app).delete('/api/hangouts/5/join').set(as())
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ left: true })
    const update = pool.query.mock.calls[0]
    expect(update[1]).toEqual(['5', 1])
    expect(emitMock).toHaveBeenCalledWith('hangout:participant_left', { hangoutId: 5, userId: 1 })
  })

  it('встреча уже удалена — выход без эмита', async () => {
    wire({ updateAffected: 1, owner: null })
    const res = await request(app).delete('/api/hangouts/5/join').set(as())
    expect(res.status).toBe(200)
    expect(emitMock).not.toHaveBeenCalled()
  })

  it('ошибка БД — 500', async () => {
    wire({ fail: "UPDATE hangout_participants SET status = 'left'" })
    const res = await request(app).delete('/api/hangouts/5/join').set(as())
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Hangout leave error:', expect.any(Error))
  })
})
