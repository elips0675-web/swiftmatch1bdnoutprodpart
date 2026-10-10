import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'

const t = (key: string) => key

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t, language: 'ru', setLanguage: () => {} }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/token', () => ({ getToken: () => 'admin-token' }))

import AdminWebhooksPage from '@/pages/admin-webhooks'
import { toast } from 'sonner'

const rows = [
  { id: 1, provider: 'stripe', eventId: 'evt_1', eventType: 'checkout.session.completed', status: 'processed', error: null, attempts: 1, createdAt: '2026-10-10T10:00:00Z', processedAt: '2026-10-10T10:00:01Z' },
  { id: 2, provider: 'stripe_event', eventId: 'evt_2', eventType: 'checkout.session.completed', status: 'failed', error: 'boom', attempts: 2, createdAt: '2026-10-10T10:01:00Z', processedAt: '2026-10-10T10:01:01Z' },
]

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  cleanup()
  fetchMock = vi.fn(async (url: unknown) => {
    if (String(url).includes('/replay')) return { ok: true, json: async () => ({ message: 'Replayed' }) }
    return { ok: true, json: async () => ({ rows, total: rows.length }) }
  })
  global.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('AdminWebhooksPage', () => {
  it('рисует журнал доставок с ошибкой упавшей доставки', async () => {
    render(<AdminWebhooksPage />)
    await waitFor(() => expect(screen.getByTestId('delivery-1')).toBeTruthy())
    expect(screen.getByTestId('delivery-2')).toBeTruthy()
    expect(screen.getByTestId('delivery-2').textContent).toContain('boom')
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/admin/webhooks'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer admin-token' }) }),
    )
  })

  it('кнопка «Повторить» шлёт POST и обновляет список', async () => {
    render(<AdminWebhooksPage />)
    await waitFor(() => expect(screen.getByTestId('replay-2')).toBeTruthy())
    fireEvent.click(screen.getByTestId('replay-2'))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/webhooks/2/replay', expect.objectContaining({ method: 'POST' })),
    )
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
  })
})
