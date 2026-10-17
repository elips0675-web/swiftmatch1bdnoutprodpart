import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import React from 'react'

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t: (key: string) => key, language: 'RU', setLanguage: vi.fn() }),
}))

import SafetyPage from '@/pages/safety'

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response)
}

let contactsData: unknown[] = []
let checkinsData: unknown[] = []

function installFetch() {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (url === '/api/checkin/contacts' && method === 'GET') return jsonResponse(contactsData)
    if (url === '/api/checkin/active') return jsonResponse(checkinsData)
    return jsonResponse({ ok: true })
  })
}

function renderPage() {
  return render(
    <MemoryRouter>
      <SafetyPage />
    </MemoryRouter>,
  )
}

const activeCheckin = (id: number, status: string, contactName: string) => ({
  id,
  checkin_at: new Date(Date.now() + 3600_000).toISOString(),
  message: null,
  status,
  contact_name: contactName,
  contact_phone: null,
})

describe('Страница safety', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
    contactsData = []
    checkinsData = []
    installFetch()
  })

  it('грузит контакты и активный чекин двумя запросами', async () => {
    contactsData = [{ id: 1, name: 'Аня', phone: '+79990001122', email: null, relation: 'сестра' }]
    checkinsData = [activeCheckin(10, 'active', 'Аня')]

    renderPage()

    await waitFor(() => expect(screen.getByText('safety.status.active')).toBeInTheDocument())

    expect(mockFetch).toHaveBeenCalledWith('/api/checkin/contacts')
    expect(mockFetch).toHaveBeenCalledWith('/api/checkin/active')
    expect(screen.getByText('safety.title')).toBeInTheDocument()
    expect(screen.getByText('+79990001122')).toBeInTheDocument()
    expect(screen.getByText('safety.active_checkins')).toBeInTheDocument()
    expect(screen.getByTestId('checkin-now-button')).toBeInTheDocument()
    expect(screen.getByText('safety.checkin_now')).toBeInTheDocument()
    expect(screen.getByText('safety.cancel')).toBeInTheDocument()
  })

  it('пустые контакты дают заглушку и один пункт в селекте', async () => {
    renderPage()

    await waitFor(() => expect(screen.getByText('safety.no_contacts')).toBeInTheDocument())

    expect(screen.queryByText('safety.active_checkins')).toBeNull()
    expect(within(screen.getByRole('combobox')).getAllByRole('option')).toHaveLength(1)
  })

  it('форма добавления: сохранение заблокировано до двух символов, затем POST и закрытие', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('safety.no_contacts')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('add-contact-button'))
    expect(screen.getByPlaceholderText('safety.contact_name')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('safety.contact_phone'), { target: { value: '89990001122' } })
    fireEvent.change(screen.getByPlaceholderText('safety.contact_relation'), { target: { value: 'сестра' } })
    fireEvent.change(screen.getByPlaceholderText('safety.contact_name'), { target: { value: 'А' } })
    expect(screen.getByTestId('save-contact-button')).toBeDisabled()

    fireEvent.change(screen.getByPlaceholderText('safety.contact_name'), { target: { value: 'Аня' } })
    expect(screen.getByTestId('save-contact-button')).not.toBeDisabled()

    fireEvent.click(screen.getByTestId('save-contact-button'))

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/checkin/contacts',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Аня', phone: '89990001122', email: '', relation: 'сестра' }),
        }),
      ),
    )

    await waitFor(() => expect(screen.queryByPlaceholderText('safety.contact_name')).toBeNull())
  })

  it('удаление контакта шлёт DELETE по id и перечитывает список', async () => {
    contactsData = [{ id: 5, name: 'Аня', phone: '+79990001122', email: null, relation: 'сестра' }]

    renderPage()
    await waitFor(() => expect(screen.getByText('+79990001122')).toBeInTheDocument())

    const row = screen.getByText('+79990001122').closest('div.flex') as HTMLElement
    expect(row).not.toBeNull()
    fireEvent.click(within(row).getByRole('button'))

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/checkin/contacts/5', { method: 'DELETE' }))
    await waitFor(() => {
      expect(mockFetch.mock.calls.filter((c) => c[0] === '/api/checkin/contacts').length).toBe(2)
    })
  })

  it('старт чекина: кнопка ждёт контакт, длительность и сообщение уезжают в тело', async () => {
    contactsData = [{ id: 9, name: 'Аня', phone: '+79990001122', email: null, relation: null }]

    renderPage()
    await waitFor(() => expect(screen.getByText('+79990001122')).toBeInTheDocument())

    const startButton = screen.getByTestId('start-checkin-button')
    expect(startButton).toBeDisabled()

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '9' } })
    expect(startButton).not.toBeDisabled()

    fireEvent.click(screen.getByText('2ч'))
    fireEvent.change(screen.getByPlaceholderText('safety.checkin_message'), { target: { value: 'позвони' } })
    fireEvent.click(startButton)

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/checkin/start',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ contact_id: 9, checkin_minutes: 120, message: 'позвони' }),
        }),
      ),
    )
  })

  it('пропущенный чекин показывает только бейдж без кнопок действий', async () => {
    checkinsData = [activeCheckin(11, 'missed', 'Аня')]

    renderPage()

    await waitFor(() => expect(screen.getByText('safety.status.missed')).toBeInTheDocument())

    expect(screen.queryByTestId('checkin-now-button')).toBeNull()
    expect(screen.queryByText('safety.cancel')).toBeNull()
  })

  it('подтверждение и отмена чекина бьют в свои роуты', async () => {
    checkinsData = [activeCheckin(12, 'active', 'Аня')]

    renderPage()
    await waitFor(() => expect(screen.getByTestId('checkin-now-button')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('checkin-now-button'))
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/checkin/12/checkin', { method: 'POST' }))

    fireEvent.click(screen.getByText('safety.cancel'))
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/checkin/12/cancel', { method: 'POST' }))
  })
})
