import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

const toastErrorMock = vi.fn()
const toastSuccessMock = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    error: (msg?: string) => toastErrorMock(msg),
    success: (msg?: string) => toastSuccessMock(msg),
  },
  Toaster: () => null,
}))

vi.mock('@/lib/token', () => ({ getToken: () => 'tok' }))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => <div {...props}>{children}</div>,
  },
}))

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t: (key: string) => key, language: 'RU' }),
}))

import { PremiumDialog } from '@/components/dialogs/premium-dialog'

const goldTier = { id: 'gold', name: 'Gold', price: 699, duration_months: 1, features: [] }
const plusTier = { id: 'plus', name: 'Plus', price: 299, duration_months: 1, features: [] }
const platinumTier = { id: 'platinum', name: 'Platinum', price: 1499, duration_months: 1, features: [] }

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response)
}

function price(value: number) {
  return value.toLocaleString('ru-RU').replace(/\u00a0/g, ' ') + ' ₽'
}

describe('PremiumDialog', () => {
  const onOpenChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
    Object.defineProperty(window, 'location', {
      value: { href: '' },
      writable: true,
      configurable: true,
    })
  })

  function renderDialog() {
    return render(<PremiumDialog open onOpenChange={onOpenChange} />)
  }

  it('при открытии загружает тарифы и выбирает первый', async () => {
    mockFetch.mockImplementation(() => jsonResponse([plusTier, goldTier]))

    renderDialog()

    await waitFor(() => expect(screen.getByText('Plus')).toBeInTheDocument())
    expect(screen.getByText('Gold')).toBeInTheDocument()
    expect(mockFetch).toHaveBeenCalledWith('/api/premium/tiers')
  })

  it('при сетевой ошибке показывает встроенные тарифы и выбирает gold', async () => {
    mockFetch.mockImplementation(() => Promise.reject(new Error('net')))

    renderDialog()

    await waitFor(() => expect(screen.getByText('Platinum')).toBeInTheDocument())
    expect(screen.getByText(price(1499))).toBeInTheDocument()
    expect(screen.getByText('-20%')).toBeInTheDocument()
    expect(screen.getByText('-40%')).toBeInTheDocument()
  })

  it('объект вместо массива тарифов не роняет диалог, а включает fallback', async () => {
    mockFetch.mockImplementation(() => jsonResponse({ error: 'bad' }))

    renderDialog()

    await waitFor(() => expect(screen.getByText('Gold')).toBeInTheDocument())
    expect(screen.getAllByText(price(699)).length).toBeGreaterThan(0)
  })

  it('пустой массив тарифов тоже уводит в fallback', async () => {
    mockFetch.mockImplementation(() => jsonResponse([]))

    renderDialog()

    await waitFor(() => expect(screen.getByText('Gold')).toBeInTheDocument())
  })

  it('без выбранного тарифа кнопка заблокирована', async () => {
    mockFetch.mockImplementation(() => Promise.reject(new Error('net')))

    renderDialog()

    const button = screen.getByText('premium.start_now').closest('button') as HTMLButtonElement
    expect(button).toBeDisabled()
  })

  it('после загрузки тарифов кнопка покупки активна', async () => {
    mockFetch.mockImplementation(() => jsonResponse([goldTier]))

    renderDialog()

    await waitFor(() => expect(screen.getByText('Gold')).toBeInTheDocument())
    const button = screen.getByText('premium.start_now').closest('button') as HTMLButtonElement
    expect(button).not.toBeDisabled()
  })

  it('выбор 12 месяцев пересчитывает цену и месячную ставку', async () => {
    mockFetch.mockImplementation(() => jsonResponse([{ ...goldTier, price: 1000 }]))

    renderDialog()

    await waitFor(() => expect(screen.getByText('Gold')).toBeInTheDocument())
    fireEvent.click(screen.getByText('12 units.month_short'))

    await waitFor(() => expect(screen.getByText(price(7200))).toBeInTheDocument())
    expect(screen.getByText(`(${price(600)}units.per_month)`)).toBeInTheDocument()
  })

  it('выбор 6 месяцев считает месячную цену со скидкой 20%', async () => {
    mockFetch.mockImplementation(() => jsonResponse([{ ...goldTier, price: 1000 }]))

    renderDialog()

    await waitFor(() => expect(screen.getByText('Gold')).toBeInTheDocument())
    expect(screen.getByText(`${price(800)}units.per_month`)).toBeInTheDocument()
    expect(screen.getByText(`${price(600)}units.per_month`)).toBeInTheDocument()
  })

  it('переключение на другой тариф сбрасывает срок на 1 месяц', async () => {
    mockFetch.mockImplementation(() => jsonResponse([goldTier, platinumTier]))

    renderDialog()

    await waitFor(() => expect(screen.getByText('Platinum')).toBeInTheDocument())
    fireEvent.click(screen.getByText('12 units.month_short'))
    await waitFor(() => expect(screen.getByText(price(5033))).toBeInTheDocument())

    fireEvent.click(screen.getByText('Platinum'))
    await waitFor(() => expect(screen.getAllByText(price(1499)).length).toBeGreaterThan(0))
    expect(screen.getByText('Platinum · 1 units.month_short')).toBeInTheDocument()
  })

  it('клик по сроку не переключает тариф на родительский обработчик', async () => {
    mockFetch.mockImplementation(() => jsonResponse([goldTier, platinumTier]))

    renderDialog()

    await waitFor(() => expect(screen.getByText('Platinum')).toBeInTheDocument())
    fireEvent.click(screen.getByText('6 units.month_short'))

    await waitFor(() => expect(screen.getByText(price(3355))).toBeInTheDocument())
  })

  it('бейдж «лучший выбор» висит на втором тарифе', async () => {
    mockFetch.mockImplementation(() => jsonResponse([plusTier, goldTier]))

    renderDialog()

    await waitFor(() => expect(screen.getByText('premium.best_choice')).toBeInTheDocument())
  })

  it('покупка с url перенаправляет на оплату', async () => {
    mockFetch
      .mockImplementationOnce(() => jsonResponse([goldTier]))
      .mockImplementationOnce(() => jsonResponse({ url: 'https://checkout.stripe.com/test' }))

    renderDialog()

    await waitFor(() => expect(screen.getByText('Gold')).toBeInTheDocument())
    fireEvent.click(screen.getByText('premium.start_now'))

    await waitFor(() => expect(window.location.href).toBe('https://checkout.stripe.com/test'))
    expect(toastSuccessMock).not.toHaveBeenCalled()
  })

  it('покупка без url показывает успех и закрывает диалог', async () => {
    mockFetch
      .mockImplementationOnce(() => jsonResponse([goldTier]))
      .mockImplementationOnce(() => jsonResponse({}))

    renderDialog()

    await waitFor(() => expect(screen.getByText('Gold')).toBeInTheDocument())
    fireEvent.click(screen.getByText('premium.start_now'))

    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith('premium.activated'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('покупка отправляет выбранные тариф и срок', async () => {
    mockFetch
      .mockImplementationOnce(() => jsonResponse([goldTier]))
      .mockImplementationOnce(() => jsonResponse({}))

    renderDialog()

    await waitFor(() => expect(screen.getByText('Gold')).toBeInTheDocument())
    fireEvent.click(screen.getByText('6 units.month_short'))
    fireEvent.click(screen.getByText('premium.start_now'))

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/premium/create-checkout', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ tier: 'gold', duration_months: 6 }),
    })))
  })

  it('отказ STRIPE_NOT_CONFIGURED показывает premium.stripe_unavailable', async () => {
    mockFetch
      .mockImplementationOnce(() => jsonResponse([goldTier]))
      .mockImplementationOnce(() => jsonResponse({ code: 'STRIPE_NOT_CONFIGURED', message: 'Stripe is not configured' }, 503))

    renderDialog()

    await waitFor(() => expect(screen.getByText('Gold')).toBeInTheDocument())
    fireEvent.click(screen.getByText('premium.start_now'))

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('premium.stripe_unavailable'))
  })

  it('прочий отказ сервера показывает premium.error, а не сырое сообщение', async () => {
    mockFetch
      .mockImplementationOnce(() => jsonResponse([goldTier]))
      .mockImplementationOnce(() => jsonResponse({ message: 'Some English text' }, 400))

    renderDialog()

    await waitFor(() => expect(screen.getByText('Gold')).toBeInTheDocument())
    fireEvent.click(screen.getByText('premium.start_now'))

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('premium.error'))
  })

  it('сетевая ошибка оплаты показывает premium.error', async () => {
    mockFetch
      .mockImplementationOnce(() => jsonResponse([goldTier]))
      .mockImplementationOnce(() => Promise.reject(new Error('Failed to fetch')))

    renderDialog()

    await waitFor(() => expect(screen.getByText('Gold')).toBeInTheDocument())
    fireEvent.click(screen.getByText('premium.start_now'))

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('premium.error'))
  })

  it('нечитаемый ответ оплаты не выводит английский SyntaxError', async () => {
    mockFetch
      .mockImplementationOnce(() => jsonResponse([goldTier]))
      .mockImplementationOnce(() => Promise.resolve({ ok: false, status: 502, json: () => Promise.reject(new Error('bad')) } as Response))

    renderDialog()

    await waitFor(() => expect(screen.getByText('Gold')).toBeInTheDocument())
    fireEvent.click(screen.getByText('premium.start_now'))

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('premium.error'))
  })

  it('закрытый диалог не запрашивает тарифы', async () => {
    mockFetch.mockImplementation(() => jsonResponse([goldTier]))

    render(<PremiumDialog open={false} onOpenChange={onOpenChange} />)

    expect(mockFetch).not.toHaveBeenCalled()
  })
})
