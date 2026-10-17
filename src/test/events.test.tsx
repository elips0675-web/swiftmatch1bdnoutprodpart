import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

const tokenState = { value: 'test-token' as string | null }
vi.mock('@/lib/token', () => ({ getToken: () => tokenState.value }))

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t: (key: string) => key, language: 'RU', setLanguage: vi.fn() }),
}))

vi.mock('@/components/layout/app-header', () => ({
  AppHeader: () => <div data-testid="app-header" />,
}))

vi.mock('@/components/navigation/bottom-nav', () => ({
  BottomNav: () => <div data-testid="bottom-nav" />,
}))

import EventsPage from '@/pages/events'
import { formatEventDate } from '@/lib/hangouts'

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response)
}

const baseEvent = {
  id: 7,
  partner_id: 1,
  category: 'cinema',
  title: 'Ночь кино',
  description: 'Показ классики',
  poster_url: null,
  price: 1200,
  city: 'Москва',
  location: 'Кинотеатр Аврора',
  event_start: '2026-11-05T18:00:00.000Z',
  event_end: null,
  event_url: null,
  capacity: 50,
  tickets_sold: 10,
  remaining: 40,
  sold_out: false,
  partner_name: 'Аврора',
  my_ticket: null,
}

function priceText(value: number) {
  // toLocaleString('ru-RU') разделяет разряды NBSP, а getByText нормализует пробелы только в node-тексте.
  return value.toLocaleString('ru-RU').replace(/\u00a0/g, ' ') + ' ₽'
}

function renderPage() {
  return render(<EventsPage />)
}

describe('Страница events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
    tokenState.value = 'test-token'
  })

  it('показывает индикатор загрузки, пока запрос не завершился', () => {
    mockFetch.mockImplementation(() => new Promise(() => {}))

    render(<EventsPage />)

    expect(screen.getByTestId('events-loading')).toBeInTheDocument()
    expect(screen.getByTestId('app-header')).toBeInTheDocument()
    expect(screen.getByTestId('bottom-nav')).toBeInTheDocument()
  })

  it('рисует карточку события по полям API и не показывает лишнего', async () => {
    mockFetch.mockImplementation(() => jsonResponse([baseEvent]))

    render(<EventsPage />)

    await waitFor(() => expect(screen.getByTestId('event-card-7')).toBeInTheDocument())

    expect(mockFetch).toHaveBeenCalledWith('/api/events', { headers: { Authorization: 'Bearer test-token' } })
    expect(screen.getByText('Ночь кино')).toBeInTheDocument()
    expect(screen.getByText('Показ классики')).toBeInTheDocument()
    expect(screen.getByText('Аврора')).toBeInTheDocument()
    expect(screen.getByText('cinema')).toBeInTheDocument()
    expect(screen.getByTestId('event-date-7')).toHaveTextContent(formatEventDate(baseEvent.event_start))
    expect(screen.getByText('Кинотеатр Аврора, Москва')).toBeInTheDocument()
    expect(screen.getByText('events.remaining')).toBeInTheDocument()
    expect(screen.getByText(priceText(1200))).toBeInTheDocument()
    expect(screen.getByText('events.buy')).toBeInTheDocument()
    expect(screen.queryByTestId('event-bought-7')).toBeNull()
  })

  it('пустой ответ показывает заглушку, а не список', async () => {
    mockFetch.mockImplementation(() => jsonResponse([]))

    render(
      <EventsPage />,
    )
    await waitFor(() => expect(screen.getByTestId('events-empty')).toBeInTheDocument())

    expect(screen.getByText('events.empty')).toBeInTheDocument()
  })

  it('без токена запрос уходит без заголовка Authorization', async () => {
    tokenState.value = null
    mockFetch.mockImplementation(() => jsonResponse([]))

    render(<EventsPage />)
    await waitFor(() => expect(screen.getByTestId('events-empty')).toBeInTheDocument())

    expect(mockFetch).toHaveBeenCalledWith('/api/events', { headers: {} })
  })

  it('поиск фильтрует карточки по городу', async () => {
    mockFetch.mockImplementation(() => jsonResponse([baseEvent, { ...baseEvent, id: 8, title: 'Лекция', city: 'Питер' }]))

    render(<EventsPage />)
    await waitFor(() => expect(screen.getByTestId('event-card-7')).toBeInTheDocument())
    expect(screen.getByTestId('event-card-8')).toBeInTheDocument()

    fireEvent.change(screen.getByTestId('events-search'), { target: { value: 'питер' } })

    expect(screen.queryByTestId('event-card-7')).toBeNull()
    expect(screen.getByTestId('event-card-8')).toBeInTheDocument()
  })

  it('покупка mock-билета: POST по id события и перезагрузка списка', async () => {
    mockFetch.mockImplementation((url: string) =>
      url === '/api/events' ? jsonResponse([baseEvent]) : jsonResponse({ mock: true }),
    )

    render(<EventsPage />)
    await waitFor(() => expect(screen.getByTestId('event-buy-7')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('event-buy-7'))

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/events/7/purchase', expect.objectContaining({ method: 'POST' })))
    await waitFor(() => {
      expect(mockFetch.mock.calls.filter((c) => c[0] === '/api/events')).toHaveLength(2)
    })
  })

  it('409 ALREADY_PURCHASED просто перезагружает список', async () => {
    mockFetch.mockImplementation((url: string) =>
      url === '/api/events' ? jsonResponse([baseEvent]) : jsonResponse({ code: 'ALREADY_PURCHASED' }, 409),
    )

    render(<EventsPage />)
    await waitFor(() => expect(screen.getByTestId('event-buy-7')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('event-buy-7'))

    await waitFor(() => {
      const calls = mockFetch.mock.calls.filter((c) => c[0] === '/api/events')
      expect(calls.length).toBe(2)
    })
  })

  it('купленный билет показывает бейдж и заблокированную кнопку вместо покупки', async () => {
    mockFetch.mockImplementation(() => jsonResponse([{ ...baseEvent, my_ticket: { id: 3, status: 'paid' } }]))

    render(<EventsPage />)
    await waitFor(() => expect(screen.getByTestId('event-bought-7')).toBeInTheDocument())

    expect(screen.getByText('events.purchased')).toBeInTheDocument()
    expect(screen.getByText('events.ticket_bought')).toBeDisabled()
    expect(screen.queryByTestId('event-buy-7')).toBeNull()
  })

  it('распроданное событие показывает бейдж и отключённую кнопку', async () => {
    mockFetch.mockImplementation(() => jsonResponse([{ ...baseEvent, sold_out: true, remaining: 0 }]))

    render(<EventsPage />)
    await waitFor(() => expect(screen.getByTestId('event-card-7')).toBeInTheDocument())

    expect(screen.getAllByText('events.sold_out')).toHaveLength(2)
    expect(screen.queryByTestId('event-buy-7')).toBeNull()
  })
})
