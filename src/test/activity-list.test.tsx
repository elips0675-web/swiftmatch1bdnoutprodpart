import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

vi.mock('@/lib/token', () => ({ getToken: () => 'test-token' }))

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t: (key: string) => key, language: 'RU', setLanguage: vi.fn() }),
}))

import { ActivityList } from '@/components/profile/activity-list'

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response)
}

describe('ActivityList (вкладка «История изменений»)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
  })

  it('рисует записи истории с разными действиями', async () => {
    mockFetch.mockImplementation(() => jsonResponse([
      { id: 2, table_name: 'user_profiles', action: 'update', old_values: { bio: 'a' }, new_values: { bio: 'b', city: 'Москва' }, created_at: '2026-10-10T10:00:00Z' },
      { id: 1, table_name: 'user_photos', action: 'delete', old_values: null, new_values: null, created_at: '2026-10-09T10:00:00Z' },
    ]))

    render(<ActivityList />)

    await waitFor(() => expect(screen.getAllByTestId('activity-item')).toHaveLength(2))
    expect(screen.getByText('profile.activity.update')).toBeTruthy()
    expect(screen.getByText('profile.activity.delete')).toBeTruthy()
    expect(screen.getByText('profile.activity.changed')).toBeTruthy()
    expect(mockFetch).toHaveBeenCalledWith('/api/profile/activity', expect.any(Object))
  })

  it('пустой список показывает заглушку', async () => {
    mockFetch.mockImplementation(() => jsonResponse([]))

    render(<ActivityList />)

    await waitFor(() => expect(screen.getByTestId('activity-empty')).toBeTruthy())
    expect(screen.queryAllByTestId('activity-item')).toHaveLength(0)
  })

  it('ошибка запроса не роняет страницу и показывает пустое состояние', async () => {
    mockFetch.mockImplementation(() => jsonResponse({ message: 'boom' }, 500))

    render(<ActivityList />)

    await waitFor(() => expect(screen.getByTestId('activity-empty')).toBeTruthy())
  })
})
