import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const h = vi.hoisted(() => {
  const t = (key: string, options?: Record<string, unknown>) => {
    let value = key
    if (options) {
      Object.entries(options).forEach(([k, v]) => { value = value.replace(`{${k}}`, String(v)) })
    }
    return value
  }
  return {
    t,
    state: {
      pathname: '/',
      token: 'header-token' as string | null,
      socket: null as { on: ReturnType<typeof vi.fn>; off: ReturnType<typeof vi.fn> } | null,
      language: 'RU',
    },
    push: vi.fn(),
    back: vi.fn(),
    setLanguage: vi.fn(),
    toast: vi.fn(),
    fetchMock: vi.fn(),
  }
})

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t: h.t, language: h.state.language, setLanguage: h.setLanguage }),
}))

vi.mock('@/shims/next-navigation', () => ({
  useRouter: () => ({ push: h.push, back: h.back }),
  usePathname: () => h.state.pathname,
}))

vi.mock('@/hooks/use-websocket', () => ({
  useWebSocket: () => ({ socket: h.state.socket, connected: false }),
}))

vi.mock('@/lib/token', () => ({
  getToken: () => h.state.token,
}))

vi.mock('@/hooks/use-toast', () => ({ toast: h.toast }))

import { AppHeader } from '@/components/layout/app-header'

interface NotificationItem {
  id: number
  type: string
  payload: Record<string, unknown> | null
  is_read: number | boolean
  created_at: string
  actor_name?: string | null
  hangout_title?: string | null
}

const now = Date.now()

function makeItem(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: 1,
    type: 'like',
    payload: {},
    is_read: 0,
    created_at: new Date(now).toISOString(),
    actor_name: 'Анна',
    hangout_title: 'Кино',
    ...overrides,
  }
}

function renderHeader(pathname = '/profile') {
  h.state.pathname = pathname
  return render(
    <MemoryRouter>
      <AppHeader />
    </MemoryRouter>,
  )
}

function respond(items: unknown, unread: unknown = 0) {
  h.fetchMock.mockImplementation((url: string) => {
    if (url === '/api/notifications') {
      return Promise.resolve({ ok: true, json: async () => ({ items, unread }) })
    }
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

async function openNotifications() {
  const bell = await waitFor(() => {
    const icon = document.querySelector('.lucide-zap')
    if (!icon) throw new Error('bell icon is not rendered yet')
    return icon.closest('button') as HTMLElement
  })
  await userEvent.click(bell)
  await screen.findByTestId('notifications-read-all')
}

describe('AppHeader', () => {
  beforeEach(() => {
    h.state.pathname = '/'
    h.state.token = 'header-token'
    h.state.socket = null
    h.state.language = 'RU'
    h.push.mockReset()
    h.back.mockReset()
    h.setLanguage.mockReset()
    h.toast.mockReset()
    h.fetchMock.mockReset()
    respond([], 0)
    vi.stubGlobal('fetch', h.fetchMock)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renders nothing on the login page', () => {
    const { container } = renderHeader('/login')
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the brand link on the home page and no back button', async () => {
    renderHeader('/')
    expect(await screen.findByText('SwiftMatch')).toBeInTheDocument()
    expect(document.querySelector('.lucide-chevron-left')).toBeNull()
  })

  it('shows the page title and navigates back on non-home pages', async () => {
    renderHeader('/profile')
    expect(await screen.findByText('nav.profile')).toBeInTheDocument()
    const backIcon = document.querySelector('.lucide-chevron-left')
    expect(backIcon).not.toBeNull()
    await userEvent.click(backIcon!.closest('button') as HTMLElement)
    expect(h.back).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['/chats/42', 'nav.chat'],
    ['/groups/7', 'nav.group_single'],
    ['/admin/unknown-page', 'nav.admin'],
    ['/search/filters', 'nav.filters'],
  ])('resolves the title for %s', async (pathname, expected) => {
    renderHeader(pathname)
    expect(await screen.findByText(expected)).toBeInTheDocument()
  })

  it('falls back to the brand title for an unknown path without title', async () => {
    renderHeader('/mystery-page')
    expect(await screen.findByText('SwiftMatch')).toBeInTheDocument()
    expect(document.querySelector('.lucide-chevron-left')).not.toBeNull()
  })

  it('does not request notifications without a token and shows the demo badge', async () => {
    h.state.token = null
    renderHeader('/profile')
    expect(await screen.findByText('4')).toBeInTheDocument()
    expect(h.fetchMock).not.toHaveBeenCalled()
  })

  it('marks demo notifications read on open without a token', async () => {
    h.state.token = null
    renderHeader('/profile')
    await openNotifications()
    expect(await screen.findByText('notifications.liked_you')).toBeInTheDocument()
    expect(screen.getAllByTestId(/^notification-demo-/)).toHaveLength(4)
    await userEvent.click(screen.getByTestId('notifications-read-all'))
    await waitFor(() => expect(screen.queryByText('4')).toBeNull())
    expect(h.fetchMock).not.toHaveBeenCalled()
  })

  it('loads real notifications with the auth header', async () => {
    respond([
      makeItem({ id: 10, type: 'like', is_read: 0 }),
      makeItem({ id: 11, type: 'match', is_read: 1 }),
    ], 2)
    renderHeader('/profile')
    await waitFor(() => expect(h.fetchMock).toHaveBeenCalledWith('/api/notifications', {
      headers: { Authorization: 'Bearer header-token' },
    }))
    expect(await screen.findByText('2')).toBeInTheDocument()
    await openNotifications()
    expect(await screen.findByText('notifications.liked_you')).toBeInTheDocument()
    expect(screen.getByText('notifications.new_match')).toBeInTheDocument()
    expect(screen.getAllByText('New')).toHaveLength(1)
    expect(screen.getByTestId('notification-n-10')).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(h.fetchMock).toHaveBeenCalledWith('/api/notifications/read-all', {
      method: 'PUT',
      headers: { Authorization: 'Bearer header-token' },
    }))
    await waitFor(() => expect(screen.queryByText('2')).toBeNull())
  })

  it('shows the empty state when the request fails', async () => {
    h.fetchMock.mockRejectedValue(new Error('network'))
    renderHeader('/profile')
    await openNotifications()
    expect(await screen.findByText('notifications.empty')).toBeInTheDocument()
  })

  it('shows the empty state when the payload misses the items array', async () => {
    h.fetchMock.mockImplementation((url: string) => {
      if (url === '/api/notifications') {
        return Promise.resolve({ ok: true, json: async () => ({ unread: 'abc' }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    renderHeader('/profile')
    await waitFor(() => expect(h.fetchMock).toHaveBeenCalled())
    await openNotifications()
    expect(await screen.findByText('notifications.empty')).toBeInTheDocument()
    expect(screen.queryByText('4')).toBeNull()
  })

  it('shows the empty state when the response is not ok', async () => {
    h.fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) })
    renderHeader('/profile')
    await waitFor(() => expect(h.fetchMock).toHaveBeenCalled())
    await openNotifications()
    expect(await screen.findByText('notifications.empty')).toBeInTheDocument()
  })

  it('marks all notifications read and ignores a failed request', async () => {
    h.fetchMock.mockImplementation((url: string) => {
      if (url === '/api/notifications') {
        return Promise.resolve({ ok: true, json: async () => ({ items: [makeItem({ id: 20 })], unread: 1 }) })
      }
      return Promise.reject(new Error('offline'))
    })
    renderHeader('/profile')
    await openNotifications()
    expect(await screen.findByText('New')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('notifications-read-all'))
    await waitFor(() => expect(screen.queryAllByText('New')).toHaveLength(0))
    expect(h.fetchMock).toHaveBeenCalledWith('/api/notifications/read-all', {
      method: 'PUT',
      headers: { Authorization: 'Bearer header-token' },
    })
  })

  it.each([
    [{ type: 'hangout_response', payload: { hangout_id: 31 } }, '/hangouts/31'],
    [{ type: 'hangout_accepted', payload: {} }, '/hangouts/my'],
    [{ type: 'hangout_declined', payload: null }, '/hangouts/my'],
    [{ type: 'match', payload: null }, '/chats'],
    [{ type: 'like', payload: null }, '/activity'],
    [{ type: 'mystery', payload: null }, '/activity'],
  ])('navigates to the notification target for %o', async (overrides, link) => {
    respond([makeItem({ id: 30, ...overrides })], 1)
    renderHeader('/profile')
    await openNotifications()
    await userEvent.click(await screen.findByTestId('notification-n-30'))
    expect(h.push).toHaveBeenCalledWith(link)
    await waitFor(() => expect(screen.queryByTestId('notification-n-30')).toBeNull())
  })

  it.each([
    [0, 'time.just_now'],
    [5, 'time.min_ago_n'],
    [120, 'time.hour_ago_n'],
    [2880, 'time.day_ago_n'],
  ])('formats relative time for %i minutes ago', async (minutes, expected) => {
    respond([makeItem({ id: 40, created_at: new Date(Date.now() - minutes * 60_000).toISOString() })], 1)
    renderHeader('/profile')
    await openNotifications()
    expect(await screen.findByText(expected)).toBeInTheDocument()
  })

  it('renders every notification text variant', async () => {
    respond([
      makeItem({ id: 50, type: 'invite' }),
      makeItem({ id: 51, type: 'message' }),
      makeItem({ id: 52, type: 'hangout_response' }),
      makeItem({ id: 53, type: 'hangout_accepted' }),
      makeItem({ id: 54, type: 'hangout_declined' }),
      makeItem({ id: 55, type: 'hangout_cancelled', actor_name: null, hangout_title: null }),
      makeItem({ id: 56, type: 'system', actor_name: null }),
    ], 7)
    renderHeader('/profile')
    await openNotifications()
    expect(await screen.findByText('notifications.new_invite')).toBeInTheDocument()
    expect(screen.getByText('notifications.sent_message')).toBeInTheDocument()
    expect(screen.getByText('notifications.hangout_response')).toBeInTheDocument()
    expect(screen.getByText('notifications.hangout_accepted')).toBeInTheDocument()
    expect(screen.getByText('notifications.hangout_declined')).toBeInTheDocument()
    expect(screen.getByText('notifications.hangout_cancelled')).toBeInTheDocument()
    expect(screen.getByText('notifications.profile_popular')).toBeInTheDocument()
  })

  it('subscribes to the websocket and prepends new notifications', async () => {
    const on = vi.fn()
    const off = vi.fn()
    h.state.socket = { on, off }
    respond([makeItem({ id: 60, is_read: 1 })], 1)
    renderHeader('/profile')
    await waitFor(() => expect(on).toHaveBeenCalledWith('notification:new', expect.any(Function)))

    act(() => {
      on.mock.calls[0][1](makeItem({ id: 61, type: 'match', payload: null, actor_name: 'Игорь' }))
    })

    expect(h.toast).toHaveBeenCalledWith({
      title: 'settings.notifications',
      description: 'notifications.new_match',
    })
    expect(await screen.findByText('2')).toBeInTheDocument()

    await openNotifications()
    expect(await screen.findByTestId('notification-n-61')).toBeInTheDocument()
  })

  it('keeps the demo list untouched when a socket event arrives before loading', async () => {
    const on = vi.fn()
    h.state.socket = { on, off: vi.fn() }
    h.fetchMock.mockReturnValue(new Promise(() => {}))
    renderHeader('/profile')
    await waitFor(() => expect(on).toHaveBeenCalled())
    act(() => {
      on.mock.calls[0][1](makeItem({ id: 62, type: 'like' }))
    })
    await openNotifications()
    expect(await screen.findByText('notifications.liked_you')).toBeInTheDocument()
    expect(screen.queryByTestId('notification-n-62')).toBeNull()
  })

  it('unsubscribes from the socket on unmount', async () => {
    const off = vi.fn()
    h.state.socket = { on: vi.fn(), off }
    const { unmount } = renderHeader('/profile')
    await waitFor(() => expect(h.state.socket?.on).toHaveBeenCalled())
    unmount()
    expect(off).toHaveBeenCalledWith('notification:new', expect.any(Function))
  })

  it('does not subscribe without a token', async () => {
    const on = vi.fn()
    h.state.socket = { on, off: vi.fn() }
    h.state.token = null
    renderHeader('/profile')
    await screen.findByText('4')
    expect(on).not.toHaveBeenCalled()
  })

  it('changes the language and confirms with a toast', async () => {
    renderHeader('/profile')
    const langButton = await screen.findByText('RU')
    await userEvent.click(langButton.closest('button') as HTMLElement)
    const en = await screen.findByRole('menuitem', { name: 'app.lang.en' })
    await userEvent.click(en)
    expect(h.setLanguage).toHaveBeenCalledWith('EN')
    expect(h.toast).toHaveBeenCalledWith({ title: 'toast.language_changed', description: 'toast.language_selected' })

    await userEvent.click(screen.getByText('RU').closest('button') as HTMLElement)
    await userEvent.click(await screen.findByRole('menuitem', { name: 'app.lang.ru' }))
    expect(h.setLanguage).toHaveBeenCalledWith('RU')
  })

  it('navigates to the activity page from the footer button', async () => {
    respond([makeItem({ id: 70 })], 1)
    renderHeader('/profile')
    await openNotifications()
    await userEvent.click(await screen.findByText('notifications.all_events'))
    expect(h.push).toHaveBeenCalledWith('/activity')
    await waitFor(() => expect(screen.queryByTestId('notification-n-70')).toBeNull())
  })
})
