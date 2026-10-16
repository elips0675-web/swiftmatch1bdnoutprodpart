import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

let tokenValue: string | null = 'test-token'
vi.mock('@/lib/token', () => ({ getToken: () => tokenValue }))

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t: (key: string) => key, language: 'RU', setLanguage: vi.fn() }),
}))

vi.mock('@/components/layout/app-header', () => ({
  AppHeader: () => <div data-testid="app-header" />,
}))

vi.mock('@/components/navigation/bottom-nav', () => ({
  BottomNav: () => <div data-testid="bottom-nav" />,
}))

import SchedulePage from '@/pages/schedule'

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response)
}

function renderPage() {
  return render(<SchedulePage />)
}

const pendingFromThem = {
  id: 1,
  partnerName: 'Аня',
  partnerAvatar: '',
  scheduledAt: '2026-10-20T18:00:00.000Z',
  duration: 30,
  status: 'pending',
  initiatedBy: 'them',
  message: 'Давай в 18:00',
}

describe('Страница schedule', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
    tokenValue = 'test-token'
  })

  it('без токена не стучит в API и показывает пустое состояние', async () => {
    tokenValue = null

    renderPage()

    await waitFor(() => expect(screen.getByText('schedule.empty')).toBeInTheDocument())
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('пустой список показывает заглушку', async () => {
    mockFetch.mockImplementation(() => jsonResponse([]))

    renderPage()

    await waitFor(() => expect(screen.getByText('schedule.empty')).toBeInTheDocument())
    expect(mockFetch).toHaveBeenCalledWith('/api/schedule', { headers: { Authorization: 'Bearer test-token' } })
  })

  it('запрос из списка показывает партнёра, статус, сообщение и кнопки принятия', async () => {
    mockFetch.mockImplementation(() => jsonResponse([pendingFromThem]))

    renderPage()

    await waitFor(() => expect(screen.getByText('Аня')).toBeInTheDocument())
    expect(screen.getByText('schedule.pending')).toBeInTheDocument()
    expect(screen.getByText('Давай в 18:00')).toBeInTheDocument()
    expect(screen.getByText('schedule.accept')).toBeInTheDocument()
    expect(screen.getByText('schedule.decline')).toBeInTheDocument()
  })

  it('запрос, инициированный мной, не показывает кнопки принятия', async () => {
    mockFetch.mockImplementation(() => jsonResponse([{ ...pendingFromThem, initiatedBy: 'me' }]))

    renderPage()

    await waitFor(() => expect(screen.getByText('Аня')).toBeInTheDocument())
    expect(screen.getByText('schedule.pending')).toBeInTheDocument()
    expect(screen.queryByText('schedule.accept')).toBeNull()
    expect(screen.queryByText('schedule.decline')).toBeNull()
  })

  it('завершённая встреча не показывает кнопки принятия', async () => {
    mockFetch.mockImplementation(() => jsonResponse([{ ...pendingFromThem, status: 'completed', message: '' }]))

    renderPage()

    await waitFor(() => expect(screen.getByText('schedule.completed')).toBeInTheDocument())
    expect(screen.queryByText('schedule.accept')).toBeNull()
    expect(screen.queryByText('schedule.decline')).toBeNull()
  })
})
