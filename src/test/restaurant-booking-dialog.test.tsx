import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RestaurantBookingDialog } from '@/components/chat/restaurant-booking-dialog'

const mockOffer = {
  id: 3,
  partner_name: 'Restoclub',
  category: 'restaurant',
  title: 'Ужин на двоих',
  description: 'Итальянская кухня',
  price: 3000,
}

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

describe('RestaurantBookingDialog', () => {
  const onOpenChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock.mockReset()
    getTokenMock.mockReset()
    getTokenMock.mockReturnValue('mock-token')
  })

  const fillDate = () => fireEvent.change(screen.getByTestId('booking-date'), { target: { value: '2026-12-31' } })

  it('renders booking form with offer info', () => {
    render(<RestaurantBookingDialog offer={mockOffer} open={true} onOpenChange={onOpenChange} />)
    expect(screen.getByText('partner.booking.title')).toBeInTheDocument()
    expect(screen.getByText('Ужин на двоих')).toBeInTheDocument()
  })

  it('shows validation error when date/time empty', () => {
    render(<RestaurantBookingDialog offer={mockOffer} open={true} onOpenChange={onOpenChange} />)
    fireEvent.click(screen.getByTestId('confirm-booking'))
    expect(screen.getByText('partner.booking.fill_required')).toBeInTheDocument()
  })

  it('renders date, time, guests inputs', () => {
    render(<RestaurantBookingDialog offer={mockOffer} open={true} onOpenChange={onOpenChange} />)
    expect(screen.getByTestId('booking-date')).toBeInTheDocument()
    expect(screen.getByTestId('booking-time')).toBeInTheDocument()
    expect(screen.getByTestId('booking-guests')).toBeInTheDocument()
  })

  it('books without chatId: spinner during request, full payload, deeplink via window.open', async () => {
    let resolveBook: (value: unknown) => void = () => {}
    fetchMock.mockReturnValueOnce(new Promise((res) => { resolveBook = res }))
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(<RestaurantBookingDialog offer={mockOffer} open={true} onOpenChange={onOpenChange} />)
    fireEvent.change(screen.getByTestId('booking-date'), { target: { value: '2026-12-31' } })
    fireEvent.change(screen.getByTestId('booking-time'), { target: { value: '20:30' } })
    fireEvent.change(screen.getByTestId('booking-guests'), { target: { value: '4' } })
    fireEvent.change(screen.getByTestId('booking-message'), { target: { value: 'Без глютена' } })
    fireEvent.click(screen.getByTestId('confirm-booking'))
    const pendingBtn = screen.getByTestId('confirm-booking')
    expect(pendingBtn).toBeDisabled()
    expect(pendingBtn.querySelector('.animate-spin')).toBeTruthy()
    resolveBook({ ok: true, json: async () => ({ deeplink: 'https://book.example/b1' }) })
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith('https://book.example/b1', '_blank', 'noopener'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const init = fetchMock.mock.calls[0][1] as RequestInit
    const body = JSON.parse(String(init.body))
    expect(body).toMatchObject({ offer_id: 3, date: '2026-12-31', time: '20:30', guests: 4, message: 'Без глютена' })
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer mock-token')
    await waitFor(() => expect(screen.getByTestId('confirm-booking')).not.toBeDisabled())
    expect(screen.queryByText('partner.booking.shared')).toBeNull()
    openSpy.mockRestore()
  })

  it('shares booking into chat with message and closes via partner.close', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    render(<RestaurantBookingDialog offer={mockOffer} chatId={42} open={true} onOpenChange={onOpenChange} />)
    fillDate()
    fireEvent.change(screen.getByTestId('booking-message'), { target: { value: 'Столик у окна' } })
    fireEvent.click(screen.getByTestId('confirm-booking'))
    expect(await screen.findByText('partner.booking.shared')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const shareBody = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))
    expect(shareBody).toMatchObject({ chat_id: 42, offer_id: 3, message: 'Столик у окна' })
    fireEvent.click(screen.getByText('partner.close'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('shares booking without message: message dropped from both payloads', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    render(<RestaurantBookingDialog offer={mockOffer} chatId={42} open={true} onOpenChange={onOpenChange} />)
    fillDate()
    fireEvent.click(screen.getByTestId('confirm-booking'))
    expect(await screen.findByText('partner.booking.shared')).toBeInTheDocument()
    const bookBody = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(bookBody.message).toBeUndefined()
    const shareBody = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))
    expect(shareBody.message).toBeUndefined()
  })

  it('server rejects with message: shows server message', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ message: 'Нет свободных столов' }) })
    render(<RestaurantBookingDialog offer={mockOffer} open={true} onOpenChange={onOpenChange} />)
    fillDate()
    fireEvent.click(screen.getByTestId('confirm-booking'))
    expect(await screen.findByText('Нет свободных столов')).toBeInTheDocument()
    expect(screen.getByTestId('confirm-booking')).not.toBeDisabled()
  })

  it('server rejects without message: falls back to Booking failed', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) })
    render(<RestaurantBookingDialog offer={mockOffer} open={true} onOpenChange={onOpenChange} />)
    fillDate()
    fireEvent.click(screen.getByTestId('confirm-booking'))
    expect(await screen.findByText('Booking failed')).toBeInTheDocument()
  })

  it('non-Error rejection: shows i18n fallback error text', async () => {
    fetchMock.mockRejectedValueOnce('boom')
    render(<RestaurantBookingDialog offer={mockOffer} open={true} onOpenChange={onOpenChange} />)
    fillDate()
    fireEvent.click(screen.getByTestId('confirm-booking'))
    expect(await screen.findByText('partner.booking.error')).toBeInTheDocument()
  })

  it('without token: request goes without Authorization header', async () => {
    getTokenMock.mockReturnValueOnce('')
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    render(<RestaurantBookingDialog offer={mockOffer} open={true} onOpenChange={onOpenChange} />)
    fillDate()
    fireEvent.click(screen.getByTestId('confirm-booking'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers.Authorization).toBeUndefined()
  })
})
