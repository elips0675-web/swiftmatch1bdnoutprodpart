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

vi.mock('../ws.js', () => ({
  getIO: vi.fn(() => null),
}))

vi.mock('../cache.js', () => ({
  getCached: vi.fn(() => Promise.resolve(null)),
  setCached: vi.fn(() => Promise.resolve()),
  invalidate: vi.fn(() => Promise.resolve()),
}))

import pool from '../db.js'
import partnersRoutes from '../routes/partners.js'
import adminPartners from '../routes/admin/partners.js'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

function createApp(...routes) {
  const app = express()
  app.use(express.json())
  routes.forEach((r) => app.use(r))
  return app
}

const userApp = createApp(partnersRoutes)
const adminApp = createApp(adminPartners)

function authToken(userId = 1) {
  return jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })
}

beforeEach(() => {
  pool.query.mockReset()
})

describe('GET /api/partners/offers', () => {
  it('requires auth', async () => {
    const res = await request(userApp).get('/api/partners/offers')
    expect(res.status).toBe(401)
  })

  it('returns array of active offers', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 1, title: 'Taxi', partner_name: 'Yandex Go' }], []])
    const res = await request(userApp)
      .get('/api/partners/offers')
      .set('Authorization', `Bearer ${authToken(2)}`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body[0].title).toBe('Taxi')
  })

  it('filters by placement via FIND_IN_SET param', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    await request(userApp)
      .get('/api/partners/offers?placement=chat')
      .set('Authorization', `Bearer ${authToken(2)}`)
    const [sql, params] = pool.query.mock.calls[0]
    expect(sql).toContain('FIND_IN_SET')
    expect(params).toContain('chat')
  })

  it('adds geo distance and radius filter when lat/lng given', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    await request(userApp)
      .get('/api/partners/offers?lat=59.93&lng=30.33&radius=5')
      .set('Authorization', `Bearer ${authToken(2)}`)
    const [sql, params] = pool.query.mock.calls[0]
    expect(sql).toContain('ST_Distance_Sphere')
    expect(sql).toContain('HAVING distance_m < ?')
    expect(params).toContain(5000)
  })
})

describe('POST /api/partners/track', () => {
  it('rejects missing offer_id', async () => {
    const res = await request(userApp)
      .post('/api/partners/track')
      .set('Authorization', `Bearer ${authToken(2)}`)
      .send({})
    expect(res.status).toBe(400)
  })

  it('returns 404 for paused offer', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(userApp)
      .post('/api/partners/track')
      .set('Authorization', `Bearer ${authToken(2)}`)
      .send({ offer_id: 9 })
    expect(res.status).toBe(404)
  })

  it('inserts click conversion and returns deeplink with utm + ref', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 3, partner_id: 1, deeplink: 'https://afisha.ru/movie/' }], []])
      .mockResolvedValueOnce([{ insertId: 42 }, []])
      .mockResolvedValueOnce([[{ referral_code: 'ABC123' }], []])

    const res = await request(userApp)
      .post('/api/partners/track')
      .set('Authorization', `Bearer ${authToken(7)}`)
      .send({ offer_id: 3 })

    expect(res.status).toBe(200)
    expect(res.body.deeplink).toBe('https://afisha.ru/movie/?utm_source=swiftmatch&ref=ABC123')

    const insertCall = pool.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO partner_conversions'))
    expect(insertCall[1]).toEqual([1, 3, 7, 'click'])
  })

  it('appends with & when deeplink already has query', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 4, partner_id: 2, deeplink: 'https://x.ru/?a=b' }], []])
      .mockResolvedValueOnce([{ insertId: 43 }, []])
      .mockResolvedValueOnce([[{ referral_code: null }], []])

    const res = await request(userApp)
      .post('/api/partners/track')
      .set('Authorization', `Bearer ${authToken(7)}`)
      .send({ offer_id: 4, conversion_type: 'booking' })

    expect(res.status).toBe(200)
    expect(res.body.deeplink).toBe('https://x.ru/?a=b&utm_source=swiftmatch&ref=')
  })

  it('substitutes {lat}/{to_lat}/{lng}/{city} placeholders in deeplink', async () => {
    pool.query
      .mockResolvedValueOnce([
        [{ id: 5, partner_id: 1, deeplink: 'https://taxi.ru/order?from={lat},{lng}&to={to_lat},{to_lng}&city={city}' }],
        [],
      ])
      .mockResolvedValueOnce([{ insertId: 44 }, []])
      .mockResolvedValueOnce([[{ referral_code: 'REF9' }], []])

    const res = await request(userApp)
      .post('/api/partners/track')
      .set('Authorization', `Bearer ${authToken(7)}`)
      .send({ offer_id: 5, lat: '59.93', lng: '30.33', city: 'Москва' })

    expect(res.status).toBe(200)
    expect(res.body.deeplink).toBe(
      `https://taxi.ru/order?from=59.93,30.33&to=59.93,30.33&city=${encodeURIComponent('Москва')}&utm_source=swiftmatch&ref=REF9`,
    )
  })

  it('keeps placeholders when geo context is not provided', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 6, partner_id: 1, deeplink: 'https://taxi.ru/order?from={lat},{lng}' }], []])
      .mockResolvedValueOnce([{ insertId: 45 }, []])
      .mockResolvedValueOnce([[{ referral_code: null }], []])

    const res = await request(userApp)
      .post('/api/partners/track')
      .set('Authorization', `Bearer ${authToken(7)}`)
      .send({ offer_id: 6 })

    expect(res.status).toBe(200)
    expect(res.body.deeplink).toBe('https://taxi.ru/order?from={lat},{lng}&utm_source=swiftmatch&ref=')
  })

  it('uses offer lat/lng for {to_lat}/{to_lng} when available', async () => {
    pool.query
      .mockResolvedValueOnce([
        [{ id: 7, partner_id: 1, deeplink: 'https://taxi.ru/order?to={to_lat},{to_lng}', offer_lat: 55.75, offer_lng: 37.62 }],
        [],
      ])
      .mockResolvedValueOnce([{ insertId: 46 }, []])
      .mockResolvedValueOnce([[{ referral_code: 'REF7' }], []])

    const res = await request(userApp)
      .post('/api/partners/track')
      .set('Authorization', `Bearer ${authToken(7)}`)
      .send({ offer_id: 7, lat: '59.93', lng: '30.33' })

    expect(res.status).toBe(200)
    expect(res.body.deeplink).toBe(
      `https://taxi.ru/order?to=55.75,37.62&utm_source=swiftmatch&ref=REF7`,
    )
  })
})

describe('POST /api/partners/postback/:id', () => {
  const AFFILIATE_TOKEN = 'tok_abc123'

  it('rejects invalid id', async () => {
    const res = await request(userApp)
      .post('/api/partners/postback/abc')
      .send({ external_order_id: 'ext1', amount: 100 })
    expect(res.status).toBe(400)
  })

  it('rejects missing external_order_id', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 1, affiliate_token: AFFILIATE_TOKEN, hmac_secret: null, commission_rate: 8 }], []])
    const res = await request(userApp)
      .post('/api/partners/postback/1')
      .send({ token: AFFILIATE_TOKEN, amount: 100 })
    expect(res.status).toBe(400)
  })

  it('rejects invalid amount', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 1, affiliate_token: AFFILIATE_TOKEN, hmac_secret: null, commission_rate: 8 }], []])
    const res = await request(userApp)
      .post('/api/partners/postback/1')
      .send({ token: AFFILIATE_TOKEN, external_order_id: 'ext1', amount: -1 })
    expect(res.status).toBe(400)
  })

  it('rejects wrong token', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 1, affiliate_token: AFFILIATE_TOKEN, hmac_secret: null, commission_rate: 8 }], []])
    const res = await request(userApp)
      .post('/api/partners/postback/1')
      .send({ token: 'wrong', external_order_id: 'ext1', amount: 100 })
    expect(res.status).toBe(401)
  })

  it('rejects partner not found or paused', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(userApp)
      .post('/api/partners/postback/99')
      .send({ token: AFFILIATE_TOKEN, external_order_id: 'ext1', amount: 100 })
    expect(res.status).toBe(401)
  })

  it('creates conversion with commission and returns id + commission', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1, affiliate_token: AFFILIATE_TOKEN, hmac_secret: null, commission_rate: 8 }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ insertId: 101 }, []])

    const res = await request(userApp)
      .post('/api/partners/postback/1')
      .send({ token: AFFILIATE_TOKEN, external_order_id: 'order_42', amount: 5000, conversion_type: 'purchase' })

    expect(res.status).toBe(200)
    expect(res.body.id).toBe(101)
    expect(res.body.commission).toBe(400)

    const insertCall = pool.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO partner_conversions'))
    expect(insertCall[0]).toContain("'approved'")
    expect(insertCall[1]).toContain('order_42')
    expect(insertCall[1]).toContain(5000)
  })

  it('returns duplicate response when external_order_id already exists', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1, affiliate_token: AFFILIATE_TOKEN, hmac_secret: null, commission_rate: 8 }], []])
      .mockResolvedValueOnce([[{ id: 77 }], []])

    const res = await request(userApp)
      .post('/api/partners/postback/1')
      .send({ token: AFFILIATE_TOKEN, external_order_id: 'order_42', amount: 5000 })

    expect(res.status).toBe(200)
    expect(res.body.id).toBe(77)
    expect(res.body.duplicate).toBe(true)
  })

  it('accepts token via Authorization header', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1, affiliate_token: AFFILIATE_TOKEN, hmac_secret: null, commission_rate: 10 }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ insertId: 200 }, []])

    const res = await request(userApp)
      .post('/api/partners/postback/1')
      .set('Authorization', `Bearer ${AFFILIATE_TOKEN}`)
      .send({ external_order_id: 'ext_hdr', amount: 1000 })

    expect(res.status).toBe(200)
    expect(res.body.commission).toBe(100)
  })

  it('accepts valid HMAC signature when hmac_secret is set', async () => {
    const HMAC_SECRET = 'test_hmac_secret_abc'
    const body = { external_order_id: 'hmac_1', amount: 2000, conversion_type: 'purchase' }
    const raw = JSON.stringify(body)
    const { createHmac } = await import('crypto')
    const signature = createHmac('sha256', HMAC_SECRET).update(raw).digest('hex')

    pool.query
      .mockResolvedValueOnce([[{ id: 2, hmac_secret: HMAC_SECRET, affiliate_token: null, commission_rate: 10 }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ insertId: 200 }, []])

    const res = await request(userApp)
      .post('/api/partners/postback/2')
      .set('X-Partner-Signature', signature)
      .send(body)

    expect(res.status).toBe(200)
    expect(res.body.id).toBe(200)
    expect(res.body.commission).toBe(200)
  })

  it('rejects missing X-Partner-Signature when hmac_secret is set', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 2, hmac_secret: 'secret', affiliate_token: null, commission_rate: 10 }], []])
    const res = await request(userApp)
      .post('/api/partners/postback/2')
      .send({ external_order_id: 'hmac_2', amount: 100 })
    expect(res.status).toBe(401)
    expect(res.body.message).toContain('Missing')
  })

  it('rejects invalid HMAC signature', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 2, hmac_secret: 'secret', affiliate_token: null, commission_rate: 10 }], []])
    const res = await request(userApp)
      .post('/api/partners/postback/2')
      .set('X-Partner-Signature', 'deadbeef'.repeat(8))
      .send({ external_order_id: 'hmac_3', amount: 100 })
    expect(res.status).toBe(401)
  })

  it('falls back to token auth when hmac_secret is null', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 3, hmac_secret: null, affiliate_token: AFFILIATE_TOKEN, commission_rate: 5 }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ insertId: 300 }, []])

    const res = await request(userApp)
      .post('/api/partners/postback/3')
      .send({ token: AFFILIATE_TOKEN, external_order_id: 'tok_1', amount: 1000 })

    expect(res.status).toBe(200)
    expect(res.body.id).toBe(300)
  })
})

describe('Admin partners CRUD', () => {
  it('GET returns stats array even on DB error', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await request(adminApp).get('/partners')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('POST validates name', async () => {
    const res = await request(adminApp).post('/partners').send({ name: 'A' })
    expect(res.status).toBe(400)
  })

  it('POST creates partner', async () => {
    pool.query.mockResolvedValueOnce([{ insertId: 11 }, []])
    const res = await request(adminApp)
      .post('/partners')
      .send({ name: 'New Partner', type: 'deeplink' })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe(11)
  })

  it('GET /conversions returns array', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 1, partner_name: 'Test', commission: 10 }], []])
    const res = await request(adminApp).get('/conversions')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('GET /conversions filters by partner_id', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    await request(adminApp).get('/conversions?partner_id=3')
    const [sql, params] = pool.query.mock.calls[0]
    expect(sql).toContain('c.partner_id = ?')
    expect(params).toContain(3)
  })

  it('GET /conversions returns [] on DB error', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await request(adminApp).get('/conversions')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('PUT rejects invalid status', async () => {
    const res = await request(adminApp).put('/partners/1').send({ status: 'deleted' })
    expect(res.status).toBe(400)
  })

  it('offer POST validates category and placement', async () => {
    const badCat = await request(adminApp)
      .post('/partners/1/offers')
      .send({ category: 'space', title: 'Test offer', deeplink: 'https://x.ru' })
    expect(badCat.status).toBe(400)

    const badPlacement = await request(adminApp)
      .post('/partners/1/offers')
      .send({ category: 'taxi', title: 'Test offer', deeplink: 'https://x.ru', placement: 'moon' })
    expect(badPlacement.status).toBe(400)
  })

  it('admin PUT offer accepts pinned flag', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }, []])
    const res = await request(adminApp)
      .put('/offers/9')
      .send({ pinned: true })
    expect(res.status).toBe(200)
    const [sql, params] = pool.query.mock.calls[0]
    expect(sql).toContain('pinned = ?')
    expect(params).toContain(1)
    expect(res.body.message).toBe('Offer updated')
  })
})

describe('Admin payouts & stats', () => {
  it('GET /payouts returns array', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 1, partner_name: 'Flowwow', amount: 5000, method: 'bank', status: 'pending', admin_note: null, created_at: new Date() }], []])
    const res = await request(adminApp).get('/payouts')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body[0].amount).toBe(5000)
  })

  it('GET /payouts returns [] on db error', async () => {
    pool.query.mockRejectedValueOnce(new Error('db'))
    const res = await request(adminApp).get('/payouts')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('POST /payouts validates fields', async () => {
    const res = await request(adminApp).post('/payouts').send({ partner_id: null, amount: 0 })
    expect(res.status).toBe(400)
  })

  it('POST /payouts creates payout', async () => {
    pool.query.mockResolvedValueOnce([{ insertId: 50 }, []])
    const res = await request(adminApp)
      .post('/payouts')
      .send({ partner_id: 1, amount: 10000, method: 'card', details: 'Счёт 1234' })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe(50)
  })

  it('PUT /payouts/:id updates status', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }, []])
    const res = await request(adminApp)
      .put('/payouts/50')
      .send({ status: 'completed', admin_note: 'Выполнено' })
    expect(res.status).toBe(200)
    expect(res.body.message).toContain('Payout updated')
  })

  it('GET /stats/daily returns array', async () => {
    pool.query.mockResolvedValueOnce([[{ date: '2026-08-24', clicks: 15, conversions: 2, total: 17, revenue: 4000, commission: 600 }], []])
    const res = await request(adminApp).get('/stats/daily')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body[0].clicks).toBe(15)
  })

  it('GET /stats/daily returns [] on db error', async () => {
    pool.query.mockRejectedValueOnce(new Error('db'))
    const res = await request(adminApp).get('/stats/daily')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })
})

describe('GET /api/partners/offers/:id', () => {
  it('requires auth', async () => {
    const res = await request(userApp).get('/api/partners/offers/1')
    expect(res.status).toBe(401)
  })

  it('returns 404 for missing offer', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(userApp)
      .get('/api/partners/offers/999')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(404)
  })

  it('returns offer details', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 1, title: 'Букет роз', price: 2500, partner_name: 'Flowwow' }], []])
    const res = await request(userApp)
      .get('/api/partners/offers/1')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.title).toBe('Букет роз')
  })

  it('rejects non-numeric id', async () => {
    const res = await request(userApp)
      .get('/api/partners/offers/abc')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(400)
  })
})

describe('POST /api/partners/order (mock mode)', () => {
  it('requires auth', async () => {
    const res = await request(userApp).post('/api/partners/order').send({ offer_id: 1 })
    expect(res.status).toBe(401)
  })

  it('rejects missing offer_id', async () => {
    const res = await request(userApp)
      .post('/api/partners/order')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({})
    expect(res.status).toBe(400)
  })

  it('rejects offer not found', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(userApp)
      .post('/api/partners/order')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ offer_id: 999 })
    expect(res.status).toBe(404)
  })

  it('rejects offer with no price', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 1, price: null, partner_status: 'active' }], []])
    const res = await request(userApp)
      .post('/api/partners/order')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ offer_id: 1 })
    expect(res.status).toBe(400)
  })

  it('creates mock order when stripe not configured', async () => {
    const offer = { id: 8, partner_id: 5, title: 'Букет', price: 2500, deeplink: 'https://flowwow.ru', partner_name: 'Flowwow', commission_rate: 15, partner_status: 'active' }
    pool.query
      .mockResolvedValueOnce([[offer], []])
      .mockResolvedValueOnce([{ insertId: 100 }, []])
      .mockResolvedValueOnce([{ insertId: 200 }, []])

    const res = await request(userApp)
      .post('/api/partners/order')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ offer_id: 8, recipient_name: 'Аня', recipient_address: 'Москва, ул. Ленина 1' })

    expect(res.status).toBe(201)
    expect(res.body.message).toContain('mock')
    expect(res.body.orderId).toBeDefined()
  })
})

describe('GET /api/partners/orders/my', () => {
  it('requires auth', async () => {
    const res = await request(userApp).get('/api/partners/orders/my')
    expect(res.status).toBe(401)
  })

  it('returns user orders', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 1, amount: 2500, status: 'paid', partner_name: 'Flowwow' }], []])
    const res = await request(userApp)
      .get('/api/partners/orders/my')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body[0].partner_name).toBe('Flowwow')
  })

  it('returns [] on db error', async () => {
    pool.query.mockRejectedValueOnce(new Error('down'))
    const res = await request(userApp)
      .get('/api/partners/orders/my')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })
})

describe('POST /api/partners/order/webhook', () => {
  it('returns 200 when stripe not configured', async () => {
    delete process.env.STRIPE_SECRET_KEY
    const res = await request(userApp)
      .post('/api/partners/order/webhook')
      .send({})
    expect(res.status).toBe(200)
    expect(res.body.received).toBe(true)
  })
})

describe('POST /api/partners/booking', () => {
  it('requires auth', async () => {
    const res = await request(userApp).post('/api/partners/booking').send({ offer_id: 1 })
    expect(res.status).toBe(401)
  })

  it('rejects missing fields', async () => {
    const res = await request(userApp)
      .post('/api/partners/booking')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ offer_id: 1 })
    expect(res.status).toBe(400)
  })

  it('rejects non-restaurant offer', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(userApp)
      .post('/api/partners/booking')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ offer_id: 1, date: '2026-09-01', time: '19:00' })
    expect(res.status).toBe(404)
  })

  it('creates booking and returns data', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 3, partner_id: 3, title: 'Ресторан', deeplink: 'https://restoclub.ru/123', city: 'Москва', lat: 55.7, lng: 37.6, partner_name: 'Restoclub', commission_rate: 12, partner_status: 'active' }], []])
      .mockResolvedValueOnce([{ insertId: 50 }, []])

    const res = await request(userApp)
      .post('/api/partners/booking')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ offer_id: 3, date: '2026-09-01', time: '19:00', guests: 2 })

    expect(res.status).toBe(201)
    expect(res.body.conversion_id).toBe(50)
    expect(res.body.date).toBe('2026-09-01')
    expect(res.body.guests).toBe(2)
    expect(res.body.deeplink).toContain('date=')
  })
})

describe('POST /api/partners/booking/share', () => {
  it('requires auth', async () => {
    const res = await request(userApp).post('/api/partners/booking/share').send({ chat_id: 1, offer_id: 1 })
    expect(res.status).toBe(401)
  })

  it('rejects invalid chat_id', async () => {
    const res = await request(userApp)
      .post('/api/partners/booking/share')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ chat_id: 'abc', offer_id: 1 })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/partners/offers/hotel', () => {
  it('requires auth', async () => {
    const res = await request(userApp).get('/api/partners/offers/hotel?city=Moscow')
    expect(res.status).toBe(401)
  })

  it('requires city param', async () => {
    const res = await request(userApp)
      .get('/api/partners/offers/hotel')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(400)
  })

  it('returns cached hotel offers', async () => {
    const { getCached } = await import('../cache.js')
    getCached.mockResolvedValueOnce([{ id: 10, title: 'Островок', category: 'hotel' }])
    const res = await request(userApp)
      .get('/api/partners/offers/hotel?city=Moscow')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].title).toBe('Островок')
  })

  it('falls back to DB when cache empty', async () => {
    const { getCached, setCached } = await import('../cache.js')
    getCached.mockResolvedValueOnce(null)
    pool.query.mockResolvedValueOnce([[{ id: 11, title: 'Отель', category: 'hotel' }], []])
    const res = await request(userApp)
      .get('/api/partners/offers/hotel?city=SPB')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(setCached).toHaveBeenCalled()
  })
})

describe('POST /api/partners/hotel/book', () => {
  it('requires auth', async () => {
    const res = await request(userApp).post('/api/partners/hotel/book').send({ offer_id: 1 })
    expect(res.status).toBe(401)
  })

  it('validates required fields', async () => {
    const res = await request(userApp)
      .post('/api/partners/hotel/book')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ offer_id: 1 })
    expect(res.status).toBe(400)
  })

  it('returns 404 for non-hotel offer', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(userApp)
      .post('/api/partners/hotel/book')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ offer_id: 99, check_in: '2026-09-01', check_out: '2026-09-05', guests: 2 })
    expect(res.status).toBe(404)
  })

  it('creates hotel booking with deeplink', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 5, partner_id: 4, title: 'Островок', deeplink: 'https://ostrovok.ru/hotel?city={city}', city: 'Москва', lat: 55.7, lng: 37.6, partner_name: 'Ostrovok', commission_rate: 7, partner_status: 'active' }], []])
      .mockResolvedValueOnce([{ insertId: 80 }, []])
    const res = await request(userApp)
      .post('/api/partners/hotel/book')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ offer_id: 5, check_in: '2026-09-01', check_out: '2026-09-05', guests: 2 })
    expect(res.status).toBe(201)
    expect(res.body.conversion_id).toBe(80)
    expect(res.body.check_in).toBe('2026-09-01')
    expect(res.body.check_out).toBe('2026-09-05')
    expect(res.body.deeplink).toContain('checkin=')
    expect(res.body.deeplink).toContain('checkout=')
  })
})
