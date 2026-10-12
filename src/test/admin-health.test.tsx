import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'

const t = (key: string) => key

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t, language: 'ru', setLanguage: () => {} }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/token', () => ({ getToken: () => 'admin-token' }))

import AdminHealthPage from '@/pages/admin-health'
import { toast } from 'sonner'

const report = {
  status: 'degraded',
  checkedAt: '2026-10-12T10:00:00Z',
  services: [
    { name: 'database', kind: 'probe', status: 'ok', mode: 'live', latencyMs: 3 },
    { name: 'redis', kind: 'probe', status: 'mock', mode: 'mock', latencyMs: 0 },
    { name: 'smtp', kind: 'config', status: 'mock', mode: 'mock', latencyMs: 0 },
    { name: 'stripe', kind: 'config', status: 'ok', mode: 'live', latencyMs: 0 },
    { name: 'openai', kind: 'config', status: 'error', mode: 'unavailable', latencyMs: 0 },
    { name: 'fcm', kind: 'config', status: 'mock', mode: 'mock', latencyMs: 0 },
  ],
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  cleanup()
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => report }))
  global.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('AdminHealthPage', () => {
  it('рисует подсистемы и общий статус', async () => {
    render(<AdminHealthPage />)
    await waitFor(() => expect(screen.getByTestId('service-database')).toBeTruthy())

    expect(screen.getByTestId('service-redis')).toBeTruthy()
    expect(screen.getByTestId('service-openai')).toBeTruthy()
    expect(screen.getByText('admin.health.overall.degraded')).toBeTruthy()
    expect(screen.getByText('admin.health.status.error')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/health', expect.any(Object))
  })

  it('сообщает об ошибке загрузки', async () => {
    fetchMock = vi.fn(async () => ({ ok: false, json: async () => ({}) }))
    global.fetch = fetchMock as unknown as typeof fetch

    render(<AdminHealthPage />)
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('admin.health.error_load'))
  })

  it('обновляет отчёт по кнопке', async () => {
    render(<AdminHealthPage />)
    await waitFor(() => expect(screen.getByTestId('service-database')).toBeTruthy())

    const before = fetchMock.mock.calls.length
    fireEvent.click(screen.getByTestId('refresh-health'))
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before))
  })
})
