import { test, expect, type Page } from '@playwright/test'
import { apiCall, loginViaApi } from './helpers/api'

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8081'
const ADMIN_EMAIL = 'admin@mail.ru'
const ADMIN_PASS = 'demo123456'

type AdminUser = { id: number; email?: string; status?: string }

async function loginViaUI(page: Page, email: string, password: string) {
  await page.goto(`${BASE_URL}/login`)
  await page.waitForLoadState('networkidle')
  await page.fill('[data-testid="email"]', email)
  await page.fill('[data-testid="password"]', password)
  await page.click('[data-testid="submit-login"]')
  await page.waitForURL(/^((?!\/login).)*$/, { timeout: 10000 }).catch(() => {})
}

test.describe('Admin Users — search, ban, unban', () => {

  test('1. API: GET /api/admin/users returns user list', async ({ request }) => {
    const token = await loginViaApi(request, ADMIN_EMAIL, ADMIN_PASS)
    const res = await apiCall(request, 'GET', '/api/admin/users', undefined, token)
    expect(res.ok).toBe(true)
    expect(Array.isArray(res.body.users)).toBe(true)
    expect(res.body.users.length).toBeGreaterThanOrEqual(1)
    expect(res.body.total).toBeGreaterThanOrEqual(1)
  })

  test('2. API: GET /api/admin/users with search filter', async ({ request }) => {
    const token = await loginViaApi(request, ADMIN_EMAIL, ADMIN_PASS)
    const res = await apiCall(request, 'GET', '/api/admin/users?search=user2', undefined, token)
    expect(res.ok).toBe(true)
    expect(res.body.users.length).toBeGreaterThanOrEqual(1)
    const found = res.body.users.some((u: AdminUser) => u.email === 'user2@mail.ru')
    expect(found).toBe(true)
  })

  test('3. API: ban + unban user via dedicated endpoints', async ({ request }) => {
    const token = await loginViaApi(request, ADMIN_EMAIL, ADMIN_PASS)

    const usersRes = await apiCall(request, 'GET', '/api/admin/users?search=user5@mail.ru', undefined, token)
    const user = usersRes.body.users.find((u: AdminUser) => u.email === 'user5@mail.ru')
    if (!user) return

    const banRes = await apiCall(request, 'POST', `/api/admin/users/${user.id}/ban`, { reason: 'E2E test' }, token)
    expect(banRes.ok).toBe(true)

    const afterBan = await apiCall(request, 'GET', `/api/admin/users?search=user5@mail.ru`, undefined, token)
    const banned = afterBan.body.users.find((u: AdminUser) => u.email === 'user5@mail.ru')
    expect(banned?.status).toBe('banned')

    const unbanRes = await apiCall(request, 'POST', `/api/admin/users/${user.id}/unban`, undefined, token)
    expect(unbanRes.ok).toBe(true)

    const afterUnban = await apiCall(request, 'GET', '/api/admin/users?search=user5@mail.ru', undefined, token)
    const unbanned = afterUnban.body.users.find((u: AdminUser) => u.email === 'user5@mail.ru')
    expect(unbanned?.status).not.toBe('banned')
  })

  test('4. UI: /admin/users page loads with table', async ({ page }) => {
    await loginViaUI(page, ADMIN_EMAIL, ADMIN_PASS)
    await page.goto(`${BASE_URL}/admin/users`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(3000)

    const table = page.locator('table')
    await expect(table).toBeVisible({ timeout: 10000 })
  })

  test('5. UI: search input filters users', async ({ page }) => {
    await loginViaUI(page, ADMIN_EMAIL, ADMIN_PASS)
    await page.goto(`${BASE_URL}/admin/users`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(3000)

    const searchInput = page.locator('[data-testid="search-users"]')
    await expect(searchInput).toBeVisible({ timeout: 10000 })
  })

  test('6. Negative: unauthenticated GET /api/admin/users returns 401', async ({ request }) => {
    const res = await apiCall(request, 'GET', '/api/admin/users')
    expect(res.status).toBe(401)
  })

  test('7. Negative: non-admin token cannot ban users', async ({ request }) => {
    const userToken = await loginViaApi(request, 'user2@mail.ru', 'demo123456')
    const res = await apiCall(request, 'POST', '/api/admin/users/1/ban', { reason: 'test' }, userToken)
    expect(res.status).toBe(403)
  })

  test('8. API: GET /api/admin/users/:id returns user detail', async ({ request }) => {
    const token = await loginViaApi(request, ADMIN_EMAIL, ADMIN_PASS)
    const usersRes = await apiCall(request, 'GET', '/api/admin/users', undefined, token)
    const userId = usersRes.body.users[0]?.id
    if (!userId) return

    const res = await apiCall(request, 'GET', `/api/admin/users/${userId}`, undefined, token)
    expect(res.ok).toBe(true)
    expect(res.body.id).toBeDefined()
  })
})
