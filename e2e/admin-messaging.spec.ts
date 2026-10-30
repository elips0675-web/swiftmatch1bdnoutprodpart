import { test, expect, type Page } from '@playwright/test'
import { apiCall, loginViaApi } from './helpers/api'

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8081'
const ADMIN_EMAIL = 'admin@mail.ru'
const ADMIN_PASS = 'demo123456'

async function loginViaUI(page: Page, email: string, password: string) {
  await page.goto(`${BASE_URL}/login`)
  await page.waitForLoadState('networkidle')
  await page.fill('[data-testid="email"]', email)
  await page.fill('[data-testid="password"]', password)
  await page.click('[data-testid="submit-login"]')
  await page.waitForURL(/^((?!\/login).)*$/, { timeout: 10000 }).catch(() => {})
}

test.describe('Admin Messaging — campaigns CRUD', () => {

  test('1. API: GET /api/admin/campaigns returns array', async ({ request }) => {
    const token = await loginViaApi(request, ADMIN_EMAIL, ADMIN_PASS)
    const res = await apiCall(request, 'GET', '/api/admin/campaigns', undefined, token)
    expect(res.ok).toBe(true)
    expect(Array.isArray(res.body)).toBe(true)
  })

  test('2. API: POST /api/admin/campaigns creates campaign', async ({ request }) => {
    const token = await loginViaApi(request, ADMIN_EMAIL, ADMIN_PASS)
    const title = `E2E Test Campaign ${Date.now()}`
    const body = 'This is a test campaign body'

    const res = await apiCall(request, 'POST', '/api/admin/campaigns', {
      title, body, target: 'all', channel: 'push'
    }, token)
    expect(res.ok).toBe(true)
    expect(res.status).toBe(201)

    const list = await apiCall(request, 'GET', '/api/admin/campaigns', undefined, token)
    const found = list.body.some((c: { title?: string }) => c.title === title)
    expect(found).toBe(true)
  })

  test('3. API: POST campaign without title returns error', async ({ request }) => {
    const token = await loginViaApi(request, ADMIN_EMAIL, ADMIN_PASS)
    const res = await apiCall(request, 'POST', '/api/admin/campaigns', {
      title: '', body: 'body', target: 'all', channel: 'push'
    }, token)
    expect(res.ok).toBe(false)
  })

  test('4. UI: /admin/messaging page loads with form', async ({ page }) => {
    await loginViaUI(page, ADMIN_EMAIL, ADMIN_PASS)
    await page.goto(`${BASE_URL}/admin/messaging`)
    await page.waitForLoadState('networkidle')

    const titleInput = page.locator('[data-testid="messaging-title"]')
    await expect(titleInput).toBeVisible({ timeout: 10000 })

    const bodyInput = page.locator('[data-testid="messaging-body"]')
    await expect(bodyInput).toBeVisible()

    const sendBtn = page.locator('[data-testid="send-campaign"]')
    await expect(sendBtn).toBeVisible()
    await expect(sendBtn).toBeDisabled()
  })

  test('5. UI: fill form → send button enables', async ({ page }) => {
    await loginViaUI(page, ADMIN_EMAIL, ADMIN_PASS)
    await page.goto(`${BASE_URL}/admin/messaging`)
    await page.waitForLoadState('networkidle')

    const titleInput = page.locator('[data-testid="messaging-title"]')
    await titleInput.fill('E2E UI Test Campaign')

    const bodyInput = page.locator('[data-testid="messaging-body"]')
    await bodyInput.fill('Test body content for E2E')

    const sendBtn = page.locator('[data-testid="send-campaign"]')
    await expect(sendBtn).toBeEnabled()
  })

  test('6. UI: send campaign → form clears → appears in history', async ({ page }) => {
    await loginViaUI(page, ADMIN_EMAIL, ADMIN_PASS)
    await page.goto(`${BASE_URL}/admin/messaging`)
    await page.waitForLoadState('networkidle')

    const uniqueTitle = `UI Campaign ${Date.now()}`
    await page.locator('[data-testid="messaging-title"]').fill(uniqueTitle)
    await page.locator('[data-testid="messaging-body"]').fill('E2E test body content')
    await page.locator('[data-testid="send-campaign"]').click()
    await page.waitForTimeout(2000)

    const titleVal = await page.locator('[data-testid="messaging-title"]').inputValue()
    expect(titleVal).toBe('')

    const historyTitle = page.locator('td, th').filter({ hasText: uniqueTitle })
    await expect(historyTitle.first()).toBeVisible({ timeout: 5000 })
  })

  test('7. Negative: unauthenticated GET /api/admin/campaigns returns 401', async ({ request }) => {
    const res = await apiCall(request, 'GET', '/api/admin/campaigns')
    expect(res.status).toBe(401)
  })

  test('8. Negative: non-admin cannot create campaign', async ({ request }) => {
    const userToken = await loginViaApi(request, 'user2@mail.ru', 'demo123456')
    const res = await apiCall(request, 'POST', '/api/admin/campaigns', {
      title: 'test', body: 'test', target: 'all', channel: 'push'
    }, userToken)
    expect(res.status).toBe(403)
  })
})
