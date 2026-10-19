vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
  delete process.env.REDIS_URL
  delete process.env.STRIPE_SECRET_KEY
  delete process.env.STRIPE_LIVE
})

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
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

const { stripeCreate } = vi.hoisted(() => ({ stripeCreate: vi.fn() }))
vi.mock('stripe', () => ({
  default: function StripeMock() {
    return { checkout: { sessions: { create: stripeCreate } } }
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

const hangoutRow = (over = {}) => ({
  id: 5,
  user_id: 2,
  hangout_type: 'company',
  status: 'active',
  title: 'Кофе',
  price: 0,
  capacity: null,
  max_companions: 2,
  lat: '43.6000',
  lng: '39.7000',
  ...over,
})

function wire(over = {}) {
  const st = {
    hangout: null,
    sold: 0,
    participant: false,
    acceptedResponse: false,
    reviewExisting: null,
    premium: false,
    boostedCount: 0,
    watcherCount: 1,
    watchRow: null,
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
    if (s.includes('merged_into IS NULL')) return [st.watchRow ? [{ id: 5 }] : [], []]
    if (s.includes('FROM hangout_participants WHERE hangout_id = ? AND user_id = ?')) return [st.participant ? [{ 1: 1 }] : [], []]
    if (s.includes('FROM hangout_responses WHERE hangout_id = ? AND user_id = ?')) return [st.acceptedResponse ? [{ 1: 1 }] : [], []]
    if (s.includes('COUNT(*) AS cnt FROM hangout_tickets')) return [[{ cnt: st.sold }], []]
    if (s.includes('COUNT(*) AS cnt FROM hangouts WHERE user_id = ? AND boosted')) return [[{ cnt: st.boostedCount }], []]
    if (s.includes('COUNT(*) AS watcher_count')) return [[{ watcher_count: st.watcherCount }], []]
    if (s.includes('FROM subscriptions')) return [st.premium ? [{ id: 1 }] : [], []]
    if (s.includes('FROM hangout_reviews WHERE hangout_id = ? AND reviewer_id')) return [[st.reviewExisting].filter(Boolean), []]
    if (s.includes('FROM hangouts WHERE id = ?')) return [[st.hangout], []]
    return [{}, []]
  })
  return st
}

const ENV = {
  key: process.env.STRIPE_SECRET_KEY,
  live: process.env.STRIPE_LIVE,
  nodeEnv: process.env.NODE_ENV,
}

afterAll(() => {
  if (ENV.key === undefined) delete process.env.STRIPE_SECRET_KEY
  else process.env.STRIPE_SECRET_KEY = ENV.key
  if (ENV.live === undefined) delete process.env.STRIPE_LIVE
  else process.env.STRIPE_LIVE = ENV.live
  if (ENV.nodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = ENV.nodeEnv
})

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockReset()
  pool.getConnection.mockReset()
  pool.query.mockResolvedValue([[], []])
  delete process.env.STRIPE_SECRET_KEY
  delete process.env.STRIPE_LIVE
  process.env.NODE_ENV = 'test'
  stripeCreate.mockReset()
  stripeCreate.mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.com/cs_1' })
  pushMock.mockResolvedValue(undefined)
})

describe('POST /api/hangouts/:id/checkin', () => {
  it('нечисловой id — 400 без запросов в БД', async () => {
    const res = await request(app).post('/api/hangouts/abc/checkin').set(as()).send({ lat: 1, lng: 2 })
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('без координат — 400 без запросов в БД', async () => {
    const res = await request(app).post('/api/hangouts/5/checkin').set(as()).send({ lat: 'x' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/lat and lng/)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('встреча не найдена — 404', async () => {
    wire({ hangout: null })
    const res = await request(app).post('/api/hangouts/5/checkin').set(as()).send({ lat: 43.6, lng: 39.7 })
    expect(res.status).toBe(404)
  })

  it('неактивная встреча — 409', async () => {
    wire({ hangout: hangoutRow({ status: 'cancelled' }) })
    const res = await request(app).post('/api/hangouts/5/checkin').set(as()).send({ lat: 43.6, lng: 39.7 })
    expect(res.status).toBe(409)
  })

  it('слишком далеко — 400 с distance_m', async () => {
    wire({ hangout: hangoutRow(), participant: true })
    const res = await request(app).post('/api/hangouts/5/checkin').set(as()).send({ lat: 55.75, lng: 37.61 })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Too far from hangout location')
    expect(res.body.distance_m).toBeGreaterThan(500)
  })

  it('не участник — 403 без чек-ина', async () => {
    wire({ hangout: hangoutRow(), participant: false })
    const res = await request(app).post('/api/hangouts/5/checkin').set(as()).send({ lat: 43.6, lng: 39.7 })
    expect(res.status).toBe(403)
    expect(pool.query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO hangout_checkins'))).toBe(false)
  })

  it('участник company-встречи отмечается и организатор получает эмит', async () => {
    wire({ hangout: hangoutRow(), participant: true })
    const res = await request(app).post('/api/hangouts/5/checkin').set(as()).send({ lat: 43.6001, lng: 39.7001 })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ checked_in: true })
    const insert = pool.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO hangout_checkins'))
    expect(insert[1]).toEqual(['5', 1, 43.6001, 39.7001])
    expect(emitMock).toHaveBeenCalledWith('hangout:checkin', { hangoutId: 5, userId: 1, lat: 43.6001, lng: 39.7001 })
  })

  it('принятый отклик на date-встречу даёт право на чек-ин', async () => {
    wire({ hangout: hangoutRow({ hangout_type: 'date' }), acceptedResponse: true })
    const res = await request(app).post('/api/hangouts/5/checkin').set(as()).send({ lat: 43.6, lng: 39.7 })
    expect(res.status).toBe(200)
  })

  it('у встречи нет координат — проверка расстояния пропускается', async () => {
    wire({ hangout: hangoutRow({ lat: null, lng: null }), participant: true })
    const res = await request(app).post('/api/hangouts/5/checkin').set(as()).send({ lat: 10, lng: 10 })
    expect(res.status).toBe(200)
  })

  it('ошибка БД — 500', async () => {
    wire({ fail: 'FROM hangouts WHERE id = ?' })
    const res = await request(app).post('/api/hangouts/5/checkin').set(as()).send({ lat: 43.6, lng: 39.7 })
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Hangout checkin error:', expect.any(Error))
  })
})

describe('POST /api/hangouts/:id/review', () => {
  it('нечисловой id — 400 без запросов в БД', async () => {
    const res = await request(app).post('/api/hangouts/abc/review').set(as()).send({ reviewee_id: 3, rating: 5 })
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('невалидные reviewee_id/rating — 400 без запросов в БД', async () => {
    for (const body of [{ reviewee_id: 'x', rating: 5 }, { reviewee_id: 3, rating: 0 }, { reviewee_id: 3, rating: 6 }]) {
      const res = await request(app).post('/api/hangouts/5/review').set(as()).send(body)
      expect(res.status).toBe(400)
    }
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('встреча не найдена — 404', async () => {
    wire({ hangout: null })
    const res = await request(app).post('/api/hangouts/5/review').set(as()).send({ reviewee_id: 3, rating: 5 })
    expect(res.status).toBe(404)
  })

  it('отменённую встречу оценивать нельзя — 409', async () => {
    wire({ hangout: hangoutRow({ status: 'cancelled' }) })
    const res = await request(app).post('/api/hangouts/5/review').set(as()).send({ reviewee_id: 3, rating: 5 })
    expect(res.status).toBe(409)
  })

  it('свою встречу оценивать нельзя — 400', async () => {
    wire({ hangout: hangoutRow({ user_id: 1 }) })
    const res = await request(app).post('/api/hangouts/5/review').set(as(1)).send({ reviewee_id: 3, rating: 5 })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Cannot review yourself')
  })

  it('повторный отзыв — 409', async () => {
    wire({ hangout: hangoutRow(), reviewExisting: { id: 9 } })
    const res = await request(app).post('/api/hangouts/5/review').set(as()).send({ reviewee_id: 3, rating: 5 })
    expect(res.status).toBe(409)
    expect(res.body.message).toBe('Already reviewed')
  })

  it('успешный отзыв с валидным тегом', async () => {
    wire({ hangout: hangoutRow({ status: 'completed' }) })
    const res = await request(app).post('/api/hangouts/5/review').set(as()).send({ reviewee_id: 3, rating: 4, tag: 'fun' })
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ review: true })
    const insert = pool.query.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO hangout_reviews'))
    expect(insert[1]).toEqual(['5', 1, 3, 4, 'fun'])
  })

  it('неизвестный тег сохраняется как NULL', async () => {
    wire({ hangout: hangoutRow() })
    const res = await request(app).post('/api/hangouts/5/review').set(as()).send({ reviewee_id: 3, rating: 5, tag: 'rude' })
    expect(res.status).toBe(201)
    const insert = pool.query.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO hangout_reviews'))
    expect(insert[1][4]).toBeNull()
  })

  it('гонка вставки — 409', async () => {
    wire({ hangout: hangoutRow(), fail: 'INSERT INTO hangout_reviews', failCode: 'ER_DUP_ENTRY' })
    const res = await request(app).post('/api/hangouts/5/review').set(as()).send({ reviewee_id: 3, rating: 5 })
    expect(res.status).toBe(409)
  })

  it('ошибка БД — 500', async () => {
    wire({ fail: 'FROM hangouts WHERE id = ?' })
    const res = await request(app).post('/api/hangouts/5/review').set(as()).send({ reviewee_id: 3, rating: 5 })
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Hangout review error:', expect.any(Error))
  })
})

describe('POST /api/hangouts/:id/purchase', () => {
  it('нечисловой id — 400 без запросов в БД', async () => {
    const res = await request(app).post('/api/hangouts/abc/purchase').set(as()).send({})
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('встреча не найдена — 404', async () => {
    wire({ hangout: null })
    const res = await request(app).post('/api/hangouts/5/purchase').set(as()).send({})
    expect(res.status).toBe(404)
  })

  it('неактивная встреча — 409', async () => {
    wire({ hangout: hangoutRow({ status: 'cancelled' }) })
    const res = await request(app).post('/api/hangouts/5/purchase').set(as()).send({})
    expect(res.status).toBe(409)
  })

  it('своя встреча — 400', async () => {
    wire({ hangout: hangoutRow({ user_id: 1 }) })
    const res = await request(app).post('/api/hangouts/5/purchase').set(as(1)).send({})
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/your own hangout/)
  })

  it('бесплатная встреча — 400', async () => {
    wire({ hangout: hangoutRow({ price: 0 }) })
    const res = await request(app).post('/api/hangouts/5/purchase').set(as()).send({})
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('This hangout is free')
  })

  it('мест нет — 409 CAPACITY_FULL', async () => {
    wire({ hangout: hangoutRow({ price: 500, capacity: 2 }), sold: 2 })
    const res = await request(app).post('/api/hangouts/5/purchase').set(as()).send({})
    expect(res.status).toBe(409)
    expect(res.body.message).toBe('CAPACITY_FULL')
  })

  it('mock-покупка вне прод-контура — 201 paid', async () => {
    wire({ hangout: hangoutRow({ price: 500, max_companions: 2 }) })
    const res = await request(app).post('/api/hangouts/5/purchase').set(as()).send({})
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ mock: true, paid: true, amount: 500, url: null, session_id: null })
    const insert = pool.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO hangout_tickets'))
    expect(String(insert[0])).toContain("'paid'")
    expect(insert[1]).toEqual(['5', 1, 500])
  })

  it('STRIPE_LIVE без ключа — 503 STRIPE_NOT_CONFIGURED', async () => {
    process.env.STRIPE_LIVE = 'true'
    wire({ hangout: hangoutRow({ price: 500 }) })
    const res = await request(app).post('/api/hangouts/5/purchase').set(as()).send({})
    expect(res.status).toBe(503)
    expect(res.body.code).toBe('STRIPE_NOT_CONFIGURED')
    expect(pool.query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO hangout_tickets'))).toBe(false)
  })

  it('с ключом Stripe создаёт сессию и pending-билет', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'
    wire({ hangout: hangoutRow({ price: 500 }) })
    const res = await request(app)
      .post('/api/hangouts/5/purchase')
      .set(as())
      .set('Origin', 'http://localhost:8081')
      .send({})
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ url: 'https://checkout.stripe.com/cs_1', session_id: 'cs_1', mock: false, paid: false })
    expect(stripeCreate).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'payment',
      success_url: 'http://localhost:8081/hangouts/5?ticket=success',
      cancel_url: 'http://localhost:8081/hangouts/5?ticket=cancelled',
      metadata: { hangout_id: '5', user_id: '1' },
    }))
    const insert = pool.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO hangout_tickets'))
    expect(String(insert[0])).toContain("'pending'")
    expect(insert[1]).toEqual(['5', 1, 'cs_1', 500])
  })

  it('падение Stripe — 500 и лог', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'
    stripeCreate.mockRejectedValueOnce(new Error('card declined'))
    wire({ hangout: hangoutRow({ price: 500 }) })
    const res = await request(app).post('/api/hangouts/5/purchase').set(as()).send({})
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Hangout purchase error:', expect.any(Error))
  })
})

describe('POST /api/hangouts/:id/boost', () => {
  it('нечисловой id — 400 без запросов в БД', async () => {
    const res = await request(app).post('/api/hangouts/abc/boost').set(as()).send({})
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('встреча не найдена — 404', async () => {
    wire({ hangout: null })
    const res = await request(app).post('/api/hangouts/5/boost').set(as()).send({})
    expect(res.status).toBe(404)
  })

  it('не автор — 403', async () => {
    wire({ hangout: hangoutRow({ user_id: 2 }) })
    const res = await request(app).post('/api/hangouts/5/boost').set(as(1)).send({})
    expect(res.status).toBe(403)
  })

  it('неактивная встреча — 409', async () => {
    wire({ hangout: hangoutRow({ user_id: 1, status: 'completed' }) })
    const res = await request(app).post('/api/hangouts/5/boost').set(as(1)).send({})
    expect(res.status).toBe(409)
    expect(res.body.message).toMatch(/Cannot boost/)
  })

  it('free-пользователь — 403 PREMIUM_REQUIRED', async () => {
    wire({ hangout: hangoutRow({ user_id: 1 }), premium: false })
    const res = await request(app).post('/api/hangouts/5/boost').set(as(1)).send({})
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('PREMIUM_REQUIRED')
  })

  it('второй boost — 409 BOOST_LIMIT', async () => {
    wire({ hangout: hangoutRow({ user_id: 1 }), premium: true, boostedCount: 1 })
    const res = await request(app).post('/api/hangouts/5/boost').set(as(1)).send({})
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('BOOST_LIMIT')
  })

  it('успешный boost выставляет флаг', async () => {
    wire({ hangout: hangoutRow({ user_id: 1 }), premium: true, boostedCount: 0 })
    const res = await request(app).post('/api/hangouts/5/boost').set(as(1)).send({})
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ boosted: true, message: 'Hangout boosted' })
    const update = pool.query.mock.calls.find((c) => String(c[0]).startsWith('UPDATE hangouts SET boosted = 1'))
    expect(update[1]).toEqual(['5'])
  })

  it('ошибка БД — 500', async () => {
    wire({ fail: 'FROM hangouts WHERE id = ?' })
    const res = await request(app).post('/api/hangouts/5/boost').set(as()).send({})
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Hangout boost error:', expect.any(Error))
  })
})

describe('POST /api/hangouts/:id/unboost', () => {
  it('нечисловой id — 400 без запросов в БД', async () => {
    const res = await request(app).post('/api/hangouts/abc/unboost').set(as()).send({})
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('встреча не найдена — 404', async () => {
    wire({ hangout: null })
    const res = await request(app).post('/api/hangouts/5/unboost').set(as()).send({})
    expect(res.status).toBe(404)
  })

  it('не автор — 403', async () => {
    wire({ hangout: hangoutRow({ user_id: 2 }) })
    const res = await request(app).post('/api/hangouts/5/unboost').set(as(1)).send({})
    expect(res.status).toBe(403)
  })

  it('успешный unboost', async () => {
    wire({ hangout: hangoutRow({ user_id: 1 }) })
    const res = await request(app).post('/api/hangouts/5/unboost').set(as(1)).send({})
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ boosted: false, message: 'Hangout unboosted' })
    const update = pool.query.mock.calls.find((c) => String(c[0]).startsWith('UPDATE hangouts SET boosted = 0'))
    expect(update[1]).toEqual(['5'])
  })

  it('ошибка БД — 500', async () => {
    wire({ fail: 'FROM hangouts WHERE id = ?' })
    const res = await request(app).post('/api/hangouts/5/unboost').set(as()).send({})
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Hangout unboost error:', expect.any(Error))
  })
})

describe('watch / unwatch', () => {
  it('watch: нечисловой id — 400', async () => {
    const res = await request(app).post('/api/hangouts/abc/watch').set(as())
    expect(res.status).toBe(400)
  })

  it('watch: встреча не найдена — 404', async () => {
    wire({ watchRow: null })
    const res = await request(app).post('/api/hangouts/5/watch').set(as())
    expect(res.status).toBe(404)
  })

  it('watch: успешная подписка', async () => {
    wire({ watchRow: { id: 5 }, watcherCount: 3 })
    const res = await request(app).post('/api/hangouts/5/watch').set(as())
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ watching: true, watcher_count: 3 })
    const insert = pool.query.mock.calls.find((c) => String(c[0]).includes('INSERT IGNORE INTO hangout_watchers'))
    expect(insert[1]).toEqual(['5', 1])
  })

  it('watch: ошибка БД — 500', async () => {
    wire({ fail: 'merged_into IS NULL' })
    const res = await request(app).post('/api/hangouts/5/watch').set(as())
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Hangout watch error:', expect.any(Error))
  })

  it('unwatch: нечисловой id — 400', async () => {
    const res = await request(app).delete('/api/hangouts/abc/watch').set(as())
    expect(res.status).toBe(400)
  })

  it('unwatch: отписка возвращает счётчик', async () => {
    wire({ watcherCount: 2 })
    const res = await request(app).delete('/api/hangouts/5/watch').set(as())
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ watching: false, watcher_count: 2 })
    const del = pool.query.mock.calls.find((c) => String(c[0]).startsWith('DELETE FROM hangout_watchers'))
    expect(del[1]).toEqual(['5', 1])
  })

  it('unwatch: ошибка БД — 500', async () => {
    wire({ fail: 'DELETE FROM hangout_watchers' })
    const res = await request(app).delete('/api/hangouts/5/watch').set(as())
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Hangout unwatch error:', expect.any(Error))
  })
})
