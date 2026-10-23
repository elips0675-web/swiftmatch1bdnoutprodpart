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
  describe('устойчивость страницы к нештатным ответам', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      mockFetch.mockReset()
      isNativeMock.mockReset()
      isNativeMock.mockReturnValue(false)
      iapMock.mockReset()
      Object.defineProperty(window, 'location', {
        value: { href: '' },
        writable: true,
        configurable: true,
      })
    })

    it('объект вместо массива тарифов не роняет страницу, а включает встроенные тарифы', async () => {
      mockFetch.mockImplementation(() => jsonResponse({ error: 'bad' }))

      renderPage()

      await waitForTier('Platinum')
      expect(screen.getByText(price(1499))).toBeInTheDocument()
    })

    it('пустой массив тарифов уводит в fallback и выбирает gold', async () => {
      mockFetch.mockImplementation(() => jsonResponse([]))

      renderPage()

      await waitForTier('Platinum')
      expect(screen.getByText('-20%')).toBeInTheDocument()
    })

    it('ответ оплаты с url уводит на страницу Stripe', async () => {
      mockFetch.mockImplementation((url: string) =>
        url === '/api/premium/tiers'
          ? jsonResponse([goldTier])
          : jsonResponse({ url: 'https://checkout.stripe.com/session' }),
      )

      renderPage()
      await waitForTier('Gold')

      fireEvent.click(screen.getByText('premium.start_now'))

      await waitFor(() => expect(window.location.href).toBe('https://checkout.stripe.com/session'))
      expect(pushMock).not.toHaveBeenCalled()
      expect(toastSuccessMock).not.toHaveBeenCalled()
    })

    it('сетевая ошибка оплаты показывает premium.error', async () => {
      mockFetch.mockImplementation((url: string) =>
        url === '/api/premium/tiers' ? jsonResponse([goldTier]) : Promise.reject(new Error('Failed to fetch')),
      )

      renderPage()
      await waitForTier('Gold')

      fireEvent.click(screen.getByText('premium.start_now'))

      await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('premium.error'))
    })

    it('нечитаемый ответ оплаты не выводит английский SyntaxError', async () => {
      mockFetch.mockImplementation((url: string) =>
        url === '/api/premium/tiers'
          ? jsonResponse([goldTier])
          : Promise.resolve({ ok: false, status: 502, json: () => Promise.reject(new Error('bad')) } as Response),
      )

      renderPage()
      await waitForTier('Gold')

      fireEvent.click(screen.getByText('premium.start_now'))

      await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('premium.error'))
    })

    it('провал IAP с fallback уходит в веб-оплату', async () => {
      isNativeMock.mockReturnValue(true)
      iapMock.mockResolvedValue({ ok: false, fallback: true, message: 'IAP unavailable' })
      mockFetch.mockImplementation((url: string) =>
        url === '/api/premium/tiers' ? jsonResponse([goldTier]) : jsonResponse({}),
      )

      renderPage()
      await waitForTier('Gold')

      fireEvent.click(screen.getByText('premium.start_now'))

      await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/premium/create-checkout', expect.anything()))
      expect(toastSuccessMock).toHaveBeenCalledWith('premium.activated')
      expect(pushMock).toHaveBeenCalledWith('/premium/success')
    })

    it('кнопка «назад» зовёт router.back()', async () => {
      mockFetch.mockImplementation(() => jsonResponse([goldTier]))

      renderPage()
      await waitForTier('Gold')

      fireEvent.click(screen.getByText('common.back'))

      expect(backMock).toHaveBeenCalled()
    })

    it('бейдж «лучший выбор» локализован ключом', async () => {
      mockFetch.mockImplementation(() => jsonResponse([goldTier, { ...goldTier, id: 'platinum', name: 'Platinum' }]))

      renderPage()
      await waitForTier('Platinum')

      expect(screen.getByText('premium.best_choice')).toBeInTheDocument()
    })

    it('пока идёт оплата, кнопка блокируется от повторного клика', async () => {
      let resolveCheckout: (value: Response) => void = () => {}
      isNativeMock.mockReturnValue(false)
      mockFetch.mockImplementation((url: string) => {
        if (url === '/api/premium/tiers') return jsonResponse([goldTier])
        return new Promise<Response>((resolve) => { resolveCheckout = resolve })
      })

      renderPage()
      await waitForTier('Gold')

      fireEvent.click(screen.getByText('premium.start_now'))

      const button = screen.getByRole('button', { name: '' })
      expect(button).toBeDisabled()

      resolveCheckout({ ok: true, status: 200, json: () => Promise.resolve({}) } as Response)
      await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith('premium.activated'))
    })

    it('провал IAP без fallback и без message показывает premium.error', async () => {
      isNativeMock.mockReturnValue(true)
      iapMock.mockResolvedValue({ ok: false, fallback: false })
      mockFetch.mockImplementation(() => jsonResponse([goldTier]))

      renderPage()
      await waitForTier('Gold')

      fireEvent.click(screen.getByText('premium.start_now'))

      await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('premium.error'))
      expect(trackMock).not.toHaveBeenCalled()
      expect(mockFetch).not.toHaveBeenCalledWith('/api/premium/create-checkout', expect.anything())
    })

    it('клик по другой карточке переключает тариф и сбрасывает срок на месяц', async () => {
      const platinumTier = { id: 'platinum', name: 'Platinum', price: 1499, duration_months: 1, features: [] }
      mockFetch.mockImplementation(() => jsonResponse([goldTier, platinumTier]))

      renderPage()
      await waitForTier('Platinum')
      expect(screen.getByText('Gold · 1 units.month_short')).toBeInTheDocument()

      fireEvent.click(screen.getByText('6 units.month_short'))
      await waitFor(() => expect(screen.getByText('Gold · 6 units.month_short')).toBeInTheDocument())

      fireEvent.click(screen.getByText('Platinum'))
      await waitFor(() => expect(screen.getByText('Platinum · 1 units.month_short')).toBeInTheDocument())
    })
  })
})
