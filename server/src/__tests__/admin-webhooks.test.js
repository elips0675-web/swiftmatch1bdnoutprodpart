// P1 #8: админский журнал вебхуков — список + кнопка «Повторить».
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../db.js', () => ({
  default: { query: vi.fn(), getConnection: vi.fn() },
}))

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('../routes/premium.js', () => ({ applyPremiumCheckout: vi.fn(async () => {}) }))
vi.mock('../routes/events.js', () => ({ applyEventTicket: vi.fn(async () => {}) }))
vi.mock('../routes/partners.js', () => ({ applyPartnerOrder: vi.fn(async () => {}) }))
vi.mock('../routes/partner-dashboard.js', () => ({ applyPartnerSubscription: vi.fn(async () => {}) }))
vi.mock('../routes/hangouts.js', () => ({ applyHangoutTicket: vi.fn(async () => {}) }))

import pool from '../db.js'
import adminWebhooks from '../routes/admin/webhooks.js'
import { applyPremiumCheckout } from '../routes/premium.js'

const conn = {
  beginTransaction: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
  query: vi.fn(),
}

function createApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/admin', adminWebhooks)
  return app
}

function listMock(rows, total) {
  pool.query.mockImplementation((sql) => {
    if (String(sql).includes('COUNT(*) AS total')) return Promise.resolve([[{ total }], []])
    if (String(sql).includes('FROM webhook_deliveries')) return Promise.resolve([rows, []])
    return Promise.resolve([{ affectedRows: 1 }, []])
  })
}

function deliveryMock(row) {
  pool.query.mockImplementation(async (sql) => {
    if (String(sql).includes('FROM webhook_deliveries WHERE id')) return [[row].filter(Boolean), []]
    return [{ affectedRows: 1 }, []]
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  pool.getConnection.mockResolvedValue(conn)
  conn.query.mockResolvedValue([{ affectedRows: 1 }, []])
})

describe('GET /api/admin/webhooks', () => {
  it('возвращает строки и total', async () => {
    listMock([{ id: 2, provider: 'stripe', eventType: 'checkout.session.completed', status: 'failed' }], 2)
    const res = await request(createApp()).get('/api/admin/webhooks')
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(2)
    expect(res.body.rows).toHaveLength(1)
  })

  it('фильтр по недопустимому статусу -> 400 без запроса к БД', async () => {
    const res = await request(createApp()).get('/api/admin/webhooks?status=hacked')
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('ошибка БД -> 500', async () => {
    pool.query.mockRejectedValue(new Error('db down'))
    const res = await request(createApp()).get('/api/admin/webhooks')
    expect(res.status).toBe(500)
  })
})

describe('POST /api/admin/webhooks/:id/replay', () => {
  it('нет записи -> 404', async () => {
    deliveryMock(null)
    const res = await request(createApp()).post('/api/admin/webhooks/999/replay')
    expect(res.status).toBe(404)
  })

  it('провайдер без обработчика -> 400', async () => {
    deliveryMock({ id: 3, provider: 'revenuecat', eventId: 'e', payload: '{}' })
    const res = await request(createApp()).post('/api/admin/webhooks/3/replay')
    expect(res.status).toBe(400)
  })

  it('битый payload -> 400, транзакция не открывается', async () => {
    deliveryMock({ id: 4, provider: 'stripe', eventId: 'e', payload: 'not-json' })
    const res = await request(createApp()).post('/api/admin/webhooks/4/replay')
    expect(res.status).toBe(400)
    expect(pool.getConnection).not.toHaveBeenCalled()
  })

  it('успешный replay -> хендлер вызван, commit и processed', async () => {
    deliveryMock({
      id: 5,
      provider: 'stripe',
      eventId: 'evt_r',
      payload: JSON.stringify({ id: 'evt_r', type: 'checkout.session.completed', data: { object: { metadata: {} } } }),
    })
    const res = await request(createApp()).post('/api/admin/webhooks/5/replay')
    expect(res.status).toBe(200)
    expect(applyPremiumCheckout).toHaveBeenCalled()
    expect(conn.commit).toHaveBeenCalled()
    const sqls = pool.query.mock.calls.map((c) => String(c[0]))
    expect(sqls.some((s) => s.includes('UPDATE webhook_deliveries') && s.includes("'processed'"))).toBe(true)
  })

  it('падение хендлера -> rollback, failed, 500', async () => {
    deliveryMock({
      id: 6,
      provider: 'stripe',
      eventId: 'evt_f',
      payload: JSON.stringify({ id: 'evt_f', type: 'checkout.session.completed', data: { object: { metadata: {} } } }),
    })
    applyPremiumCheckout.mockRejectedValueOnce(new Error('replay boom'))
    const res = await request(createApp()).post('/api/admin/webhooks/6/replay')
    expect(res.status).toBe(500)
    expect(conn.rollback).toHaveBeenCalled()
    const sqls = pool.query.mock.calls.map((c) => String(c[0]))
    expect(sqls.some((s) => s.includes('UPDATE webhook_deliveries') && s.includes("'failed'"))).toBe(true)
  })
})
