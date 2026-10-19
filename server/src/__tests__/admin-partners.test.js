import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }))

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

const { invalidateMock } = vi.hoisted(() => ({ invalidateMock: vi.fn(async () => {}) }))
vi.mock('../cache.js', () => ({
  getCached: vi.fn(async () => null),
  setCached: vi.fn(async () => {}),
  invalidate: invalidateMock,
}))

import pool from '../db.js'
import logger from '../logger.js'
import adminPartners from '../routes/admin/partners.js'

const app = express()
app.use(express.json())
app.use(adminPartners)

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockReset()
  pool.query.mockResolvedValue([[], []])
  invalidateMock.mockReset()
  invalidateMock.mockResolvedValue(undefined)
})

describe('GET /partners', () => {
  it('отдаёт партнёров со статистикой', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 1, name: 'Flowwow', offers_count: 2, commission_pending: 500 }], []])
    const res = await request(app).get('/partners')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    const sql = String(pool.query.mock.calls[0][0])
    expect(sql).toContain('commission_pending')
    expect(sql).toContain("conversion_type = 'click'")
  })
})

describe('POST /partners', () => {
  it('недопустимый type — 400', async () => {
    const res = await request(app).post('/partners').send({ name: 'Partner', type: 'other' })
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('дубль имени — 409', async () => {
    const err = new Error('dup')
    err.code = 'ER_DUP_ENTRY'
    pool.query.mockRejectedValueOnce(err)
    const res = await request(app).post('/partners').send({ name: 'Partner' })
    expect(res.status).toBe(409)
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('прочая ошибка БД — 500 и лог', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).post('/partners').send({ name: 'Partner' })
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Admin partner create error:', expect.any(Error))
  })

  it('дефолты: deeplink, null-токен, комиссия 10 и сгенерированный секрет', async () => {
    pool.query.mockResolvedValueOnce([{ insertId: 11 }, []])
    const res = await request(app).post('/partners').send({ name: '  Partner  ', commission_rate: 0 })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe(11)
    expect(res.body.hmac_secret).toMatch(/^wh_[0-9a-f]{32}$/)
    const params = pool.query.mock.calls[0][1]
    expect(params).toEqual(['Partner', 'deeplink', null, res.body.hmac_secret, 10])
  })

  it('явные type, токен и комиссия сохраняются', async () => {
    pool.query.mockResolvedValueOnce([{ insertId: 12 }, []])
    const res = await request(app)
      .post('/partners')
      .send({ name: 'API Partner', type: 'api', affiliate_token: 'tok_1', commission_rate: '15' })
    expect(res.status).toBe(201)
    const params = pool.query.mock.calls[0][1]
    expect(params.slice(0, 3)).toEqual(['API Partner', 'api', 'tok_1'])
    expect(params[4]).toBe(15)
  })
})

describe('PUT /partners/:id', () => {
  it('нечисловой id — 400', async () => {
    const res = await request(app).put('/partners/abc').send({ status: 'paused' })
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('недопустимый type — 400', async () => {
    const res = await request(app).put('/partners/1').send({ type: 'other' })
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('нечего менять — 400', async () => {
    const res = await request(app).put('/partners/1').send({})
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Nothing to update')
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('обновляет все переданные поля', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }, []])
    const res = await request(app)
      .put('/partners/1')
      .send({ name: ' Renamed ', type: 'saas', status: 'paused', affiliate_token: 'tok_2', commission_rate: '12.5' })
    expect(res.status).toBe(200)
    expect(res.body.message).toBe('Partner updated')
    const [sql, params] = pool.query.mock.calls[0]
    expect(String(sql)).toContain('name = ?')
    expect(String(sql)).toContain('type = ?')
    expect(String(sql)).toContain('status = ?')
    expect(String(sql)).toContain('affiliate_token = ?')
    expect(String(sql)).toContain('commission_rate = ?')
    expect(params).toEqual(['Renamed', 'saas', 'paused', 'tok_2', 12.5, '1'])
  })

  it('партнёр не найден — 404', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 0 }, []])
    const res = await request(app).put('/partners/99').send({ status: 'active' })
    expect(res.status).toBe(404)
    expect(res.body.message).toBe('Partner not found')
  })

  it('ошибка БД — 500 и лог', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).put('/partners/1').send({ status: 'active' })
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Admin partner update error:', expect.any(Error))
  })
})

describe('GET /offers', () => {
  it('отдаёт офферы с именем партнёра и кликами', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 3, title: 'Такси', partner_name: 'Yandex', clicks_total: 7 }], []])
    const res = await request(app).get('/offers')
    expect(res.status).toBe(200)
    expect(res.body[0].clicks_total).toBe(7)
    expect(String(pool.query.mock.calls[0][0])).toContain('partner_offers o JOIN partners p')
  })

  it('ошибка БД — пустой список', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).get('/offers')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
    expect(logger.error).toHaveBeenCalledWith('Admin offers list error:', expect.any(Error))
  })
})

describe('POST /partners/:id/offers', () => {
  it('нечисловой id партнёра — 400', async () => {
    const res = await request(app)
      .post('/partners/abc/offers')
      .send({ category: 'taxi', title: 'Такси', deeplink: 'https://x.ru' })
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('короткий title — 400', async () => {
    const res = await request(app)
      .post('/partners/1/offers')
      .send({ category: 'taxi', title: 'ab', deeplink: 'https://x.ru' })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Valid title is required')
  })

  it('без deeplink — 400', async () => {
    const res = await request(app)
      .post('/partners/1/offers')
      .send({ category: 'taxi', title: 'Такси' })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('deeplink is required')
  })

  it('event без event_start — 400', async () => {
    const res = await request(app)
      .post('/partners/1/offers')
      .send({ category: 'event', title: 'Концерт', deeplink: 'https://x.ru' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/event_start is required/)
  })

  it('партнёр не найден — 404', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(app)
      .post('/partners/99/offers')
      .send({ category: 'taxi', title: 'Такси', deeplink: 'https://x.ru' })
    expect(res.status).toBe(404)
    expect(res.body.message).toBe('Partner not found')
  })

  it('минимальный оффер: placement chat, пустые поля как NULL, invalidate', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1 }], []])
      .mockResolvedValueOnce([{ insertId: 21 }, []])
    const res = await request(app)
      .post('/partners/1/offers')
      .send({ category: 'taxi', title: ' Такси ', deeplink: 'https://x.ru/go' })
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ id: 21 })
    const params = pool.query.mock.calls[1][1]
    expect(params).toEqual([
      '1', 'taxi', 'Такси', null, null, 'https://x.ru/go', null, null, null, null,
      'chat', 0, null, null, null, null, null, null,
    ])
    expect(invalidateMock).toHaveBeenCalledWith('partner:offers:hotel:*')
  })

  it('event-оффер: даты, capacity, pinned и фильтр placement', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1 }], []])
      .mockResolvedValueOnce([{ insertId: 22 }, []])
    const res = await request(app).post('/partners/1/offers').send({
      category: 'event',
      title: 'Концерт',
      deeplink: 'https://x.ru/event',
      event_start: '2026-12-01 18:00',
      event_end: '2026-12-01 22:00',
      placement: 'chat, profile, moon',
      pinned: true,
      price: '1500',
      capacity: '50',
      city: 'Москва',
      poster_url: 'https://x.ru/p.jpg',
      event_url: 'https://x.ru/e',
      location: 'Клуб',
      description: 'Описание',
      image_url: 'https://x.ru/i.jpg',
      valid_from: '2026-11-01',
      valid_to: '2026-12-01',
    })
    expect(res.status).toBe(201)
    const params = pool.query.mock.calls[1][1]
    expect(params[10]).toBe('chat,profile')
    expect(params[11]).toBe(1)
    expect(params[6]).toBe(1500)
    expect(params[17]).toBe(50)
    expect(params[12]).toBeInstanceOf(Date)
    expect(params[13]).toBeInstanceOf(Date)
  })

  it('падение invalidate не ломает создание оффера', async () => {
    invalidateMock.mockRejectedValueOnce(new Error('redis down'))
    pool.query
      .mockResolvedValueOnce([[{ id: 1 }], []])
      .mockResolvedValueOnce([{ insertId: 23 }, []])
    const res = await request(app)
      .post('/partners/1/offers')
      .send({ category: 'taxi', title: 'Такси', deeplink: 'https://x.ru' })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe(23)
  })

  it('ошибка БД — 500 и лог', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app)
      .post('/partners/1/offers')
      .send({ category: 'taxi', title: 'Такси', deeplink: 'https://x.ru' })
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Admin offer create error:', expect.any(Error))
  })
})

describe('PUT /offers/:offerId', () => {
  it('нечисловой id — 400', async () => {
    const res = await request(app).put('/offers/abc').send({ pinned: true })
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('недопустимый status — 400', async () => {
    const res = await request(app).put('/offers/9').send({ status: 'deleted' })
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('недопустимый placement — 400', async () => {
    const res = await request(app).put('/offers/9').send({ placement: 'moon' })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Invalid placement set')
  })

  it('нечего менять — 400', async () => {
    const res = await request(app).put('/offers/9').send({})
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Nothing to update')
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('обновляет все поля, включая NULL и даты', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }, []])
    const res = await request(app).put('/offers/9').send({
      title: ' Новое ',
      description: 'Текст',
      deeplink: 'https://x.ru/new',
      price: null,
      city: 'Сочи',
      status: 'paused',
      placement: 'chat,profile',
      pinned: false,
      event_start: '2026-12-02 12:00',
      event_end: null,
      location: 'Зал',
      poster_url: '',
      event_url: 'https://x.ru/e2',
      capacity: null,
    })
    expect(res.status).toBe(200)
    expect(res.body.message).toBe('Offer updated')
    const [sql, params] = pool.query.mock.calls[0]
    expect(String(sql)).toContain('event_start = ?')
    expect(String(sql)).toContain('event_end = ?')
    expect(String(sql)).toContain('capacity = ?')
    expect(params[0]).toBe('Новое')
    expect(params[3]).toBeNull()
    expect(params[6]).toBe('chat,profile')
    expect(params[7]).toBe(0)
    expect(params[8]).toBeInstanceOf(Date)
    expect(params[9]).toBeNull()
    expect(params[13]).toBeNull()
    expect(params[14]).toBe('9')
    expect(invalidateMock).toHaveBeenCalledWith('partner:offers:hotel:*')
  })

  it('оффер не найден — 404', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 0 }, []])
    const res = await request(app).put('/offers/99').send({ title: 'Новое' })
    expect(res.status).toBe(404)
    expect(res.body.message).toBe('Offer not found')
    expect(invalidateMock).not.toHaveBeenCalled()
  })

  it('ошибка БД — 500 и лог', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).put('/offers/9').send({ title: 'Новое' })
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Admin offer update error:', expect.any(Error))
  })
})

describe('POST /payouts', () => {
  it('partner_id обязателен и числовой — 400', async () => {
    for (const body of [{ amount: 100 }, { partner_id: 'abc', amount: 100 }]) {
      const res = await request(app).post('/payouts').send(body)
      expect(res.status).toBe(400)
      expect(res.body.message).toBe('partner_id is required')
    }
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('сумма должна быть положительной — 400', async () => {
    const res = await request(app).post('/payouts').send({ partner_id: 1, amount: -5 })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Valid amount is required')
  })

  it('недопустимый method — 400', async () => {
    const res = await request(app).post('/payouts').send({ partner_id: 1, amount: 100, method: 'cash' })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Invalid method')
  })

  it('дефолты: bank и null-детали', async () => {
    pool.query.mockResolvedValueOnce([{ insertId: 51 }, []])
    const res = await request(app).post('/payouts').send({ partner_id: '7', amount: '2500.50' })
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ id: 51 })
    expect(pool.query.mock.calls[0][1]).toEqual([7, 2500.5, 'bank', null])
  })

  it('ошибка БД — 500 и лог', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).post('/payouts').send({ partner_id: 1, amount: 100 })
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Admin payout create error:', expect.any(Error))
  })
})

describe('PUT /payouts/:id', () => {
  it('нечисловой id — 400', async () => {
    const res = await request(app).put('/payouts/abc').send({ status: 'completed' })
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('недопустимый статус — 400', async () => {
    const res = await request(app).put('/payouts/1').send({ status: 'pending' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/processing, completed or rejected/)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('processing с заметкой: без processed_at', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }, []])
    const res = await request(app).put('/payouts/1').send({ status: 'processing', admin_note: 'В работе' })
    expect(res.status).toBe(200)
    const [sql, params] = pool.query.mock.calls[0]
    expect(String(sql)).toContain('admin_note = ?')
    expect(String(sql)).not.toContain('processed_at')
    expect(params).toEqual(['processing', 'В работе', '1'])
  })

  it('completed без заметки: processed_at = NOW()', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }, []])
    const res = await request(app).put('/payouts/1').send({ status: 'completed' })
    expect(res.status).toBe(200)
    const [sql, params] = pool.query.mock.calls[0]
    expect(String(sql)).toContain('processed_at = NOW()')
    expect(params).toEqual(['completed', '1'])
  })

  it('выплата не найдена — 404', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 0 }, []])
    const res = await request(app).put('/payouts/99').send({ status: 'rejected' })
    expect(res.status).toBe(404)
    expect(res.body.message).toBe('Payout not found')
  })

  it('ошибка БД — 500 и лог', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).put('/payouts/1').send({ status: 'completed' })
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Admin payout update error:', expect.any(Error))
  })
})
