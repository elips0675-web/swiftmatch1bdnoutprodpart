import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Home from '@/pages/Home'
import { toast } from '@/hooks/use-toast'

const flags = vi.hoisted(() => ({ hangoutsEnabled: false }))
const langState = vi.hoisted(() => ({ language: 'RU' }))
const pushMock = vi.hoisted(() => vi.fn())

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({
    t: (key: string) => key,
    language: langState.language,
    setLanguage: () => {},
  }),
}))

vi.mock('@/context/feature-flags-context', () => ({
  useFeatureFlags: () => flags,
}))

vi.mock('@/shims/next-navigation', () => ({
  useRouter: () => ({ push: pushMock, back: vi.fn() }),
}))

vi.mock('@/components/layout/app-header', () => ({ AppHeader: () => null }))
vi.mock('@/components/navigation/bottom-nav', () => ({ BottomNav: () => null }))

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: () => (props: Record<string, unknown>) => {
      const { layoutId, ...rest } = props as { layoutId?: string }
      return <div {...(rest as object)} />
    },
  }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }))

vi.mock('@/lib/demo-data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/demo-data')>()
  return {
    ...actual,
    GROUP_CATEGORIES: [
      actual.GROUP_CATEGORIES[0],
      actual.GROUP_CATEGORIES[1],
      actual.GROUP_CATEGORIES[2],
      { ...actual.GROUP_CATEGORIES[3], icon: 'MysteryIcon' },
    ],
  }
})

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

describe('Home page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    fetchMock.mockReset()
    langState.language = 'RU'
    flags.hangoutsEnabled = false
  })

  const renderHome = () => render(
    <MemoryRouter>
      <Home />
    </MemoryRouter>
  )

  it('renders top-of-week after lazy load: like fires toast, no banner without flag', async () => {
    renderHome()
    expect(screen.getByText('home.headline')).toBeInTheDocument()
    expect(screen.queryByText('auth.resend_verification')).toBeNull()
    const cardUser = await screen.findByText('Матвей, 24')
    const card = cardUser.closest('div.bg-white') as HTMLElement
    const likeBtn = card.querySelector('button') as HTMLButtonElement
    fireEvent.click(likeBtn)
    expect(toast).toHaveBeenCalledWith({ title: 'toast.liked', description: 'toast.you_liked Матвей' })
    expect(screen.getByText('button.autosearch')).toBeInTheDocument()
  })

  it('broken userProfile JSON falls back to demo user', async () => {
    localStorage.setItem('userProfile', '{oops')
    renderHome()
    expect(await screen.findByText('Матвей, 24')).toBeInTheDocument()
  })

  it('autosearch with default profile: filters from Анна, push to search', async () => {
    renderHome()
    await screen.findByText('Матвей, 24')
    fireEvent.click(screen.getByText('button.autosearch'))
    fireEvent.click(await screen.findByText('autosearch.paid'))
    expect(pushMock).toHaveBeenCalledWith('/search?mode=autosearch')
    const filters = JSON.parse(sessionStorage.getItem('autosearchFilters') ?? '{}')
    expect(filters.selectedCity).toBe('Москва')
    expect(filters.genderPref).toBe('female')
    expect(filters.selectedDatingGoal).toBe('all')
    expect(filters.selectedInterests.length).toBeGreaterThan(0)
    await waitFor(() => expect(screen.queryByText('autosearch.title')).toBeNull())
  })

  it('autosearch with stored profile: defaults for missing city and interests', async () => {
    localStorage.setItem('userProfile', JSON.stringify({ id: 99, gender: 'female', datingGoal: 'goal.parties' }))
    renderHome()
    await screen.findByText('Матвей, 24')
    fireEvent.click(screen.getByText('button.autosearch'))
    fireEvent.click(await screen.findByText('autosearch.paid'))
    const filters = JSON.parse(sessionStorage.getItem('autosearchFilters') ?? '{}')
    expect(filters.selectedCity).toBe('all')
    expect(filters.genderPref).toBe('male')
    expect(filters.selectedDatingGoal).toBe('goal.parties')
    expect(filters.selectedInterests).toEqual([])
  })

  it('verify banner resend: success toast with email payload', async () => {
    localStorage.setItem('email_verified', '0')
    localStorage.setItem('email', 'anna@test.ru')
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ message: 'Письмо отправлено' }) })
    renderHome()
    await screen.findByText('Матвей, 24')
    fireEvent.click(await screen.findByText('auth.resend_verification'))
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: 'Письмо отправлено' }))
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ email: 'anna@test.ru' })
  })

  it('verify banner resend: network failure toast with empty email fallback', async () => {
    localStorage.setItem('email_verified', '0')
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    renderHome()
    await screen.findByText('Матвей, 24')
    fireEvent.click(await screen.findByText('auth.resend_verification'))
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ variant: 'destructive', title: 'common.error' }))
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({ email: '' })
  })

  it('popular groups tab: RU names, icon fallback, underline, back to top-users', async () => {
    renderHome()
    await screen.findByText('Матвей, 24')
    fireEvent.click(screen.getByText('home.popular_groups'))
    expect(await screen.findByText('Музыка')).toBeInTheDocument()
    expect(screen.getByText('Игры')).toBeInTheDocument()
    const gamingLink = screen.getByText('Игры').closest('a') as HTMLAnchorElement
    expect(gamingLink.querySelector('.lucide-users')).toBeTruthy()
    expect(gamingLink.textContent ?? '').toContain('chats.online')
    const groupsTab = screen.getByText('home.popular_groups').closest('button') as HTMLButtonElement
    expect(groupsTab.querySelector('.bg-primary')).toBeTruthy()
    const topTab = screen.getByText('home.top_week').closest('button') as HTMLButtonElement
    expect(topTab.querySelector('.bg-primary')).toBeNull()
    fireEvent.click(screen.getByText('home.top_week'))
    expect(screen.queryByText('Музыка')).toBeNull()
    expect(await screen.findByText('Матвей, 24')).toBeInTheDocument()
  })

  it('popular groups tab: EN names when language is not RU', async () => {
    langState.language = 'en'
    renderHome()
    await screen.findByText('Матвей, 24')
    fireEvent.click(screen.getByText('home.popular_groups'))
    expect(await screen.findByText('Music')).toBeInTheDocument()
    expect(screen.queryByText('Музыка')).toBeNull()
  })
})
