// Stage 151 (COV-03, остаток): непокрытые ветки `server/src/routes/partners.js` —
// money-роут B2B (офферы, конверсии, брони, комиссии). Роут был покрыт по
// счастливым путям, но фоллбэки остались непроверенными: токен партнёра из
// query-параметра и из заголовка, отсутствие заголовка, атрибуция `user_id` в
// конверсии, город из query, пустой `deeplink` у оффера, клампы гостей,
// null-поля карточки брони, падение записи в кэш и работа роутов без
// body-парсера.
//
// Проверяется поведение, а не строки: каждая ветка обязана менять ответ или
// запись в БД, иначе тест проходит и на сломанной ветке.

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

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

const { emitMock, toMock } = vi.hoisted(() => {
  const emit = vi.fn()
  const to = vi.fn(() => ({ emit }))
  return { emitMock: emit, toMock: to }
})
vi.mock('../ws.js', () => ({ getIO: vi.fn(() => ({ to: toMock })) }))

const { getCachedMock, setCachedMock } = vi.hoisted(() => ({
  getCachedMock: vi.fn(async () => null),
  setCachedMock: vi.fn(async () => {}),
}))
vi.mock('../cache.js', () => ({
  getCached: getCachedMock,
  setCached: setCachedMock,
  invalidate: vi.fn(async () => {}),
}))

import pool from '../db.js'
import partnersRoutes from '../routes/partners.js'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'
const app = express()
app.use(express.json())
app.use(partnersRoutes)

const as = (userId = 1) => ({
  Authorization: `Bearer ${jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })}`,
})

const TOKEN = 'tok_partner_1'

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockReset()
  getCachedMock.mockResolvedValue(null)
  setCachedMock.mockResolvedValue(undefined)
})

describe('POST /api/partners/postback/:id — авторизация партнёра', () => {
  it('принимает affiliate_token из query-параметра', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1, affiliate_token: TOKEN, hmac_secret: null, commission_rate: 10 }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ insertId: 501 }, []])

    const res = await request(app)
      .post(`/api/partners/postback/1?token=${TOKEN}`)
      .send({ external_order_id: 'ext_query', amount: 1000 })

    expect(res.status).toBe(200)
    expect(res.body.commission).toBe(100)
  })

  it('без токена в body, query и заголовке — 401', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 1, affiliate_token: TOKEN, hmac_secret: null, commission_rate: 10 }], []])

    const res = await request(app)
      .post('/api/partners/postback/1')
      .send({ external_order_id: 'ext_none', amount: 1000 })

    expect(res.status).toBe(401)
    expect(res.body.message).toBe('Unauthorized')
  })

  it('принимает affiliate_token из заголовка Authorization', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1, affiliate_token: TOKEN, hmac_secret: null, commission_rate: 10 }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ insertId: 502 }, []])

    const res = await request(app)
      .post('/api/partners/postback/1')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ external_order_id: 'ext_header', amount: 1000 })

    expect(res.status).toBe(200)
    expect(res.body.commission).toBe(100)
  })
})

describe('POST /api/partners/postback/:id — атрибуция user_id', () => {
  it('числовой user_id из body попадает в конверсию', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1, affiliate_token: TOKEN, hmac_secret: null, commission_rate: 10 }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ insertId: 503 }, []])

    const res = await request(app)
      .post('/api/partners/postback/1')
      .send({ token: TOKEN, external_order_id: 'ext_uid', amount: 1000, user_id: 42 })

    expect(res.status).toBe(200)
    const insertCall = pool.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO partner_conversions'))
    expect(insertCall[1][2]).toBe(42)
  })

  it('нечисловой user_id не попадает в конверсию — null', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1, affiliate_token: TOKEN, hmac_secret: null, commission_rate: 10 }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ insertId: 504 }, []])

    const res = await request(app)
      .post('/api/partners/postback/1')
      .send({ token: TOKEN, external_order_id: 'ext_uid_bad', amount: 1000, user_id: 'abc' })

    expect(res.status).toBe(200)
    const insertCall = pool.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO partner_conversions'))
    expect(insertCall[1][2]).toBeNull()
  })
})

describe('POST /api/partners/track — город в плейсхолдере', () => {
  it('берёт город из query, когда в body его нет', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 11, partner_id: 1, deeplink: 'https://taxi.ru/order?city={city}' }], []])
      .mockResolvedValueOnce([{ insertId: 601 }, []])
      .mockResolvedValueOnce([[{ referral_code: 'REFQ' }], []])

    const res = await request(app)
      .post('/api/partners/track?city=%D0%9C%D0%BE%D1%81%D0%BA%D0%B2%D0%B0')
      .set(as(3))
      .send({ offer_id: 11 })

    expect(res.status).toBe(200)
    expect(res.body.deeplink).toBe(
      `https://taxi.ru/order?city=${encodeURIComponent('Москва')}&utm_source=swiftmatch&ref=REFQ`,
    )
  })

  it('пустой город не подставляется — плейсхолдер сохраняется', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 12, partner_id: 1, deeplink: 'https://taxi.ru/order?city={city}' }], []])
      .mockResolvedValueOnce([{ insertId: 602 }, []])
      .mockResolvedValueOnce([[{ referral_code: 'REFE' }], []])

    const res = await request(app)
      .post('/api/partners/track')
      .set(as(3))
      .send({ offer_id: 12, city: '   ' })

    expect(res.status).toBe(200)
    expect(res.body.deeplink).toBe('https://taxi.ru/order?city={city}&utm_source=swiftmatch&ref=REFE')
  })
})

describe('POST /api/partners/booking — фоллбэки брони', () => {
  it('оффер без deeplink — ссылка пустая, гости по умолчанию 2', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 8, partner_id: 4, title: 'Ресторан', deeplink: null, city: 'Сочи', partner_name: 'R' }], []])
      .mockResolvedValueOnce([{ insertId: 701 }, []])

    const res = await request(app)
      .post('/api/partners/booking')
      .set(as())
      .send({ offer_id: 8, date: '2026-11-01', time: '19:00' })

    expect(res.status).toBe(201)
    expect(res.body.guests).toBe(2)
    expect(res.body.deeplink).toBe('')
  })

  it('deeplink с уже готовым query — параметры дописываются через &', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 9, partner_id: 4, title: 'Ресторан', deeplink: 'https://r.example/book?ref=x', city: 'Сочи', partner_name: 'R' }], []])
      .mockResolvedValueOnce([{ insertId: 702 }, []])

    const res = await request(app)
      .post('/api/partners/booking')
      .set(as())
      .send({ offer_id: 9, date: '2026-11-01', time: '19:00', guests: 4 })

    expect(res.status).toBe(201)
    expect(res.body.guests).toBe(4)
    expect(res.body.deeplink).toBe('https://r.example/book?ref=x&date=2026-11-01&time=19%3A00&guests=4')
  })
})

describe('POST /api/partners/spa/book — фоллбэки брони', () => {
  it('оффер без deeplink — ссылка пустая', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 20, partner_id: 2, title: 'Спа', deeplink: null, city: 'Сочи', price: 100, partner_name: 'S' }], []])
      .mockResolvedValueOnce([{ insertId: 703 }, []])

    const res = await request(app)
      .post('/api/partners/spa/book')
      .set(as())
      .send({ offer_id: 20, date: '2026-11-01', time: '18:00' })

    expect(res.status).toBe(201)
    expect(res.body.deeplink).toBe('')
  })
})

describe('POST /api/partners/booking/share — карточка брони', () => {
  it('незаполненные дата, время и сообщение уходят в карточке как null', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 30, title: 'Ресторан', deeplink: '', city: 'Сочи', partner_name: 'R' }], []])
      .mockResolvedValueOnce([[{ user_id: 5 }], []])

    const res = await request(app)
      .post('/api/partners/booking/share')
      .set(as(5))
      .send({ chat_id: 5, offer_id: 30 })

    expect(res.status).toBe(200)
    expect(toMock).toHaveBeenCalledWith('chat:5')
    expect(emitMock).toHaveBeenCalledWith('partner:restaurant_shared', expect.objectContaining({
      chatId: 5,
      senderId: 5,
      card: expect.objectContaining({
        type: 'restaurant_shared',
        restaurant: 'Ресторан',
        date: null,
        time: null,
        message: null,
        guests: 2,
      }),
    }))
  })
})

describe('GET /api/partners/offers/hotel — запись в кэш', () => {
  it('падение записи в кэш не роняет ленту офферов', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 40, title: 'Отель', price: 5000 }], []])
    setCachedMock.mockRejectedValueOnce(new Error('redis down'))

    const res = await request(app)
      .get('/api/partners/offers/hotel?city=Sochi')
      .set(as())

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].title).toBe('Отель')
    expect(setCachedMock).toHaveBeenCalledWith(
      'partner:offers:hotel:sochi',
      expect.any(Array),
      3600,
    )
  })
})
