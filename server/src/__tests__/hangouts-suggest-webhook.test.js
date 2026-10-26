vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
  delete process.env.REDIS_URL
  process.env.OPENAI_API_KEY = 'sk-test-openai'
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'

vi.mock('../db.js', () => ({ default: { query: vi.fn(), getConnection: vi.fn() } }))

vi.mock('../ws.js', () => ({ getIO: vi.fn(() => null) }))

vi.mock('../banned-words.js', () => ({
  getBannedWords: vi.fn(async () => []),
  containsBannedWord: vi.fn(() => false),
}))

vi.mock('../routes/push.js', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  sendPushToUser: vi.fn(async () => {}),
  sendPushToAll: vi.fn(),
}))

const { trackEventMock } = vi.hoisted(() => ({ trackEventMock: vi.fn() }))
vi.mock('../routes/experiments.js', () => ({ trackEvent: trackEventMock }))

const { logDelivery, markProcessed, markFailed } = vi.hoisted(() => ({
  logDelivery: vi.fn(async () => {}),
  markProcessed: vi.fn(async () => {}),
  markFailed: vi.fn(async () => {}),
}))
vi.mock('../webhooks.js', () => ({
  logWebhookDelivery: logDelivery,
  markWebhookProcessed: markProcessed,
  markWebhookFailed: markFailed,
  WEBHOOK_PROVIDERS: { hangoutTicket: 'hangout_ticket' },
}))

vi.mock('../circuit-breaker.js', () => ({
  createBreaker: (fn) => ({ fire: fn }),
}))

const { openaiCreate } = vi.hoisted(() => ({ openaiCreate: vi.fn() }))
vi.mock('openai', () => ({
  default: function OpenAIMock() {
    return { chat: { completions: { create: openaiCreate } } }
  },
}))

const { constructEventMock } = vi.hoisted(() => ({ constructEventMock: vi.fn() }))
vi.mock('stripe', () => ({
  default: function StripeMock() {
    return { webhooks: { constructEvent: constructEventMock } }
  },
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

const { conn } = vi.hoisted(() => ({
  conn: {
    query: vi.fn(),
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockReset()
  pool.getConnection.mockReset()
  pool.query.mockResolvedValue([[], []])
  pool.getConnection.mockResolvedValue(conn)
  conn.query.mockReset()
  conn.query.mockResolvedValue([{ affectedRows: 1 }, []])
  conn.beginTransaction.mockReset()
  conn.beginTransaction.mockResolvedValue(undefined)
  conn.commit.mockReset()
  conn.commit.mockResolvedValue(undefined)
  conn.rollback.mockReset()
  conn.rollback.mockResolvedValue(undefined)
  conn.release.mockReset()
  openaiCreate.mockReset()
  constructEventMock.mockReset()
  trackEventMock.mockReset()
  delete process.env.STRIPE_SECRET_KEY
  delete process.env.STRIPE_WEBHOOK_SECRET
})

describe('POST /api/hangouts/suggest', () => {
  function wireSuggest(over = {}) {
    const st = { premium: true, me: { display_name: 'Аня', age: 27, city: 'Сочи', bio: 'люблю кофе', dating_goal: 'long-term' }, partner: null, rows: [], fail: null, ...over }
    let profileCalls = 0
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql)
      if (st.fail && s.includes(st.fail)) throw new Error('boom')
      if (s.includes('FROM subscriptions')) return [st.premium ? [{ id: 1 }] : [], []]
      if (s.includes('FROM user_profiles')) {
        profileCalls += 1
        if (profileCalls === 1) return [st.me ? [st.me] : [], []]
        return [st.partner ? [st.partner] : [], []]
      }
      if (s.includes('FROM hangouts')) return [st.rows, []]
      return [[], []]
    })
    return st
  }

  it('free-пользователь получает 403 PREMIUM_REQUIRED без чтения профиля', async () => {
    wireSuggest({ premium: false })
    const res = await request(app).post('/api/hangouts/suggest').set(as()).send({})
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('PREMIUM_REQUIRED')
    expect(pool.query).toHaveBeenCalledTimes(1)
    expect(String(pool.query.mock.calls[0][0])).toContain('FROM subscriptions')
  })

  it('OpenAI отдаёт идеи: source openai, английский промт, мусор отфильтрован', async () => {
    wireSuggest({ partner: { display_name: 'Игорь', age: 30, city: 'Сочи', bio: 'кино', dating_goal: 'friendship' } })
    openaiCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '```json\n[null, {"title":"Кино","category":"cinema"}, {"title":"Театр"}, {"title":"Кафе"}]\n```' } }],
    })
    const res = await request(app)
      .post('/api/hangouts/suggest')
      .set(as())
      .send({ user_id: 3, language: 'en' })
    expect(res.status).toBe(200)
    expect(res.body.source).toBe('openai')
    expect(res.body.suggestions).toHaveLength(2)
    const arg = openaiCreate.mock.calls[0][0]
    expect(arg.model).toBe('gpt-4o-mini')
    expect(arg.messages[0].content).toContain('in English')
    expect(arg.messages[1].content).toContain('User A: Аня')
    expect(arg.messages[1].content).toContain('User B: Игорь')
    expect(trackEventMock).toHaveBeenCalledWith('hangout_suggest', 1, { source: 'openai', count: 2 })
  })

  it('пустой ответ OpenAI уводит на DB-fallback с афишей', async () => {
    wireSuggest({ rows: [{ title: 'Выставка', category: 'exhibition', place_name: 'Галерея', city: 'Сочи' }] })
    openaiCreate.mockResolvedValueOnce({ choices: [{ message: { content: '[]' } }] })
    const res = await request(app).post('/api/hangouts/suggest').set(as()).send({})
    expect(res.status).toBe(200)
    expect(res.body.source).toBe('db')
    expect(res.body.suggestions).toHaveLength(3)
    expect(pool.query.mock.calls.some((c) => String(c[0]).includes("WHERE status = 'active' AND event_date > NOW()"))).toBe(true)
    expect(trackEventMock).toHaveBeenCalledWith('hangout_suggest', 1, { source: 'db', count: 3 })
  })

  it('падение OpenAI не ломает ответ: warn и статический fallback', async () => {
    wireSuggest({ rows: [] })
    openaiCreate.mockRejectedValueOnce(new Error('rate limit'))
    const res = await request(app).post('/api/hangouts/suggest').set(as()).send({})
    expect(res.status).toBe(200)
    expect(res.body.source).toBe('static')
    expect(res.body.suggestions).toHaveLength(3)
    expect(logger.warn).toHaveBeenCalledWith(
      'Hangout suggest: OpenAI breaker failed, falling back to DB:',
      'rate limit',
    )
  })

  it('ошибка БД — 500', async () => {
    wireSuggest({ fail: 'FROM subscriptions' })
    const res = await request(app).post('/api/hangouts/suggest').set(as()).send({})
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Hangout suggest error:', expect.any(Error))
  })

  it('поля профиля отсутствуют и user_id нечисловой — в промте unknown, партнёр не читается', async () => {
    wireSuggest({ me: { display_name: 'Аня', age: 27, city: null, bio: null, dating_goal: null } })
    openaiCreate.mockResolvedValueOnce({ choices: [{ message: { content: '[{"title":"Кино"}]' } }] })
    const res = await request(app).post('/api/hangouts/suggest').set(as()).send({ user_id: '12abc' })
    expect(res.status).toBe(200)
    expect(res.body.source).toBe('openai')
    const content = openaiCreate.mock.calls[0][0].messages[1].content
    expect(content).toContain('User A: Аня, 27 y.o., unknown, bio: "", goal: unknown.')
    expect(content).toContain('User B: unknown.')
    expect(pool.query.mock.calls.filter((c) => String(c[0]).includes('FROM user_profiles'))).toHaveLength(1)
  })

  it('нет своего профиля, партнёр без города/био/цели — обе строки промта с fallback', async () => {
    wireSuggest({ me: null, partner: { display_name: 'Игорь', age: 30, city: null, bio: null, dating_goal: null } })
    openaiCreate.mockResolvedValueOnce({ choices: [{ message: { content: '[{"title":"Театр"}]' } }] })
    const res = await request(app).post('/api/hangouts/suggest').set(as()).send({ user_id: 3 })
    expect(res.status).toBe(200)
    const content = openaiCreate.mock.calls[0][0].messages[1].content
    expect(content).toContain('User A: unknown.')
    expect(content).toContain('User B: Игорь, 30 y.o., unknown, bio: "", goal: unknown.')
  })

  it('OpenAI вернул пустой content — статические подсказки как fallback', async () => {
    wireSuggest()
    openaiCreate.mockResolvedValueOnce({ choices: [] })
    const res = await request(app).post('/api/hangouts/suggest').set(as()).send({})
    expect(res.status).toBe(200)
    expect(res.body.source).toBe('static')
    expect(res.body.suggestions).toHaveLength(3)
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('афиша без места и категории: «рядом», category other, пустое place', async () => {
    wireSuggest({ rows: [{ title: 'Прогулка', category: null, place_name: null, city: null }] })
    openaiCreate.mockResolvedValueOnce({ choices: [{ message: { content: '[]' } }] })
    const sortSpy = vi.spyOn(Array.prototype, 'sort').mockImplementation(function () {
      return this.reverse()
    })
    try {
      const res = await request(app).post('/api/hangouts/suggest').set(as()).send({})
      expect(res.status).toBe(200)
      expect(res.body.source).toBe('db')
      const fromFeed = res.body.suggestions.find((s) => s.title === 'Прогулка (рядом)')
      expect(fromFeed).toEqual({
        title: 'Прогулка (рядом)',
        category: 'other',
        place: '',
        description: 'Встреча рядом из афиши.',
      })
    } finally {
      sortSpy.mockRestore()
    }
  })

  it('афиша с заголовком статической подсказки не дублируется', async () => {
    wireSuggest({ rows: [{ title: 'Концерт живой музыки', category: 'concert', place_name: 'Клуб', city: 'Сочи' }] })
    openaiCreate.mockResolvedValueOnce({ choices: [{ message: { content: '[]' } }] })
    const sortSpy = vi.spyOn(Array.prototype, 'sort').mockImplementation(function () {
      return this.reverse()
    })
    try {
      const res = await request(app).post('/api/hangouts/suggest').set(as()).send({})
      expect(res.status).toBe(200)
      expect(res.body.source).toBe('db')
      expect(res.body.suggestions).toHaveLength(3)
      expect(res.body.suggestions.filter((s) => s.title === 'Концерт живой музыки')).toHaveLength(1)
      expect(res.body.suggestions.some((s) => s.title.startsWith('Концерт живой музыки ('))).toBe(false)
    } finally {
      sortSpy.mockRestore()
    }
  })

  it('без тела запроса — читает профиль и отдаёт подсказки', async () => {
    wireSuggest()
    openaiCreate.mockResolvedValueOnce({ choices: [{ message: { content: '[]' } }] })
    const res = await request(app).post('/api/hangouts/suggest').set(as())
    expect(res.status).toBe(200)
    expect(res.body.source).toBe('static')
  })
})

describe('POST /api/hangouts/order/webhook', () => {
  const eventFor = (over = {}) => ({
    id: 'evt_1',
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_1', payment_status: 'paid', metadata: { hangout_id: '5', user_id: '3' }, ...over } },
  })

  it('без ключа Stripe — 200 received без единого запроса', async () => {
    const res = await request(app).post('/api/hangouts/order/webhook').send({})
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ received: true })
    expect(pool.getConnection).not.toHaveBeenCalled()
  })

  it('без подписи или секрета — 400 Missing signature', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
    const noSig = await request(app).post('/api/hangouts/order/webhook').send({})
    expect(noSig.status).toBe(400)
    delete process.env.STRIPE_WEBHOOK_SECRET
    const noSecret = await request(app)
      .post('/api/hangouts/order/webhook')
      .set('stripe-signature', 'sig')
      .send({})
    expect(noSecret.status).toBe(400)
    expect(constructEventMock).not.toHaveBeenCalled()
  })

  it('невалидная подпись — 400 и лог', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
    constructEventMock.mockImplementationOnce(() => {
      throw new Error('bad signature')
    })
    const res = await request(app)
      .post('/api/hangouts/order/webhook')
      .set('stripe-signature', 'sig')
      .send({})
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Invalid signature')
    expect(logger.error).toHaveBeenCalledWith('Hangout webhook signature error:', expect.any(Error))
  })

  it('чужое событие и неоплаченная сессия — 200 received без БД', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
    constructEventMock.mockReturnValueOnce({ id: 'evt_2', type: 'payment_intent.succeeded', data: { object: {} } })
    const foreign = await request(app)
      .post('/api/hangouts/order/webhook')
      .set('stripe-signature', 'sig')
      .send({})
    expect(foreign.status).toBe(200)

    constructEventMock.mockReturnValueOnce(eventFor({ payment_status: 'unpaid' }))
    const unpaid = await request(app)
      .post('/api/hangouts/order/webhook')
      .set('stripe-signature', 'sig')
      .send({})
    expect(unpaid.status).toBe(200)
    expect(pool.getConnection).not.toHaveBeenCalled()
    expect(logDelivery).not.toHaveBeenCalled()
  })

  it('успешная оплата: журнал, INSERT IGNORE, paid-билет, commit', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
    const event = eventFor()
    constructEventMock.mockReturnValueOnce(event)
    const res = await request(app)
      .post('/api/hangouts/order/webhook')
      .set('stripe-signature', 'sig')
      .send({})
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ received: true })
    expect(logDelivery).toHaveBeenCalledWith({
      provider: 'hangout_ticket',
      eventId: 'evt_1',
      eventType: 'checkout.session.completed',
      payload: event,
    })
    expect(conn.beginTransaction).toHaveBeenCalled()
    const ignoreInsert = conn.query.mock.calls.find((c) => String(c[0]).includes('INSERT IGNORE INTO webhook_events'))
    expect(ignoreInsert[1]).toEqual(['hangout_ticket', 'evt_1'])
    const ticketUpdate = conn.query.mock.calls.find((c) => String(c[0]).includes("UPDATE hangout_tickets SET status = 'paid'"))
    expect(ticketUpdate[1]).toEqual(['5', '3', 'cs_1'])
    expect(conn.commit).toHaveBeenCalled()
    expect(markProcessed).toHaveBeenCalledWith('hangout_ticket', 'evt_1')
    expect(markFailed).not.toHaveBeenCalled()
    expect(conn.release).toHaveBeenCalled()
  })

  it('повторное событие: rollback, без применения билета и без markProcessed', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
    constructEventMock.mockReturnValueOnce(eventFor())
    conn.query.mockResolvedValueOnce([{ affectedRows: 0 }, []])
    const res = await request(app)
      .post('/api/hangouts/order/webhook')
      .set('stripe-signature', 'sig')
      .send({})
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ received: true })
    expect(conn.rollback).toHaveBeenCalled()
    expect(conn.query.mock.calls.some((c) => String(c[0]).includes("status = 'paid'"))).toBe(false)
    expect(markProcessed).not.toHaveBeenCalled()
    expect(conn.release).toHaveBeenCalled()
  })

  it('ошибка обработки: rollback, markWebhookFailed, 200 received', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
    constructEventMock.mockReturnValueOnce(eventFor())
    conn.query.mockRejectedValueOnce(new Error('deadlock'))
    const res = await request(app)
      .post('/api/hangouts/order/webhook')
      .set('stripe-signature', 'sig')
      .send({})
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ received: true })
    expect(conn.rollback).toHaveBeenCalled()
    expect(conn.release).toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledWith('Hangout ticket webhook processing error:', expect.any(Error))
    expect(markFailed).toHaveBeenCalledWith('hangout_ticket', 'evt_1', 'deadlock')
    expect(markProcessed).not.toHaveBeenCalled()
  })

  it('сессия без metadata не роняет вебхук (пустые ключи)', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
    constructEventMock.mockReturnValueOnce(eventFor({ metadata: null }))
    const res = await request(app)
      .post('/api/hangouts/order/webhook')
      .set('stripe-signature', 'sig')
      .send({})
    expect(res.status).toBe(200)
    const ticketUpdate = conn.query.mock.calls.find((c) => String(c[0]).includes("UPDATE hangout_tickets SET status = 'paid'"))
    expect(ticketUpdate[1]).toEqual([undefined, undefined, 'cs_1'])
    expect(conn.commit).toHaveBeenCalled()
  })

  it('событие без id: пустой eventId в журнале и отметке processed', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
    constructEventMock.mockReturnValueOnce({
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_9', payment_status: 'paid', metadata: { hangout_id: '5', user_id: '3' } } },
    })
    const res = await request(app)
      .post('/api/hangouts/order/webhook')
      .set('stripe-signature', 'sig')
      .send({})
    expect(res.status).toBe(200)
    expect(logDelivery).toHaveBeenCalledWith(expect.objectContaining({ eventId: '' }))
    expect(markProcessed).toHaveBeenCalledWith('hangout_ticket', '')
    const ignoreInsert = conn.query.mock.calls.find((c) => String(c[0]).includes('INSERT IGNORE INTO webhook_events'))
    expect(ignoreInsert[1]).toEqual(['hangout_ticket', ''])
  })
})

describe('PUT /api/hangouts/:id — остаток валидаций полей', () => {
  function wireUpdate(over = {}) {
    const st = { hangout: { user_id: 1, status: 'active' }, sold: 0, premium: true, fail: null, ...over }
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql)
      if (st.fail && s.includes(st.fail)) throw new Error('boom')
      if (s.includes('FROM subscriptions')) return [st.premium ? [{ id: 1 }] : [], []]
      if (s.includes('COUNT(*) AS cnt FROM hangout_tickets')) return [[{ cnt: st.sold }], []]
      if (s.includes('FROM hangouts WHERE id = ?')) return [[st.hangout], []]
      return [{}, []]
    })
    return st
  }

  const updateCall = () => pool.query.mock.calls.find((c) => String(c[0]).startsWith('UPDATE hangouts SET'))

  it('event_date приводится к Date', async () => {
    wireUpdate()
    const res = await request(app)
      .put('/api/hangouts/5')
      .set(as(1))
      .send({ event_date: '2026-12-01T18:00:00.000Z' })
    expect(res.status).toBe(200)
    const [sql, params] = updateCall()
    expect(String(sql)).toContain('event_date = ?')
    expect(params[0]).toBeInstanceOf(Date)
    expect(params[0].toISOString()).toBe('2026-12-01T18:00:00.000Z')
    expect(params[1]).toBe('5')
  })

  it('цена числом сохраняется как число', async () => {
    wireUpdate()
    const res = await request(app).put('/api/hangouts/5').set(as(1)).send({ price: '300' })
    expect(res.status).toBe(200)
    const [, params] = updateCall()
    expect(params[0]).toBe(300)
    expect(params[1]).toBe('5')
  })

  it('пустая capacity сохраняется как NULL без проверки проданных', async () => {
    wireUpdate()
    const res = await request(app).put('/api/hangouts/5').set(as(1)).send({ capacity: '' })
    expect(res.status).toBe(200)
    const [, params] = updateCall()
    expect(params[0]).toBeNull()
    expect(pool.query.mock.calls.some((c) => String(c[0]).includes('COUNT(*) AS cnt FROM hangout_tickets'))).toBe(false)
  })

  it('capacity ниже проданных билетов — 409 CAPACITY_BELOW_SOLD', async () => {
    wireUpdate({ sold: 4 })
    const res = await request(app).put('/api/hangouts/5').set(as(1)).send({ capacity: 2 })
    expect(res.status).toBe(409)
    expect(res.body.message).toBe('CAPACITY_BELOW_SOLD: 4')
    expect(updateCall()).toBeUndefined()
  })

  it('max_companions сверх лимита free-плана — 400 COMPANIONS_LIMIT', async () => {
    wireUpdate({ premium: false })
    const res = await request(app).put('/api/hangouts/5').set(as(1)).send({ max_companions: 15 })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('COMPANIONS_LIMIT')
    expect(res.body.message).toMatch(/up to 10/)
    expect(updateCall()).toBeUndefined()
  })

  it('ошибка БД — 500', async () => {
    wireUpdate({ fail: 'FROM hangouts WHERE id = ?' })
    const res = await request(app).put('/api/hangouts/5').set(as(1)).send({ title: 'Новое' })
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Hangout update error:', expect.any(Error))
  })

  it('пустое описание сохраняется как NULL', async () => {
    wireUpdate()
    const res = await request(app).put('/api/hangouts/5').set(as(1)).send({ description: '<b></b>' })
    expect(res.status).toBe(200)
    const [, params] = updateCall()
    expect(params[0]).toBeNull()
  })
})

describe('остатки выборки и серий', () => {
  it('city-фильтр ленты уходит в SQL параметром', async () => {
    pool.query.mockResolvedValue([[], []])
    const res = await request(app).get('/api/hangouts?city=Сочи').set(as())
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ items: [], total: 0 })
    const cityCall = pool.query.mock.calls.find((c) => String(c[0]).includes('h.city = ?'))
    expect(cityCall).toBeTruthy()
    expect(cityCall[1]).toContain('Сочи')
  })

  it('привязка серии к merged-встрече — 404', async () => {
    pool.query.mockResolvedValueOnce([[{ user_id: 1, merged_into: 9 }], []])
    const res = await request(app).put('/api/hangouts/5/series').set(as(1)).send({})
    expect(res.status).toBe(404)
    expect(res.body.message).toBe('Hangout not found')
  })
})
