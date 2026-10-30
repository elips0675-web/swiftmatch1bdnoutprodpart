import { test, expect, type APIRequestContext } from '@playwright/test'
import { apiCall } from './helpers/api'

// Этап 74 (аудит qwen, пробел #1): Premium-флоу с mock Stripe.
// В локальной среде STRIPE_SECRET_KEY отсутствует → create-checkout активирует mock-подписку (201).

async function registerUser(request: APIRequestContext, name: string) {
  const email = `e2e_premium_${name}_${Date.now()}@mail.ru`
  const reg = await apiCall(request, 'POST', '/api/auth/register', {
    email,
    password: 'TestPass123',
    displayName: `Premium ${name}`,
    consent: true,
  })
  expect(reg.ok).toBe(true)
  return { token: reg.body?.token as string, userId: reg.body?.userId as number }
}

async function getMySubscription(request: APIRequestContext, token: string) {
  return apiCall(request, 'GET', '/api/premium/my', undefined, token)
}

test.describe('Premium: tiers + mock Stripe checkout flow', () => {
  test('tiers endpoint returns the 3 configured tiers', async ({ request }) => {
    const res = await apiCall(request, 'GET', '/api/premium/tiers')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    const ids = (res.body as Array<{ id: string }>).map((t) => t.id)
    expect(ids).toEqual(expect.arrayContaining(['plus', 'gold', 'platinum']))
    for (const tier of res.body as Array<{ price: number; duration_months: number }>) {
      expect(tier.price).toBeGreaterThan(0)
      expect(tier.duration_months).toBeGreaterThan(0)
    }
  })

  test('no subscription before purchase; mock checkout activates subscription', async ({ playwright, request }) => {
    const ctx = await playwright.request.newContext()
    const user = await registerUser(ctx, 'buyer')

    const before = await getMySubscription(ctx, user.token)
    expect([200, 401]).toContain(before.status)
    if (before.status === 200) {
      expect(before.body).toBeNull()
    }

    const checkout = await apiCall(ctx, 'POST', '/api/premium/create-checkout', {
      tier: 'gold',
      duration_months: 1,
    }, user.token)
    // Без STRIPE_SECRET_KEY сервер активирует mock-подписку (201) и возвращает { message, tier }
    expect(checkout.status).toBe(201)
    expect(checkout.body?.tier).toBe('gold')

    const after = await getMySubscription(ctx, user.token)
    expect(after.status).toBe(200)
    expect(after.body?.tier).toBe('gold')
    expect(after.body?.is_active).toBe(1)
    expect(after.body?.duration_months).toBe(1)
  })

  test('invalid tier is rejected with 400', async ({ playwright, request }) => {
    const ctx = await playwright.request.newContext()
    const user = await registerUser(ctx, 'badtier')

    const res = await apiCall(ctx, 'POST', '/api/premium/create-checkout', {
      tier: 'nonexistent',
      duration_months: 1,
    }, user.token)
    expect(res.status).toBe(400)
  })

  test('create-checkout and cancel require auth', async ({ request }) => {
    const res = await apiCall(request, 'POST', '/api/premium/create-checkout', {
      tier: 'gold',
      duration_months: 1,
    })
    expect([401, 403]).toContain(res.status)

    const cancel = await apiCall(request, 'POST', '/api/premium/cancel')
    expect([401, 403]).toContain(cancel.status)
  })

  test('cancel keeps access until the paid period ends and sets status canceled', async ({ playwright }) => {
    const ctx = await playwright.request.newContext()
    const user = await registerUser(ctx, 'cancel')

    const checkout = await apiCall(ctx, 'POST', '/api/premium/create-checkout', {
      tier: 'plus',
      duration_months: 1,
    }, user.token)
    expect(checkout.status).toBe(201)

    const cancel = await apiCall(ctx, 'POST', '/api/premium/cancel', {}, user.token)
    expect(cancel.status).toBe(200)
    expect(cancel.body.status).toBe('canceled')
    // Отмена не снимает доступ: is_active остаётся 1 до expires_at, сервер отдаёт activeUntil
    expect(cancel.body.activeUntil).not.toBeNull()

    const after = await getMySubscription(ctx, user.token)
    expect(after.status).toBe(200)
    expect(after.body).not.toBeNull()
    expect(after.body.status).toBe('canceled')
    expect(after.body.is_active).toBe(1)
    expect(new Date(after.body.expires_at).getTime()).toBe(new Date(cancel.body.activeUntil).getTime())
  })

  test('cancel without active subscription returns 404', async ({ playwright, request }) => {
    const ctx = await playwright.request.newContext()
    const user = await registerUser(ctx, 'nocancel')

    const cancel = await apiCall(ctx, 'POST', '/api/premium/cancel', {}, user.token)
    expect(cancel.status).toBe(404)
  })

  test('premium page renders tiers for authenticated user', async ({ page, playwright, request }) => {
    const ctx = await playwright.request.newContext()
    const user = await registerUser(ctx, 'page')

    await page.addInitScript((token) => {
      window.localStorage.setItem('token', token)
      document.cookie = `sm_token=${token}; path=/`
    }, user.token)

    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })
    page.on('response', (res) => {
      if (res.status() >= 500) errors.push(`API ${res.status()}: ${res.url()}`)
    })

    const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:8081'
    await page.goto(`${baseUrl}/premium`)
    await page.waitForLoadState('networkidle')

    // страница тарифов должна отрендерить хотя бы один tier
    await expect(page.locator('body')).toContainText(/Plus|Gold|Platinum|Премиум|Premium/i, { timeout: 10_000 })
    expect(errors).toEqual([])
  })

  test('UI-джорни покупки: выбрать тариф → mock checkout → страница успеха → подписка активна и в API, и в интерфейсе', async ({ page, request }) => {
    const user = await registerUser(request, 'uijourney')

    await page.addInitScript((token) => {
      window.localStorage.setItem('token', token)
      document.cookie = `sm_token=${token}; path=/`
    }, user.token)

    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })
    page.on('response', (res) => {
      if (res.status() >= 500) errors.push(`API ${res.status()}: ${res.url()}`)
    })

    const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:8081'

    // До покупки активность продаёт подписку (апселл-блок activity.premium_title)
    await page.goto(`${baseUrl}/activity`)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).toContainText('Premium Доступ', { timeout: 10_000 })

    // Тариф: выбираем Gold и жмём «Начать сейчас»
    await page.goto(`${baseUrl}/premium`)
    await page.waitForLoadState('networkidle')
    await page.getByText('Gold', { exact: true }).click()
    await page.getByRole('button', { name: 'Начать сейчас' }).click()

    // Без STRIPE_SECRET_KEY сервер активирует mock-подписку, фронт уводит на страницу успеха
    await page.waitForURL('**/premium/success', { timeout: 15_000 })
    await expect(page.locator('body')).toContainText('Оплата прошла успешно!', { timeout: 10_000 })

    // Сервер видит активную gold-подписку
    const sub = await getMySubscription(request, user.token)
    expect(sub.status).toBe(200)
    expect(sub.body?.tier).toBe('gold')
    expect(sub.body?.is_active).toBe(1)

    // Интерфейс перестаёт продавать то, что уже куплено
    await page.goto(`${baseUrl}/activity`)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).not.toContainText('Premium Доступ', { timeout: 10_000 })

    expect(errors).toEqual([])
  })
})
