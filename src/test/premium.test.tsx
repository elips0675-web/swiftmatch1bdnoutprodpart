import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

const pushMock = vi.fn()
const backMock = vi.fn()

vi.mock('@/shims/next-navigation', () => ({
  useRouter: () => ({ push: pushMock, back: backMock }),
}))

vi.mock('@/lib/token', () => ({ getToken: () => 'test-token' }))

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t: (key: string) => key, language: 'RU', setLanguage: vi.fn() }),
}))

const isNativeMock = vi.fn(() => false)
vi.mock('@/lib/native', () => ({ isNative: () => isNativeMock() }))

const iapMock = vi.fn()
vi.mock('@/lib/iap', () => ({ purchaseWithIAP: (tier: string, months: number) => iapMock(tier, months) }))

const trackMock = vi.fn()
vi.mock('@/hooks/useExperiment', () => ({
  useTrackEvent: () => trackMock,
  useExperiment: () => ({ variant: null, loading: false }),
}))

const toastErrorMock = vi.fn()
const toastSuccessMock = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    error: (msg?: string) => toastErrorMock(msg),
    success: (msg?: string) => toastSuccessMock(msg),
  },
  Toaster: () => null,
}))

import Premium from '@/pages/premium'

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response)
}

function price(value: number) {
  // toLocaleString('ru-RU') отделяет разряды NBSP, а getByText нормализует пробелы только в node-тексте.
  return value.toLocaleString('ru-RU').replace(/\u00a0/g, ' ') + ' ₽'
}

const goldTier = { id: 'gold', name: 'Gold', price: 699, duration_months: 1, features: ['10 суперлайков'] }

function renderPage() {
  return render(<Premium />)
}

async function waitForTier(name: string) {
  await waitFor(() => expect(screen.getByText(name)).toBeInTheDocument())
}

describe('Страница premium', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
    isNativeMock.mockReset()
    isNativeMock.mockReturnValue(false)
    iapMock.mockReset()
  })

  it('грузит тарифы из API и выбирает первый, показывая его цену', async () => {
    mockFetch.mockImplementation(() => jsonResponse([
      { id: 'plus', name: 'Plus', price: 299, duration_months: 1, features: ['5 суперлайков'] },
      goldTier,
    ]))

    renderPage()
    await waitForTier('Plus')

    expect(mockFetch).toHaveBeenCalledWith('/api/premium/tiers')
    expect(screen.getByText('Gold')).toBeInTheDocument()
    expect(screen.getByText(price(699))).toBeInTheDocument()
    expect(backMock).not.toHaveBeenCalled()

  })

  it('при ошибке API показывает три встроенных тарифа и выбирает gold со скидками', async () => {
    mockFetch.mockImplementation(() => Promise.reject(new Error('network')))

    renderPage()
    await waitForTier('Platinum')

    expect(screen.getByText(price(1499))).toBeInTheDocument()
    expect(screen.getByText('-20%')).toBeInTheDocument()
    expect(screen.getByText('-40%')).toBeInTheDocument()
  })

  it('выбор длительности 12 месяцев влияет на цену за месяц и на тело запроса', async () => {
    mockFetch.mockImplementation((url: string) =>
      url === '/api/premium/tiers' ? jsonResponse([{ ...goldTier, price: 1000, features: [] }]) : jsonResponse({}),
    )

    renderPage()
    await waitForTier('Gold')

    expect(screen.getAllByText(price(1000)).length).toBeGreaterThan(0)
    expect(screen.getByText(price(800) + 'units.per_month')).toBeInTheDocument()
    expect(screen.getByText(price(600) + 'units.per_month')).toBeInTheDocument()

    fireEvent.click(screen.getByText('12 units.month_short'))
    fireEvent.click(screen.getByText('premium.start_now'))

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/premium/create-checkout', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ tier: 'gold', duration_months: 12 }),
    })))
  })

  it('веб-покупка без redirect-url: событие, тост успеха и переход на success', async () => {
    mockFetch.mockImplementation((url: string) =>
      url === '/api/premium/tiers' ? jsonResponse([goldTier]) : jsonResponse({}),
    )

    renderPage()
    await waitForTier('Gold')

    fireEvent.click(screen.getByText('premium.start_now'))

    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith('premium.activated'))
    expect(pushMock).toHaveBeenCalledWith('/premium/success')
    expect(trackMock).toHaveBeenCalledWith('purchase_completed', expect.objectContaining({ tier: 'gold', channel: 'web' }))
    expect(mockFetch).toHaveBeenCalledWith('/api/premium/create-checkout', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ tier: 'gold', duration_months: 1 }),
    }))
  })

  it('отказ Stripe показывает ключ premium.stripe_unavailable, а не сырой message', async () => {
    mockFetch.mockImplementation((url: string) =>
      url === '/api/premium/tiers'
        ? jsonResponse([goldTier])
        : jsonResponse({ code: 'STRIPE_NOT_CONFIGURED', message: 'Stripe is not configured' }, 503),
    )

    renderPage()
    await waitForTier('Gold')

    fireEvent.click(screen.getByText('premium.start_now'))

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('premium.stripe_unavailable'))
    expect(pushMock).not.toHaveBeenCalled()
    expect(trackMock).not.toHaveBeenCalled()
  })

  it('прочий HTTP-отказ без message показывает premium.error', async () => {
    mockFetch.mockImplementation((url: string) =>
      url === '/api/premium/tiers' ? jsonResponse([goldTier]) : jsonResponse({}, 400),
    )

    renderPage()
    await waitForTier('Gold')

    fireEvent.click(screen.getByText('premium.start_now'))

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('premium.error'))
  })

  it('на нативе успешная IAP-покупка не идёт в Stripe-эндпоинт', async () => {
    isNativeMock.mockReturnValue(true)
    iapMock.mockResolvedValue({ ok: true, fallback: false })
    mockFetch.mockImplementation(() => jsonResponse([goldTier]))

    renderPage()
    await waitForTier('Gold')

    fireEvent.click(screen.getByText('premium.start_now'))

    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith('premium.activated'))
    expect(iapMock).toHaveBeenCalledWith('gold', 1)
    expect(trackMock).toHaveBeenCalledWith('purchase_completed', expect.objectContaining({ channel: 'iap' }))
    expect(pushMock).toHaveBeenCalledWith('/premium/success')
    expect(mockFetch).not.toHaveBeenCalledWith('/api/premium/create-checkout', expect.anything())
  })

  it('на нативе провал IAP без fallback показывает сообщение и не идёт в Stripe', async () => {
    isNativeMock.mockReturnValue(true)
    iapMock.mockResolvedValue({ ok: false, fallback: false, message: 'Purchase cancelled' })
    mockFetch.mockImplementation(() => jsonResponse([goldTier]))

    renderPage()
    await waitForTier('Gold')

    fireEvent.click(screen.getByText('premium.start_now'))

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('Purchase cancelled'))
    expect(pushMock).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalledWith('/api/premium/create-checkout', expect.anything())
  })
})
