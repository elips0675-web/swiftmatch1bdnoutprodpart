import { test, expect, Page } from '@playwright/test'
import { createAudit } from './helpers/audit'

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8081'
const USER_STATE = 'e2e/.auth/demo.json'
const ADMIN_STATE = 'e2e/.auth/admin.json'

// Бэклог (`Что доделать.txt`, «Остатки, подтверждённые сверкой двух аудитов 13.10.2026»):
// «Страницы фронта без собственного юнит-теста» и «Админ-страницы без E2E». Здесь закрывается
// вторая половина — сквозной путь до каждой страницы. Проверка: документ отдаётся (< 400),
// страница доводит до готового экрана (заголовок из PAGE_TITLES в `src/App.tsx`), нет
// 5xx/console-error/pageerror (общий детектор — `e2e/helpers/audit.ts`).

interface PageCase {
  path: string
  title: string
}

const USER_PAGES: PageCase[] = [
  { path: '/matches', title: 'Мои совпадения — SwiftMatch' },
  { path: '/search', title: 'Поиск — SwiftMatch' },
  { path: '/search/filters', title: 'Фильтры — SwiftMatch' },
  { path: '/groups', title: 'Группы — SwiftMatch' },
  { path: '/contest', title: 'Конкурс — SwiftMatch' },
  { path: '/events', title: 'Афиша событий — SwiftMatch' },
  { path: '/hangouts/my', title: 'Мои встречи — SwiftMatch' },
  { path: '/onboarding', title: 'Добро пожаловать — SwiftMatch' },
  { path: '/settings', title: 'Настройки — SwiftMatch' },
  { path: '/settings/privacy', title: 'Конфиденциальность — SwiftMatch' },
  { path: '/schedule', title: 'Видеосвидания — SwiftMatch' },
  { path: '/support-chat', title: 'Поддержка — SwiftMatch' },
  { path: '/about', title: 'О приложении — SwiftMatch' },
  { path: '/faq', title: 'Вопросы — SwiftMatch' },
  { path: '/premium', title: 'Премиум — SwiftMatch' },
  { path: '/premium/success', title: 'Оплата успешна — SwiftMatch' },
  { path: '/premium/cancel', title: 'Оплата отменена — SwiftMatch' },
  { path: '/partner/register', title: 'Регистрация партнёра — SwiftMatch' },
  { path: '/partner-order/success', title: 'Заказ оформлен — SwiftMatch' },
  { path: '/partner-order/cancel', title: 'Заказ отменён — SwiftMatch' },
  { path: '/profile/attachment-test', title: 'Тест привязанности — SwiftMatch' },
  { path: '/safety', title: 'SwiftMatch' },
  { path: '/user', title: 'SwiftMatch' },
  { path: '/verify-email', title: 'SwiftMatch' },
]

const ADMIN_PAGES: PageCase[] = [
  { path: '/admin/analytics', title: 'Аналитика — SwiftMatch' },
  { path: '/admin/backup', title: 'Резервные копии — SwiftMatch' },
  { path: '/admin/experiments', title: 'SwiftMatch' },
  { path: '/admin/hangouts', title: 'Модерация встреч — SwiftMatch' },
  { path: '/admin/monetization', title: 'Монетизация — SwiftMatch' },
  { path: '/admin/partners', title: 'Партнёры — SwiftMatch' },
  { path: '/admin/photos', title: 'SwiftMatch' },
  { path: '/admin/reports', title: 'Жалобы — SwiftMatch' },
  { path: '/admin/teams', title: 'Команды модерации — SwiftMatch' },
  { path: '/admin/health', title: 'Состояние системы — SwiftMatch' },
  { path: '/admin/queues', title: 'Очереди заданий — SwiftMatch' },
  { path: '/admin/webhooks', title: 'Вебхуки — SwiftMatch' },
]

const BOTTOM_NAV = [
  { href: '/', title: 'SwiftMatch' },
  { href: '/search', title: 'Поиск — SwiftMatch' },
  { href: '/groups', title: 'Группы — SwiftMatch' },
  { href: '/chats', title: 'Чаты — SwiftMatch' },
  { href: '/profile', title: 'Профиль — SwiftMatch' },
]

const CYRILLIC = /[А-Яа-яЁё]/

async function openPage(page: Page, path: string) {
  const res = await page.goto(`${BASE_URL}${path}`)
  expect(res?.status() ?? 0, `${path}: HTTP-статус документа`).toBeLessThan(400)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(300)
}

test.describe('Смоук непокрытых страниц (13.10.2026): страницы пользователя открываются без ошибок', () => {
  test.use({ storageState: USER_STATE })

  for (const { path, title } of USER_PAGES) {
    test(`${path} — готовый экран, без 5xx`, async ({ page }) => {
      const audit = createAudit(page)
      await openPage(page, path)
      await expect(page, `${path} увёл на /login`).not.toHaveURL(/\/login/)
      await expect(page).toHaveTitle(title)
      await expect(page.locator('body')).toContainText(CYRILLIC)
      audit.expectClean()
    })
  }
})

test.describe('Смоук непокрытых страниц (13.10.2026): админ-страницы открываются без ошибок', () => {
  test.use({ storageState: ADMIN_STATE })

  for (const { path, title } of ADMIN_PAGES) {
    test(`${path} — готовый экран, без 5xx`, async ({ page }) => {
      const audit = createAudit(page)
      await openPage(page, path)
      await expect(page, `${path} увёл на /login`).not.toHaveURL(/\/login/)
      await expect(page).toHaveTitle(title)
      await expect(page.locator('body')).toContainText(CYRILLIC)
      audit.expectClean()
    })
  }
})

test.describe('Смоук непокрытых страниц (13.10.2026): пункты нижнего меню ведут на живую страницу', () => {
  test.use({ storageState: USER_STATE })

  for (const { href, title } of BOTTOM_NAV) {
    test(`клик по «${href}» открывает страницу без ошибок`, async ({ page }) => {
      const audit = createAudit(page)
      await openPage(page, '/')
      const link = page.locator(`nav.fixed a[href="${href}"]`).first()
      await expect(link, `в нижнем меню нет ссылки ${href}`).toBeVisible()
      await link.click()
      await page.waitForLoadState('networkidle')
      await expect(page).toHaveURL(new RegExp(`${href === '/' ? '\\/$' : `${href}$`}`))
      await expect(page).toHaveTitle(title)
      audit.expectClean()
    })
  }
})
