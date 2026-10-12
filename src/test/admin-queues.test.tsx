import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'

const t = (key: string) => key

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t, language: 'ru', setLanguage: () => {} }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/token', () => ({ getToken: () => 'admin-token' }))

import AdminQueuesPage from '@/pages/admin-queues'
import { toast } from 'sonner'

const report = {
  available: ['email'],
  redisConfigured: false,
  queues: [
    {
      name: 'email',
      enabled: true,
      counts: { waiting: 2, active: 1, completed: 5, failed: 1, delayed: 0 },
      failed: [{ id: '7', name: 'send-email', attemptsMade: 3, failedReason: 'SMTP timeout' }],
    },
    { name: 'push', enabled: false, counts: null, failed: [] },
    { name: 'image', enabled: false, counts: null, failed: [] },
  ],
}

const jsonResponse = (body: unknown, ok = true) => ({ ok, json: async () => body })

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  cleanup()
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return jsonResponse({ name: 'email', available: true, total: 1, retried: 1, failed: 0 })
    return jsonResponse(report)
  })
  global.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('AdminQueuesPage', () => {
  it('рисует очереди, счётчики и отключённые очереди с предупреждением', async () => {
    render(<AdminQueuesPage />)
    await waitFor(() => expect(screen.getByTestId('queue-email')).toBeTruthy())

    expect(screen.getByTestId('queue-push')).toBeTruthy()
    expect(screen.getByTestId('queue-image')).toBeTruthy()
    expect(screen.getByText('admin.queues.enabled')).toBeTruthy()
    expect(screen.getAllByText('admin.queues.disabled')).toHaveLength(2)
    expect(screen.getByTestId('queue-warning')).toBeTruthy()
    expect(screen.getByText('admin.queues.redis_not_configured')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/queues', expect.any(Object))
  })

  it('показывает «Redis недоступен», когда Redis настроен, но очереди отключены', async () => {
    fetchMock = vi.fn(async () => jsonResponse({ ...report, redisConfigured: true }))
    global.fetch = fetchMock as unknown as typeof fetch

    render(<AdminQueuesPage />)
    await waitFor(() => expect(screen.getByTestId('queue-warning')).toBeTruthy())
    expect(screen.getByText('admin.queues.redis_unreachable')).toBeTruthy()
  })

  it('повторяет упавшие задания и перезагружает список', async () => {
    render(<AdminQueuesPage />)
    await waitFor(() => expect(screen.getByTestId('retry-email')).toBeTruthy())

    const before = fetchMock.mock.calls.length
    fireEvent.click(screen.getByTestId('retry-email'))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('admin.queues.retried'))
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before))

    const postCall = fetchMock.mock.calls.find((call) => (call[1] as RequestInit)?.method === 'POST')
    expect(postCall?.[0]).toBe('/api/admin/queues/email/retry')
  })

  it('сообщает об ошибке загрузки', async () => {
    fetchMock = vi.fn(async () => jsonResponse({}, false))
    global.fetch = fetchMock as unknown as typeof fetch

    render(<AdminQueuesPage />)
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('admin.queues.error_load'))
  })
})
