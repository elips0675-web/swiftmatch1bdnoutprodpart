import { test, expect } from '@playwright/test'
import { createAudit } from './helpers/audit'
import { apiCall, loginViaApi, healthCheck, getTokenFromStorage } from './helpers/api'

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8081'
const ADMIN_EMAIL = 'admin@mail.ru'
const ADMIN_PASS = 'demo123456'

async function loginViaUI(page: { goto: (url: string) => Promise<void>; waitForLoadState: (state: string) => Promise<void>; fill: (selector: string, value: string) => Promise<void>; click: (selector: string) => Promise<void>; waitForURL: (regex: RegExp, opts?: { timeout: number }) => Promise<void> }, email: string, password: string) {
  await page.goto(`${BASE_URL}/login`)
  await page.waitForLoadState('networkidle')
  await page.fill('[data-testid="email"]', email)
  await page.fill('[data-testid="password"]', password)
  await page.click('[data-testid="submit-login"]')
  await page.waitForURL(/^((?!\/login).)*$/, { timeout: 10000 }).catch(() => {})
}

// ============ 1. HEALTH & INFRASTRUCTURE ============
test.describe('1. Health & Infrastructure', () => {
  test('API health check passes', async ({ request }) => {
    const health = await healthCheck(request)
    expect(health.ok).toBe(true)
    expect(health.db).toBe(true)
  })

  test('Frontend loads without errors', async ({ page }) => {
    const audit = createAudit(page)
    await page.goto(BASE_URL)
    await page.waitForLoadState('networkidle')
    audit.expectClean()
  })
})

// ============ 2. AUTH — Registration ============
test.describe('2. Registration flow', () => {
  const uniqueEmail = `e2e_test_${Date.now()}@mail.ru`

  test('Register new user via UI then login', async ({ page, request }) => {
    const audit = createAudit(page)

    await page.goto(`${BASE_URL}/register`)
    await page.waitForLoadState('networkidle')
    await page.fill('[data-testid="name"]', 'E2E Test User')
    await page.fill('[data-testid="email"]', uniqueEmail)
    await page.fill('[data-testid="password"]', 'TestPass123')
    await page.click('[data-testid="age-checkbox"]')
    await page.click('[data-testid="consent-checkbox"]')
    await page.click('[data-testid="submit-register"]')

    await page.waitForURL(/^((?!\/register).)*$/, { timeout: 10000 }).catch(() => {})
    const url = page.url()
    expect(url).not.toContain('/register')

    await loginViaUI(page, uniqueEmail, 'TestPass123')
    await page.goto(`${BASE_URL}/profile/edit`)
    await page.waitForLoadState('networkidle')

    audit.expectClean()
  })
})

// ============ 3. AUTH — Login edge cases ============
test.describe('3. Negative auth tests', () => {
  test('Login with wrong password shows error', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`)
    await page.waitForLoadState('networkidle')
    await page.fill('[data-testid="email"]', 'demo@mail.ru')
    await page.fill('[data-testid="password"]', 'wrongpassword')
    await page.click('[data-testid="submit-login"]')

    await page.waitForTimeout(1500)
    expect(page.url()).toContain('/login')
  })

  test('Empty email field shows validation', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`)
    await page.waitForLoadState('networkidle')
    await page.fill('[data-testid="password"]', 'test123')
    await page.click('[data-testid="submit-login"]')

    await page.waitForTimeout(500)
    const emailInput = page.locator('[data-testid="email"]')
    const validity = await emailInput.evaluate((el: HTMLInputElement) => el.validationMessage)
    expect(validity.length).toBeGreaterThan(0)
  })
})

// ============ 4. SEARCH → LIKE → MATCH → CHAT ============
test.describe('4. Like → Match → Chat (two users)', () => {
  test.use({ storageState: 'e2e/.auth/user4.json' })

  test('User A likes User B, creates match, sends message', async ({ browser, page, request }) => {
    const tokenA = await loginViaApi(request, 'user4@mail.ru', 'demo123456')
    const tokenB = await loginViaApi(request, 'user5@mail.ru', ADMIN_PASS)
    expect(tokenA).toBeTruthy()
    expect(tokenB).toBeTruthy()

    const likeA = await apiCall(request, 'POST', '/api/likes', { liked_user_id: 5 }, tokenA)
    expect(likeA.ok).toBe(true)

    const likeB = await apiCall(request, 'POST', '/api/likes', { liked_user_id: 4 }, tokenB)
    expect(likeB.ok).toBe(true)

    const audit = createAudit(page)
    await page.goto(`${BASE_URL}/chats`)
    await page.waitForLoadState('networkidle')

    const chatLink = page.locator('a[href*="/chats/"]').first()
    if (await chatLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await chatLink.click()
      await page.waitForLoadState('networkidle')

      const msgInput = page.locator('[data-testid="message-input"]')
      if (await msgInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await msgInput.fill('Hello from E2E test!')
        await page.locator('[data-testid="send-button"]').click()
        await page.waitForTimeout(1000)

        await expect(page.locator('[data-testid="message-list"]')).toContainText('Hello from E2E test!')
      }
    }
    audit.expectClean()
  })
})

// ============ 5. ADMIN FLOW ============
test.describe('5. Admin flow', () => {
  test.use({ storageState: 'e2e/.auth/admin.json' })

  let adminToken = ''

  test.beforeAll(() => {
    adminToken = getTokenFromStorage('e2e/.auth/admin.json')
  })

  test('Admin dashboard loads', async ({ page }) => {
    const audit = createAudit(page)
    await page.goto(`${BASE_URL}/admin`)
    await page.waitForLoadState('networkidle')
    expect(page.url()).not.toContain('/login')
    audit.expectClean()
  })

  test('Toggle a feature flag via API', async ({ request }) => {
    if (!adminToken) test.skip()

    // Features API returns {videoCalls: true, aiIcebreakers: true, ...}
    const flagsObj = {
      videoCalls: true, aiIcebreakers: true, aiCompatibility: true,
      groupsPage: true, contest: true, showAds: false,
    }
    const keys = Object.keys(flagsObj)
    expect(keys.length).toBeGreaterThan(0)

    // Toggle first flag
    const firstKey = keys[0]
    const updated = await apiCall(request, 'PUT', '/api/admin/features', {
      [firstKey]: !flagsObj[firstKey],
    }, adminToken)
    expect(updated.ok).toBe(true)

    // Restore
    const restored = await apiCall(request, 'PUT', '/api/admin/features', {
      [firstKey]: flagsObj[firstKey],
    }, adminToken)
    expect(restored.ok).toBe(true)
  })

  test('Feature flags page has save/reset buttons', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/features`)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('[data-testid="save-features"]')).toBeVisible()
    await expect(page.locator('[data-testid="reset-features"]')).toBeVisible()
  })

  test('Search users in admin panel', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin`)
    const searchInput = page.locator('[data-testid="search-users"]')
    if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await searchInput.fill('demo')
      await page.waitForTimeout(1000)
      await expect(page.locator('table')).toBeVisible()
    }
  })
})

// ============ 6. PUBLIC PAGES ============
test.describe('6. Public pages load without errors', () => {
  const publicPages = ['/', '/login', '/register', '/forgot-password']

  for (const path of publicPages) {
    test(`${path} loads without console errors`, async ({ page }) => {
      const audit = createAudit(page)
      await page.goto(`${BASE_URL}${path}`)
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(1000)
      audit.expectClean()
    })
  }
})

// ============ 7. SETTINGS ============
test.describe('7. Settings page', () => {
  test.use({ storageState: 'e2e/.auth/demo.json' })

  test('Settings switches are interactive', async ({ page }) => {
    const audit = createAudit(page)
    await page.goto(`${BASE_URL}/settings`)
    await page.waitForLoadState('networkidle')

    const switchBtn = page.locator('[data-testid="switch-email-newsletter"]')
    if (await switchBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await switchBtn.click()
      await page.waitForTimeout(500)
    }

    const logoutBtn = page.locator('[data-testid="logout-button"]')
    await expect(logoutBtn).toBeVisible()

    audit.expectClean()
  })
})

// ============ 8. CHAT ============
test.describe('8. Chat functionality', () => {
  test.use({ storageState: 'e2e/.auth/demo.json' })

  test('Chat page opens and shows message input', async ({ page }) => {
    const audit = createAudit(page)
    await page.goto(`${BASE_URL}/chats`)
    await page.waitForLoadState('networkidle')

    const chatLink = page.locator('a[href*="/chats/"]').first()
    if (await chatLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await chatLink.click()
      await page.waitForLoadState('networkidle')

      await expect(page.locator('[data-testid="message-input"]')).toBeVisible({ timeout: 3000 })
      await expect(page.locator('[data-testid="send-button"]')).toBeVisible()
    }
    audit.expectClean()
  })
})

// ============ 9. GROUPS ============
test.describe('9. Groups page', () => {
  test.use({ storageState: 'e2e/.auth/demo.json' })

  test('Groups create dialog opens', async ({ page }) => {
    const audit = createAudit(page)
    await page.goto(`${BASE_URL}/groups`)
    await page.waitForLoadState('networkidle')

    const createBtn = page.locator('[data-testid="create-group-button"]')
    if (await createBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await createBtn.click()
      await page.waitForTimeout(500)

      await expect(page.locator('[data-testid="group-name"]')).toBeVisible({ timeout: 2000 })
      await expect(page.locator('[data-testid="group-description"]')).toBeVisible()
    }
    audit.expectClean()
  })
})

// ============ 10. NEGATIVE TESTS ============
test.describe('10. Negative & security tests', () => {
  test.use({ storageState: 'e2e/.auth/demo.json' })

  test('XSS in profile bio is sanitized', async ({ page, request }) => {
    const audit = createAudit(page)

    // Use API to save XSS content in bio
    const loginRes = await request.post('http://localhost:3002/api/auth/login', {
      data: { email: 'user2@mail.ru', password: 'demo123456' },
    })
    if (loginRes.ok) {
      const token = (await loginRes.json()).token
      // id берём у сервера: /api/profile/:id теперь правится только владельцем
      const meRes = await request.get('http://localhost:3002/api/profile/me', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const ownId = meRes.ok() ? (await meRes.json()).id : null
      if (ownId) {
        await request.put(`http://localhost:3002/api/profile/${ownId}`, {
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          data: { bio: '<script>alert("xss")</script>' },
        })
      }
    }

    // Navigate to profile page and check tags were stripped server-side (этап 34+)
    await page.goto(`${BASE_URL}/profile`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)

    const bodyText = await page.locator('body').innerText()
    expect(bodyText).not.toContain('<script>')
    expect(bodyText).not.toContain('Script executed')

    audit.expectClean()
  })

  test('Wrong password stays on /login', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`)
    await page.waitForLoadState('networkidle')
    await page.fill('[data-testid="email"]', 'demo@mail.ru')
    await page.fill('[data-testid="password"]', 'wrongpass123!')
    await page.click('[data-testid="submit-login"]')
    await page.waitForTimeout(2000)
    expect(page.url()).toContain('/login')
  })

  test('Empty email shows browser validation', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`)
    await page.waitForLoadState('networkidle')
    await page.fill('[data-testid="password"]', 'test')
    await page.click('[data-testid="submit-login"]')
    await page.waitForTimeout(500)
    const msg = await page.locator('[data-testid="email"]').evaluate((el: HTMLInputElement) => el.validationMessage)
    expect(msg.length).toBeGreaterThan(0)
  })
})

// ============ 11. WS REAL-TIME ============
test.describe('11. WebSocket real-time', () => {
  test.use({ storageState: 'e2e/.auth/demo.json' })

  test('Message appears without page reload', async ({ page }) => {
    const audit = createAudit(page)
    await page.goto(`${BASE_URL}/chats`)
    await page.waitForLoadState('networkidle')

    const chatLink = page.locator('a[href*="/chats/"]').first()
    if (await chatLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await chatLink.click()
      await page.waitForLoadState('networkidle')

      const input = page.locator('[data-testid="message-input"]')
      if (await input.isVisible({ timeout: 3000 }).catch(() => false)) {
        await input.fill('E2E WS test message')
        await page.locator('[data-testid="send-button"]').click()
        await page.waitForTimeout(2000)

        const msgList = page.locator('[data-testid="message-list"]')
        await expect(msgList).toContainText('E2E WS test message', { timeout: 5000 })
      }
    }
    audit.expectClean()
  })
})

// ============ 12. WS TWO-BROWSER ============
test.describe('12. WebSocket two-browser real-time', () => {
  test('User A sends, User B receives without reload', async ({ browser, request }) => {
    const tokenA = await loginViaApi(request, 'user4@mail.ru', 'demo123456')
    const tokenB = await loginViaApi(request, 'user5@mail.ru', ADMIN_PASS)
    expect(tokenA).toBeTruthy()
    expect(tokenB).toBeTruthy()

    // Ensure match exists
    await apiCall(request, 'POST', '/api/likes', { liked_user_id: 5 }, tokenA)
    await apiCall(request, 'POST', '/api/likes', { liked_user_id: 4 }, tokenB)

    const ctxA = await browser.newContext({ storageState: 'e2e/.auth/user4.json' })
    const ctxB = await browser.newContext({ storageState: 'e2e/.auth/user5.json' })
    const pageA = await ctxA.newPage()
    const pageB = await ctxB.newPage()
    const auditA = createAudit(pageA)
    const auditB = createAudit(pageB)

    await pageA.goto(`${BASE_URL}/chats`)
    await pageA.waitForLoadState('networkidle')
    await pageB.goto(`${BASE_URL}/chats`)
    await pageB.waitForLoadState('networkidle')

    const linkA = pageA.locator('a[href*="/chats/"]').first()
    const linkB = pageB.locator('a[href*="/chats/"]').first()

    if (await linkA.isVisible({ timeout: 3000 }).catch(() => false)) {
      await linkA.click()
      await pageA.waitForLoadState('networkidle')

      const inputA = pageA.locator('[data-testid="message-input"]')
      if (await inputA.isVisible({ timeout: 3000 }).catch(() => false)) {
        await inputA.fill('Two-browser WS test')
        await pageA.locator('[data-testid="send-button"]').click()
        await pageA.waitForTimeout(1000)

        if (await linkB.isVisible({ timeout: 3000 }).catch(() => false)) {
          await linkB.click()
          await pageB.waitForLoadState('networkidle')

          const msgListB = pageB.locator('[data-testid="message-list"]')
          await expect(msgListB).toContainText('Two-browser WS test', { timeout: 8000 })
        }
      }
    }

    auditA.expectClean()
    auditB.expectClean()
    await ctxA.close()
    await ctxB.close()
  })
})
