import { test, expect } from '@playwright/test'
import crypto from 'crypto'
import { apiCall, loginViaApi, API_BASE } from './helpers/api'

// Этап 74 (аудит qwen, пробел #3): B2B partner dashboard —
// регистрация партнёра → оффер → конверсия (S2S postback с HMAC) → статистика → выплата.

async function registerUser(ctx: any, name: string) {
  const email = `e2e_b2b_${name}_${Date.now()}@mail.ru`
  const reg = await apiCall(ctx, 'POST', '/api/auth/register', {
    email,
    password: 'TestPass123',
    displayName: `B2B ${name}`,
    consent: true,
  })
  expect(reg.ok).toBe(true)
  return { token: reg.body?.token as string, userId: reg.body?.userId as number }
}

function signBody(secret: string, body: Record<string, unknown>): string {
  const raw = JSON.stringify(body)
  return crypto.createHmac('sha256', secret).update(raw).digest('hex')
}

test.describe('B2B partner dashboard: register -> offer -> conversion -> payout', () => {
  test('full partner lifecycle via API', async ({ playwright, request }) => {
    const partnerCtx = await playwright.request.newContext()
    const buyerCtx = await playwright.request.newContext()
    const partnerUser = await registerUser(partnerCtx, 'partner')
    const buyer = await registerUser(buyerCtx, 'buyer')

    // ── 1. Регистрация партнёра ──
    const reg = await apiCall(partnerCtx, 'POST', '/api/partner/register', {
      name: `P2P Cafe ${Date.now()}`,
      type: 'deeplink',
      description: 'Restaurant partner',
      contact_email: 'p@example.com',
    }, partnerUser.token)
    expect(reg.status).toBe(201)
    expect(reg.body?.hmac_secret).toBeTruthy()
    expect(reg.body?.affiliate_token).toBeTruthy()
    const partnerId = reg.body?.id as number
    const hmacSecret = reg.body?.hmac_secret as string

    // двойная регистрация — 409
    const dup = await apiCall(partnerCtx, 'POST', '/api/partner/register', { name: 'Dup' }, partnerUser.token)
    expect(dup.status).toBe(409)

    // ── 2. Создание оффера ──
    const offer = await apiCall(partnerCtx, 'POST', '/api/partner/offers', {
      category: 'restaurant',
      title: `Table for two ${Date.now()}`,
      description: 'Evening dinner',
      deeplink: 'https://partner.example.com/table?city={city}',
      price: 1000,
      city: 'Moscow',
      placement: 'chat',
    }, partnerUser.token)
    expect(offer.status).toBe(201)
    const offerId = offer.body?.id as number
    expect(offerId).toBeGreaterThan(0)

    // невалидная категория — 400
    const badOffer = await apiCall(partnerCtx, 'POST', '/api/partner/offers', {
      category: 'nope',
      title: 'Bad',
      deeplink: 'https://x',
    }, partnerUser.token)
    expect(badOffer.status).toBe(400)

    // оффер виден в своём списке
    const ownOffers = await apiCall(partnerCtx, 'GET', '/api/partner/offers', undefined, partnerUser.token)
    expect(ownOffers.status).toBe(200)
    expect((ownOffers.body as Array<{ id: number }>).some((o) => o.id === offerId)).toBe(true)

    // ── 3. Клик покупателя (конверсия click) ──
    const click = await apiCall(buyerCtx, 'POST', '/api/partners/track', { offer_id: offerId }, buyer.token)
    expect(click.status).toBe(200)
    expect(String(click.body?.deeplink)).toContain('utm_source=swiftmatch')
    expect(String(click.body?.deeplink)).toContain('city=')

    // ── 4. S2S postback (покупка) с HMAC — создаёт approved-конверсию с комиссией ──
    const postbackBody: Record<string, unknown> = {
      offer_id: offerId,
      external_order_id: `ord_${Date.now()}`,
      conversion_type: 'purchase',
      amount: 2000,
      user_id: buyer.userId,
    }
    const sig = signBody(hmacSecret, postbackBody)
    const postback = await apiCall(partnerCtx, 'POST', `/api/partners/postback/${partnerId}`, postbackBody, partnerUser.token)
    // apiCall ставит Authorization; для HMAC-верификации нужен X-Partner-Signature
    // → отправляем напрямую через request.fetch, а не через apiCall
    expect(postback.status).toBe(401) // без подписи — 401

    const raw = JSON.stringify(postbackBody)
    const signedRes = await request.post(`${API_BASE}/api/partners/postback/${partnerId}`, {
      headers: {
        'Content-Type': 'application/json',
        'X-Partner-Signature': sig,
      },
      data: raw,
    })
    const signedBody = await signedRes.json().catch(() => null)
    expect(signedRes.status()).toBe(200)
    expect(signedBody?.commission).toBe(200) // 2000 * 10% = 200

    // ── 5. Статистика в дашборде (mysql2 возвращает COUNT/SUM как строки → Number()) ──
    const dashboard = await apiCall(partnerCtx, 'GET', '/api/partner/dashboard', undefined, partnerUser.token)
    expect(dashboard.status).toBe(200)
    const stats = dashboard.body?.stats ?? {}
    expect(Number(stats.offers_count)).toBeGreaterThanOrEqual(1)
    expect(Number(stats.clicks_total)).toBeGreaterThanOrEqual(1)
    expect(Number(stats.conversions_count)).toBeGreaterThanOrEqual(1)
    expect(Number(stats.commission_total)).toBeGreaterThanOrEqual(200)
    expect(Number(stats.commission_pending)).toBeGreaterThanOrEqual(200)

    // ── 6. Админ-выплата партнёру ──
    const adminToken = await loginViaApi(request, 'admin@mail.ru', 'demo123456')
    const payout = await apiCall(request, 'POST', '/api/admin/payouts', {
      partner_id: partnerId,
      amount: 200,
      method: 'bank',
      details: 'B2B test payout',
    }, adminToken)
    expect(payout.status).toBe(201)
    const payoutId = payout.body?.id as number
    expect(payoutId).toBeGreaterThan(0)

    const payouts = await apiCall(request, 'GET', '/api/admin/payouts', undefined, adminToken)
    expect(payouts.status).toBe(200)
    expect((payouts.body as Array<{ id: number; partner_id: number }>).some((p) => p.id === payoutId && p.partner_id === partnerId)).toBe(true)

    // сменяем статус на completed
    const processed = await apiCall(request, 'PUT', `/api/admin/payouts/${payoutId}`, {
      status: 'completed',
      admin_note: 'done',
    }, adminToken)
    expect(processed.status).toBe(200)

    // комиссия теперь выплачена → pending падает
    const dashboardAfter = await apiCall(partnerCtx, 'GET', '/api/partner/dashboard', undefined, partnerUser.token)
    expect(Number(dashboardAfter.body?.stats?.paid_out)).toBeGreaterThanOrEqual(200)
  })

  test('partner endpoints require partner account (403 for regular user)', async ({ playwright, request }) => {
    const ctx = await playwright.request.newContext()
    const user = await registerUser(ctx, 'plain')

    const dashboard = await apiCall(ctx, 'GET', '/api/partner/dashboard', undefined, user.token)
    expect(dashboard.status).toBe(403)

    const offers = await apiCall(ctx, 'GET', '/api/partner/offers', undefined, user.token)
    expect(offers.status).toBe(403)
  })

  test('postback with bad signature is rejected (401)', async ({ request }) => {
    // 64 hex-символов = 32 байта — той же длины, что sha256-подпись, иначе
    // crypto.timingSafeEqual бросит ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH (500).
    const res = await request.post('http://localhost:3002/api/partners/postback/1', {
      headers: {
        'Content-Type': 'application/json',
        'X-Partner-Signature': '0'.repeat(64),
      },
      data: JSON.stringify({ external_order_id: 'x', amount: 100 }),
    })
    expect([401, 400]).toContain(res.status())
  })
})
