/**
 * Быстрый смоук живого приложения: обход страниц, console-ошибки / pageerror /
 * ответы 5xx = FAIL. Перенос `scripts/check-console.mjs` из Service Desk
 * (правило: запускать после каждого изменения кода), адаптирован под SwiftMatch:
 *
 *   • маршруты — только статические (динамические `/:id`, `/verify-email`,
 *     `/reset-password`, `/onboarding` пропускаются: им нужны реальные данные);
 *   • политика ошибок — из `e2e/helpers/audit.ts` (фильтры известного шума
 *     Sentry/Supabase/Service Worker/CSP/429, 5xx и pageerror = ошибка,
 *     warnings печатаются, но не валят прогон — как в их E2E-аудите);
 *   • логин — тот же, что в `e2e/setup/global-setup.ts` (API /api/auth/login
 *     → storageState в `e2e/.auth/`, каталог в .gitignore);
 *   • русский текст («сырой» UI без перевода) — проверка как в Service Desk,
 *     но после фильтров: страница без единого русского слова = FAIL.
 *
 * Локальный инструмент, в CI не заведён: CI закрыт полным Playwright E2E.
 * Требует живых серверов: preview `8081` + API `3002` (запуск-всего.bat).
 *
 * Запуск: `npm run check:console`
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const PAGES = [
  '/', '/hangouts', '/hangouts/create', '/hangouts/my', '/chats', '/search',
  '/search/filters', '/matches', '/schedule', '/events', '/groups', '/activity',
  '/premium', '/settings', '/settings/privacy', '/profile', '/profile/edit',
  '/faq', '/about', '/safety', '/login', '/register',
  '/admin', '/admin/users', '/admin/content', '/admin/features',
  '/admin/analytics', '/admin/hangouts', '/admin/partners',
]

const BASE = process.env.BASE_URL || 'http://localhost:8081'
const API = process.env.API_URL || 'http://localhost:3002'
const AUTH_PATH = 'e2e/.auth/check-console.json'

// Тот же список игнорируемых console-ошибок, что в e2e/helpers/audit.ts
const IGNORED_CONSOLE = [
  'Sentry', 'Supabase', 'Service Worker',
  'non-existent route', 'Content Security Policy', '429',
]

async function saveStorageState(email, password) {
  const loginRes = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }).catch(() => null)
  if (!loginRes || !loginRes.ok) {
    throw new Error(`API недоступен или логин не прошёл (${API} → ${loginRes?.status}). Запусти API 3002 и preview 8081 (запуск-всего.bat).`)
  }
  const { token } = await loginRes.json()
  if (!token) throw new Error('Логин вернул без токена — нет storageState, проверь test-данные.')

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.goto(BASE)
  await page.evaluate((t) => {
    localStorage.setItem('token', t)
    sessionStorage.setItem('swiftmatch_auth_token', t)
    document.cookie = `sm_token=${t}; path=/`
  }, token)
  mkdirSync(dirname(AUTH_PATH), { recursive: true })
  await page.context().storageState({ path: AUTH_PATH })
  await browser.close()
}

function isIgnoredConsole(text) {
  return IGNORED_CONSOLE.some((needle) => text.includes(needle))
}

async function main() {
  console.log(`🔑 Логин ${'admin@mail.ru'} → storageState ${AUTH_PATH}`)
  await saveStorageState('admin@mail.ru', 'demo123456')

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ storageState: AUTH_PATH })
  let failed = 0

  for (const path of PAGES) {
    const page = await context.newPage()
    const consoleErrors = []
    const warnings = []
    const netErrors = []

    page.on('console', (msg) => {
      const text = msg.text()
      if (msg.type() === 'error' && !isIgnoredConsole(text)) {
        consoleErrors.push(text.substring(0, 200))
      }
      if (msg.type() === 'warning') warnings.push(text.substring(0, 160))
    })
    page.on('pageerror', (err) => consoleErrors.push(String(err.message).substring(0, 200)))
    page.on('response', (res) => {
      if (res.status() >= 500) netErrors.push(`HTTP ${res.status()}: ${res.url().substring(0, 150)}`)
      if (res.status() === 0) netErrors.push(`обрыв соединения: ${res.url().substring(0, 150)}`)
    })

    const problems = []
    try {
      try {
        await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 15000 })
      } catch {
        // networkidle не наступает при long-polling/WS — грузим дальше по 'load'
        await page.goto(`${BASE}${path}`, { waitUntil: 'load', timeout: 15000 })
        warnings.push('networkidle не наступил (long-polling/WS?)')
      }
      await page.waitForTimeout(1000)

      const landed = new URL(page.url()).pathname
      if (path.startsWith('/admin') && !landed.startsWith('/admin')) {
        problems.push(`не попали на страницу: редирект ${path} → ${landed}`)
      }

      const body = await page.locator('body').innerText()
      if (!/[а-яёА-ЯЁ]/.test(body)) {
        problems.push('нет ни одного русского слова (сырой ключ i18n или пустая страница)')
      }
      if (body.trim().length < 20) problems.push('страница почти пустая')
    } catch (err) {
      problems.push(`не загрузилась: ${String(err.message).split('\n')[0].substring(0, 160)}`)
    }

    problems.push(...consoleErrors, ...netErrors)
    if (problems.length > 0) {
      failed++
      console.log(`✗ ${path}`)
      for (const p of problems) console.log(`    ${p}`)
    } else {
      console.log(`✓ ${path}${warnings.length ? `  (warnings: ${warnings.length})` : ''}`)
    }
    if (warnings.length > 0 && problems.length === 0) {
      for (const w of warnings) console.log(`    warn: ${w}`)
    }
    await page.close()
  }

  await context.close()
  await browser.close()

  if (failed > 0) {
    console.log(`\n✗ Смоук провален: ${failed} из ${PAGES.length} страниц с ошибками`)
    process.exit(1)
  }
  console.log(`\n✓ Смоук чист: ${PAGES.length} страниц, console/5xx/пустые — 0`)
}

main().catch((err) => {
  console.error(`✗ ${err.message}`)
  process.exit(1)
})
