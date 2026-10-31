import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'

const t = (key: string) => key

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t, language: 'ru', setLanguage: () => {} }),
}))

const tokenState = vi.hoisted(() => ({ value: 'admin-token' as string | null }))

vi.mock('@/lib/token', () => ({ getToken: () => tokenState.value }))

import AdminDashboardPage from '@/pages/admin'

const stats = {
  totalUsers: 100,
  activeToday: 10,
  totalMatches: 5,
  revenue: 699,
  activeSubs: 20,
  newToday: 30,
}

const cities = [
  { name: 'Москва', value: 50 },
  { name: 'Казань', value: 20 },
  { name: 'Сочи', value: 12 },
  { name: 'Омск', value: 7 },
  { name: 'Тула', value: 4 },
  { name: 'Псков', value: 2 },
]

const feed = [
  { id: 1, type: 'registration', text: 'Новый пользователь', time: '5 мин' },
  { id: 2, type: 'match', text: 'Новый мэтч', time: '10 мин' },
  { id: 3, type: 'report', text: 'Жалоба на профиль', time: '15 мин' },
  { id: 4, type: 'premium', text: 'Куплена подписка', time: '20 мин' },
  { id: 5, type: 'system', text: 'Прочее событие', time: '25 мин' },
]

const trend = [{ date: '01.10', users: 3 }]

let routes: Record<string, unknown>
let requests: { url: string; init?: RequestInit }[]
let failing: string[]

const jsonResponse = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response

beforeEach(() => {
  cleanup()
  tokenState.value = 'admin-token'
  failing = []
  requests = []
  routes = {
    '/api/admin/stats': stats,
    '/api/admin/registration-trend': trend,
    '/api/admin/city-distribution': cities,
    '/api/admin/recent-activity': feed,
    '/api/admin/revenue-by-month': [{ month: '10', revenue: 699 }],
  }
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    requests.push({ url, init })
    const key = Object.keys(routes).find(k => url.includes(k))
    if (key && failing.includes(key)) {
      return { ok: false, status: 500, json: async () => ({}) } as unknown as Response
    }
    if (!key) return jsonResponse([])
    return jsonResponse(routes[key])
  }) as unknown as typeof fetch
})

afterEach(() => {
  vi.clearAllMocks()
})

const trendCalls = () => requests.filter(r => r.url.includes('/api/admin/registration-trend'))
const dashboardCalls = () => requests.filter(r => r.url.includes('/api/admin/'))

describe('AdminDashboardPage', () => {
  it('показывает выручку в рублях, без деления на 100', async () => {
    render(<AdminDashboardPage />)
    await waitFor(() => expect(screen.getByText('699 ₽')).toBeTruthy())
    expect(screen.queryByText('6.99 ₽')).toBeNull()
    expect(dashboardCalls()).toHaveLength(5)
    dashboardCalls().forEach(r => expect(r.init?.headers).toEqual({ Authorization: 'Bearer admin-token' }))
    const statusCalls = () => requests.filter(r => r.url === '/api/auth/2fa/status')
    await waitFor(() => expect(statusCalls()).toHaveLength(1))
    expect(statusCalls()[0].init?.headers).toEqual({ Authorization: 'Bearer admin-token' })
  })

  it('показывает ключ заглушки, если выручка пришла пустой', async () => {
    routes['/api/admin/stats'] = { ...stats, revenue: null }
    render(<AdminDashboardPage />)
    await waitFor(() => expect(screen.getByText('admin.dash.revenue_value')).toBeTruthy())
    expect(screen.queryByText('0 ₽')).toBeNull()
  })

  it('считает долю активных от всех пользователей', async () => {
    render(<AdminDashboardPage />)
    await waitFor(() => expect(screen.getByText('10% admin.dash.from_all')).toBeTruthy())
  })

  it('не показывает долю, когда пользователей нет', async () => {
    routes['/api/admin/stats'] = {
      totalUsers: 0, activeToday: 0, totalMatches: 0, revenue: 0, activeSubs: 0, newToday: 0,
    }
    render(<AdminDashboardPage />)
    await waitFor(() => expect(screen.getByText('admin.dash.active_today')).toBeTruthy())
    expect(screen.queryByText(/admin\.dash\.from_all/)).toBeNull()
    expect(screen.getByText('0 ₽')).toBeTruthy()
  })

  it('показывает только пять городов из распределения', async () => {
    render(<AdminDashboardPage />)
    await waitFor(() => expect(screen.getByText('Москва')).toBeTruthy())
    expect(screen.getByText('Тула')).toBeTruthy()
    expect(screen.queryByText('Псков')).toBeNull()
  })

  it('показывает ленту активности и заглушку иконки для неизвестного типа', async () => {
    render(<AdminDashboardPage />)
    await waitFor(() => expect(screen.getByText('Новый пользователь')).toBeTruthy())
    expect(screen.getByText('Куплена подписка')).toBeTruthy()
    expect(screen.getByText('Прочее событие')).toBeTruthy()
    expect(screen.getByText('25 мин')).toBeTruthy()
  })

  it('переключает период графика и перезапрашивает тренд', async () => {
    const user = userEvent.setup()
    render(<AdminDashboardPage />)
    await waitFor(() => expect(screen.getByText('Москва')).toBeTruthy())
    expect(trendCalls().map(r => r.url)).toEqual(['/api/admin/registration-trend?period=7'])

    await user.click(screen.getByText('30units.d_short'))
    await waitFor(() => expect(trendCalls()).toHaveLength(2))
    expect(trendCalls()[1].url).toBe('/api/admin/registration-trend?period=30')

    await user.click(screen.getByText('90units.d_short'))
    await waitFor(() => expect(trendCalls()).toHaveLength(3))
    expect(trendCalls()[2].url).toBe('/api/admin/registration-trend?period=90')
  })

  it('не падает, если списки пришли не массивами', async () => {
    routes['/api/admin/registration-trend'] = { rows: trend }
    routes['/api/admin/city-distribution'] = { cities }
    render(<AdminDashboardPage />)
    await waitFor(() => expect(screen.getByText('699 ₽')).toBeTruthy())
    expect(screen.getByText('admin.dash.reg_trend')).toBeTruthy()
    expect(screen.queryByText('Москва')).toBeNull()
  })

  it('показывает нули, если статистика недоступна', async () => {
    failing = ['/api/admin/stats']
    render(<AdminDashboardPage />)
    await waitFor(() => expect(screen.getByText('0 ₽')).toBeTruthy())
    expect(screen.queryByText('699 ₽')).toBeNull()
    expect(screen.queryByText('Москва')).toBeNull()
  })

  it('не отправляет Authorization без токена', async () => {
    tokenState.value = null
    render(<AdminDashboardPage />)
    await waitFor(() => expect(screen.getByText('699 ₽')).toBeTruthy())
    const dashboard = requests.filter(r => !r.url.includes('/api/auth/'))
    expect(dashboard.length).toBeGreaterThan(0)
    dashboard.forEach(r => expect(r.init?.headers).toEqual({}))
  })
})
