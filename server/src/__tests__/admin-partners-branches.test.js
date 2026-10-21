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
import adminPartners from '../routes/admin/partners.js'

const app = express()
app.use(express.json())
app.use(adminPartners)

const appNoBodyParser = express()
appNoBodyParser.use(adminPartners)

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockReset()
  pool.query.mockResolvedValue([[], []])
  invalidateMock.mockReset()
  invalidateMock.mockResolvedValue(undefined)
})

describe('роуты админки, смонтированные без body-парсера', () => {
  it.each([
    ['post', '/partners', 'Valid name is required'],
    ['put', '/partners/1', 'Nothing to update'],
    ['post', '/partners/1/offers', 'category must be one of'],
    ['put', '/offers/1', 'Nothing to update'],
    ['post', '/payouts', 'partner_id is required'],
    ['put', '/payouts/1', 'status must be processing, completed or rejected'],
  ])('%s %s — 400 с профильным сообщением и без запроса в БД', async (method, url, message) => {
    const res = await request(appNoBodyParser)[method](url)
    expect(res.status).toBe(400)
    expect(res.body.message).toContain(message)
    expect(pool.query).not.toHaveBeenCalled()
  })
})

describe('PUT /offers/:offerId — null-поля', () => {
  it('price, event_start, event_end и capacity = null пишутся null, а не 0', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }, []])
    const res = await request(app)
      .put('/offers/1')
      .send({ price: null, event_start: null, event_end: null, capacity: null })
    expect(res.status).toBe(200)
    const params = pool.query.mock.calls[0][1]
    expect(params).toEqual([null, null, null, null, '1'])
  })

  it('числовые price и capacity приводятся к Number, event_end — к Date', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }, []])
    const res = await request(app)
      .put('/offers/1')
      .send({ price: '1500', capacity: '25', event_end: '2026-12-03 18:00' })
    expect(res.status).toBe(200)
    const params = pool.query.mock.calls[0][1]
    expect(params[0]).toBe(1500)
    expect(params[1]).toBeInstanceOf(Date)
    expect(params[1].getFullYear()).toBe(2026)
    expect(params[1].getHours()).toBe(18)
    expect(params[2]).toBe(25)
    expect(params[3]).toBe('1')
  })
})

describe('инвалидация кэша офферов', () => {
  it('падение invalidate не роняет ответ — оффер обновлён', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }, []])
    invalidateMock.mockRejectedValueOnce(new Error('redis down'))
    const res = await request(app).put('/offers/1').send({ title: 'Такси' })
    expect(res.status).toBe(200)
    expect(res.body.message).toBe('Offer updated')
    expect(invalidateMock).toHaveBeenCalledWith('partner:offers:hotel:*')
  })
})
