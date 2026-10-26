vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
  delete process.env.REDIS_URL
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'

vi.mock('../db.js', () => ({ default: { query: vi.fn(), getConnection: vi.fn() } }))

const { toMock, ioState } = vi.hoisted(() => {
  const state = { throwOnTo: false }
  const emit = vi.fn()
  const to = vi.fn(() => {
    if (state.throwOnTo) throw new Error('io down')
    return { emit }
  })
  return { toMock: to, ioState: state }
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

const { prefsState } = vi.hoisted(() => ({ prefsState: { inApp: true, push: false } }))
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
import { getIO } from '../ws.js'
import hangoutsRoutes from '../routes/hangouts.js'

const JWT_SECRET = 'test-secret'
const app = express()
app.use(express.json())
app.use(hangoutsRoutes)

const as = (userId = 1) => ({
  Authorization: `Bearer ${jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })}`,
})

const FUTURE = '2030-01-01T12:00:00.000Z'
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

const validBody = (over = {}) => ({
  category: 'cafe',
  title: 'Кофе',
  event_date: FUTURE,
  max_companions: 2,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockReset()
  pool.getConnection.mockReset()
  pool.query.mockResolvedValue([[], []])
  prefsState.inApp = true
  prefsState.push = false
  ioState.throwOnTo = false
  pushMock.mockResolvedValue(undefined)
})

describe('GET /api/hangouts/:id: границы', () => {
  it('нечисловой id — 400 без запросов в БД', async () => {
    const res = await request(app).get('/api/hangouts/abc')
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('падение инкремента view_count не ломает ответ, а логируется', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 5, author_id: 2, is_watching: 1 }], []])
      .mockRejectedValueOnce(new Error('counter down'))
    const res = await request(app).get('/api/hangouts/5').set(as(1))
    expect(res.status).toBe(200)
    expect(res.body.is_watching).toBe(true)
    await flush()
    expect(logger.error).toHaveBeenCalledWith('Hangout view_count increment error:', expect.any(Error))
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).get('/api/hangouts/5')
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Hangout detail error:', expect.any(Error))
  })
})

describe('POST /api/hangouts: валидации', () => {
  it('без обязательных полей — 400 без запросов в БД', async () => {
    const res = await request(app).post('/api/hangouts').set(as()).send({})
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('max_companions = 0 — 400 без запросов в БД', async () => {
    const res = await request(app).post('/api/hangouts').set(as()).send(validBody({ max_companions: 0 }))
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('отрицательная цена — 400', async () => {
    const res = await request(app).post('/api/hangouts').set(as()).send(validBody({ price: -5 }))
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/non-negative/)
  })

  it('платная встреча дешевле 1 ₽ — 400', async () => {
    const res = await request(app).post('/api/hangouts').set(as()).send(validBody({ price: 0.5 }))
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/at least 1/)
  })

  it('capacity вне 1..1000 — 400', async () => {
    for (const capacity of [0, 1001, 'abc']) {
      const res = await request(app).post('/api/hangouts').set(as()).send(validBody({ capacity }))
      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/between 1 and 1000/)
    }
  })

  it('title из одних тегов после очистки пуст — 400', async () => {
    const res = await request(app).post('/api/hangouts').set(as()).send(validBody({ title: '<b></b>' }))
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/title is required/)
  })

  it('нечисловые координаты — 400', async () => {
    const res = await request(app).post('/api/hangouts').set(as()).send(validBody({ lat: 'abc' }))
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Invalid coordinates')
  })

  it('free-пользователь не может указать больше 10 компаньонов', async () => {
    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ cnt: 0 }], []])
    const res = await request(app).post('/api/hangouts').set(as()).send(validBody({ max_companions: 11 }))
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('COMPANIONS_LIMIT')
    expect(pool.query.mock.calls.some((c) => String(c[0]).startsWith('INSERT INTO hangouts'))).toBe(false)
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).post('/api/hangouts').set(as()).send(validBody())
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Hangout create error:', expect.any(Error))
  })
})

describe('PUT /api/hangouts/:id: валидации полей', () => {
  const activeHangout = () => pool.query.mockResolvedValueOnce([[{ user_id: 1, status: 'active' }], []])

  it('нечисловой id — 400 без запросов в БД', async () => {
    const res = await request(app).put('/api/hangouts/abc').set(as()).send({ title: 'x' })
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('встреча не найдена — 404', async () => {
    const res = await request(app).put('/api/hangouts/5').set(as()).send({ title: 'x' })
    expect(res.status).toBe(404)
  })

  it('пустой title — 400', async () => {
    activeHangout()
    const res = await request(app).put('/api/hangouts/5').set(as()).send({ title: '<b></b>' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/title cannot be empty/)
  })

  it('невалидная event_date — 400', async () => {
    activeHangout()
    const res = await request(app).put('/api/hangouts/5').set(as()).send({ event_date: 'не-дата' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/Invalid event_date/)
  })

  it('max_companions = 0 — 400', async () => {
    activeHangout()
    const res = await request(app).put('/api/hangouts/5').set(as()).send({ max_companions: 0 })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/positive integer/)
  })

  it('цена < 0 и 0 < цена < 1 — 400', async () => {
    activeHangout()
    const negative = await request(app).put('/api/hangouts/5').set(as()).send({ price: -1 })
    expect(negative.status).toBe(400)
    activeHangout()
    const tiny = await request(app).put('/api/hangouts/5').set(as()).send({ price: 0.5 })
    expect(tiny.status).toBe(400)
    expect(tiny.body.message).toMatch(/at least 1/)
  })

  it('capacity вне 1..1000 — 400', async () => {
    activeHangout()
    const res = await request(app).put('/api/hangouts/5').set(as()).send({ capacity: 2000 })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/between 1 and 1000/)
  })

  it('нечисловая координата — 400', async () => {
    activeHangout()
    const res = await request(app).put('/api/hangouts/5').set(as()).send({ lat: 'abc' })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Invalid lat')
  })

  it('пустой body — 400 Nothing to update', async () => {
    activeHangout()
    const res = await request(app).put('/api/hangouts/5').set(as()).send({})
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/Nothing to update/)
  })

  it('описание, город и цена пустыми строками сохраняются как NULL', async () => {
    activeHangout()
    const res = await request(app)
      .put('/api/hangouts/5')
      .set(as())
      .send({ description: '', city: '', price: '' })
    expect(res.status).toBe(200)
    const update = pool.query.mock.calls.find((c) => String(c[0]).startsWith('UPDATE hangouts SET'))
    expect(update[1]).toEqual([null, null, null, '5'])
  })

  it('capacity ниже проданных билетов — 409 CAPACITY_BELOW_SOLD', async () => {
    activeHangout().mockResolvedValueOnce([[{ cnt: 7 }], []])
    const res = await request(app).put('/api/hangouts/5').set(as()).send({ capacity: 5 })
    expect(res.status).toBe(409)
    expect(res.body.message).toBe('CAPACITY_BELOW_SOLD: 7')
    expect(pool.query.mock.calls.some((c) => String(c[0]).startsWith('UPDATE hangouts SET'))).toBe(false)
  })

  it('free-пользователь не может поднять лимит выше 10', async () => {
    activeHangout().mockResolvedValueOnce([[], []])
    const res = await request(app).put('/api/hangouts/5').set(as()).send({ max_companions: 11 })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('COMPANIONS_LIMIT')
  })

  it('premium-пользователь может поднять лимит до 20', async () => {
    activeHangout().mockResolvedValueOnce([[{ id: 1 }], []])
    const res = await request(app).put('/api/hangouts/5').set(as()).send({ max_companions: 20 })
    expect(res.status).toBe(200)
    const update = pool.query.mock.calls.find((c) => String(c[0]).startsWith('UPDATE hangouts SET'))
    expect(update[1]).toEqual([20, '5'])
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).put('/api/hangouts/5').set(as()).send({ title: 'x' })
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Hangout update error:', expect.any(Error))
  })
})

describe('DELETE /api/hangouts/:id: границы и уведомления', () => {
  it('нечисловой id — 400 без запросов в БД', async () => {
    const res = await request(app).delete('/api/hangouts/abc').set(as())
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('встреча не найдена — 404', async () => {
    const res = await request(app).delete('/api/hangouts/5').set(as())
    expect(res.status).toBe(404)
  })

  it('чужая встреча — 403, статус не меняется', async () => {
    pool.query.mockResolvedValueOnce([[{ user_id: 2, status: 'active' }], []])
    const res = await request(app).delete('/api/hangouts/5').set(as(1))
    expect(res.status).toBe(403)
    expect(pool.query.mock.calls.some((c) => String(c[0]).includes("status = 'cancelled'"))).toBe(false)
  })

  it('несовпадение числа вставленных и прочитанных уведомлений логируется', async () => {
    pool.query
      .mockResolvedValueOnce([[{ user_id: 1, status: 'active' }], []])
      .mockResolvedValueOnce([{}, []])
      .mockResolvedValueOnce([[{ user_id: 2 }], []])
      .mockResolvedValueOnce([{ insertId: 100 }, []])
      .mockResolvedValueOnce([[], []])
    const res = await request(app).delete('/api/hangouts/5').set(as())
    expect(res.status).toBe(200)
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('notifications inserted but not returned'))
  })

  it('падение push логируется, ответ остаётся 200', async () => {
    prefsState.inApp = false
    prefsState.push = true
    pushMock.mockRejectedValueOnce(new Error('push down'))
    pool.query
      .mockResolvedValueOnce([[{ user_id: 1, status: 'active' }], []])
      .mockResolvedValueOnce([{}, []])
      .mockResolvedValueOnce([[{ user_id: 2 }], []])
    const res = await request(app).delete('/api/hangouts/5').set(as())
    expect(res.status).toBe(200)
    await flush()
    expect(logger.error).toHaveBeenCalledWith('Hangout cancel push failed:', expect.any(Error))
  })

  it('падение realtime-эмита логируется, ответ остаётся 200', async () => {
    prefsState.inApp = false
    prefsState.push = false
    ioState.throwOnTo = true
    pool.query
      .mockResolvedValueOnce([[{ user_id: 1, status: 'active' }], []])
      .mockResolvedValueOnce([{}, []])
      .mockResolvedValueOnce([[{ user_id: 2 }], []])
    const res = await request(app).delete('/api/hangouts/5').set(as())
    expect(res.status).toBe(200)
    expect(logger.error).toHaveBeenCalledWith('Hangout cancel realtime emit failed:', expect.any(Error))
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).delete('/api/hangouts/5').set(as())
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Hangout cancel error:', expect.any(Error))
  })
})

describe('POST /api/hangouts: успешное создание', () => {
  it('сохраняет все необязательные поля и отдаёт встречу в фид', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 3 }], []])
      .mockResolvedValueOnce([{ insertId: 77 }, []])
    const res = await request(app).post('/api/hangouts').set(as()).send(validBody({
      description: 'Встретимся у входа',
      place_name: 'Кафе Пушкин',
      place_address: 'Тверская, 1',
      city: 'Москва',
      lat: '55.75',
      lng: 37.61,
      price: 1500,
      capacity: 30,
      partner_offer_id: '12',
      hangout_type: 'company',
    }))
    expect(res.status).toBe(201)
    expect(res.body.id).toBe(77)
    const insert = pool.query.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO hangouts'))
    expect(insert[1]).toEqual([
      1, 'cafe', 'Кофе', 'Встретимся у входа', 'Кафе Пушкин', 'Тверская, 1', 'Москва',
      55.75, 37.61, new Date(FUTURE), 2, 12, 'company', 1500, 30,
    ])
    expect(toMock).toHaveBeenCalledWith('hangout:feed')
  })

  it('нечисловой partner_offer_id сохраняется как NULL', async () => {
    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ cnt: 0 }], []])
      .mockResolvedValueOnce([{ insertId: 78 }, []])
    const res = await request(app).post('/api/hangouts').set(as()).send(validBody({ partner_offer_id: 'abc' }))
    expect(res.status).toBe(201)
    const insert = pool.query.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO hangouts'))
    expect(insert[1][11]).toBeNull()
  })

  it('поля из одних тегов сохраняются как NULL, без getIO фид не эмитится', async () => {
    getIO.mockReturnValueOnce(null)
    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ cnt: 0 }], []])
      .mockResolvedValueOnce([{ insertId: 79 }, []])
    const res = await request(app).post('/api/hangouts').set(as()).send(validBody({
      description: '<b></b>',
      place_name: '<i></i>',
      place_address: '<p></p>',
      city: '<span></span>',
    }))
    expect(res.status).toBe(201)
    const insert = pool.query.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO hangouts'))
    expect(insert[1].slice(3, 7)).toEqual([null, null, null, null])
    expect(toMock).not.toHaveBeenCalled()
  })

  it('premium-пользователь не может указать больше 20 компаньонов, код лимита не отдаётся', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 3 }], []])
    const res = await request(app).post('/api/hangouts').set(as()).send(validBody({ max_companions: 21 }))
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('max_companions can be up to 20 for your plan')
    expect(res.body.code).toBeUndefined()
  })
})

describe('PUT /api/hangouts/:id: успешные обновления и границы плана', () => {
  const activeHangout = () => pool.query.mockResolvedValueOnce([[{ user_id: 1, status: 'active' }], []])
  const updateCall = () => pool.query.mock.calls.find((c) => String(c[0]).startsWith('UPDATE hangouts SET'))

  it('координаты строкой и числом сохраняются числами', async () => {
    activeHangout()
    const res = await request(app).put('/api/hangouts/5').set(as()).send({ lat: '55.7', lng: 37.6 })
    expect(res.status).toBe(200)
    expect(updateCall()[1]).toEqual([55.7, 37.6, '5'])
  })

  it('capacity выше проданных билетов обновляется', async () => {
    activeHangout().mockResolvedValueOnce([[{ cnt: 2 }], []])
    const res = await request(app).put('/api/hangouts/5').set(as()).send({ capacity: 10 })
    expect(res.status).toBe(200)
    expect(updateCall()[1]).toEqual([10, '5'])
  })

  it('capacity обновляется, когда проданных билетов ноль', async () => {
    activeHangout().mockResolvedValueOnce([[{ cnt: 0 }], []])
    const res = await request(app).put('/api/hangouts/5').set(as()).send({ capacity: 10 })
    expect(res.status).toBe(200)
    expect(updateCall()[1]).toEqual([10, '5'])
  })

  it('capacity, равная проданным билетам, обновляется', async () => {
    activeHangout().mockResolvedValueOnce([[{ cnt: 10 }], []])
    const res = await request(app).put('/api/hangouts/5').set(as()).send({ capacity: 10 })
    expect(res.status).toBe(200)
    expect(updateCall()[1]).toEqual([10, '5'])
  })

  it('пустые координаты сохраняются как NULL', async () => {
    activeHangout()
    const res = await request(app).put('/api/hangouts/5').set(as()).send({ lat: '', lng: null })
    expect(res.status).toBe(200)
    expect(updateCall()[1]).toEqual([null, null, '5'])
  })

  it('текстовое поле со значением null очищается без очистки строки', async () => {
    activeHangout()
    const res = await request(app).put('/api/hangouts/5').set(as()).send({ place_name: null })
    expect(res.status).toBe(200)
    expect(updateCall()[1]).toEqual([null, '5'])
  })

  it('premium-пользователь не может поднять лимит выше 20, код лимита не отдаётся', async () => {
    activeHangout().mockResolvedValueOnce([[{ id: 1 }], []])
    const res = await request(app).put('/api/hangouts/5').set(as()).send({ max_companions: 21 })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('max_companions can be up to 20 for your plan')
    expect(res.body.code).toBeUndefined()
  })

  it('event_date в прошлом — 400, как при создании', async () => {
    activeHangout()
    const res = await request(app).put('/api/hangouts/5').set(as()).send({ event_date: '2020-01-01T12:00:00.000Z' })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('event_date must be in the future')
    expect(updateCall()).toBeUndefined()
  })

  it('будущая event_date обновляется', async () => {
    activeHangout()
    const res = await request(app).put('/api/hangouts/5').set(as()).send({ event_date: FUTURE })
    expect(res.status).toBe(200)
    expect(updateCall()[1]).toEqual([new Date(FUTURE), '5'])
  })
})
