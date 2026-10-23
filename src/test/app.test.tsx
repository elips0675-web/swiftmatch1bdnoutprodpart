import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import type { ReactNode } from 'react'

const h = vi.hoisted(() => ({
  page: (name: string) => ({ default: () => `page:${name}` }),
  state: { adminAllowed: true, partnerAllowed: true },
  useFcmToken: vi.fn(),
  t: (key: string) => `t.${key}`,
}))

vi.mock('@/context/language-context', () => ({
  LanguageProvider: ({ children }: { children?: ReactNode }) => children,
  useLanguage: () => ({ t: h.t, language: 'RU', setLanguage: vi.fn() }),
}))

vi.mock('@/context/feature-flags-context', () => ({
  FeatureFlagsProvider: ({ children }: { children?: ReactNode }) => children,
}))

vi.mock('@/context/auth-context', () => ({
  AuthProvider: ({ children }: { children?: ReactNode }) => children,
}))

vi.mock('@/components/shared/error-boundary', () => ({
  ErrorBoundary: ({ children, fallbackTitle }: { children?: ReactNode; fallbackTitle?: string }) => (
    <div data-error-boundary={fallbackTitle ?? 'root'}>{children}</div>
  ),
}))

vi.mock('@/components/shared/loading-screen', () => ({
  PageLoading: () => <div data-page-loading>loading</div>,
}))

vi.mock('@/components/layout/app-container', () => ({
  AppContainer: ({ children }: { children?: ReactNode }) => <div data-container>{children}</div>,
}))

vi.mock('@/components/layout/admin-layout', () => ({
  AdminLayout: ({ children }: { children?: ReactNode }) => <div data-admin-layout>{children}</div>,
}))

vi.mock('@/components/shared/admin-guard', () => ({
  AdminGuard: ({ children }: { children?: ReactNode }) =>
    h.state.adminAllowed ? <div data-guard="admin">{children}</div> : <div data-guard="admin">guard:admin:blocked</div>,
}))

vi.mock('@/components/shared/partner-guard', () => ({
  PartnerGuard: ({ children }: { children?: ReactNode }) =>
    h.state.partnerAllowed ? (
      <div data-guard="partner">{children}</div>
    ) : (
      <div data-guard="partner">guard:partner:blocked</div>
    ),
}))

vi.mock('@/components/shared/client-only', () => ({
  ClientOnly: ({ children }: { children?: ReactNode }) => <div data-client-only>{children}</div>,
}))

vi.mock('@/components/shared/cookie-consent', () => ({
  CookieConsent: () => <div data-cookie-consent />,
}))

vi.mock('@/components/shared/geolocation-init', () => ({
  GeolocationInit: () => <div data-geolocation />,
}))

vi.mock('@/components/shared/pwa-install-banner', () => ({
  PwaInstallBanner: () => <div data-pwa-banner />,
}))

vi.mock('@/components/impersonation-banner', () => ({
  ImpersonationBanner: () => <div data-impersonation />,
}))

vi.mock('@/hooks/use-fcm-token', () => ({
  useFcmToken: h.useFcmToken,
}))

vi.mock('@/components/ui/toaster', () => ({ Toaster: () => <div data-toaster /> }))
vi.mock('@/components/ui/sonner', () => ({ Toaster: () => <div data-sonner /> }))
vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
}))

vi.mock('@/pages/Home', () => h.page('Home'))
vi.mock('@/pages/NotFound', () => h.page('NotFound'))
vi.mock('@/pages/about', () => h.page('About'))
vi.mock('@/pages/activity', () => h.page('Activity'))
vi.mock('@/pages/admin', () => h.page('Admin'))
vi.mock('@/pages/admin-analytics', () => h.page('AdminAnalytics'))
vi.mock('@/pages/admin-content', () => h.page('AdminContent'))
vi.mock('@/pages/admin-features', () => h.page('AdminFeatures'))
vi.mock('@/pages/admin-messaging', () => h.page('AdminMessaging'))
vi.mock('@/pages/admin-monetization', () => h.page('AdminMonetization'))
vi.mock('@/pages/admin-reports', () => h.page('AdminReports'))
vi.mock('@/pages/admin-teams', () => h.page('AdminTeams'))
vi.mock('@/pages/admin-photos', () => h.page('AdminPhotos'))
vi.mock('@/pages/admin-users', () => h.page('AdminUsers'))
vi.mock('@/pages/admin-experiments', () => h.page('AdminExperiments'))
vi.mock('@/pages/admin-backup', () => h.page('AdminBackup'))
vi.mock('@/pages/admin-webhooks', () => h.page('AdminWebhooks'))
vi.mock('@/pages/admin-health', () => h.page('AdminHealth'))
vi.mock('@/pages/admin-queues', () => h.page('AdminQueues'))
vi.mock('@/pages/chats', () => h.page('Chats'))
vi.mock('@/pages/_chats-chatId-adapter', () => h.page('ChatId'))
vi.mock('@/pages/contest', () => h.page('Contest'))
vi.mock('@/pages/faq', () => h.page('Faq'))
vi.mock('@/pages/groups', () => h.page('Groups'))
vi.mock('@/pages/hangouts', () => h.page('Hangouts'))
vi.mock('@/pages/hangout-detail', () => h.page('HangoutDetail'))
vi.mock('@/pages/hangout-create', () => h.page('HangoutCreate'))
vi.mock('@/pages/hangout-edit', () => h.page('HangoutEdit'))
vi.mock('@/pages/hangouts-my', () => h.page('HangoutsMy'))
vi.mock('@/pages/admin-hangouts', () => h.page('AdminHangouts'))
vi.mock('@/pages/events', () => h.page('Events'))
vi.mock('@/pages/admin-partners', () => h.page('AdminPartners'))
vi.mock('@/pages/matches', () => h.page('Matches'))
vi.mock('@/pages/premium', () => h.page('Premium'))
vi.mock('@/pages/settings-privacy', () => h.page('SettingsPrivacy'))
vi.mock('@/pages/profile-[id]', () => h.page('ProfileById'))
vi.mock('@/pages/profile-watching', () => h.page('ProfileWatching'))
vi.mock('@/pages/groups-category', () => h.page('GroupCategory'))
vi.mock('@/pages/legal-data-processing', () => h.page('LegalDataProcessing'))
vi.mock('@/pages/legal-privacy', () => h.page('LegalPrivacy'))
vi.mock('@/pages/legal-terms', () => h.page('LegalTerms'))
vi.mock('@/pages/login', () => h.page('Login'))
vi.mock('@/pages/forgot-password', () => h.page('ForgotPassword'))
vi.mock('@/pages/reset-password', () => h.page('ResetPassword'))
vi.mock('@/pages/verify-email', () => h.page('VerifyEmail'))
vi.mock('@/pages/unsubscribe', () => h.page('Unsubscribe'))
vi.mock('@/pages/onboarding', () => h.page('Onboarding'))
vi.mock('@/pages/profile', () => h.page('Profile'))
vi.mock('@/pages/profile-edit', () => h.page('ProfileEdit'))
vi.mock('@/pages/profile-attachment-test', () => h.page('ProfileAttachmentTest'))
vi.mock('@/pages/register', () => h.page('Register'))
vi.mock('@/pages/search', () => h.page('Search'))
vi.mock('@/pages/search-filters', () => h.page('SearchFilters'))
vi.mock('@/pages/settings', () => h.page('Settings'))
vi.mock('@/pages/support-chat', () => h.page('SupportChat'))
vi.mock('@/pages/user', () => h.page('User'))
vi.mock('@/pages/premium-success', () => h.page('PremiumSuccess'))
vi.mock('@/pages/premium-cancel', () => h.page('PremiumCancel'))
vi.mock('@/pages/partner-order-success', () => h.page('PartnerOrderSuccess'))
vi.mock('@/pages/partner-order-cancel', () => h.page('PartnerOrderCancel'))
vi.mock('@/pages/partner-register', () => h.page('PartnerRegister'))
vi.mock('@/pages/partner-dashboard', () => h.page('PartnerDashboard'))
vi.mock('@/pages/schedule', () => h.page('Schedule'))
vi.mock('@/pages/safety', () => h.page('Safety'))

import App from '@/App'

async function renderAt(path: string) {
  window.history.pushState({}, '', path)
  const view = render(<App />)
  await screen.findByText(/^page:|^guard:/)
  return view
}

beforeEach(() => {
  h.state.adminAllowed = true
  h.state.partnerAllowed = true
  h.useFcmToken.mockClear()
  document.title = ''
})

afterEach(() => {
  cleanup()
  window.history.pushState({}, '', '/')
})

describe('маршруты приложения', () => {
  const ROUTES: Array<[string, string]> = [
    ['/', 'Home'],
    ['/about', 'About'],
    ['/activity', 'Activity'],
    ['/chats', 'Chats'],
    ['/chats/room-1', 'ChatId'],
    ['/contest', 'Contest'],
    ['/faq', 'Faq'],
    ['/groups', 'Groups'],
    ['/groups/sport', 'GroupCategory'],
    ['/hangouts', 'Hangouts'],
    ['/hangouts/create', 'HangoutCreate'],
    ['/events', 'Events'],
    ['/hangouts/my', 'HangoutsMy'],
    ['/hangouts/42/edit', 'HangoutEdit'],
    ['/hangouts/42', 'HangoutDetail'],
    ['/legal/data-processing', 'LegalDataProcessing'],
    ['/legal/privacy', 'LegalPrivacy'],
    ['/legal/terms', 'LegalTerms'],
    ['/login', 'Login'],
    ['/forgot-password', 'ForgotPassword'],
    ['/reset-password', 'ResetPassword'],
    ['/verify-email', 'VerifyEmail'],
    ['/unsubscribe', 'Unsubscribe'],
    ['/onboarding', 'Onboarding'],
    ['/profile', 'Profile'],
    ['/matches', 'Matches'],
    ['/profile/edit', 'ProfileEdit'],
    ['/profile/watching', 'ProfileWatching'],
    ['/profile/42', 'ProfileById'],
    ['/profile/attachment-test', 'ProfileAttachmentTest'],
    ['/register', 'Register'],
    ['/search', 'Search'],
    ['/search/filters', 'SearchFilters'],
    ['/settings', 'Settings'],
    ['/settings/privacy', 'SettingsPrivacy'],
    ['/schedule', 'Schedule'],
    ['/safety', 'Safety'],
    ['/support-chat', 'SupportChat'],
    ['/user', 'User'],
    ['/premium', 'Premium'],
    ['/partner/register', 'PartnerRegister'],
    ['/partner/dashboard', 'PartnerDashboard'],
  ]

  for (const [path, page] of ROUTES) {
    it(`отдаёт страницу ${page} по адресу ${path}`, async () => {
      await renderAt(path)
      expect(screen.getByText(`page:${page}`)).toBeInTheDocument()
    })
  }

  const ADMIN_ROUTES: Array<[string, string]> = [
    ['/admin', 'Admin'],
    ['/admin/analytics', 'AdminAnalytics'],
    ['/admin/experiments', 'AdminExperiments'],
    ['/admin/content', 'AdminContent'],
    ['/admin/features', 'AdminFeatures'],
    ['/admin/messaging', 'AdminMessaging'],
    ['/admin/monetization', 'AdminMonetization'],
    ['/admin/reports', 'AdminReports'],
    ['/admin/teams', 'AdminTeams'],
    ['/admin/photos', 'AdminPhotos'],
    ['/admin/hangouts', 'AdminHangouts'],
    ['/admin/partners', 'AdminPartners'],
    ['/admin/users', 'AdminUsers'],
    ['/admin/backup', 'AdminBackup'],
    ['/admin/webhooks', 'AdminWebhooks'],
    ['/admin/health', 'AdminHealth'],
    ['/admin/queues', 'AdminQueues'],
  ]

  for (const [path, page] of ADMIN_ROUTES) {
    it(`отдаёт страницу админки ${page} по адресу ${path} под охраной и в макете`, async () => {
      await renderAt(path)
      expect(screen.getByText(`page:${page}`)).toBeInTheDocument()
      expect(screen.getByText(`page:${page}`).closest('[data-guard="admin"]')).not.toBeNull()
      expect(screen.getByText(`page:${page}`).closest('[data-admin-layout]')).not.toBeNull()
    })
  }

  const PAGES_OUTSIDE_CONTAINER: Array<[string, string]> = [
    ['/premium/success', 'PremiumSuccess'],
    ['/premium/cancel', 'PremiumCancel'],
    ['/partner-order/success', 'PartnerOrderSuccess'],
    ['/partner-order/cancel', 'PartnerOrderCancel'],
  ]

  for (const [path, page] of PAGES_OUTSIDE_CONTAINER) {
    it(`рисует ${page} вне общей оболочки`, async () => {
      const { container } = await renderAt(path)
      expect(screen.getByText(`page:${page}`)).toBeInTheDocument()
      expect(container.querySelector('[data-container]')).toBeNull()
      expect(container.querySelector('[data-cookie-consent]')).toBeNull()
    })
  }

  it('неизвестный адрес отдаёт страницу 404 внутри оболочки', async () => {
    const { container } = await renderAt('/no-such-page')
    expect(screen.getByText('page:NotFound')).toBeInTheDocument()
    expect(container.querySelector('[data-container]')).not.toBeNull()
  })

  it('держит общую оболочку и баннеры согласия на обычных страницах', async () => {
    const { container } = await renderAt('/faq')
    expect(container.querySelector('[data-container]')).not.toBeNull()
    expect(container.querySelector('[data-cookie-consent]')).not.toBeNull()
    expect(container.querySelector('[data-pwa-banner]')).not.toBeNull()
    expect(container.querySelector('[data-client-only]')).not.toBeNull()
  })

  it('прогоняет служебные компоненты при каждом монтировании', async () => {
    const { container } = await renderAt('/login')
    expect(h.useFcmToken).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[data-impersonation]')).not.toBeNull()
    expect(container.querySelector('[data-geolocation]')).not.toBeNull()
    expect(container.querySelector('[data-toaster]')).not.toBeNull()
    expect(container.querySelector('[data-sonner]')).not.toBeNull()
  })

  it('закрывает админку без прав и не рисует страницу', async () => {
    h.state.adminAllowed = false
    await renderAt('/admin/users')
    expect(screen.getByText('guard:admin:blocked')).toBeInTheDocument()
    expect(screen.queryByText('page:AdminUsers')).toBeNull()
  })

  it('закрывает кабинет партнёра без прав, но пускает на регистрацию партнёра', async () => {
    h.state.partnerAllowed = false
    await renderAt('/partner/dashboard')
    expect(screen.getByText('guard:partner:blocked')).toBeInTheDocument()
    cleanup()

    await renderAt('/partner/register')
    expect(screen.getByText('page:PartnerRegister')).toBeInTheDocument()
  })
})

describe('заголовок вкладки', () => {
  const TITLES: Array<[string, string]> = [
    ['/', 'SwiftMatch'],
    ['/login', 'Вход — SwiftMatch'],
    ['/admin/users', 'Пользователи — SwiftMatch'],
    ['/admin/queues', 'Очереди заданий — SwiftMatch'],
    ['/admin/photos', 'Фотомодерация — SwiftMatch'],
    ['/admin/experiments', 'Эксперименты — SwiftMatch'],
    ['/safety', 'Безопасность — SwiftMatch'],
    ['/verify-email', 'Подтверждение почты — SwiftMatch'],
    ['/forgot-password', 'Восстановление пароля — SwiftMatch'],
    ['/reset-password', 'Новый пароль — SwiftMatch'],
    ['/unsubscribe', 'Отписка — SwiftMatch'],
    ['/user', 'Профиль — SwiftMatch'],
    ['/chats/room-1', 'Чат — SwiftMatch'],
    ['/groups/sport', 'Группа — SwiftMatch'],
    ['/hangouts/42', 'Встреча — SwiftMatch'],
    ['/hangouts/42/edit', 'Редактировать встречу — SwiftMatch'],
    ['/profile/42', 'Профиль — SwiftMatch'],
    ['/profile/edit', 'Редактировать — SwiftMatch'],
    ['/profile/attachment-test', 'Тест привязанности — SwiftMatch'],
    ['/hangouts/create', 'Создать встречу — SwiftMatch'],
    ['/nope/deeper', 'SwiftMatch'],
  ]

  for (const [path, title] of TITLES) {
    it(`для ${path} ставит «${title}»`, async () => {
      await renderAt(path)
      expect(document.title).toBe(title)
    })
  }

  it('обновляет заголовок при переходе внутри приложения', async () => {
    await renderAt('/')
    expect(document.title).toBe('SwiftMatch')
    act(() => {
      window.history.pushState({}, '', '/faq')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await screen.findByText('page:Faq')
    expect(document.title).toBe('Вопросы — SwiftMatch')
  })
})

describe('обёртки маршрутов', () => {
  it('передаёт в границу ошибок переведённые тексты', async () => {
    await renderAt('/faq')
    expect(document.querySelector('[data-error-boundary="root"]')).not.toBeNull()
    expect(document.querySelector('[data-error-boundary="t.common.error_boundary.title"]')).not.toBeNull()
    expect(screen.getByText('page:Faq').closest('[data-error-boundary="t.common.error_boundary.title"]')).not.toBeNull()
  })
})
