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

const { cachedValue, getCachedMock, setCachedMock } = vi.hoisted(() => {
  const state = { value: null }
  return {
    cachedValue: state,
    getCachedMock: vi.fn(async () => state.value),
    setCachedMock: vi.fn(async () => {}),
  }
})
vi.mock('../cache.js', () => ({
  getCached: getCachedMock,
  setCached: setCachedMock,
  invalidate: vi.fn(async () => {}),
}))

import pool from '../db.js'
import logger from '../logger.js'
import { getIO } from '../ws.js'
import partnersRoutes from '../routes/partners.js'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'
const app = express()
app.use(express.json())
app.use(partnersRoutes)

const as = (userId = 1) => ({
  Authorization: `Bearer ${jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })}`,
})

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockReset()
  pool.query.mockResolvedValue([[], []])
  cachedValue.value = null
  setCachedMock.mockResolvedValue(undefined)
  getCachedMock.mockImplementation(async () => cachedValue.value)
})

describe('GET /api/partners/offers: фильтры', () => {
  it('category и city попадают в SQL и параметры', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 1, title: 'Спа' }], []])
    const res = await request(app).get('/api/partners/offers').query({ category: 'spa', city: 'Сочи' }).set(as())
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    const [sql, params] = pool.query.mock.calls[0]
    expect(sql).toContain('o.category = ?')
    expect(sql).toContain('(o.city = ? OR o.city IS NULL)')
    expect(params).toEqual(['spa', 'Сочи'])
  })

  it('гео добавляет distance_m и HAVING по радиусу', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(app)
      .get('/api/partners/offers')
      .query({ placement: 'hangout', lat: 55.75, lng: 37.61, radius: 5 })
      .set(as())
    expect(res.status).toBe(200)
    const [sql, params] = pool.query.mock.calls[0]
    expect(sql).toContain('ST_Distance_Sphere')
    expect(sql).toContain('HAVING distance_m < ?')
    expect(params).toEqual(['hangout', 37.61, 55.75, 5000])
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).get('/api/partners/offers').set(as())
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Partner offers error:', expect.any(Error))
  })
})

describe('POST /api/partners/track: ошибка', () => {
  it('падение INSERT конверсии — 500', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1, partner_id: 2, deeplink: '', offer_city: null, offer_lat: null, offer_lng: null }], []])
      .mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).post('/api/partners/track').set(as()).send({ offer_id: 1 })
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Partner track error:', expect.any(Error))
  })
})

describe('GET /api/partners/offers/hotel', () => {
  it('без города — 400 без запросов в БД', async () => {
    const res = await request(app).get('/api/partners/offers/hotel').set(as())
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('кэш отдаётся без запроса в БД', async () => {
    cachedValue.value = [{ id: 9, title: 'Отель' }]
    const res = await request(app).get('/api/partners/offers/hotel').query({ city: 'Сочи' }).set(as())
    expect(res.status).toBe(200)
    expect(res.body[0].id).toBe(9)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('промах кэша: город обрезан, ключ в нижнем регистре, результат кладётся в кэш', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 9, title: 'Отель' }], []])
    const res = await request(app).get('/api/partners/offers/hotel').query({ city: '  Сочи  ' }).set(as())
    expect(res.status).toBe(200)
    expect(pool.query.mock.calls[0][1]).toEqual(['Сочи'])
    expect(getCachedMock).toHaveBeenCalledWith('partner:offers:hotel:сочи')
    expect(setCachedMock).toHaveBeenCalledWith('partner:offers:hotel:сочи', expect.any(Array), expect.any(Number))
  })

  it('ошибка БД — пустой список, а не 500 (витрина не должна ломать паспорт)', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).get('/api/partners/offers/hotel').query({ city: 'Сочи' }).set(as())
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
    expect(logger.error).toHaveBeenCalledWith('Hotel offers error:', expect.any(Error))
  })
})

describe('POST /api/partners/hotel/book', () => {
  it('без offer_id — 400 без запросов в БД', async () => {
    const res = await request(app).post('/api/partners/hotel/book').set(as()).send({})
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('без дат — 400 без запросов в БД', async () => {
    const res = await request(app).post('/api/partners/hotel/book').set(as()).send({ offer_id: 1 })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/check_in and check_out/)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('отель не найден — 404', async () => {
    const res = await request(app)
      .post('/api/partners/hotel/book')
      .set(as())
      .send({ offer_id: 1, check_in: '2026-11-01', check_out: '2026-11-05' })
    expect(res.status).toBe(404)
  })

  it('создаёт конверсию и дописывает даты в deeplink с существующим query', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 4, partner_id: 2, title: 'Отель', deeplink: 'https://h.example/book?src=sm', city: 'Сочи', partner_name: 'H', commission_rate: '10.00', partner_status: 'active' }], []])
      .mockResolvedValueOnce([{ insertId: 55 }, []])
    const res = await request(app)
      .post('/api/partners/hotel/book')
      .set(as())
      .send({ offer_id: 4, check_in: '2026-11-01', check_out: '2026-11-05', guests: 25 })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ conversion_id: 55, offer_id: 4, hotel: 'Отель', guests: 10 })
    expect(res.body.deeplink).toBe('https://h.example/book?src=sm&checkin=2026-11-01&checkout=2026-11-05&guests=10')
    const insert = pool.query.mock.calls[1]
    expect(insert[1]).toEqual([2, 4, 1])
  })

  it('deeplink без query получает ?, гости по умолчанию 2', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 4, partner_id: 2, title: 'Отель', deeplink: 'https://h.example/book', city: null, partner_name: 'H' }], []])
      .mockResolvedValueOnce([{ insertId: 56 }, []])
    const res = await request(app)
      .post('/api/partners/hotel/book')
      .set(as())
      .send({ offer_id: 4, check_in: '2026-11-01', check_out: '2026-11-05' })
    expect(res.status).toBe(201)
    expect(res.body.guests).toBe(2)
    expect(res.body.deeplink).toContain('?checkin=')
  })

  it('пустой deeplink остаётся пустым', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 4, partner_id: 2, title: 'Отель', deeplink: null, city: null, partner_name: 'H' }], []])
      .mockResolvedValueOnce([{ insertId: 57 }, []])
    const res = await request(app)
      .post('/api/partners/hotel/book')
      .set(as())
      .send({ offer_id: 4, check_in: '2026-11-01', check_out: '2026-11-05' })
    expect(res.status).toBe(201)
    expect(res.body.deeplink).toBe('')
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app)
      .post('/api/partners/hotel/book')
      .set(as())
      .send({ offer_id: 4, check_in: '2026-11-01', check_out: '2026-11-05' })
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Hotel booking error:', expect.any(Error))
  })
})

describe('POST /api/partners/spa/book', () => {
  it('без offer_id — 400 без запросов в БД', async () => {
    const res = await request(app).post('/api/partners/spa/book').set(as()).send({})
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('без даты/времени — 400 без запросов в БД', async () => {
    const res = await request(app).post('/api/partners/spa/book').set(as()).send({ offer_id: 1 })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/date and time/)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('оффер не найден — 404', async () => {
    const res = await request(app).post('/api/partners/spa/book').set(as()).send({ offer_id: 1, date: '2026-11-01', time: '18:00' })
    expect(res.status).toBe(404)
    expect(res.body.message).toMatch(/Spa/)
  })

  it('создаёт конверсию, услуга и цена в ответе, deeplink с service', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 6, partner_id: 3, title: 'Спа', deeplink: 'https://spa.example/book?x=1', city: 'Сочи', price: '2500.00', partner_name: 'S' }], []])
      .mockResolvedValueOnce([{ insertId: 60 }, []])
    const res = await request(app)
      .post('/api/partners/spa/book')
      .set(as())
      .send({ offer_id: 6, date: '2026-11-01', time: '18:00', service: 'массаж' })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ conversion_id: 60, service: 'массаж', price: '2500.00' })
    expect(res.body.deeplink).toBe('https://spa.example/book?x=1&date=2026-11-01&time=18%3A00&service=%D0%BC%D0%B0%D1%81%D1%81%D0%B0%D0%B6')
  })

  it('без услуги service null и в deeplink его нет', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 6, partner_id: 3, title: 'Спа', deeplink: 'https://spa.example/book', city: null, price: null, partner_name: 'S' }], []])
      .mockResolvedValueOnce([{ insertId: 61 }, []])
    const res = await request(app)
      .post('/api/partners/spa/book')
      .set(as())
      .send({ offer_id: 6, date: '2026-11-01', time: '18:00' })
    expect(res.status).toBe(201)
    expect(res.body.service).toBeNull()
    expect(res.body.deeplink).not.toContain('service=')
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).post('/api/partners/spa/book').set(as()).send({ offer_id: 6, date: '2026-11-01', time: '18:00' })
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Spa booking error:', expect.any(Error))
  })
})

describe('GET /api/partners/offers/:id', () => {
  it('нечисловой id — 400 без запросов в БД', async () => {
    const res = await request(app).get('/api/partners/offers/abc').set(as())
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('оффер не найден — 404', async () => {
    const res = await request(app).get('/api/partners/offers/999').set(as())
    expect(res.status).toBe(404)
  })

  it('отдаёт оффер', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 4, title: 'Отель', placement: 'passport' }], []])
    const res = await request(app).get('/api/partners/offers/4').set(as())
    expect(res.status).toBe(200)
    expect(res.body.title).toBe('Отель')
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).get('/api/partners/offers/4').set(as())
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Partner offer detail error:', expect.any(Error))
  })
})

describe('POST /api/partners/booking', () => {
  it('без offer_id — 400 без запросов в БД', async () => {
    const res = await request(app).post('/api/partners/booking').set(as()).send({})
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('без даты/времени — 400 без запросов в БД', async () => {
    const res = await request(app).post('/api/partners/booking').set(as()).send({ offer_id: 1 })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/date and time/)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('ресторан не найден — 404', async () => {
    const res = await request(app).post('/api/partners/booking').set(as()).send({ offer_id: 1, date: '2026-11-01', time: '19:00' })
    expect(res.status).toBe(404)
  })

  it('создаёт бронь, гости ограничены 20, deeplink размечен', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 8, partner_id: 4, title: 'Ресторан', deeplink: 'https://r.example/book', city: 'Сочи', partner_name: 'R' }], []])
      .mockResolvedValueOnce([{ insertId: 70 }, []])
    const res = await request(app)
      .post('/api/partners/booking')
      .set(as())
      .send({ offer_id: 8, date: '2026-11-01', time: '19:00', guests: 50, message: 'у окна' })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ conversion_id: 70, restaurant: 'Ресторан', guests: 20, message: 'у окна' })
    expect(res.body.deeplink).toBe('https://r.example/book?date=2026-11-01&time=19%3A00&guests=20')
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).post('/api/partners/booking').set(as()).send({ offer_id: 8, date: '2026-11-01', time: '19:00' })
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Partner booking error:', expect.any(Error))
  })
})

describe('POST /api/partners/booking/share', () => {
  it('без chat_id — 400 без запросов в БД', async () => {
    const res = await request(app).post('/api/partners/booking/share').set(as()).send({})
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('без offer_id — 400 без запросов в БД', async () => {
    const res = await request(app).post('/api/partners/booking/share').set(as()).send({ chat_id: 5 })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/offer_id/)
    expect(pool.query).not.toHaveBeenCalled()
  })

  const shareOffer = (over = {}) => ({
    id: 8, title: 'Ресторан', deeplink: '', city: 'Сочи', category: 'restaurant', partner_name: 'R', ...over,
  })
  const shareMessage = {
    id: 101, chat_id: 5, sender_id: 1, text: 'Ресторан', card_type: 'booking', card_payload: {}, created_at: '2026-11-01T10:00:00.000Z', sender_name: 'Я',
  }

  const wireShare = (over = {}) => {
    const state = { offer: shareOffer(), participant: [{ user_id: 1 }], others: [{ user_id: 2 }], message: shareMessage, ...over }
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql)
      if (s.includes('FROM partner_offers o')) {
        const allowed = ['restaurant', 'spa', 'experience'].filter((c) => s.includes(`'${c}'`))
        return state.offer && allowed.includes(state.offer.category) ? [[state.offer], []] : [[], []]
      }
      if (s.includes('user_id != ?')) return [state.others, []]
      if (s.includes('FROM chat_participants')) return [state.participant, []]
      if (s.startsWith('INSERT INTO messages')) return [{ insertId: 101 }, []]
      if (s.startsWith('UPDATE chats')) return [{}, []]
      if (s.includes('FROM messages m JOIN user_profiles')) return [[state.message], []]
      return [[], []]
    })
    return state
  }

  it('оффер не найден или категория не из бронируемых — 404', async () => {
    wireShare({ offer: null })
    let res = await request(app).post('/api/partners/booking/share').set(as()).send({ chat_id: 5, offer_id: 8 })
    expect(res.status).toBe(404)

    wireShare({ offer: shareOffer({ category: 'hotel' }) })
    res = await request(app).post('/api/partners/booking/share').set(as()).send({ chat_id: 5, offer_id: 8 })
    expect(res.status).toBe(404)
    expect(pool.query.mock.calls.some((c) => String(c[0]).startsWith('INSERT INTO messages'))).toBe(false)
  })

  it('не участник чата — 403', async () => {
    wireShare({ participant: [] })
    const res = await request(app).post('/api/partners/booking/share').set(as()).send({ chat_id: 5, offer_id: 8 })
    expect(res.status).toBe(403)
    expect(emitMock).not.toHaveBeenCalled()
    expect(pool.query.mock.calls.some((c) => String(c[0]).startsWith('INSERT INTO messages'))).toBe(false)
  })

  it('бронь пишется в messages карточкой и уходит получателю по WS', async () => {
    wireShare()
    const res = await request(app)
      .post('/api/partners/booking/share')
      .set(as())
      .send({ chat_id: 5, offer_id: 8, date: '2026-11-01', time: '19:00', guests: 2, message: 'идём?' })

    expect(res.status).toBe(201)
    expect(res.body).toEqual({ shared: true, message: shareMessage, card: expect.objectContaining({ type: 'booking', title: 'Ресторан', message: 'идём?' }) })

    const insert = pool.query.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO messages'))
    expect(insert[1]).toEqual([5, 1, 'Ресторан', 'booking', expect.any(String)])
    expect(JSON.parse(insert[1][4])).toMatchObject({ type: 'booking', category: 'restaurant', date: '2026-11-01', time: '19:00', message: 'идём?' })
    expect(pool.query.mock.calls.some((c) => String(c[0]).startsWith('UPDATE chats'))).toBe(true)
    expect(toMock).toHaveBeenCalledWith('user:2')
    expect(emitMock).toHaveBeenCalledWith('chat:message', { chatId: 5, message: shareMessage })
  })

  it('спа и впечатления бронируются так же, как ресторан', async () => {
    for (const category of ['spa', 'experience']) {
      vi.clearAllMocks()
      wireShare({ offer: shareOffer({ category, title: category }) })
      const res = await request(app).post('/api/partners/booking/share').set(as()).send({ chat_id: 5, offer_id: 8 })
      expect(res.status).toBe(201)
      expect(res.body.card.category).toBe(category)
    }
  })

  it('без второго участника — 201 и ни одного эмита', async () => {
    wireShare({ others: [] })
    const res = await request(app).post('/api/partners/booking/share').set(as()).send({ chat_id: 5, offer_id: 8 })
    expect(res.status).toBe(201)
    expect(toMock).not.toHaveBeenCalled()
  })

  it('сокеты не подняты — сообщение сохраняется, ответ 201', async () => {
    wireShare()
    getIO.mockReturnValueOnce(null)
    const res = await request(app).post('/api/partners/booking/share').set(as()).send({ chat_id: 5, offer_id: 8 })
    expect(res.status).toBe(201)
    expect(pool.query.mock.calls.some((c) => String(c[0]).startsWith('INSERT INTO messages'))).toBe(true)
    expect(emitMock).not.toHaveBeenCalled()
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).post('/api/partners/booking/share').set(as()).send({ chat_id: 5, offer_id: 8 })
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Partner booking share error:', expect.any(Error))
  })
})
