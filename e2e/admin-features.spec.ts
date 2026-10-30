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

test.describe('Admin Features — feature flags CRUD', () => {

  test('1. API: GET /api/admin/features returns flag object', async ({ request }) => {
    const res = await apiCall(request, 'GET', '/api/admin/features')
    expect(res.ok).toBe(true)
    expect(typeof res.body).toBe('object')
    expect(res.body).not.toBeNull()
  })

  test('2. API: PUT /api/admin/features saves and round-trips', async ({ request }) => {
    const token = await loginViaApi(request, ADMIN_EMAIL, ADMIN_PASS)

    const getRes = await apiCall(request, 'GET', '/api/admin/features', undefined, token)
    const original = getRes.body

    const putRes = await apiCall(request, 'PUT', '/api/admin/features', original, token)
    expect(putRes.ok).toBe(true)

    const verify = await apiCall(request, 'GET', '/api/admin/features', undefined, token)
    for (const key of Object.keys(original)) {
      expect(verify.body[key]).toBe(original[key])
    }
  })

  test('3. API: toggle a flag and verify change persists', async ({ request }) => {
    const token = await loginViaApi(request, ADMIN_EMAIL, ADMIN_PASS)

    const getRes = await apiCall(request, 'GET', '/api/admin/features', undefined, token)
    const flags = { ...getRes.body }
    const testKey = 'hangouts'

    const originalVal = flags[testKey] ?? false
    flags[testKey] = !originalVal

    await apiCall(request, 'PUT', '/api/admin/features', flags, token)

    const verify = await apiCall(request, 'GET', '/api/admin/features', undefined, token)
    expect(verify.body[testKey]).toBe(!originalVal)

    flags[testKey] = originalVal
    await apiCall(request, 'PUT', '/api/admin/features', flags, token)
  })

  test('4. UI: /admin/features page loads with switches', async ({ page }) => {
    await loginViaUI(page, ADMIN_EMAIL, ADMIN_PASS)
    await page.goto(`${BASE_URL}/admin/features`)
    await page.waitForLoadState('networkidle')

    const heading = page.locator('text=Feature Flags')
    await expect(heading).toBeVisible({ timeout: 10000 })

    const switches = page.locator('[role="switch"]')
    const count = await switches.count()
    expect(count).toBeGreaterThanOrEqual(5)
  })

  test('5. UI: toggle flag → save button enables → save → persists', async ({ page }) => {
    await loginViaUI(page, ADMIN_EMAIL, ADMIN_PASS)
    await page.goto(`${BASE_URL}/admin/features`)
    await page.waitForLoadState('networkidle')

    const firstSwitch = page.locator('[role="switch"]').first()
    const initialState = await firstSwitch.getAttribute('aria-checked')
    await firstSwitch.click()
    await page.waitForTimeout(200)

    const saveBtn = page.locator('[data-testid="save-features"]')
    await expect(saveBtn).toBeEnabled()

    await saveBtn.click()
    await page.waitForTimeout(1000)

    const newState = await firstSwitch.getAttribute('aria-checked')
    expect(newState).not.toBe(initialState)

    const resetBtn = page.locator('[data-testid="reset-features"]')
    await expect(resetBtn).toBeDisabled()
  })

  test('6. UI: reset button reverts unsaved changes', async ({ page }) => {
    await loginViaUI(page, ADMIN_EMAIL, ADMIN_PASS)
    await page.goto(`${BASE_URL}/admin/features`)
    await page.waitForLoadState('networkidle')

    const firstSwitch = page.locator('[role="switch"]').first()
    const initial = await firstSwitch.getAttribute('aria-checked')
    await firstSwitch.click()
    await page.waitForTimeout(200)

    const resetBtn = page.locator('[data-testid="reset-features"]')
    await expect(resetBtn).toBeEnabled()
    await resetBtn.click()
    await page.waitForTimeout(200)

    const after = await firstSwitch.getAttribute('aria-checked')
    expect(after).toBe(initial)
  })

  test('7. API: public GET /api/admin/features does not require auth', async ({ request }) => {
    const res = await apiCall(request, 'GET', '/api/admin/features')
    expect(res.ok).toBe(true)
    expect(typeof res.body).toBe('object')
  })

  test('8. Negative: PUT /api/admin/features without auth returns 401', async ({ request }) => {
    const res = await apiCall(request, 'PUT', '/api/admin/features', { hangouts: true })
    expect(res.status).toBe(401)
  })
})
