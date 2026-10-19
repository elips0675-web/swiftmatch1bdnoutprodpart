import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }))

const { log } = vi.hoisted(() => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('../logger.js', () => ({
  default: log,
  createLogger: () => log,
  rootLogger: log,
}))

import pool from '../db.js'
import logger from '../logger.js'
import {
  WEBHOOK_PROVIDERS,
  logWebhookDelivery,
  markWebhookProcessed,
  markWebhookFailed,
  listWebhookDeliveries,
  getWebhookDelivery,
} from '../webhooks.js'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('WEBHOOK_PROVIDERS', () => {
  it('заморожен и несёт ожидаемые ключи провайдеров', () => {
    expect(Object.isFrozen(WEBHOOK_PROVIDERS)).toBe(true)
    expect(WEBHOOK_PROVIDERS).toMatchObject({
      premium: 'stripe',
      iap: 'revenuecat',
      hangoutTicket: 'stripe_hangout_ticket',
    })
  })
})

describe('serializePayload (через logWebhookDelivery)', () => {
  it('null/undefined payload → null в колонке', async () => {
    pool.query.mockResolvedValue([{ affectedRows: 1 }])
    await logWebhookDelivery({ provider: 'stripe', eventId: 'e1', eventType: 't', payload: null })
    expect(pool.query.mock.calls[0][1][3]).toBeNull()
  })

  it('объект с циклом (JSON.stringify бросает) → null, а не падение', async () => {
    pool.query.mockResolvedValue([{ affectedRows: 1 }])
    const cyclic = { a: 1 }
    cyclic.self = cyclic
    await expect(
      logWebhookDelivery({ provider: 'stripe', eventId: 'e2', eventType: 't', payload: cyclic }),
    ).resolves.toBeUndefined()
    expect(pool.query.mock.calls[0][1][3]).toBeNull()
  })

  it('eventId/eventType не заданы → пустая строка и null', async () => {
    pool.query.mockResolvedValue([{ affectedRows: 1 }])
    await logWebhookDelivery({ provider: 'stripe' })
    const params = pool.query.mock.calls[0][1]
    expect(params[1]).toBe('')
    expect(params[2]).toBeNull()
  })
})

describe('markWebhookFailed', () => {
  it('текст ошибки обрезается до 1000 символов', async () => {
    pool.query.mockResolvedValue([{ affectedRows: 1 }])
    await markWebhookFailed('stripe', 'e', 'x'.repeat(2500))
    expect(pool.query.mock.calls[0][1][0]).toHaveLength(1000)
  })

  it('пустая ошибка → «unknown error»; eventId отсутствует → пустая строка', async () => {
    pool.query.mockResolvedValue([{ affectedRows: 1 }])
    await markWebhookFailed('stripe', null, '')
    const params = pool.query.mock.calls[0][1]
    expect(params[0]).toBe('unknown error')
    expect(params[2]).toBe('')
  })

  it('падение БД глотается', async () => {
    pool.query.mockRejectedValue(new Error('db down'))
    await expect(markWebhookFailed('stripe', 'e', 'boom')).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalled()
  })
})

describe('markWebhookProcessed', () => {
  it('обновляет статус processed без ошибки', async () => {
    pool.query.mockResolvedValue([{ affectedRows: 1 }])
    await markWebhookProcessed('stripe', 'evt_9')
    const [sql, params] = pool.query.mock.calls[0]
    expect(String(sql)).toContain("SET status = 'processed'")
    expect(params).toEqual(['stripe', 'evt_9'])
  })

  it('eventId отсутствует → пустая строка', async () => {
    pool.query.mockResolvedValue([{ affectedRows: 1 }])
    await markWebhookProcessed('stripe', undefined)
    expect(pool.query.mock.calls[0][1]).toEqual(['stripe', ''])
  })
})

describe('listWebhookDeliveries — фильтры и пагинация', () => {
  it('без фильтров: без WHERE, дефолтный limit 50/offset 0', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 2 }, { id: 1 }]])
      .mockResolvedValueOnce([[{ total: 2 }]])
    const out = await listWebhookDeliveries()

    const [sql, params] = pool.query.mock.calls[0]
    expect(String(sql)).not.toContain('WHERE')
    expect(params).toEqual([50, 0])
    expect(out.rows).toHaveLength(2)
    expect(out.total).toBe(2)
    expect(out.limit).toBe(50)
    expect(out.offset).toBe(0)
  })

  it('фильтр по provider и status → WHERE с двумя условиями', async () => {
    pool.query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ total: 0 }]])
    await listWebhookDeliveries({ provider: 'stripe', status: 'failed' })

    const [sql, params] = pool.query.mock.calls[0]
    expect(String(sql)).toContain('provider = ? AND status = ?')
    expect(params).toEqual(['stripe', 'failed', 50, 0])

    const [, countParams] = pool.query.mock.calls[1]
    expect(countParams).toEqual(['stripe', 'failed'])
  })

  it('limit зажимается в [1, 200], offset не меньше 0', async () => {
    pool.query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ total: 0 }]])
    const out = await listWebhookDeliveries({ limit: 9999, offset: -5 })
    expect(out.limit).toBe(200)
    expect(out.offset).toBe(0)

    pool.query.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[{ total: 0 }]])
    const out2 = await listWebhookDeliveries({ limit: -3, offset: '10' })
    expect(out2.limit).toBe(1)
    expect(out2.offset).toBe(10)
  })

  it('total из БД как строка приводится к числу; отсутствует → 0', async () => {
    pool.query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ total: '42' }]])
    expect((await listWebhookDeliveries()).total).toBe(42)

    pool.query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{}]])
    expect((await listWebhookDeliveries()).total).toBe(0)
  })
})

describe('getWebhookDelivery', () => {
  it('возвращает строку по id', async () => {
    pool.query.mockResolvedValue([[{ id: 5, provider: 'stripe' }]])
    await expect(getWebhookDelivery(5)).resolves.toEqual({ id: 5, provider: 'stripe' })
    expect(pool.query.mock.calls[0][1]).toEqual([5])
  })

  it('нет строки → null', async () => {
    pool.query.mockResolvedValue([[]])
    await expect(getWebhookDelivery(404)).resolves.toBeNull()
  })
})
