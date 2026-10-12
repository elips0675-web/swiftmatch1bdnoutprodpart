import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'

const t = (key: string) => key

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t, language: 'ru', setLanguage: () => {} }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/token', () => ({ getToken: () => 'admin-token' }))

import FeatureFlagsPage from '@/pages/admin-features'
import { toast } from 'sonner'

const flags = {
  videoCalls: true, aiIcebreakers: true, aiCompatibility: true, groupsPage: true,
  contest: true, showAds: false, autosearch: true, hangouts: true,
  partnerOffers: false, profileActivity: true, rolloutPercent: 30,
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  cleanup()
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => flags }))
  global.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('FeatureFlagsPage rollout', () => {
  it('рисует rollout из API и шлёт его в PUT', async () => {
    render(<FeatureFlagsPage />)
    await waitFor(() => expect(screen.getByTestId('rollout-percent')).toBeTruthy())
    expect((screen.getByTestId('rollout-percent') as HTMLInputElement).value).toBe('30')
    expect(screen.getByText('30% users')).toBeTruthy()

    fireEvent.change(screen.getByTestId('rollout-percent'), { target: { value: '50' } })
    fireEvent.click(screen.getByTestId('save-features'))

    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/features', expect.objectContaining({
      method: 'PUT',
      body: expect.stringContaining('"rolloutPercent":50'),
    }))
  })

  it('количество затронутых пользователей зависит от роллаута', async () => {
    render(<FeatureFlagsPage />)
    await waitFor(() => expect(screen.getByTestId('rollout-percent')).toBeTruthy())
    expect(screen.getAllByText(/744 users/).length).toBeGreaterThan(0)
    expect(screen.queryAllByText(/12480/)).toHaveLength(0)
  })
})