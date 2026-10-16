import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import React from 'react'

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t: (key: string) => key, language: 'RU', setLanguage: vi.fn() }),
}))

import VerifyEmailPage from '@/pages/verify-email'

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response)
}

function renderPage(token?: string) {
  const entry = token ? `/verify-email?token=${token}` : '/verify-email'
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <VerifyEmailPage />
    </MemoryRouter>,
  )
}

describe('Страница verify-email', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
  })

  it('без токена не стучит в API и показывает ошибку ссылки', async () => {
    renderPage()

    await waitFor(() => expect(screen.getByText('auth.verification_failed')).toBeInTheDocument())
    expect(screen.getByText('auth.invalid_verification_link')).toBeInTheDocument()
    expect(screen.getByText('auth.back_to_login')).toBeInTheDocument()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('показывает состояние загрузки, пока запрос не завершился', () => {
    mockFetch.mockImplementation(() => new Promise(() => {}))

    renderPage('tok-1')

    expect(screen.getByText('auth.verifying')).toBeInTheDocument()
    expect(screen.queryByText('auth.verification_failed')).toBeNull()
  })

  it('успешный ответ показывает «подтверждено» и кнопку возврата', async () => {
    mockFetch.mockImplementation(() => jsonResponse({ ok: true }))

    renderPage('tok-2')

    await waitFor(() => expect(screen.getByText('auth.email_verified_title')).toBeInTheDocument())
    expect(screen.getByText('auth.email_verified')).toBeInTheDocument()
    expect(screen.getByText('auth.back_to_login')).toBeInTheDocument()
    expect(mockFetch).toHaveBeenCalledWith('/api/auth/verify-email', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ token: 'tok-2' }),
    }))
  })

  it('ошибочный ответ показывает message из API', async () => {
    mockFetch.mockImplementation(() => jsonResponse({ message: 'Ссылка просрочена' }, 400))

    renderPage('tok-3')

    await waitFor(() => expect(screen.getByText('auth.verification_failed')).toBeInTheDocument())
    expect(screen.getByText('Ссылка просрочена')).toBeInTheDocument()
  })

  it('ошибочный ответ без message показывает common.error', async () => {
    mockFetch.mockImplementation(() => jsonResponse({}, 500))

    renderPage('tok-4')

    await waitFor(() => expect(screen.getByText('auth.verification_failed')).toBeInTheDocument())
    expect(screen.getByText('common.error')).toBeInTheDocument()
  })

  it('сетевая ошибка показывает common.error', async () => {
    mockFetch.mockImplementation(() => Promise.reject(new Error('network')))

    renderPage('tok-5')

    await waitFor(() => expect(screen.getByText('auth.verification_failed')).toBeInTheDocument())
    expect(screen.getByText('common.error')).toBeInTheDocument()
  })
})
