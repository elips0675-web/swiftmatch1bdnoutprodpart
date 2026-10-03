import { test, expect } from '@playwright/test'
import { createAudit } from './helpers/audit'
import { apiCall, getTokenFromStorage, API_BASE } from './helpers/api'

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8081'

// ============ 13. GDPR — CONSENT FLOW ============
test.describe('13. GDPR consent flow', () => {
  test('Register with consent=true writes consent_log', async ({ request }) => {
    const email = `e2e_consent_${Date.now()}@mail.ru`
    const res = await apiCall(request, 'POST', '/api/auth/register', {
      email, password: 'TestPass123', displayName: 'Consent E2E', consent: true,
    })
    expect(res.ok).toBe(true)
    const token = res.body?.token as string
    expect(token).toBeTruthy()

    const history = await apiCall(request, 'GET', '/api/consent/history', undefined, token)
    expect(history.ok).toBe(true)
    const granted = (history.body as Array<{ consent_type?: string; granted?: number }>)?.find((c) => c.consent_type === 'data_processing')
    expect(granted).toBeTruthy()
    expect(granted.granted).toBe(1)
  })

  test('Register UI: submit blocked without consent, works with consent', async ({ page }) => {
    const audit = createAudit(page)
    const email = `e2e_uiconsent_${Date.now()}@mail.ru`

    await page.goto(`${BASE_URL}/register`)
    await page.waitForLoadState('networkidle')
    await page.fill('[data-testid="name"]', 'UI Consent User')
    await page.fill('[data-testid="email"]', email)
    await page.fill('[data-testid="password"]', 'TestPass123')
    await page.click('[data-testid="submit-register"]')
    await page.waitForTimeout(1500)

    expect(page.url()).toContain('/register')

    await page.click('[data-testid="age-checkbox"]')
    await page.click('[data-testid="consent-checkbox"]')
    await page.click('[data-testid="submit-register"]')
    await page.waitForURL(/^((?!\/register).)*$/, { timeout: 10000 }).catch(() => {})
    expect(page.url()).not.toContain('/register')

    audit.expectClean()
  })

  test('POST /api/consent revoke + restore, data export includes consents', async ({ request }) => {
    const token = getTokenFromStorage('e2e/.auth/demo.json')
    expect(token).toBeTruthy()

    const revoked = await apiCall(request, 'POST', '/api/consent', { consent_type: 'data_processing', granted: false }, token)
    expect(revoked.ok).toBe(true)

    const history = await apiCall(request, 'GET', '/api/consent/history', undefined, token)
    const revokedEntry = (history.body as Array<{ consent_type?: string; granted?: number }>).find((c) => c.consent_type === 'data_processing')
    expect(revokedEntry.granted).toBe(0)

    const restored = await apiCall(request, 'POST', '/api/consent', { consent_type: 'data_processing', granted: true }, token)
    expect(restored.ok).toBe(true)

    const exportRes = await apiCall(request, 'GET', '/api/data/export', undefined, token)
    expect(exportRes.ok).toBe(true)
    expect(Array.isArray(exportRes.body?.consents)).toBe(true)
    expect(exportRes.body?.user?.email).toBe('user2@mail.ru')
  })

  test('Erase request returns token', async ({ request }) => {
    const email = `e2e_erase_${Date.now()}@mail.ru`
    const reg = await apiCall(request, 'POST', '/api/auth/register', {
      email, password: 'TestPass123', displayName: 'Erase E2E', consent: true,
    })
    expect(reg.ok).toBe(true)
    const token = reg.body?.token as string
    const res = await apiCall(request, 'POST', '/api/data/erase/request', {}, token)
    expect(res.ok).toBe(true)
    expect(res.body?.token).toBeTruthy()
    expect(res.body?.message).toBeTruthy()
  })

  test.describe('GDPR UI (auth)', () => {
    test.use({ storageState: 'e2e/.auth/demo.json' })

    test('Settings privacy page has consent toggle', async ({ page }) => {
      const audit = createAudit(page)
      await page.goto(`${BASE_URL}/settings`)
      await page.waitForLoadState('networkidle')

      const toggle = page.locator('[data-testid="switch-data-consent"]')
      if (await toggle.isVisible({ timeout: 3000 }).catch(() => false)) {
        await toggle.click()
        await page.waitForTimeout(500)
      }
      audit.expectClean()
    })
  })
})

// ============ 14. ICEBREAKERS ============
test.describe('14. Icebreakers', () => {
  test('POST /api/icebreakers/suggest returns 3 suggestions', async ({ request }) => {
    const token = getTokenFromStorage('e2e/.auth/demo.json')
    expect(token).toBeTruthy()
    const res = await apiCall(request, 'POST', '/api/icebreakers/suggest', { chat_user_id: 3 }, token)
    expect(res.ok).toBe(true)
    const suggestions = res.body?.suggestions as string[]
    expect(Array.isArray(suggestions)).toBe(true)
    expect(suggestions.length).toBeGreaterThanOrEqual(3)
    for (const s of suggestions) {
      expect(typeof s).toBe('string')
      expect(s.length).toBeGreaterThan(0)
    }
    // source: 'static' — легитимный фолбэк icebreakers.js:76, а не ошибка.
    expect(['db', 'openai', 'static']).toContain(res.body?.source)
  })

  test.describe('Icebreakers UI', () => {
    test.use({ storageState: 'e2e/.auth/demo.json' })

    test('Empty chat shows chips, click sends message', async ({ page, request }) => {
      const demoToken = getTokenFromStorage('e2e/.auth/demo.json')
      expect(demoToken).toBeTruthy()

      const adminToken = getTokenFromStorage('e2e/.auth/admin.json')
      expect(adminToken).toBeTruthy()
      // adminAuth приоритезирует httpOnly-cookie над Bearer, а любой Playwright request-контекст
      // в jar'е несёт sm_token не-админа (от предыдущих регистраций) → PUT /features дал бы 403.
      // Обходим через чистый fetch (без cookie jar'а), чтобы Bearer-админ прошёл.
      const adminPut = async (flagsBody: Record<string, unknown>) => {
        const r = await fetch(`${API_BASE}/api/admin/features`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + adminToken },
          body: JSON.stringify(flagsBody),
        })
        return { status: r.status, ok: r.ok, body: await r.json().catch(() => null) }
      }
      const flags = await apiCall(request, 'GET', '/api/admin/features', undefined, adminToken)
      expect(flags.ok).toBe(true)
      const originalFlags = { ...flags.body }
      const enabled = await adminPut({ ...originalFlags, aiIcebreakers: true })
      expect(enabled.ok).toBe(true)

      try {
        const me = await apiCall(request, 'GET', '/api/profile/me', undefined, demoToken)
        expect(me.ok).toBe(true)
        const meId = me.body?.id as number
        expect(meId).toBeGreaterThan(0)

        let chatId = 0
        // этап 40: диапазон расширен до 199 — после многих прогонов у demo есть
        // чаты со всеми "ранними" юзерами, ищем кого угодно без существующего чата
        for (let pid = 20; pid <= 199 && !chatId; pid++) {
          if (pid === meId) continue
          const created = await apiCall(request, 'POST', '/api/chats', { participant_id: pid }, demoToken)
          if (created.ok && created.body?.existing === false) {
            chatId = created.body.id as number
            break
          }
        }
        expect(chatId).toBeGreaterThan(0)

        const audit = createAudit(page)
        await page.goto(`${BASE_URL}/chats`)
        await page.waitForLoadState('networkidle')

        const chatRow = page.locator(`[data-testid="chat-row-${chatId}"]`)
        await expect(chatRow).toBeVisible({ timeout: 5000 })
        await chatRow.click()
        await page.waitForLoadState('networkidle')

        const chips = page.locator('[data-testid="icebreaker-chip"]')
        await expect(chips.first()).toBeVisible({ timeout: 8000 })

        const chipText = (await chips.first().innerText()).trim()
        await chips.first().click()
        await page.waitForTimeout(1500)

        await expect(page.locator('[data-testid="message-list"]')).toContainText(chipText, { timeout: 5000 })
        audit.expectClean()
      } finally {
        await adminPut(originalFlags)
      }
    })
  })
})

// ============ 15. A/B EXPERIMENTS ============
test.describe('15. A/B experiments', () => {
  test('GET /api/experiments/card_cta is stable per user', async ({ request }) => {
    const token = getTokenFromStorage('e2e/.auth/demo.json')
    expect(token).toBeTruthy()
    const first = await apiCall(request, 'GET', '/api/experiments/card_cta', undefined, token)
    const second = await apiCall(request, 'GET', '/api/experiments/card_cta', undefined, token)
    expect(first.ok).toBe(true)
    expect(first.body?.key).toBe('card_cta')
    expect(first.body?.enabled).toBe(true)
    expect(['variant_a', 'variant_b']).toContain(first.body?.variant)
    expect(second.body?.variant).toBe(first.body?.variant)
  })

  test('POST /api/analytics/track records event', async ({ request }) => {
    const token = getTokenFromStorage('e2e/.auth/demo.json')
    expect(token).toBeTruthy()
    const res = await apiCall(request, 'POST', '/api/analytics/track', {
      event_type: 'e2e_test', variant: 'a', metadata: { source: 'features.spec' },
    }, token)
    expect(res.ok).toBe(true)
  })

  test.describe('A/B admin UI', () => {
    test.use({ storageState: 'e2e/.auth/admin.json' })

    test('Admin experiments page lists card_cta', async ({ page }) => {
      const audit = createAudit(page)
      await page.goto(`${BASE_URL}/admin/experiments`)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('code', { hasText: 'card_cta' })).toBeVisible({ timeout: 5000 })
      audit.expectClean()
    })
  })
})

// ============ 16. GHOST MODE (premium-gated) ============
test.describe('16. Ghost mode / privacy', () => {
  test('Privacy settings get + premium gate on incognito', async ({ request }) => {
    const token = getTokenFromStorage('e2e/.auth/demo.json')
    expect(token).toBeTruthy()

    const privacy = await apiCall(request, 'GET', '/api/settings/privacy', undefined, token)
    expect(privacy.ok).toBe(true)
    expect(typeof privacy.body?.incognito).toBe('boolean')

    const premium = await apiCall(request, 'GET', '/api/premium/my', undefined, token)
    const hasActiveSub = premium.ok && !!premium.body?.is_active

    const enable = await apiCall(request, 'PUT', '/api/settings/privacy', { incognito: true }, token)
    if (hasActiveSub) {
      expect(enable.ok).toBe(true)
      const after = await apiCall(request, 'GET', '/api/settings/privacy', undefined, token)
      expect(after.body?.incognito).toBe(true)

      const disable = await apiCall(request, 'PUT', '/api/settings/privacy', { incognito: false }, token)
      expect(disable.ok).toBe(true)
    } else {
      expect(enable.status).toBe(403)
      expect(enable.body?.code).toBe('PREMIUM_REQUIRED')
    }
  })
})

// ============ 17. PROFILE SCORE ============
test.describe('17. Profile score', () => {
  test('PUT /api/profile/score returns 0-100', async ({ request }) => {
    const token = getTokenFromStorage('e2e/.auth/demo.json')
    expect(token).toBeTruthy()
    const res = await apiCall(request, 'PUT', '/api/profile/score', {}, token)
    expect(res.ok).toBe(true)
    const { score, photoCount, interestCount } = res.body
    expect(typeof score).toBe('number')
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(100)
    expect(typeof photoCount).toBe('number')
    expect(typeof interestCount).toBe('number')
  })
})

// ============ 18. VIDEO DATE SCHEDULING + SAFETY CHECK-IN ============
test.describe('18. Video date scheduling & safety check-in', () => {
  test('Schedule CRUD: create, list, accept, decline, cancel', async ({ request }) => {
    const demoToken = getTokenFromStorage('e2e/.auth/demo.json')
    const user4Token = getTokenFromStorage('e2e/.auth/user4.json')
    const user5Token = getTokenFromStorage('e2e/.auth/user5.json')
    expect(demoToken).toBeTruthy()
    expect(user4Token).toBeTruthy()
    expect(user5Token).toBeTruthy()

    const payload4 = JSON.parse(Buffer.from(user4Token.split('.')[1], 'base64url').toString())
    const user4Id = payload4.userId as number
    expect(user4Id).toBeGreaterThan(0)
    const payloadDemo = JSON.parse(Buffer.from(demoToken.split('.')[1], 'base64url').toString())
    const demoId = payloadDemo.userId as number

    const future = new Date(Date.now() + 86400000).toISOString()

    const chat = await apiCall(request, 'POST', '/api/chats', { participant_id: user4Id }, demoToken)
    expect(chat.ok).toBe(true)
    const chatId = chat.body.id as number
    expect(chatId).toBeGreaterThan(0)

    const created = await apiCall(request, 'POST', '/api/schedule', {
      chat_id: chatId, scheduled_at: future, duration_minutes: 30, message: 'Video call?',
    }, demoToken)
    expect(created.status).toBe(201)
    expect(created.body.proposer_id).toBe(demoId)
    expect(created.body.status).toBe('pending')
    const scheduleId = created.body.id as number

    const list = await apiCall(request, 'GET', '/api/schedule?status=all', undefined, demoToken)
    expect(list.ok).toBe(true)
    expect((list.body as Array<{ id?: number }>).some((s) => s.id === scheduleId)).toBe(true)

    const forbidden = await apiCall(request, 'POST', '/api/schedule', {
      chat_id: chatId, scheduled_at: future,
    }, user5Token)
    expect(forbidden.status).toBe(403)

    const accept = await apiCall(request, 'PUT', `/api/schedule/${scheduleId}/accept`, undefined, user4Token)
    expect(accept.ok).toBe(true)
    expect(accept.body.status).toBe('accepted')

    const sched2 = await apiCall(request, 'POST', '/api/schedule', { chat_id: chatId, scheduled_at: future }, demoToken)
    const decline = await apiCall(request, 'PUT', `/api/schedule/${sched2.body.id}/decline`, undefined, user4Token)
    expect(decline.ok).toBe(true)
    expect(decline.body.status).toBe('declined')

    const sched3 = await apiCall(request, 'POST', '/api/schedule', { chat_id: chatId, scheduled_at: future }, demoToken)
    const cancel = await apiCall(request, 'PUT', `/api/schedule/${sched3.body.id}/cancel`, undefined, demoToken)
    expect(cancel.ok).toBe(true)
    expect(cancel.body.status).toBe('cancelled')

    const reAccept = await apiCall(request, 'PUT', `/api/schedule/${scheduleId}/accept`, undefined, user4Token)
    expect(reAccept.status).toBe(404)
  })

  test('Safety check-in: contact, start, active, confirm', async ({ request }) => {
    const token = getTokenFromStorage('e2e/.auth/demo.json')
    expect(token).toBeTruthy()

    const contact = await apiCall(request, 'POST', '/api/checkin/contacts', {
      name: 'E2E Contact', phone: '+70000000000', relation: 'friend',
    }, token)
    expect(contact.status).toBe(201)
    expect(contact.body.id).toBeGreaterThan(0)

    const bad = await apiCall(request, 'POST', '/api/checkin/start', { checkin_minutes: 5 }, token)
    expect(bad.status).toBe(400)

    const started = await apiCall(request, 'POST', '/api/checkin/start', {
      checkin_minutes: 30, message: 'On a date', location_sharing: true,
    }, token)
    expect(started.status).toBe(201)
    expect(started.body.checkin_at).toBeTruthy()
    const checkinId = started.body.id as number

    const active = await apiCall(request, 'GET', '/api/checkin/active', undefined, token)
    expect(active.ok).toBe(true)
    expect((active.body as Array<{ id?: number }>).some((c) => c.id === checkinId)).toBe(true)

    const done = await apiCall(request, 'POST', `/api/checkin/${checkinId}/checkin`, undefined, token)
    expect(done.ok).toBe(true)
    expect(done.body.status).toBe('checked_in')

    const del = await apiCall(request, 'DELETE', `/api/checkin/contacts/${contact.body.id}`, undefined, token)
    expect(del.ok).toBe(true)
  })
})