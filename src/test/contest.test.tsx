import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import React from 'react'

const tCalls: Array<{ key: string; options?: Record<string, unknown> }> = []

const mockUseLanguage = {
  t: (key: string, options?: Record<string, unknown>) => {
    tCalls.push({ key, options })
    let value = key
    if (options) {
      for (const [k, v] of Object.entries(options)) value = value.replace(`{${k}}`, String(v))
    }
    return value
  },
  language: 'RU',
  setLanguage: vi.fn(),
}

vi.mock('@/context/language-context', () => ({
  useLanguage: () => mockUseLanguage,
}))

vi.mock('@/components/layout/app-header', () => ({
  AppHeader: () => <div data-testid="app-header" />,
}))

vi.mock('@/components/navigation/bottom-nav', () => ({
  BottomNav: () => <div data-testid="bottom-nav" />,
}))

import ContestPage from '@/pages/contest'

function renderPage() {
  return render(<ContestPage />)
}

function switchToMale() {
  fireEvent.mouseDown(screen.getByText('contest.tab.men'))
}

describe('Страница contest', () => {
  beforeEach(() => {
    tCalls.length = 0
  })

  it('рисует шапку, тикер и обратный отсчёт с числом дней в опции count', () => {
    renderPage()

    expect(screen.getByTestId('app-header')).toBeInTheDocument()
    expect(screen.getByTestId('bottom-nav')).toBeInTheDocument()
    expect(screen.getByText('contest.title')).toBeInTheDocument()
    expect(screen.getByText('contest.subtitle')).toBeInTheDocument()
    expect(screen.getByText('contest.ends_in')).toBeInTheDocument()

    const call = tCalls.find((c) => c.key === 'contest.days_left')
    expect(call).toBeTruthy()
    const count = call?.options?.count
    expect(typeof count).toBe('number')
    expect(count as number).toBeGreaterThanOrEqual(0)
    expect(count as number).toBeLessThanOrEqual(31)
  })

  it('по умолчанию показывает женские топ-3 с голосами и прошлых победительниц', () => {
    renderPage()

    expect(screen.getByText('contest.tab.women')).toBeInTheDocument()
    expect(screen.getByText('contest.tab.men')).toBeInTheDocument()
    expect(screen.getByText('Алина')).toBeInTheDocument()
    expect(screen.getByText('Анна')).toBeInTheDocument()
    expect(screen.getAllByText('Елена').length).toBeGreaterThan(0)
    expect(screen.getByText('1240')).toBeInTheDocument()
    expect(screen.getByText('980')).toBeInTheDocument()
    expect(screen.getByText('850')).toBeInTheDocument()
    expect(screen.queryByText('Максим')).toBeNull()
  })

  it('показывает прошлых победительниц женского зачёта с месяцами', () => {
    renderPage()

    expect(screen.getByText('contest.previous_winners')).toBeInTheDocument()
    expect(screen.getByText('Мария')).toBeInTheDocument()
    expect(screen.getByText('Ксения')).toBeInTheDocument()
    expect(screen.getByText('month.april')).toBeInTheDocument()
    expect(screen.getByText('month.march')).toBeInTheDocument()
    expect(screen.getByText('month.february')).toBeInTheDocument()
    expect(screen.queryByText('Александр')).toBeNull()
  })

  it('переключение вкладки показывает мужские топ-3 и убирает женские', async () => {
    renderPage()

    switchToMale()

    expect(await screen.findByText('Максим', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.getByText('Иван')).toBeInTheDocument()
    expect(screen.getAllByText('Дмитрий').length).toBeGreaterThan(0)
    expect(screen.getByText('1100')).toBeInTheDocument()
    expect(screen.getByText('950')).toBeInTheDocument()
    expect(screen.getByText('700')).toBeInTheDocument()

    await waitFor(() => expect(screen.queryByText('Алина')).toBeNull())
    expect(screen.queryByText('1240')).toBeNull()
  })

  it('переключение вкладки меняет прошлых победителей', async () => {
    renderPage()

    expect(screen.getByText('Мария')).toBeInTheDocument()
    expect(screen.queryByText('Александр')).toBeNull()

    switchToMale()

    expect(await screen.findByText('Александр', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.queryByText('Мария')).toBeNull()
  })

  it('показывает все три приза и правила', () => {
    renderPage()

    expect(screen.getByText('contest.prizes.title')).toBeInTheDocument()
    expect(screen.getByText('contest.prizes.pro.title')).toBeInTheDocument()
    expect(screen.getByText('contest.prizes.pro.desc')).toBeInTheDocument()
    expect(screen.getByText('contest.prizes.boost.title')).toBeInTheDocument()
    expect(screen.getByText('contest.prizes.boost.desc')).toBeInTheDocument()
    expect(screen.getByText('contest.prizes.badge.title')).toBeInTheDocument()
    expect(screen.getByText('contest.prizes.badge.desc')).toBeInTheDocument()
    expect(screen.getByText('contest.rules')).toBeInTheDocument()
    expect(screen.getByText('contest.rules_desc')).toBeInTheDocument()
  })

  it('клик по фото открывает просмотрщик, кнопка закрытия его убирает', async () => {
    renderPage()

    expect(screen.queryByTestId('close-photo-viewer')).toBeNull()

    fireEvent.click(screen.getByAltText('Алина'))

    expect(await screen.findByTestId('close-photo-viewer')).toBeInTheDocument()
    expect(screen.getByText('contest.photo_viewer')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('close-photo-viewer'))

    await waitFor(() => expect(screen.queryByTestId('close-photo-viewer')).toBeNull())
  })
})
