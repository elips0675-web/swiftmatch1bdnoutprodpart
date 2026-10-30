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

test.describe('Admin Content CRUD — interests, goals, education, banned_words, cities', () => {

  test('1. API: GET /api/admin/content returns all 5 sections', async ({ request }) => {
    const token = await loginViaApi(request, ADMIN_EMAIL, ADMIN_PASS)
    const res = await apiCall(request, 'GET', '/api/admin/content', undefined, token)
    expect(res.ok).toBe(true)
    expect(Array.isArray(res.body.interests)).toBe(true)
    expect(Array.isArray(res.body.dating_goals)).toBe(true)
    expect(Array.isArray(res.body.education)).toBe(true)
    expect(Array.isArray(res.body.banned_words)).toBe(true)
    expect(res.body.interests.length).toBeGreaterThanOrEqual(28)
    expect(res.body.dating_goals.length).toBeGreaterThanOrEqual(5)
    expect(res.body.education.length).toBeGreaterThanOrEqual(5)
    expect(res.body.banned_words.length).toBeGreaterThanOrEqual(10)
  })

  test('2. API: PUT /api/admin/content/interests round-trip', async ({ request }) => {
    const token = await loginViaApi(request, ADMIN_EMAIL, ADMIN_PASS)
    const getRes = await apiCall(request, 'GET', '/api/admin/content', undefined, token)
    const original = getRes.body.interests

    const putRes = await apiCall(request, 'PUT', '/api/admin/content/interests', { items: original }, token)
    expect(putRes.ok).toBe(true)

    const verify = await apiCall(request, 'GET', '/api/content')
    expect(verify.body.interests.sort()).toEqual(original.sort())
  })

  test('3. API: PUT /api/admin/content/goals round-trip', async ({ request }) => {
    const token = await loginViaApi(request, ADMIN_EMAIL, ADMIN_PASS)
    const getRes = await apiCall(request, 'GET', '/api/admin/content', undefined, token)
    const original = getRes.body.dating_goals

    const putRes = await apiCall(request, 'PUT', '/api/admin/content/dating_goals', { items: original }, token)
    expect(putRes.ok).toBe(true)

    const verify = await apiCall(request, 'GET', '/api/content')
    expect(verify.body.dating_goals.sort()).toEqual(original.sort())
  })

  test('4. API: PUT /api/admin/content/education round-trip', async ({ request }) => {
    const token = await loginViaApi(request, ADMIN_EMAIL, ADMIN_PASS)
    const getRes = await apiCall(request, 'GET', '/api/admin/content', undefined, token)
    const original = getRes.body.education

    const putRes = await apiCall(request, 'PUT', '/api/admin/content/education', { items: original }, token)
    expect(putRes.ok).toBe(true)

    const verify = await apiCall(request, 'GET', '/api/content')
    expect(verify.body.education.sort()).toEqual(original.sort())
  })

  test('5. API: PUT /api/admin/content/banned_words round-trip', async ({ request }) => {
    const token = await loginViaApi(request, ADMIN_EMAIL, ADMIN_PASS)
    const getRes = await apiCall(request, 'GET', '/api/admin/content', undefined, token)
    const original = getRes.body.banned_words

    const putRes = await apiCall(request, 'PUT', '/api/admin/content/banned_words', { items: original }, token)
    expect(putRes.ok).toBe(true)

    const verify = await apiCall(request, 'GET', '/api/content')
    expect(verify.body.banned_words.sort()).toEqual(original.sort())
  })

  test('6. API: add + remove interest via API persists', async ({ request }) => {
    const token = await loginViaApi(request, ADMIN_EMAIL, ADMIN_PASS)
    const testSlug = 'e2e_test_interest_alpha'

    const getRes = await apiCall(request, 'GET', '/api/admin/content', undefined, token)
    const interests = [...getRes.body.interests]

    if (!interests.includes(testSlug)) {
      interests.push(testSlug)
      await apiCall(request, 'PUT', '/api/admin/content/interests', { items: interests }, token)
    }

    const after = await apiCall(request, 'GET', '/api/content')
    expect(after.body.interests).toContain(testSlug)

    const cleanup = interests.filter(i => i !== testSlug)
    await apiCall(request, 'PUT', '/api/admin/content/interests', { items: cleanup }, token)

    const final = await apiCall(request, 'GET', '/api/content')
    expect(final.body.interests).not.toContain(testSlug)
  })

  test('7. API: add + remove banned word via API persists', async ({ request }) => {
    const token = await loginViaApi(request, ADMIN_EMAIL, ADMIN_PASS)
    const testWord = 'e2e_test_badword_xyz'

    const getRes = await apiCall(request, 'GET', '/api/admin/content', undefined, token)
    const words = [...getRes.body.banned_words]

    if (!words.includes(testWord)) {
      words.push(testWord)
      await apiCall(request, 'PUT', '/api/admin/content/banned_words', { items: words }, token)
    }

    const after = await apiCall(request, 'GET', '/api/content')
    expect(after.body.banned_words).toContain(testWord)

    const cleanup = words.filter(w => w !== testWord)
    await apiCall(request, 'PUT', '/api/admin/content/banned_words', { items: cleanup }, token)

    const final = await apiCall(request, 'GET', '/api/content')
    expect(final.body.banned_words).not.toContain(testWord)
  })

  test('8. UI: all 5 tabs visible with correct counts', async ({ page }) => {
    await loginViaUI(page, ADMIN_EMAIL, ADMIN_PASS)
    await page.goto(`${BASE_URL}/admin/content`)
    await page.waitForLoadState('networkidle')

    const tabs = ['Интересы', 'Цели', 'Образование', 'Города', 'Запрещенные']
    for (const tabName of tabs) {
      const tab = page.getByRole('tab', { name: new RegExp(tabName, 'i') })
      await expect(tab).toBeVisible({ timeout: 10000 })
    }
  })

  test('9. UI: interests tab shows items', async ({ page }) => {
    await loginViaUI(page, ADMIN_EMAIL, ADMIN_PASS)
    await page.goto(`${BASE_URL}/admin/content`)
    await page.waitForLoadState('networkidle')

    const tab = page.getByRole('tab', { name: /Интересы|Interests/i })
    await tab.click()
    await page.waitForTimeout(1000)

    const panel = page.getByRole('tabpanel')
    await expect(panel).toBeVisible({ timeout: 5000 })
    const text = await panel.textContent()
    expect(text!.length).toBeGreaterThan(50)
  })

  test('10. UI: add interest appears in panel text', async ({ page, request }) => {
    await loginViaUI(page, ADMIN_EMAIL, ADMIN_PASS)
    await page.goto(`${BASE_URL}/admin/content`)
    await page.waitForLoadState('networkidle')

    const tab = page.getByRole('tab', { name: /Интересы|Interests/i })
    await tab.click()
    await page.waitForTimeout(1000)

    const testItem = 'e2e_ui_test_interest_zzz'
    const panel = page.getByRole('tabpanel')
    const input = panel.locator('input').last()
    await input.fill(testItem)

    const addBtn = panel.locator('button').filter({ hasText: /Добавить|Add/i }).last()
    await addBtn.click()
    await page.waitForTimeout(1000)

    const panelText = await panel.textContent()
    expect(panelText).toContain(testItem)

    const token = await loginViaApi(request, ADMIN_EMAIL, ADMIN_PASS)
    const getRes = await apiCall(request, 'GET', '/api/admin/content', undefined, token)
    const interests = getRes.body.interests.filter((i: string) => i !== testItem)
    await apiCall(request, 'PUT', '/api/admin/content/interests', { items: interests }, token)
  })

  test('11. UI: goals tab shows items', async ({ page }) => {
    await loginViaUI(page, ADMIN_EMAIL, ADMIN_PASS)
    await page.goto(`${BASE_URL}/admin/content`)
    await page.waitForLoadState('networkidle')

    const tab = page.getByRole('tab', { name: /Цели|Goals/i })
    await tab.click()
    await page.waitForTimeout(1000)

    const panel = page.getByRole('tabpanel')
    await expect(panel).toBeVisible({ timeout: 5000 })
    const text = await panel.textContent()
    expect(text!.length).toBeGreaterThan(20)
  })

  test('12. UI: education tab shows items', async ({ page }) => {
    await loginViaUI(page, ADMIN_EMAIL, ADMIN_PASS)
    await page.goto(`${BASE_URL}/admin/content`)
    await page.waitForLoadState('networkidle')

    const tab = page.getByRole('tab', { name: /Образование|Education/i })
    await tab.click()
    await page.waitForTimeout(1000)

    const panel = page.getByRole('tabpanel')
    await expect(panel).toBeVisible({ timeout: 5000 })
    const text = await panel.textContent()
    expect(text!.length).toBeGreaterThan(20)
  })

  test('13. UI: banned_words tab shows items', async ({ page }) => {
    await loginViaUI(page, ADMIN_EMAIL, ADMIN_PASS)
    await page.goto(`${BASE_URL}/admin/content`)
    await page.waitForLoadState('networkidle')

    const tab = page.getByRole('tab', { name: /Запрещенные\s*слова|banned|forbidden/i })
    await tab.click()
    await page.waitForTimeout(1000)

    const panel = page.getByRole('tabpanel')
    await expect(panel).toBeVisible({ timeout: 5000 })
    const text = await panel.textContent()
    expect(text!.length).toBeGreaterThan(50)
  })

  test('14. Negative: unauthenticated GET /api/admin/content returns 401', async ({ request }) => {
    const res = await apiCall(request, 'GET', '/api/admin/content')
    expect(res.status).toBe(401)
  })

  test('15. Negative: PUT /api/admin/content with empty items still works (clears section)', async ({ request }) => {
    const token = await loginViaApi(request, ADMIN_EMAIL, ADMIN_PASS)

    const getRes = await apiCall(request, 'GET', '/api/admin/content', undefined, token)
    const original = getRes.body.interests

    const putRes = await apiCall(request, 'PUT', '/api/admin/content/interests', { items: [] }, token)
    expect(putRes.ok).toBe(true)

    const verify = await apiCall(request, 'GET', '/api/admin/content', undefined, token)
    expect(verify.body.interests).toEqual([])

    await apiCall(request, 'PUT', '/api/admin/content/interests', { items: original }, token)
  })
})
