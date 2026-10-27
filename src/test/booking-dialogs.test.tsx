import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { HotelBookingDialog } from '@/components/chat/hotel-booking-dialog'
import { SpaBookingDialog } from '@/components/chat/spa-booking-dialog'

const mockT = (key: string) => key
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t: mockT }),
}))

const getTokenMock = vi.hoisted(() => vi.fn(() => 'mock-token'))
vi.mock('@/lib/token', () => ({
  getToken: getTokenMock,
}))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const hotelOffer = {
  id: 11,
  partner_name: 'Отель Ривьера',
  category: 'hotel',
  title: 'Люкс с видом на море',
  price: 12000,
}

const spaOffer = {
  id: 22,
  partner_name: 'Спа-центр',
  category: 'spa',
  title: 'Массаж спины',
  price: 3500,
}

const okJson = (body: unknown = {}) => ({ ok: true, json: async () => body })
const failJson = (body: unknown = {}) => ({ ok: false, json: async () => body })
const emptyBody = () => ({
  ok: true,
  json: async () => {
    throw new SyntaxError('Unexpected end of JSON input')
  },
})

const failHtml = () => ({
  ok: false,
  json: async () => {
    throw new SyntaxError('Unexpected token < in JSON at position 0')
  },
})

describe('HotelBookingDialog', () => {
  const onOpenChange = vi.fn()
  let openSpy: { mockRestore: () => void }

  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock.mockReset()
    getTokenMock.mockReset()
    getTokenMock.mockReturnValue('mock-token')
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
  })

  afterEach(() => {
    openSpy.mockRestore()
  })

  const renderHotel = (open = true) =>
    render(<HotelBookingDialog offer={hotelOffer} open={open} onOpenChange={onOpenChange} />)

  const fillDates = () => {
    fireEvent.change(screen.getByTestId('hotel-checkin'), { target: { value: '2026-11-10' } })
    fireEvent.change(screen.getByTestId('hotel-checkout'), { target: { value: '2026-11-12' } })
  }

  it('показывает название отеля и гостей по умолчанию', () => {
    renderHotel()
    expect(screen.getByText('partner.hotel.title')).toBeInTheDocument()
    expect(screen.getByText('Люкс с видом на море')).toBeInTheDocument()
    expect(screen.getByTestId('hotel-guests')).toHaveValue(2)
  })

  it('без дат показывает ошибку и не идёт в сеть', () => {
    renderHotel()
    fireEvent.click(screen.getByTestId('confirm-hotel-booking'))
    expect(screen.getByText('partner.hotel.fill_required')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('выезд не позже заезда — ошибка без запроса', () => {
    renderHotel()
    fireEvent.change(screen.getByTestId('hotel-checkin'), { target: { value: '2026-11-12' } })
    fireEvent.change(screen.getByTestId('hotel-checkout'), { target: { value: '2026-11-12' } })
    fireEvent.click(screen.getByTestId('confirm-hotel-booking'))
    expect(screen.getByText('partner.hotel.checkout_after_checkin')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('гости вне диапазона 1–10 — ошибка без запроса', () => {
    renderHotel()
    fillDates()
    for (const value of ['0', '11', '', '2.5']) {
      fireEvent.change(screen.getByTestId('hotel-guests'), { target: { value } })
      fireEvent.click(screen.getByTestId('confirm-hotel-booking'))
      expect(screen.getByText('partner.hotel.guests_range')).toBeInTheDocument()
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('успешная бронь: полное тело, Bearer, deeplink и закрытие', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ deeplink: 'https://hotel.example/b/1' }))
    renderHotel()
    fillDates()
    fireEvent.change(screen.getByTestId('hotel-guests'), { target: { value: '4' } })
    fireEvent.click(screen.getByTestId('confirm-hotel-booking'))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(openSpy).toHaveBeenCalledWith('https://hotel.example/b/1', '_blank', 'noopener')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/partners/hotel/book')
    expect(JSON.parse(String(init.body))).toEqual({
      offer_id: 11,
      check_in: '2026-11-10',
      check_out: '2026-11-12',
      guests: 4,
    })
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer mock-token')
  })

  it('успех без deeplink: окно не открывается, диалог закрывается', async () => {
    fetchMock.mockResolvedValueOnce(okJson({}))
    renderHotel()
    fillDates()
    fireEvent.click(screen.getByTestId('confirm-hotel-booking'))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('пустое тело успешного ответа не ломает закрытие', async () => {
    fetchMock.mockResolvedValueOnce(emptyBody())
    renderHotel()
    fillDates()
    fireEvent.click(screen.getByTestId('confirm-hotel-booking'))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(screen.queryByText('partner.hotel.error')).toBeNull()
  })

  it('отказ сервера показывает локализованный текст, а не английский message', async () => {
    fetchMock.mockResolvedValueOnce(failJson({ message: 'Hotel offer not found' }))
    renderHotel()
    fillDates()
    fireEvent.click(screen.getByTestId('confirm-hotel-booking'))

    expect(await screen.findByText('partner.hotel.error')).toBeInTheDocument()
    expect(screen.queryByText('Hotel offer not found')).toBeNull()
    expect(screen.getByTestId('confirm-hotel-booking')).not.toBeDisabled()
  })

  it('HTML вместо JSON (nginx 502) — локализованная ошибка без технического текста', async () => {
    fetchMock.mockResolvedValueOnce(failHtml())
    renderHotel()
    fillDates()
    fireEvent.click(screen.getByTestId('confirm-hotel-booking'))

    expect(await screen.findByText('partner.hotel.error')).toBeInTheDocument()
    expect(screen.queryByText(/Unexpected token/)).toBeNull()
  })

  it('сетевой сбой — локализованная ошибка', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    renderHotel()
    fillDates()
    fireEvent.click(screen.getByTestId('confirm-hotel-booking'))

    expect(await screen.findByText('partner.hotel.error')).toBeInTheDocument()
    expect(screen.queryByText('Failed to fetch')).toBeNull()
  })

  it('без токена запрос уходит без Authorization', async () => {
    getTokenMock.mockReturnValueOnce('')
    fetchMock.mockResolvedValueOnce(okJson({}))
    renderHotel()
    fillDates()
    fireEvent.click(screen.getByTestId('confirm-hotel-booking'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers.Authorization).toBeUndefined()
  })

  it('при повторном открытии прошлая ошибка сбрасывается', async () => {
    fetchMock.mockResolvedValueOnce(failJson({ message: 'nope' }))
    const { rerender } = renderHotel()
    fillDates()
    fireEvent.click(screen.getByTestId('confirm-hotel-booking'))
    expect(await screen.findByText('partner.hotel.error')).toBeInTheDocument()

    rerender(<HotelBookingDialog offer={hotelOffer} open={false} onOpenChange={onOpenChange} />)
    rerender(<HotelBookingDialog offer={hotelOffer} open={true} onOpenChange={onOpenChange} />)
    expect(screen.queryByText('partner.hotel.error')).toBeNull()
  })
})

describe('SpaBookingDialog', () => {
  const onOpenChange = vi.fn()
  let openSpy: { mockRestore: () => void }

  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock.mockReset()
    getTokenMock.mockReset()
    getTokenMock.mockReturnValue('mock-token')
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
  })

  afterEach(() => {
    openSpy.mockRestore()
  })

  const renderSpa = (props: { chatId?: number; open?: boolean; onShared?: () => void } = {}) =>
    render(
      <SpaBookingDialog
        offer={spaOffer}
        chatId={props.chatId}
        open={props.open ?? true}
        onOpenChange={onOpenChange}
        onShared={props.onShared}
      />
    )

  const fillDate = () =>
    fireEvent.change(screen.getByTestId('spa-date'), { target: { value: '2026-12-31' } })

  it('показывает название, цену и блокирует кнопку до выбора даты', () => {
    renderSpa()
    expect(screen.getByText('partner.spa.title')).toBeInTheDocument()
    expect(screen.getByText('Массаж спины')).toBeInTheDocument()
    expect(screen.getByText(/3\s?500/)).toBeInTheDocument()
    expect(screen.getByTestId('spa-book')).toBeDisabled()
    fillDate()
    expect(screen.getByTestId('spa-book')).not.toBeDisabled()
  })

  it('без цены блок стоимости не рисуется', () => {
    render(
      <SpaBookingDialog
        offer={{ ...spaOffer, price: undefined }}
        open={true}
        onOpenChange={onOpenChange}
      />
    )
    expect(screen.queryByText(/partner\.spa\.price/)).toBeNull()
  })

  it('успешная запись без chatId: одно сетевое обращение и deeplink', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ deeplink: 'https://spa.example/b/1' }))
    renderSpa()
    fillDate()
    fireEvent.change(screen.getByTestId('spa-time'), { target: { value: '15:30' } })
    fireEvent.click(screen.getByTestId('spa-book'))

    await waitFor(() => expect(openSpy).toHaveBeenCalledWith('https://spa.example/b/1', '_blank', 'noopener'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/partners/spa/book')
    expect(JSON.parse(String(init.body))).toEqual({ offer_id: 22, date: '2026-12-31', time: '15:30' })
    expect(screen.queryByText('partner.spa.shared')).toBeNull()
  })

  it('с chatId делится бронью в чат и показывает подтверждение', async () => {
    const onShared = vi.fn()
    fetchMock.mockResolvedValueOnce(okJson({}))
    fetchMock.mockResolvedValueOnce(okJson({ shared: true }))
    renderSpa({ chatId: 42, onShared })
    fillDate()
    fireEvent.click(screen.getByTestId('spa-book'))

    expect(await screen.findByText('partner.spa.shared')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(onShared).toHaveBeenCalledTimes(1)
    const [shareUrl, shareInit] = fetchMock.mock.calls[1]
    expect(shareUrl).toBe('/api/partners/booking/share')
    expect(JSON.parse(String(shareInit.body))).toEqual({
      chat_id: 42,
      offer_id: 22,
      date: '2026-12-31',
      time: '12:00',
      message: 'Массаж спины — 2026-12-31 12:00',
    })

    fireEvent.click(screen.getByText('partner.spa.close'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('отказ share не выдаётся за успех: ошибка вместо «отправлено»', async () => {
    const onShared = vi.fn()
    fetchMock.mockResolvedValueOnce(okJson({ deeplink: 'https://spa.example/b/1' }))
    fetchMock.mockResolvedValueOnce(failJson({ message: 'Restaurant not found' }))
    renderSpa({ chatId: 42, onShared })
    fillDate()
    fireEvent.click(screen.getByTestId('spa-book'))

    expect(await screen.findByText('partner.spa.share_error')).toBeInTheDocument()
    expect(screen.queryByText('partner.spa.shared')).toBeNull()
    expect(openSpy).toHaveBeenCalledWith('https://spa.example/b/1', '_blank', 'noopener')
    expect(onShared).not.toHaveBeenCalled()
  })

  it('отказ записи (404) — локализованная ошибка', async () => {
    fetchMock.mockResolvedValueOnce(failJson({ message: 'Spa/fitness offer not found' }))
    renderSpa()
    fillDate()
    fireEvent.click(screen.getByTestId('spa-book'))

    expect(await screen.findByText('partner.spa.error')).toBeInTheDocument()
    expect(screen.queryByText('Spa/fitness offer not found')).toBeNull()
  })

  it('ответ не JSON (500 от прокси) — локализованная ошибка', async () => {
    fetchMock.mockResolvedValueOnce(failHtml())
    renderSpa()
    fillDate()
    fireEvent.click(screen.getByTestId('spa-book'))

    expect(await screen.findByText('partner.spa.error')).toBeInTheDocument()
    expect(screen.queryByText(/Unexpected token/)).toBeNull()
  })

  it('пустое тело успешного ответа не роняет диалог', async () => {
    fetchMock.mockResolvedValueOnce(emptyBody())
    renderSpa()
    fillDate()
    fireEvent.click(screen.getByTestId('spa-book'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('partner.spa.error')).toBeNull()
    expect(screen.queryByText('partner.spa.shared')).toBeNull()
  })

  it('сетевой сбой строкой — локализованная ошибка', async () => {
    fetchMock.mockRejectedValueOnce('boom')
    renderSpa()
    fillDate()
    fireEvent.click(screen.getByTestId('spa-book'))

    expect(await screen.findByText('partner.spa.error')).toBeInTheDocument()
  })

  it('повторное открытие сбрасывает экран «отправлено»', async () => {
    fetchMock.mockResolvedValueOnce(okJson({}))
    fetchMock.mockResolvedValueOnce(okJson({ shared: true }))
    const { rerender } = renderSpa({ chatId: 42 })
    fillDate()
    fireEvent.click(screen.getByTestId('spa-book'))
    expect(await screen.findByText('partner.spa.shared')).toBeInTheDocument()

    rerender(
      <SpaBookingDialog offer={spaOffer} chatId={42} open={false} onOpenChange={onOpenChange} />
    )
    rerender(
      <SpaBookingDialog offer={spaOffer} chatId={42} open={true} onOpenChange={onOpenChange} />
    )
    expect(screen.queryByText('partner.spa.shared')).toBeNull()
    expect(screen.getByTestId('spa-book')).toBeInTheDocument()
  })
})
