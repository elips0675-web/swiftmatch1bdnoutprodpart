import { test, expect, type APIRequestContext } from '@playwright/test'
import mysql from 'mysql2/promise'
import { apiCall } from './helpers/api'

// RevenueCat webhook E2E (события с мок-телом, живой HTTP и живая БД).
// Ветки вебхука держат юниты (server/src/__tests__/iap-webhook.test.js) на мокнутой БД,
// а здесь проверяется то, чего мок доказать не может: живой MySQL принимает INSERT/UPDATE,
// UNIQUE-ключ uq_subscriptions_provider не даёт продлению создать вторую строку,
// а подписка видна через GET /api/iap/status.
// Секрет вебхука серверу задаёт запуск-всего.bat (локально) и env джобы в ci.yml/deploy.yml.

const SECRET = process.env.REVENUECAT_WEBHOOK_SECRET || 'ci-e2e-revenuecat-webhook'
const MONTH_MS = 30 * 24 * 3600 * 1000

let conn: mysql.Connection | null = null

async function db() {
  if (!conn) {
    conn = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'swiftmatch',
    })
  }
  return conn
}

async function countSubscriptions(userId: number) {
  const [rows] = await (await db()).execute(
    'SELECT COUNT(*) AS n FROM subscriptions WHERE user_id = ? AND provider = ?',
    [userId, 'revenuecat'],
  )
  const row = (rows as Array<Record<string, unknown>>)[0]
  return Number(row.n)
}

test.afterAll(async () => {
  if (conn) await conn.end()
})

async function registerUser(request: APIRequestContext, name: string) {
  const email = `e2e_iap_${name}_${Date.now()}@mail.ru`
  const reg = await apiCall(request, 'POST', '/api/auth/register', {
    email,
    password: 'TestPass123',
    displayName: `IAP ${name}`,
    consent: true,
  })
  expect(reg.ok).toBe(true)
  return { userId: reg.body?.userId as number, token: reg.body?.token as string }
}

async function sendEvent(request: APIRequestContext, event: Record<string, unknown>, secret = SECRET) {
  const res = await apiCall(request, 'POST', '/api/iap/webhook', { event }, secret)
  if (res.status === 503) {
    throw new Error(
      'API отвечает 503: сервер поднят без REVENUECAT_WEBHOOK_SECRET. ' +
        'Перезапусти стенд через запуск-всего.bat или задай переменную окружения.',
    )
  }
  return res
}

async function iapStatus(request: APIRequestContext, token: string) {
  const res = await apiCall(request, 'GET', '/api/iap/status', undefined, token)
  expect(res.status).toBe(200)
  return res.body as { active: boolean; tier: string | null; expiresAt?: string }
}

test.describe('IAP: RevenueCat webhook (mock events, live DB)', () => {
  test('без Authorization и с неверным секретом -> 401 (fail-closed)', async ({ request }) => {
    const payload = { event: { type: 'INITIAL_PURCHASE', app_user_id: '1', product_id: 'plus_1m' } }
    const noAuth = await apiCall(request, 'POST', '/api/iap/webhook', payload)
    expect(noAuth.status).toBe(401)
    const wrong = await apiCall(request, 'POST', '/api/iap/webhook', payload, 'wrong-secret')
    expect(wrong.status).toBe(401)
    expect(String(wrong.body?.message)).toMatch(/Invalid signature/i)
  })

  test('INITIAL_PURCHASE создаёт активную подписку, видна в /api/iap/status', async ({ request }) => {
    const { userId, token } = await registerUser(request, 'initial')
    const expires = Date.now() + MONTH_MS

    const res = await sendEvent(request, {
      type: 'INITIAL_PURCHASE',
      app_user_id: String(userId),
      product_id: 'gold_1m',
      expiration_at_ms: expires,
    })
    expect(res.status).toBe(200)
    expect(res.body?.received).toBe(true)

    const status = await iapStatus(request, token)
    expect(status.active).toBe(true)
    expect(status.tier).toBe('gold')
    expect(Math.abs(new Date(status.expiresAt as string).getTime() - expires)).toBeLessThan(2000)
  })

  test('RENEWAL продлевает ту же подписку (срок сдвигается вперёд)', async ({ request }) => {
    const { userId, token } = await registerUser(request, 'renewal')
    await sendEvent(request, {
      type: 'INITIAL_PURCHASE',
      app_user_id: String(userId),
      product_id: 'plus_1m',
      expiration_at_ms: Date.now() + MONTH_MS,
    })
    const before = await iapStatus(request, token)

    const extended = Date.now() + 2 * MONTH_MS
    const renewal = await sendEvent(request, {
      type: 'RENEWAL',
      app_user_id: String(userId),
      product_id: 'plus_1m',
      expiration_at_ms: extended,
    })
    expect(renewal.status).toBe(200)

    const after = await iapStatus(request, token)
    expect(after.active).toBe(true)
    expect(after.tier).toBe('plus')
    expect(new Date(after.expiresAt as string).getTime()).toBeGreaterThan(
      new Date(before.expiresAt as string).getTime(),
    )
    expect(Math.abs(new Date(after.expiresAt as string).getTime() - extended)).toBeLessThan(2000)
  })

  test('повторный RENEWAL не создаёт вторую строку (UNIQUE + ON DUPLICATE KEY UPDATE)', async ({ request }) => {
    const { userId } = await registerUser(request, 'upsert')
    const product = 'platinum_6m'
    await sendEvent(request, {
      type: 'INITIAL_PURCHASE',
      app_user_id: String(userId),
      product_id: product,
      expiration_at_ms: Date.now() + MONTH_MS,
    })
    await sendEvent(request, {
      type: 'RENEWAL',
      app_user_id: String(userId),
      product_id: product,
      expiration_at_ms: Date.now() + 7 * MONTH_MS,
    })

    const [rows] = await (await db()).execute(
      'SELECT COUNT(*) AS n, MAX(status) AS status FROM subscriptions WHERE user_id = ? AND provider = ?',
      [userId, 'revenuecat'],
    )
    const row = (rows as Array<Record<string, unknown>>)[0]
    expect(Number(row.n)).toBe(1)
    expect(row.status).toBe('active')
  })

  test('два разных пользователя с одним продуктом -> у каждого своя подписка', async ({ request }) => {
    const a = await registerUser(request, 'sharedA')
    const b = await registerUser(request, 'sharedB')
    for (const u of [a, b]) {
      const res = await sendEvent(request, {
        type: 'INITIAL_PURCHASE',
        app_user_id: String(u.userId),
        product_id: 'plus_6m',
        expiration_at_ms: Date.now() + 6 * MONTH_MS,
      })
      expect(res.status).toBe(200)
    }

    expect((await iapStatus(request, a.token)).active).toBe(true)
    expect((await iapStatus(request, b.token)).active).toBe(true)
    expect(await countSubscriptions(a.userId)).toBe(1)
    expect(await countSubscriptions(b.userId)).toBe(1)
  })

  test('CANCELLATION -> active:false, тир сохранён', async ({ request }) => {
    const { userId, token } = await registerUser(request, 'cancel')
    await sendEvent(request, {
      type: 'INITIAL_PURCHASE',
      app_user_id: String(userId),
      product_id: 'plus_1m',
      expiration_at_ms: Date.now() + MONTH_MS,
    })
    const cancel = await sendEvent(request, {
      type: 'CANCELLATION',
      app_user_id: String(userId),
      product_id: 'plus_1m',
    })
    expect(cancel.status).toBe(200)

    const status = await iapStatus(request, token)
    expect(status.active).toBe(false)
    expect(status.tier).toBe('plus')
  })

  test('EXPIRATION -> active:false (is_active сброшен)', async ({ request }) => {
    const { userId, token } = await registerUser(request, 'expire')
    await sendEvent(request, {
      type: 'INITIAL_PURCHASE',
      app_user_id: String(userId),
      product_id: 'gold_12m',
      expiration_at_ms: Date.now() + 12 * MONTH_MS,
    })
    const expire = await sendEvent(request, {
      type: 'EXPIRATION',
      app_user_id: String(userId),
      product_id: 'gold_12m',
    })
    expect(expire.status).toBe(200)

    const status = await iapStatus(request, token)
    expect(status.active).toBe(false)
  })

  test('неизвестный product_id -> 400, подписки не появляется', async ({ request }) => {
    const { userId, token } = await registerUser(request, 'unknownProduct')
    const res = await sendEvent(request, {
      type: 'INITIAL_PURCHASE',
      app_user_id: String(userId),
      product_id: 'premium_monthly_99',
      expiration_at_ms: Date.now() + MONTH_MS,
    })
    expect(res.status).toBe(400)
    expect(res.body?.received).toBe(false)
    expect(await countSubscriptions(userId)).toBe(0)
    expect((await iapStatus(request, token)).active).toBe(false)
  })

  test('неизвестный тип события -> 200 received без записи в БД', async ({ request }) => {
    const { userId } = await registerUser(request, 'unknownType')
    const res = await sendEvent(request, {
      type: 'TRANSFER',
      app_user_id: String(userId),
      product_id: 'plus_1m',
      expiration_at_ms: Date.now() + MONTH_MS,
    })
    expect(res.status).toBe(200)
    expect(res.body?.received).toBe(true)
    expect(await countSubscriptions(userId)).toBe(0)
  })

  test('GET /api/iap/products отдаёт 9 продуктов (3 тира x 3 длительности)', async ({ request }) => {
    const res = await apiCall(request, 'GET', '/api/iap/products')
    expect(res.status).toBe(200)
    const ids = (res.body as Array<{ id: string }>).map((p) => p.id)
    expect(ids).toHaveLength(9)
    expect(new Set(ids).size).toBe(9)
    expect(ids).toContain('gold_1m')
    expect(ids).toContain('plus_12m')
  })
})
