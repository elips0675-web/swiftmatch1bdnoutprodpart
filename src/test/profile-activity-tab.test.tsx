import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import React from 'react'
import { MemoryRouter } from 'react-router-dom'

const mockFlags = vi.hoisted(() => ({ profileActivityEnabled: true }))

const mockT = vi.hoisted(() => (key: string) => key)
const mockSetLanguage = vi.hoisted(() => () => {})

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t: mockT, language: 'RU', setLanguage: mockSetLanguage }),
  LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/context/feature-flags-context', () => ({
  useFeatureFlags: () => mockFlags,
}))

vi.mock('@/shims/next-navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}))

vi.mock('@/lib/token', () => ({ getToken: () => 'test-token' }))

vi.mock('@/components/layout/app-header', () => ({ AppHeader: () => <div data-testid="mock-app-header" /> }))
vi.mock('@/components/navigation/bottom-nav', () => ({ BottomNav: () => <div data-testid="mock-bottom-nav" /> }))

vi.mock('@/lib/demo-data', () => ({ GROUP_CATEGORIES: [] }))

import ProfilePage from '@/pages/profile'

const renderProfile = () =>
  render(
    <MemoryRouter>
      <ProfilePage />
    </MemoryRouter>
  )

describe('Профиль: вкладка «История» под флагом profileActivityEnabled', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    mockFlags.profileActivityEnabled = true
    mockFetch.mockImplementation((url: string) => {
      const u = String(url)
      if (u.includes('/api/profile/activity')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) } as Response)
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) } as Response)
    })
  })

  it('флаг включён → вкладка «История» есть', () => {
    renderProfile()
    expect(screen.getByText('profile.tab.activity')).toBeTruthy()
  })

  it('флаг выключен → вкладки «История» нет', () => {
    mockFlags.profileActivityEnabled = false
    renderProfile()
    expect(screen.queryByText('profile.tab.activity')).toBeNull()
  })
})
