import { test, expect } from '@playwright/test'
import { apiCall } from './helpers/api'

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8081'
const ADMIN_EMAIL = 'admin@mail.ru'
const ADMIN_PASS = 'demo123456'

test.describe('Realtime ban chain → user:banned → logout', () => {
  let bannedUserId: number | null = null
  let adminToken: string = ''

  test('banned user is logged out via WS user:banned event', async ({ request, page }) => {
    // Префикс `e2e_` обязателен: global-teardown чистит только `e2e_*` и `layout_*`.
    const email = `e2e_ban_rt_${Date.now()}@mail.ru`
    const password = 'demo123456'
    const name = 'BanNotify'

    // 1. Register a fresh user (needs displayName + consent)
    const reg = await apiCall(request, 'POST', '/api/auth/register', {
      email,
      password,
      displayName: name,
      consent: true,
    })
    expect(reg.ok).toBe(true)

    // 2. Login the new user to get a real JWT
    const login = await apiCall(request, 'POST', '/api/auth/login', { email, password })
    expect(login.ok).toBe(true)
    const userToken: string = login.body.token

    // Admin token for ban/unban
    const adminLogin = await apiCall(request, 'POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASS })
    expect(adminLogin.ok).toBe(true)
    adminToken = adminLogin.body.token

    const list = await apiCall(request, 'GET', `/api/admin/users?search=${email}`, undefined, adminToken)
    const user = list.body?.users?.find((u: any) => u.email === email)
    if (!user) throw new Error('Freshly registered user not found in admin list')
    bannedUserId = user.id

    // Track a socket.io connection to the API (not the Vite HMR websocket).
    const wsToApi: string[] = []
    page.on('websocket', (ws) => {
      if (ws.url().includes('/socket.io/')) wsToApi.push(ws.url())
    })

    // 3. Токен сажается ДО первой навигации: addInitScript выполняется раньше кода
    //    приложения на каждом документе. После goto('/chats') + page.evaluate визитёр
    //    успевал уйти на /login, а useWebSocket живёт только в /chats — 0 сокетов.
    await page.addInitScript((t) => {
      sessionStorage.setItem('swiftmatch_auth_token', t)
      localStorage.setItem('token', t)
      document.cookie = `sm_token=${t}; path=/`
    }, userToken)
    await page.goto(`${BASE_URL}/chats`)
    await page.waitForLoadState('networkidle')
    expect(page.url()).not.toContain('/login')

    // Give the WS handshake a moment to reach the user:ID room
    await page.waitForTimeout(2500)
    expect(wsToApi.length).toBeGreaterThan(0)

    // 4. Attach a waiter for the logout request BEFORE banning. logout() fires
    //    POST /api/auth/logout only when the client handled the user:banned event.
    const logoutReq = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().includes('/api/auth/logout'),
      { timeout: 15000 },
    )

    try {
      // 5. Admin bans the user via API
      const ban = await apiCall(request, 'POST', `/api/admin/users/${user.id}/ban`, { reason: 'E2E realtime ban test' }, adminToken)
      expect(ban.ok).toBe(true)

      // 6. The user:banned WS event must reach the client and trigger logout()
      await logoutReq
    } finally {
      // 7. Safety: unban so the test user is not left banned in the DB
      if (bannedUserId) {
        await apiCall(request, 'POST', `/api/admin/users/${bannedUserId}/unban`, undefined, adminToken)
      }
    }
  })
})
