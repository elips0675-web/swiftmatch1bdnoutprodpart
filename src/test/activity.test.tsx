import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

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
      token: 'activity-token' as string | null,
      showAdsEnabled: false,
      isPremium: false,
      activity: [] as unknown[],
      invites: [] as unknown[],
      activityResponse: null as null | (() => Promise<unknown>),
      invitesResponse: null as null | (() => Promise<unknown>),
    },
    push: vi.fn(),
    fetchMock: vi.fn(),
  }
})

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t: h.t, language: 'RU', setLanguage: vi.fn() }),
}))

vi.mock('@/context/feature-flags-context', () => ({
  useFeatureFlags: () => ({ showAdsEnabled: h.state.showAdsEnabled }),
}))

vi.mock('@/hooks/use-premium', () => ({
  usePremium: () => ({ isPremium: h.state.isPremium }),
}))

vi.mock('@/shims/next-navigation', () => ({
  useRouter: () => ({ push: h.push }),
}))

vi.mock('@/lib/token', () => ({ getToken: () => h.state.token }))

vi.mock('@/components/layout/app-header', () => ({ AppHeader: () => null }))
vi.mock('@/components/navigation/bottom-nav', () => ({ BottomNav: () => null }))

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: () => (props: Record<string, unknown>) => {
      const { layoutId, whileHover, whileTap, initial, animate, exit, layout, ...rest } = props as Record<string, unknown>
      void layoutId
      void whileHover
      void whileTap
      void initial
      void animate
      void exit
      void layout
      return <div {...(rest as object)} />
    },
  }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/components/dialogs/premium-dialog', () => ({
  PremiumDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="premium-dialog" /> : null),
}))

vi.mock('@/components/dialogs/ad-dialog', () => ({
  AdDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="ad-dialog" /> : null),
}))

import ActivityPage from '@/pages/activity'

function jsonResponse(data: unknown) {
  return Promise.resolve({ ok: true, json: async () => data })
}

function minutesAgo(minutes: number) {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

function activityRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    user_id: 7,
    user_name: 'Анна',
    user_avatar: '/img/anna.jpg',
    user_age: 28,
    action_type: 'like',
    created_at: minutesAgo(3),
    ...overrides,
  }
}

function inviteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    sender_id: 9,
    sender_name: 'Мария',
    sender_avatar: '/img/maria.jpg',
    sender_age: 31,
    type: 'coffee',
    status: 'pending',
    created_at: minutesAgo(10),
    ...overrides,
  }
}

function renderPage() {
  return render(<ActivityPage />)
}

function clickTab(name: string) {
  return userEvent.click(screen.getByRole('tab', { name: new RegExp(`^${name}`) }))
}

describe('ActivityPage', () => {
  beforeEach(() => {
    h.state.token = 'activity-token'
    h.state.showAdsEnabled = false
    h.state.isPremium = false
    h.state.activity = []
    h.state.invites = []
    h.state.activityResponse = null
    h.state.invitesResponse = null
    h.push.mockReset()
    h.fetchMock.mockReset()
    h.fetchMock.mockImplementation((url: string) => {
      if (url === '/api/activity') {
        return h.state.activityResponse ? h.state.activityResponse() : jsonResponse(h.state.activity)
      }
      if (url === '/api/invites') {
        return h.state.invitesResponse ? h.state.invitesResponse() : jsonResponse(h.state.invites)
      }
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', h.fetchMock)
    localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('shows the loader while the request is in flight', async () => {
    h.state.activityResponse = () => new Promise(() => {})
    h.state.invitesResponse = () => new Promise(() => {})
    const { container } = renderPage()
    expect(container.querySelector('.animate-spin')).not.toBeNull()
    expect(h.fetchMock).toHaveBeenCalledWith('/api/activity', {
      headers: { Authorization: 'Bearer activity-token' },
    })
    expect(h.fetchMock).toHaveBeenCalledWith('/api/invites', {
      headers: { Authorization: 'Bearer activity-token' },
    })
  })

  it('does not request anything without a token and shows the empty state', async () => {
    h.state.token = null
    renderPage()
    expect(await screen.findByText('activity.empty')).toBeInTheDocument()
    expect(h.fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByText(/activity\.new/)).toBeNull()
  })

  it('loads activity and invites with the bearer token', async () => {
    h.state.activity = [activityRow()]
    h.state.invites = [inviteRow()]
    renderPage()
    expect(await screen.findByText('Анна, 28')).toBeInTheDocument()
    expect(screen.getByText('activity.msg_like')).toBeInTheDocument()
    expect(screen.getByText(/^2 activity\.new$/)).toBeInTheDocument()
    expect(h.fetchMock).toHaveBeenCalledWith('/api/activity', {
      headers: { Authorization: 'Bearer activity-token' },
    })
    expect(h.fetchMock).toHaveBeenCalledWith('/api/invites', {
      headers: { Authorization: 'Bearer activity-token' },
    })
  })

  it('renders the name without a dangling comma when age is missing', async () => {
    const activityWithoutAge = activityRow()
    delete (activityWithoutAge as Record<string, unknown>).user_age
    const inviteWithoutAge = inviteRow({ status: 'accepted' })
    delete (inviteWithoutAge as Record<string, unknown>).sender_age
    h.state.activity = [activityWithoutAge]
    h.state.invites = [inviteWithoutAge]
    renderPage()
    expect(await screen.findByText('Анна')).toBeInTheDocument()
    expect(screen.queryByText(/undefined/)).toBeNull()
    await clickTab('activity.invites')
    expect(await screen.findByText('Мария')).toBeInTheDocument()
    expect(screen.queryByText(/undefined/)).toBeNull()
  })

  it('falls back to an empty avatar when the API omits it', async () => {
    const activityWithoutAvatar = activityRow()
    delete (activityWithoutAvatar as Record<string, unknown>).user_avatar
    const inviteWithoutAvatar = inviteRow({ status: 'pending' })
    delete (inviteWithoutAvatar as Record<string, unknown>).sender_avatar
    h.state.activity = [activityWithoutAvatar]
    h.state.invites = [inviteWithoutAvatar]
    renderPage()
    expect(await screen.findByText('Анна, 28')).toBeInTheDocument()
    await clickTab('activity.invites')
    expect(await screen.findByText('Мария, 31')).toBeInTheDocument()
  })

  it('renders every activity type with its message', async () => {
    h.state.activity = [
      activityRow({ id: 1, user_name: 'Лайк', action_type: 'like' }),
      activityRow({ id: 2, user_name: 'Матч', action_type: 'match' }),
      activityRow({ id: 3, user_name: 'Гость', action_type: 'profile_view' }),
      activityRow({ id: 4, user_name: 'Прочее', action_type: 'message' }),
    ]
    renderPage()
    expect(await screen.findByText('activity.msg_like')).toBeInTheDocument()
    expect(screen.getByText('activity.msg_match')).toBeInTheDocument()
    const visits = screen.getAllByText('activity.msg_visit')
    expect(visits.length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Прочее, 28')).toBeInTheDocument()
  })

  it('filters activity by the likes and visits tabs', async () => {
    h.state.activity = [
      activityRow({ id: 1, user_name: 'Лайк', action_type: 'like' }),
      activityRow({ id: 2, user_name: 'Матч', action_type: 'match', created_at: minutesAgo(30) }),
      activityRow({ id: 3, user_name: 'Гость', action_type: 'profile_view' }),
    ]
    renderPage()
    expect(await screen.findByText('Лайк, 28')).toBeInTheDocument()
    expect(screen.getByText('profile.someone')).toBeInTheDocument()

    await clickTab('activity.likes')
    await waitFor(() => expect(screen.queryByText('profile.someone')).toBeNull())
    expect(screen.getByText('Лайк, 28')).toBeInTheDocument()
    expect(screen.getByText('Матч, 28')).toBeInTheDocument()

    await clickTab('activity.visits')
    await waitFor(() => expect(screen.getByText('profile.someone')).toBeInTheDocument())
    expect(screen.queryByText('Лайк, 28')).toBeNull()
    expect(screen.getByRole('heading', { level: 2, name: 'activity.visits' })).toBeInTheDocument()
  })

  it('shows invites with the unread counter and marks answered ones as seen', async () => {
    h.state.invites = [
      inviteRow({ id: 1, status: 'pending' }),
      inviteRow({ id: 2, status: 'accepted', sender_name: 'Ольга' }),
    ]
    renderPage()
    await screen.findByText('activity.empty')
    await clickTab('activity.invites')
    expect(await screen.findByText('Мария, 31')).toBeInTheDocument()
    expect(screen.getByText('Ольга, 31')).toBeInTheDocument()
    expect(screen.getAllByText('invite.msg_coffee')).toHaveLength(2)
    const tab = screen.getByRole('tab', { name: /activity\.invites/ })
    expect(tab.textContent).toContain('1')
  })

  it('shows the invites empty state', async () => {
    renderPage()
    await screen.findByText('activity.empty')
    await clickTab('activity.invites')
    expect(await screen.findByText('activity.empty_invites')).toBeInTheDocument()
  })

  it('renders every invite type icon branch', async () => {
    h.state.invites = ['coffee', 'cinema', 'walk', 'dinner', 'picnic', 'exhibition', 'museum', 'other'].map((type, index) =>
      inviteRow({ id: index + 1, type, sender_name: `Гость${index}` }),
    )
    renderPage()
    expect(await screen.findByText('activity.empty')).toBeInTheDocument()
    await clickTab('activity.invites')
    expect(await screen.findByText('Гость0, 31')).toBeInTheDocument()
    expect(screen.getByText('invite.msg_coffee')).toBeInTheDocument()
    expect(screen.getByText('invite.msg_cinema')).toBeInTheDocument()
    expect(screen.getByText('invite.msg_walk')).toBeInTheDocument()
    expect(screen.getByText('invite.msg_dinner')).toBeInTheDocument()
    expect(screen.getByText('invite.msg_picnic')).toBeInTheDocument()
    expect(screen.getByText('invite.msg_exhibition')).toBeInTheDocument()
    expect(screen.getByText('invite.msg_museum')).toBeInTheDocument()
    expect(screen.getByText('invite.msg_other')).toBeInTheDocument()
  })

  it('shows the incognito banner only on the visits tab', async () => {
    localStorage.setItem('incognito-mode', 'true')
    h.state.activity = [activityRow({ action_type: 'profile_view' })]
    renderPage()
    await screen.findByText('profile.someone')
    expect(screen.queryByText('incognito.banner.title')).toBeNull()
    await clickTab('activity.visits')
    expect(await screen.findByText('incognito.banner.title')).toBeInTheDocument()
    expect(screen.getByText('incognito.banner.description')).toBeInTheDocument()
  })

  it('hides the incognito banner when the stored flag is false', async () => {
    localStorage.setItem('incognito-mode', 'false')
    h.state.activity = [activityRow({ action_type: 'profile_view' })]
    renderPage()
    await screen.findByText('profile.someone')
    await clickTab('activity.visits')
    expect(screen.queryByText('incognito.banner.title')).toBeNull()
  })

  it('opens the premium dialog when a blurred visit is clicked without premium', async () => {
    h.state.activity = [activityRow({ action_type: 'profile_view' })]
    renderPage()
    await userEvent.click(await screen.findByText('profile.someone'))
    expect(await screen.findByTestId('premium-dialog')).toBeInTheDocument()
    expect(h.push).not.toHaveBeenCalled()
  })

  it('navigates to the profile for a blurred visit when premium is active', async () => {
    h.state.isPremium = true
    h.state.activity = [activityRow({ action_type: 'profile_view', user_id: 42 })]
    renderPage()
    await userEvent.click(await screen.findByText('profile.someone'))
    expect(h.push).toHaveBeenCalledWith('/user?id=42')
  })

  it('unlocks a blurred visit by opening premium or an ad depending on premium', async () => {
    h.state.activity = [activityRow({ action_type: 'profile_view' })]
    const first = renderPage()
    await userEvent.click(await screen.findByTestId('reveal-profile'))
    expect(await screen.findByTestId('premium-dialog')).toBeInTheDocument()
    expect(h.push).not.toHaveBeenCalled()
    first.unmount()

    h.state.isPremium = true
    renderPage()
    await userEvent.click(await screen.findByTestId('reveal-profile'))
    expect(await screen.findByTestId('ad-dialog')).toBeInTheDocument()
  })

  it('opens the ad dialog from the unlock button when ads are enabled', async () => {
    h.state.showAdsEnabled = true
    h.state.activity = [activityRow({ user_name: 'Лайк', action_type: 'like' })]
    renderPage()
    await screen.findByText('Лайк, 28')
    await userEvent.click(screen.getByText('button.unlock'))
    expect(await screen.findByTestId('ad-dialog')).toBeInTheDocument()
  })

  it('hides the unlock button when ads are disabled', async () => {
    h.state.activity = [activityRow({ user_name: 'Лайк', action_type: 'like' })]
    renderPage()
    await screen.findByText('Лайк, 28')
    expect(screen.queryByText('button.unlock')).toBeNull()
  })

  it('opens the premium dialog from the promo banner and hides it for premium users', async () => {
    h.state.activity = [activityRow({ user_name: 'Лайк', action_type: 'like' })]
    const first = renderPage()
    await screen.findByText('Лайк, 28')
    await userEvent.click(screen.getByText('activity.premium_title'))
    expect(await screen.findByTestId('premium-dialog')).toBeInTheDocument()
    expect(screen.getByText('activity.premium_desc')).toBeInTheDocument()
    first.unmount()

    h.state.isPremium = true
    renderPage()
    await screen.findByText('Лайк, 28')
    expect(screen.queryByText('activity.premium_title')).toBeNull()
  })

  it('navigates to the profile from an activity card', async () => {
    h.state.activity = [activityRow({ action_type: 'like', user_id: 77 })]
    renderPage()
    await userEvent.click(await screen.findByText('Анна, 28'))
    expect(h.push).toHaveBeenCalledWith('/user?id=77')
  })

  it('navigates to the profile from an invite card', async () => {
    h.state.invites = [inviteRow({ sender_id: 88 })]
    renderPage()
    await screen.findByText('activity.empty')
    await clickTab('activity.invites')
    await userEvent.click(await screen.findByText('Мария, 31'))
    expect(h.push).toHaveBeenCalledWith('/user?id=88')
  })

  it('formats relative time for every bucket', async () => {
    h.state.activity = [
      activityRow({ id: 1, user_name: 'Сейчас', created_at: minutesAgo(0) }),
      activityRow({ id: 2, user_name: 'Минуты', created_at: minutesAgo(5) }),
      activityRow({ id: 3, user_name: 'Часы', created_at: minutesAgo(120) }),
      activityRow({ id: 4, user_name: 'Дни', created_at: minutesAgo(2880) }),
    ]
    renderPage()
    expect(await screen.findByText('time.just_now')).toBeInTheDocument()
    expect(screen.getByText('5time.min_ago')).toBeInTheDocument()
    expect(screen.getByText('2time.hour_ago')).toBeInTheDocument()
    expect(screen.getByText('2time.day_ago')).toBeInTheDocument()
  })

  it('stops the loader and shows the empty state when the request fails', async () => {
    h.state.activityResponse = () => Promise.reject(new Error('network'))
    h.state.invitesResponse = () => Promise.reject(new Error('network'))
    renderPage()
    expect(await screen.findByText('activity.empty')).toBeInTheDocument()
  })

  it('switches the heading with the active tab', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { level: 2, name: 'activity.title' })).toBeInTheDocument()
    await clickTab('activity.likes')
    expect(await screen.findByRole('heading', { level: 2, name: 'activity.likes' })).toBeInTheDocument()
    await clickTab('activity.visits')
    expect(await screen.findByRole('heading', { level: 2, name: 'activity.visits' })).toBeInTheDocument()
    await clickTab('activity.invites')
    expect(await screen.findByRole('heading', { level: 2, name: 'activity.invites' })).toBeInTheDocument()
  })
})
