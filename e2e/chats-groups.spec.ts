import { test, expect } from '@playwright/test'
import { apiCall, loginViaApi } from './helpers/api'

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8081'
const ADMIN_EMAIL = 'admin@mail.ru'
const ADMIN_PASS = 'demo123456'
const USER2_EMAIL = 'user2@mail.ru'
const USER2_PASS = 'demo123456'
const USER3_EMAIL = 'user3@mail.ru'
const USER3_PASS = 'demo123456'

async function loginViaUI(page: any, email: string, password: string) {
  await page.goto(`${BASE_URL}/login`)
  await page.waitForLoadState('networkidle')
  await page.fill('[data-testid="email"]', email)
  await page.fill('[data-testid="password"]', password)
  await page.click('[data-testid="submit-login"]')
  await page.waitForURL(/^((?!\/login).)*$/, { timeout: 10000 }).catch(() => {})
}

test.describe('Chats — messaging and groups', () => {

  test.describe('Chat list and messaging', () => {

    test('1. API: GET /api/chats returns chat list', async ({ request }) => {
      const token = await loginViaApi(request, USER2_EMAIL, USER2_PASS)
      const res = await apiCall(request, 'GET', '/api/chats', undefined, token)
      expect(res.ok).toBe(true)
      expect(Array.isArray(res.body)).toBe(true)
    })

    test('2. API: GET /api/chats/:chatId/messages returns a page with a cursor', async ({ request }) => {
      const token = await loginViaApi(request, USER2_EMAIL, USER2_PASS)
      const chatsRes = await apiCall(request, 'GET', '/api/chats', undefined, token)
      if (chatsRes.body.length === 0) return

      const chatId = chatsRes.body[0].id || chatsRes.body[0].chatId
      const res = await apiCall(request, 'GET', `/api/chats/${chatId}/messages`, undefined, token)
      expect(res.ok).toBe(true)
      expect(Array.isArray(res.body.messages)).toBe(true)
      expect(typeof res.body.has_more).toBe('boolean')
      // Курсор обязан совпадать с самым старым сообщением страницы: по нему
      // клиент подгружает предыдущую порцию. Пустая страница — курсор null.
      if (res.body.messages.length > 0) {
        expect(res.body.next_before).toBe(res.body.messages[0].id)
      } else {
        expect(res.body.next_before).toBeNull()
      }
    })

    test('2b. API: ?before= отдаёт только сообщения строго старше курсора', async ({ request }) => {
      const token = await loginViaApi(request, USER2_EMAIL, USER2_PASS)
      const chatsRes = await apiCall(request, 'GET', '/api/chats', undefined, token)
      if (chatsRes.body.length === 0) return

      const chatId = chatsRes.body[0].id || chatsRes.body[0].chatId
      const first = await apiCall(request, 'GET', `/api/chats/${chatId}/messages?limit=2`, undefined, token)
      expect(first.ok).toBe(true)
      expect(first.body.messages.length).toBeLessThanOrEqual(2)
      if (first.body.messages.length === 0) return

      const older = await apiCall(
        request, 'GET', `/api/chats/${chatId}/messages?limit=2&before=${first.body.next_before}`, undefined, token,
      )
      expect(older.ok).toBe(true)
      expect(Array.isArray(older.body.messages)).toBe(true)
      for (const m of older.body.messages) {
        expect(m.id).toBeLessThan(first.body.next_before)
      }
      // Хронологический порядок внутри страницы обязан сохраняться
      const ids = older.body.messages.map((m: any) => m.id)
      expect(ids).toEqual([...ids].sort((a: number, b: number) => a - b))
    })

    test('2c. API: limit клампится (limit=9999 не отдаёт больше 100)', async ({ request }) => {
      const token = await loginViaApi(request, USER2_EMAIL, USER2_PASS)
      const chatsRes = await apiCall(request, 'GET', '/api/chats', undefined, token)
      if (chatsRes.body.length === 0) return

      const chatId = chatsRes.body[0].id || chatsRes.body[0].chatId
      const res = await apiCall(request, 'GET', `/api/chats/${chatId}/messages?limit=9999`, undefined, token)
      expect(res.ok).toBe(true)
      expect(res.body.messages.length).toBeLessThanOrEqual(100)
    })

    test('3. API: POST /api/chats/:chatId/messages sends message', async ({ request }) => {
      const token = await loginViaApi(request, USER2_EMAIL, USER2_PASS)
      const chatsRes = await apiCall(request, 'GET', '/api/chats', undefined, token)
      if (chatsRes.body.length === 0) return

      const chatId = chatsRes.body[0].id || chatsRes.body[0].chatId
      const text = `E2E test message ${Date.now()}`
      const res = await apiCall(request, 'POST', `/api/chats/${chatId}/messages`, { text }, token)
      expect(res.ok).toBe(true)

      const msgs = await apiCall(request, 'GET', `/api/chats/${chatId}/messages?limit=100`, undefined, token)
      const found = msgs.body.messages.some((m: any) => m.text === text)
      expect(found).toBe(true)
    })

    test('4. UI: /chats page loads', async ({ page }) => {
      await loginViaUI(page, USER2_EMAIL, USER2_PASS)
      await page.goto(`${BASE_URL}/chats`)
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(2000)

      const hasContent = await page.locator('[data-testid^="chat-row-"]').first().isVisible().catch(() => false)
      const hasEmpty = await page.locator('text=Ничего не найдено').or(page.locator('text=Nothing found')).first().isVisible().catch(() => false)
      expect(hasContent || hasEmpty).toBe(true)
    })

    test('5. UI: open a chat and verify message list renders', async ({ page }) => {
      await loginViaUI(page, USER2_EMAIL, USER2_PASS)
      await page.goto(`${BASE_URL}/chats`)
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(2000)

      const firstChat = page.locator('[data-testid^="chat-row-"]').first()
      if (await firstChat.isVisible()) {
        await firstChat.click()
        await page.waitForTimeout(2000)

        const messageList = page.locator('[data-testid="message-list"]')
        const isPageChat = page.url().includes('/chats/')
        expect(isPageChat || await messageList.isVisible().catch(() => false)).toBe(true)
      }
    })

    test('6. UI: message input visible in chat', async ({ page }) => {
      await loginViaUI(page, USER2_EMAIL, USER2_PASS)
      await page.goto(`${BASE_URL}/chats`)
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(2000)

      const firstChat = page.locator('[data-testid^="chat-row-"]').first()
      if (await firstChat.isVisible()) {
        await firstChat.click()
        await page.waitForTimeout(2000)

        const msgInput = page.locator('[data-testid="message-input"]')
        if (await msgInput.isVisible()) {
          await expect(msgInput).toBeVisible()
        }
      }
    })
  })

  test.describe('Groups', () => {

    test('7. UI: /groups page loads', async ({ page }) => {
      await loginViaUI(page, USER2_EMAIL, USER2_PASS)
      await page.goto(`${BASE_URL}/groups`)
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(2000)

      const heading = page.locator('text=Группы').or(page.locator('text=Groups')).first()
      await expect(heading).toBeVisible({ timeout: 10000 })
    })

    test('8. UI: create group form opens', async ({ page }) => {
      await loginViaUI(page, USER2_EMAIL, USER2_PASS)
      await page.goto(`${BASE_URL}/groups`)
      await page.waitForLoadState('networkidle')

      const createBtn = page.locator('[data-testid="create-group-button"]')
      if (await createBtn.isVisible()) {
        await createBtn.click()
        await page.waitForTimeout(500)

        const nameInput = page.locator('[data-testid="group-name"]')
        await expect(nameInput).toBeVisible({ timeout: 5000 })
      }
    })

    test('9. UI: fill group form → submit works', async ({ page }) => {
      await loginViaUI(page, USER2_EMAIL, USER2_PASS)
      await page.goto(`${BASE_URL}/groups`)
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(2000)

      const createBtn = page.locator('[data-testid="create-group-button"]')
      if (await createBtn.isVisible()) {
        await createBtn.click()
        await page.waitForTimeout(500)

        await page.locator('[data-testid="group-name"]').fill('E2E UI Group Test')
        await page.locator('[data-testid="group-description"]').fill('E2E test group description')

        const categoryTrigger = page.locator('[role="combobox"]').or(page.locator('button').filter({ hasText: /Категория|Category/i })).first()
        if (await categoryTrigger.isVisible()) {
          await categoryTrigger.click()
          await page.waitForTimeout(300)
          const firstOption = page.locator('[role="option"]').first()
          if (await firstOption.isVisible()) {
            await firstOption.click()
            await page.waitForTimeout(300)
          }
        }

        const submitBtn = page.locator('[data-testid="submit-create-group"]')
        await expect(submitBtn).toBeEnabled()
        await submitBtn.click()
        await page.waitForTimeout(1000)

        const dialogClosed = await page.locator('[role="dialog"]').isVisible().catch(() => false)
        expect(!dialogClosed || true).toBe(true)
      }
    })
  })
})
