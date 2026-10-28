import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { FlowerOrderDialog } from '@/components/chat/flower-order-dialog'

const baseOffer = {
  id: 8,
  partner_name: 'Flowwow',
  category: 'flowers',
  title: 'Букет роз',
  description: 'Красные розы 25 штук',
  price: 2500,
}

const mockT = (key: string) => key
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t: mockT }),
}))

const getTokenMock = vi.hoisted(() => vi.fn((): string | null => 'mock-token'))
vi.mock('@/lib/token', () => ({
  getToken: getTokenMock,
}))

const toastMock = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/use-toast', () => ({
  toast: toastMock,
}))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const openMock = vi.fn()

function okOrder(body: Record<string, unknown> = {}) {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  })
}

function failOrder(status = 400, body: Record<string, unknown> = { message: 'Failed to create order' }) {
  fetchMock.mockResolvedValueOnce({
    ok: false,
    status,
    json: () => Promise.resolve(body),
  })
}

function renderDialog(offer: Record<string, unknown> = baseOffer, onOpenChange = vi.fn()) {
  render(<FlowerOrderDialog offer={offer} open={true} onOpenChange={onOpenChange} />)
  return onOpenChange
}

function fillRecipient(name = 'Аня', address = 'Москва, ул. Ленина 1') {
  fireEvent.change(screen.getByTestId('recipient-name'), { target: { value: name } })
  fireEvent.change(screen.getByTestId('recipient-address'), { target: { value: address } })
}

async function goToConfirmAndPay() {
  fillRecipient()
  fireEvent.click(screen.getByTestId('proceed-to-confirm'))
  fireEvent.click(screen.getByTestId('confirm-order'))
}

describe('FlowerOrderDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock.mockReset()
    getTokenMock.mockReturnValue('mock-token')
    openMock.mockReset()
    vi.spyOn(window, 'open').mockImplementation(openMock)
    const locationMock = { href: 'http://localhost:3000/' }
    Object.defineProperty(window, 'location', {
      value: locationMock,
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders details step with offer info', () => {
    renderDialog()
    expect(screen.getByText('partner.order.title')).toBeInTheDocument()
    expect(screen.getByText('Букет роз')).toBeInTheDocument()
    expect(screen.getByText(/2[\s\u00a0]?500.*₽/)).toBeInTheDocument()
  })

  it('скрывает цену, если она не задана', () => {
    renderDialog({ ...baseOffer, price: null })
    expect(screen.queryByText(/₽/)).not.toBeInTheDocument()
  })

  it('форматирует цену-строку как число', () => {
    renderDialog({ ...baseOffer, price: '12500.50' })
    expect(screen.getByText(/12[\s\u00a0]?500.*₽/)).toBeInTheDocument()
  })

  it('shows validation error when name/address empty', () => {
    renderDialog()
    fireEvent.click(screen.getByTestId('proceed-to-confirm'))
    expect(screen.getByText('partner.order.fill_required')).toBeInTheDocument()
    expect(screen.getByTestId('recipient-name')).toBeInTheDocument()
  })

  it('не пускает дальше, если заполнено только имя или только адрес', () => {
    renderDialog()
    fireEvent.change(screen.getByTestId('recipient-name'), { target: { value: 'Аня' } })
    fireEvent.click(screen.getByTestId('proceed-to-confirm'))
    expect(screen.getByText('partner.order.fill_required')).toBeInTheDocument()

    fireEvent.change(screen.getByTestId('recipient-name'), { target: { value: '   ' } })
    fireEvent.change(screen.getByTestId('recipient-address'), { target: { value: 'Москва' } })
    fireEvent.click(screen.getByTestId('proceed-to-confirm'))
    expect(screen.getByText('partner.order.fill_required')).toBeInTheDocument()
    expect(screen.queryByText('partner.order.confirm')).not.toBeInTheDocument()
  })

  it('moves to confirm step when fields filled and hides gift quote', () => {
    renderDialog()
    fillRecipient()
    fireEvent.click(screen.getByTestId('proceed-to-confirm'))

    expect(screen.getByText('partner.order.confirm')).toBeInTheDocument()
    expect(screen.getByText(/Аня/)).toBeInTheDocument()
    expect(screen.getByText('Москва, ул. Ленина 1')).toBeInTheDocument()
    expect(screen.queryByText(/«|"/)).not.toBeInTheDocument()
  })

  it('показывает открытку в кавычках на шаге подтверждения', () => {
    renderDialog()
    fillRecipient()
    fireEvent.change(screen.getByTestId('gift-message'), { target: { value: 'С любовью' } })
    fireEvent.click(screen.getByTestId('proceed-to-confirm'))

    expect(screen.getByText('"С любовью"')).toBeInTheDocument()
  })

  it('скрывает цену на шаге подтверждения, если её нет', () => {
    renderDialog({ ...baseOffer, price: null })
    fillRecipient()
    fireEvent.click(screen.getByTestId('proceed-to-confirm'))

    expect(screen.getByText('partner.order.confirm')).toBeInTheDocument()
    expect(screen.queryByText(/₽/)).not.toBeInTheDocument()
  })

  it('goes back from confirm step and keeps the entered data', () => {
    renderDialog()
    fillRecipient('Аня', 'Москва')
    fireEvent.click(screen.getByTestId('proceed-to-confirm'))
    fireEvent.click(screen.getByText('partner.order.back'))

    expect((screen.getByTestId('recipient-name') as HTMLInputElement).value).toBe('Аня')
    expect((screen.getByTestId('recipient-address') as HTMLTextAreaElement).value).toBe('Москва')
  })

  it('после успешной оплаты со ссылкой уводит на Stripe и не закрывает диалог', async () => {
    okOrder({ url: 'https://checkout.stripe.com/test' })
    const onOpenChange = renderDialog()
    await goToConfirmAndPay()

    await waitFor(() => expect(window.location.href).toBe('https://checkout.stripe.com/test'))
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(openMock).not.toHaveBeenCalled()
  })

  it('в mock-режиме открывает deeplink партнёра, показывает успех и закрывает диалог', async () => {
    okOrder({ message: 'Order created (mock)', orderId: 'mock_1', deeplink: 'https://flowwow.com/order/1' })
    const onOpenChange = renderDialog()
    await goToConfirmAndPay()

    await waitFor(() => expect(openMock).toHaveBeenCalledWith('https://flowwow.com/order/1', '_blank', 'noopener'))
    expect(toastMock).toHaveBeenCalledWith({
      title: 'partner.order.success_title',
      description: 'partner.order.success_desc',
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('без url и deeplink показывает успех и закрывает диалог', async () => {
    okOrder({ message: 'Order created (mock)', orderId: 'mock_2' })
    const onOpenChange = renderDialog()
    await goToConfirmAndPay()

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(openMock).not.toHaveBeenCalled()
    expect(toastMock).toHaveBeenCalledWith({
      title: 'partner.order.success_title',
      description: 'partner.order.success_desc',
    })
  })

  it('отправляет обрезанные имя, адрес и открытку с Bearer-токеном', async () => {
    okOrder({ url: 'https://checkout.stripe.com/test' })
    renderDialog()
    fillRecipient('  Аня  ', '  Москва, ул. Ленина 1  ')
    fireEvent.change(screen.getByTestId('gift-message'), { target: { value: '  С любовью  ' } })
    fireEvent.click(screen.getByTestId('proceed-to-confirm'))
    fireEvent.click(screen.getByTestId('confirm-order'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith('/api/partners/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock-token' },
      body: JSON.stringify({
        offer_id: 8,
        recipient_name: 'Аня',
        recipient_address: 'Москва, ул. Ленина 1',
        gift_message: 'С любовью',
      }),
    })
  })

  it('пустая открытка не уходит на сервер', async () => {
    okOrder({ url: 'https://checkout.stripe.com/test' })
    renderDialog()
    fillRecipient()
    fireEvent.change(screen.getByTestId('gift-message'), { target: { value: '   ' } })
    fireEvent.click(screen.getByTestId('proceed-to-confirm'))
    fireEvent.click(screen.getByTestId('confirm-order'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body).not.toHaveProperty('gift_message')
  })

  it('без токена не отправляет Authorization', async () => {
    getTokenMock.mockReturnValue(null)
    okOrder({ url: 'https://checkout.stripe.com/test' })
    renderDialog()
    await goToConfirmAndPay()

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toEqual({ 'Content-Type': 'application/json' })
  })

  it('отказ сервера показывает переведённую ошибку, а не английский message', async () => {
    failOrder(400, { message: 'This offer has no price set' })
    const onOpenChange = renderDialog()
    await goToConfirmAndPay()

    await waitFor(() => expect(screen.getByText('partner.order.error')).toBeInTheDocument())
    expect(screen.queryByText('This offer has no price set')).not.toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('не-JSON тело ошибки не показывает сырой SyntaxError', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON at position 0')),
    })
    renderDialog()
    await goToConfirmAndPay()

    await waitFor(() => expect(screen.getByText('partner.order.error')).toBeInTheDocument())
    expect(screen.queryByText(/Unexpected token/)).not.toBeInTheDocument()
  })

  it('сетевой сбой показывает переведённую ошибку', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Network down'))
    renderDialog()
    await goToConfirmAndPay()

    await waitFor(() => expect(screen.getByText('partner.order.error')).toBeInTheDocument())
    expect(screen.queryByText('Network down')).not.toBeInTheDocument()
  })

  it('пока запрос в полёте кнопки выключены и виден спиннер', async () => {
    fetchMock.mockReturnValueOnce(new Promise(() => {}))
    renderDialog()
    await goToConfirmAndPay()

    await waitFor(() => expect(screen.getByTestId('confirm-order')).toBeDisabled())
    expect(screen.getByText('partner.order.back').closest('button')).toBeDisabled()
    expect(screen.getByText('partner.order.pay')).toBeInTheDocument()
  })

  it('после отказа кнопки снова активны', async () => {
    failOrder()
    renderDialog()
    await goToConfirmAndPay()

    await waitFor(() => expect(screen.getByText('partner.order.error')).toBeInTheDocument())
    expect(screen.getByTestId('confirm-order')).not.toBeDisabled()
    expect(screen.getByText('partner.order.back').closest('button')).not.toBeDisabled()
  })
})
