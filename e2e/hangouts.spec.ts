import { test, expect, type APIRequestContext } from '@playwright/test'
import { createAudit } from './helpers/audit'
import { apiCall } from './helpers/api'

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8081'

async function enableHangoutsFlag(request: APIRequestContext) {
  const admin = await apiCall(request, 'POST', '/api/auth/login', {
    email: 'admin@mail.ru',
    password: 'demo123456',
  })
  if (!admin.ok) return false
  const put = await apiCall(request, 'PUT', '/api/admin/features', { hangouts: true }, admin.body?.token)
  return put.ok === true
}

async function registerUser(request: APIRequestContext, name: string) {
  const email = `e2e_hangout_${name}_${Date.now()}@mail.ru`
  const reg = await apiCall(request, 'POST', '/api/auth/register', {
    email,
    password: 'TestPass123',
    displayName: `Hangout ${name}`,
    consent: true,
  })
  expect(reg.ok).toBe(true)
  return { token: reg.body?.token as string, userId: reg.body?.user_id ?? reg.body?.userId }
}

// ============ HANGOUTS: FULL FLOW ============
test.describe('Hangouts: create -> respond -> accept -> chat', () => {
  test('API flow enables flag, creates hangout, responds, accepts, creates chat', async ({ playwright, request }) => {
    const flagOn = await enableHangoutsFlag(request)
    expect(flagOn).toBe(true)

    // Изолированные cookie-контексты: middleware предпочитает httpOnly-cookie Bearer'у,
    // а Playwright request хранит Set-Cookie из предыдущих запросов в общем jar.
    // Без изоляции cookie одного юзера перекрывает Bearer другого → "own hangout".
    const authorCtx = await playwright.request.newContext()
    const companionCtx = await playwright.request.newContext()

    const author = await registerUser(authorCtx, 'author')
    const companion = await registerUser(companionCtx, 'companion')

    const eventDate = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()
    const create = await apiCall(authorCtx, 'POST', '/api/hangouts', {
      category: 'cinema',
      title: 'Dune 2 together',
      description: 'Evening show',
      place_name: 'Aurora',
      city: 'Moscow',
      event_date: eventDate,
      max_companions: 1,
    }, author.token)
    expect(create.ok).toBe(true)
    const hangoutId = create.body?.id
    expect(hangoutId).toBeGreaterThan(0)

    const my = await apiCall(authorCtx, 'GET', '/api/hangouts/my', undefined, author.token)
    expect(my.ok).toBe(true)
    expect((my.body as Array<{ id: number }>).some((h) => h.id === hangoutId)).toBe(true)

    const respond = await apiCall(companionCtx, 'POST', `/api/hangouts/${hangoutId}/respond`, {
      message: 'Take me!',
    }, companion.token)
    expect(respond.ok).toBe(true)
    const responseId = respond.body?.id
    expect(responseId).toBeGreaterThan(0)

    const duplicate = await apiCall(companionCtx, 'POST', `/api/hangouts/${hangoutId}/respond`, {
      message: 'Again',
    }, companion.token)
    expect(duplicate.status).toBe(409)

    const responsesList = await apiCall(authorCtx, 'GET', `/api/hangouts/${hangoutId}/responses`, undefined, author.token)
    expect(responsesList.ok).toBe(true)
    expect(Array.isArray(responsesList.body)).toBe(true)
    expect(responsesList.body.length).toBeGreaterThan(0)

    const accept = await apiCall(authorCtx, 'PUT', `/api/hangouts/${hangoutId}/responses/${responseId}`, {
      status: 'accepted',
    }, author.token)
    expect(accept.ok).toBe(true)
    const chatId = accept.body?.chat_id
    expect(chatId).toBeGreaterThan(0)

    const afterAccept = await apiCall(authorCtx, 'GET', `/api/hangouts/${hangoutId}`, undefined, author.token)
    expect(afterAccept.ok).toBe(true)
    expect(afterAccept.body?.status).toBe('completed')

    const myResponses = await apiCall(companionCtx, 'GET', '/api/hangouts/responses/my', undefined, companion.token)
    expect(myResponses.ok).toBe(true)
    const mine = (myResponses.body as Array<{ id: number; response_status?: string; status?: string }>).find(
      (r) => r.id === responseId,
    )
    expect(mine).toBeTruthy()
  })

  test('Author cannot respond to own hangout', async ({ playwright, request }) => {
    const ctx = await playwright.request.newContext()
    const author = await registerUser(ctx, 'selfresp')
    const create = await apiCall(ctx, 'POST', '/api/hangouts', {
      category: 'other',
      title: 'Park walk',
      event_date: new Date(Date.now() + 86_400_000).toISOString(),
      max_companions: 2,
    }, author.token)
    expect(create.ok).toBe(true)

    const selfRespond = await apiCall(ctx, 'POST', `/api/hangouts/${create.body?.id}/respond`, {}, author.token)
    expect(selfRespond.status).toBe(400)
  })

  test('Non-author cannot accept responses', async ({ playwright, request }) => {
    const authorCtx = await playwright.request.newContext()
    const strangerCtx = await playwright.request.newContext()
    const author = await registerUser(authorCtx, 'owner2')
    const stranger = await registerUser(strangerCtx, 'stranger2')
    const create = await apiCall(authorCtx, 'POST', '/api/hangouts', {
      category: 'theater',
      title: 'Bolshoi evening',
      event_date: new Date(Date.now() + 86_400_000).toISOString(),
      max_companions: 1,
    }, author.token)
    expect(create.ok).toBe(true)

    const forbidden = await apiCall(strangerCtx, 'PUT', `/api/hangouts/${create.body?.id}/responses/999999`, {
      status: 'accepted',
    }, stranger.token)
    expect([403, 404]).toContain(forbidden.status)
  })

  test('Hangouts page renders card for logged-in user', async ({ page }) => {
    const audit = createAudit(page)

    const author = await registerUser(page.request as never, 'uiuser')
    const create = await apiCall(page.request as never, 'POST', '/api/hangouts', {
      category: 'cafe',
      title: 'Coffee meetup E2E',
      event_date: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      max_companions: 3,
    }, author.token)
    expect(create.ok).toBe(true)

    await page.addInitScript((token) => {
      window.localStorage.setItem('token', token)
      document.cookie = `sm_token=${token}; path=/`
    }, author.token)
    await page.goto(`${BASE_URL}/hangouts`)
    await page.waitForLoadState('networkidle')

    const card = page.locator('[data-testid^="hangout-card-"]').first()
    await expect(card).toBeVisible({ timeout: 10_000 })

    audit.expectClean()
  })
})
