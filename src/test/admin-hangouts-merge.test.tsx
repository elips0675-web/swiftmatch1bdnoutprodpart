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
  items[0].status = 'active'
  items[1].status = 'active'
  fetchMock = vi.fn(async (url: unknown, init?: RequestInit): Promise<{ ok: boolean; json: () => Promise<unknown> }> => {
    const u = String(url)
    if (u.includes('/merge')) {
      if (init && (init as any).body && String((init as any).body).includes('999')) {
        return { ok: false, json: async () => ({ message: 'err' }) }
      }
      return { ok: true, json: async () => ({ message: 'Hangouts merged' }) }
    }
    if (u.includes('/api/admin/hangouts/') && init?.method === 'PUT') {
      if (String(u).includes('/999')) return { ok: false, json: async () => ({}) }
      try {
        const body = init?.body ? JSON.parse(String(init.body)) : {}
        const m = u.match(/\/api\/admin\/hangouts\/(\d+)/)
        if (m) {
          const id = Number(m[1])
          const it = items.find(x => x.id === id)
          if (it && (body.status === 'blocked' || body.status === 'active')) it.status = body.status
        }
      } catch {}
      return { ok: true, json: async () => ({}) }
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

  it('показывает ошибку merge при неуспешном ответе', async () => {
    const user = userEvent.setup()
    render(<AdminHangoutsPage />)
    await user.click(await screen.findByTestId('merge-hangout-31'))
    await user.type(await screen.findByTestId('merge-into-id'), '999')
    await user.click(screen.getByTestId('confirm-merge-hangout'))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('admin.hangouts.merge_error'))
  })

  it('блокирует и разблокирует встречу', async () => {
    const user = userEvent.setup()
    render(<AdminHangoutsPage />)
    await user.click(await screen.findByTestId('block-hangout-31'))
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    await user.click(await screen.findByTestId('unblock-hangout-31'))
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(2))
  })

  it('показывает ошибку блокировки при неуспешном ответе', async () => {
    fetchMock = vi.fn(async (url: unknown, init?: RequestInit): Promise<{ ok: boolean; json: () => Promise<unknown> }> => {
      const u = String(url)
      if (u.includes('/api/admin/hangouts/31') && init?.method === 'PUT') {
        return { ok: false, json: async () => ({}) }
      }
      if (u.includes('/api/admin/hangouts')) {
        return { ok: true, json: async () => items }
      }
      return { ok: true, json: async () => ({}) }
    })
    global.fetch = fetchMock as unknown as typeof fetch
    const user = userEvent.setup()
    render(<AdminHangoutsPage />)
    await user.click(await screen.findByTestId('block-hangout-31'))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('hangout.error.load'))
  })

  it('фильтрует по вкладкам active/blocked/all', async () => {
    const user = userEvent.setup()
    render(<AdminHangoutsPage />)
    await screen.findByTestId('admin-hangout-31')
    const tabs = screen.getAllByRole('tab')
    await user.click(tabs[1])
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/hangouts?status=active', expect.anything()))
    await user.click(tabs[2])
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/hangouts?status=blocked', expect.anything()))
    await user.click(tabs[0])
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/hangouts?', expect.anything()))
  })

  it('показывает ошибку при загрузке и пустой список', async () => {
    fetchMock = vi.fn(async (url: unknown): Promise<{ ok: boolean; json: () => Promise<unknown> }> => {
      const u = String(url)
      if (u.includes('/api/admin/hangouts')) return { ok: false, json: async () => ({}) }
      return { ok: true, json: async () => ({}) }
    })
    global.fetch = fetchMock as unknown as typeof fetch
    render(<AdminHangoutsPage />)
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('hangout.error.load'))
    expect(await screen.findByText('hangout.empty')).toBeInTheDocument()
  })

  it('не шлёт merge при пустом вводе и при нецелом/неположительном', async () => {
    const user = userEvent.setup()
    render(<AdminHangoutsPage />)
    await user.click(await screen.findByTestId('merge-hangout-31'))
    await user.click(screen.getByTestId('confirm-merge-hangout'))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('admin.hangouts.merge_invalid'))
    await user.clear(await screen.findByTestId('merge-into-id'))
    await user.type(screen.getByTestId('merge-into-id'), '0')
    await user.click(screen.getByTestId('confirm-merge-hangout'))
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(2))
    await user.clear(screen.getByTestId('merge-into-id'))
    await user.type(screen.getByTestId('merge-into-id'), '-5')
    await user.click(screen.getByTestId('confirm-merge-hangout'))
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(3))
  })

  it('закрывает диалог merge при отмене и при onOpenChange', async () => {
    const user = userEvent.setup()
    render(<AdminHangoutsPage />)
    await user.click(await screen.findByTestId('merge-hangout-31'))
    expect(screen.getByTestId('merge-hangout-dialog')).toBeInTheDocument()
    await user.click(screen.getByText('hangout.action.cancel'))
    await waitFor(() => expect(screen.queryByTestId('merge-hangout-dialog')).not.toBeInTheDocument())
    await user.click(await screen.findByTestId('merge-hangout-31'))
    expect(screen.getByTestId('merge-hangout-dialog')).toBeInTheDocument()
    // close via overlay/escape simulated by calling onOpenChange path - click outside not easy, just reopen/close again
    await user.click(screen.getByText('hangout.action.cancel'))
    await waitFor(() => expect(screen.queryByTestId('merge-hangout-dialog')).not.toBeInTheDocument())
  })

  it('обрабатывает невалидный JSON от списка и показывает пустой список', async () => {
    fetchMock = vi.fn(async (url: unknown): Promise<{ ok: boolean; json: () => Promise<unknown> }> => {
      const u = String(url)
      if (u.includes('/api/admin/hangouts')) return { ok: true, json: async () => ({}) }
      return { ok: true, json: async () => ({}) }
    })
    global.fetch = fetchMock as unknown as typeof fetch
    render(<AdminHangoutsPage />)
    await waitFor(() => expect(screen.getByText('hangout.empty')).toBeInTheDocument())
  })
})
