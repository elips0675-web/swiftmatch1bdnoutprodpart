import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import React from 'react'

const t = (key: string) => key

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t, language: 'ru', setLanguage: () => {} }),
}))
vi.mock('@/lib/token', () => ({ getToken: () => 'admin-token' }))

import AdminDashboardPage from '@/pages/admin'

const stats = {
  totalUsers: 100,
  activeToday: 10,
  totalMatches: 5,
  revenue: 699,
  activeSubs: 20,
  newToday: 30,
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  cleanup()
  fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    json: async () => (String(url).includes('/api/admin/stats') ? stats : []),
  }))
  global.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('AdminDashboardPage', () => {
  it('показывает выручку в рублях, без деления на 100', async () => {
    render(<AdminDashboardPage />)
    await waitFor(() => expect(screen.getByText('699 ₽')).toBeTruthy())
    expect(screen.queryByText('6.99 ₽')).toBeNull()
  })
})
