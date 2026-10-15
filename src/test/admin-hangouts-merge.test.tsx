import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'

const t = (key: string, options?: Record<string, unknown>) => {
  let value = key
  if (options) {
    Object.entries(options).forEach(([k, v]) => { value = value.replace(`{${k}}`, String(v)) })
  }
  return value
}

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t, language: 'ru', setLanguage: () => {} }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/token', () => ({ getToken: () => 'admin-token' }))

import AdminHangoutsPage from '@/pages/admin-hangouts'
import { toast } from 'sonner'

const items = [
  {
    id: 31,
    author_id: 10,
    category: 'cinema',
    title: 'Дубликат',
    description: null,
    place_name: 'Аврора',
    city: 'Москва',
    event_date: '2026-11-01T18:00:00.000Z',
    max_companions: 2,
    status: 'active',
    created_at: '2026-10-01T10:00:00.000Z',
    display_name: 'Иван',
    avatar_url: null,
  },
  {
    id: 30,
    author_id: 10,
    category: 'cinema',
    title: 'Оригинал',
    description: null,
    place_name: 'Аврора',
    city: 'Москва',
    event_date: '2026-11-02T18:00:00.000Z',
    max_companions: 2,
    status: 'active',
    created_at: '2026-10-02T10:00:00.000Z',
    display_name: 'Иван',
    avatar_url: null,
  },
]

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  fetchMock = vi.fn(async (url: unknown): Promise<{ ok: boolean; json: () => Promise<unknown> }> => {
    const u = String(url)
    if (u.includes('/merge')) {
      return { ok: true, json: async () => ({ message: 'Hangouts merged' }) }
    }
    if (u.includes('/api/admin/hangouts')) {
      return { ok: true, json: async () => items }
    }
    return { ok: true, json: async () => ({}) }
  })
  global.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AdminHangoutsPage merge', () => {
  it('шлёт POST merge с mergeIntoId и обновляет список', async () => {
    const user = userEvent.setup()
    render(<AdminHangoutsPage />)

    const mergeBtn = await screen.findByTestId('merge-hangout-31')
    await user.click(mergeBtn)

    const input = await screen.findByTestId('merge-into-id')
    await user.type(input, '30')
    await user.click(screen.getByTestId('confirm-merge-hangout'))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/hangouts/31/merge',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ mergeIntoId: 30 }),
        }),
      ),
    )
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/hangouts?', expect.anything()),
    )
  })

  it('не шлёт merge, если ID пустой или совпадает с самим дубликатом', async () => {
    const user = userEvent.setup()
    render(<AdminHangoutsPage />)

    await user.click(await screen.findByTestId('merge-hangout-31'))
    await user.type(await screen.findByTestId('merge-into-id'), '31')
    await user.click(screen.getByTestId('confirm-merge-hangout'))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('admin.hangouts.merge_invalid'))
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/admin/hangouts/31/merge',
      expect.anything(),
    )
  })
})
