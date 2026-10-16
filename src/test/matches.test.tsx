import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import React from 'react'

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

vi.mock('@/lib/token', () => ({ getToken: () => 'test-token' }))

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t: (key: string) => key, language: 'RU', setLanguage: vi.fn() }),
}))

import Matches from '@/pages/matches'

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response)
}

function renderPage() {
  return render(
    <BrowserRouter>
      <Matches />
    </BrowserRouter>,
  )
}

describe('Страница matches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
  })

  it('грузит первую страницу с limit=50 и offset=0 и рисует мэтчи по полям API', async () => {
    mockFetch.mockImplementation(() => jsonResponse([
      { id: 1, user_id: 7, display_name: 'Аня', avatar_url: null, matched_at: '2026-10-01T00:00:00Z' },
    ]))

    renderPage()

    await waitFor(() => expect(screen.getByText('Аня')).toBeTruthy())
    expect(mockFetch).toHaveBeenCalledWith('/api/matches?limit=50&offset=0', expect.any(Object))
  })

  it('полная страница показывает «Показать ещё» и грузит следующую с offset=50', async () => {
    const full = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, user_id: i + 1, display_name: `U${i}`, matched_at: null }))
    mockFetch
      .mockImplementationOnce(() => jsonResponse(full))
      .mockImplementationOnce(() => jsonResponse([{ id: 51, user_id: 51, display_name: 'U51', matched_at: null }]))

    renderPage()

    const btn = await screen.findByText('matches.load_more')
    fireEvent.click(btn)

    await waitFor(() => expect(screen.getByText('U51')).toBeTruthy())
    expect(mockFetch).toHaveBeenLastCalledWith('/api/matches?limit=50&offset=50', expect.any(Object))
  })

  it('неполная страница не показывает кнопку «Показать ещё»', async () => {
    mockFetch.mockImplementation(() => jsonResponse([
      { id: 1, user_id: 7, display_name: 'Аня', matched_at: null },
    ]))

    renderPage()

    await waitFor(() => expect(screen.getByText('Аня')).toBeTruthy())
    expect(screen.queryByText('matches.load_more')).toBeNull()
  })

  it('пустой список показывает заглушку без кнопки', async () => {
    mockFetch.mockImplementation(() => jsonResponse([]))

    renderPage()

    await waitFor(() => expect(screen.getByText('matches.empty')).toBeTruthy())
    expect(screen.queryByText('matches.load_more')).toBeNull()
  })
})
