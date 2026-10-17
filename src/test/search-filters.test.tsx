import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'

const pushMock = vi.fn()
const backMock = vi.fn()

vi.mock('@/shims/next-navigation', () => ({
  useRouter: () => ({ push: pushMock, back: backMock }),
}))

const tCalls: Array<{ key: string; options?: Record<string, unknown> }> = []

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      tCalls.push({ key, options })
      return key
    },
    language: 'RU',
    setLanguage: vi.fn(),
  }),
}))

import FiltersPage from '@/pages/search-filters'
import { ALL_DEMO_USERS } from '@/lib/demo-data'

const INTEREST = ALL_DEMO_USERS.flatMap((u) => u.interests)[0]

function lastOptions(key: string) {
  const calls = tCalls.filter((c) => c.key === key)
  return calls[calls.length - 1]?.options
}

function readSaved() {
  const raw = localStorage.getItem('searchFilters')
  return raw ? JSON.parse(raw) : null
}

function renderPage() {
  return render(<FiltersPage />)
}

describe('Страница search-filters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tCalls.length = 0
    localStorage.clear()
  })

  it('рисует разделы фильтров и дефолтные диапазоны 18–40 и 50 км', () => {
    renderPage()

    expect(screen.getByText('search.filters')).toBeInTheDocument()
    expect(screen.getByText('filters.age')).toBeInTheDocument()
    expect(screen.getByText('filters.distance')).toBeInTheDocument()
    expect(screen.getByText('filters.city')).toBeInTheDocument()
    expect(screen.getByText('filters.interests')).toBeInTheDocument()
    expect(screen.getByText('button.apply_filters')).toBeInTheDocument()

    expect(lastOptions('filters.age_from_to')).toMatchObject({ from: 18, to: 40 })
    expect(lastOptions('filters.distance_up_to')).toMatchObject({ distance: 50 })

    expect(screen.getByText(INTEREST)).toBeInTheDocument()
    expect(screen.getAllByRole('combobox')).toHaveLength(1)
  })

  it('поднимает сохранённые фильтры и подставляет страну по сохранённому городу', () => {
    localStorage.setItem(
      'searchFilters',
      JSON.stringify({ ageRange: [25, 35], distance: [120], selectedCity: 'Berlin', selectedInterests: [INTEREST] }),
    )

    renderPage()

    expect(lastOptions('filters.age_from_to')).toMatchObject({ from: 25, to: 35 })
    expect(lastOptions('filters.distance_up_to')).toMatchObject({ distance: 120 })
    expect(screen.getAllByRole('combobox')).toHaveLength(2)
  })

  it('применение сохраняет поднятые из хранилища значения без потерь', () => {
    localStorage.setItem(
      'searchFilters',
      JSON.stringify({ ageRange: [25, 35], distance: [120], selectedCity: 'Berlin', selectedInterests: [INTEREST] }),
    )

    renderPage()
    fireEvent.click(screen.getByTestId('apply-filters'))

    expect(readSaved()).toEqual({
      ageRange: [25, 35],
      distance: [120],
      selectedCity: 'Berlin',
      selectedInterests: [INTEREST],
    })
    expect(pushMock).toHaveBeenCalledWith('/search')
  })

  it('клик по интересу добавляет его, повторный клик убирает', () => {
    renderPage()

    fireEvent.click(screen.getByText(INTEREST))
    fireEvent.click(screen.getByTestId('apply-filters'))
    expect(readSaved().selectedInterests).toEqual([INTEREST])

    fireEvent.click(screen.getByText(INTEREST))
    fireEvent.click(screen.getByTestId('apply-filters'))
    expect(readSaved().selectedInterests).toEqual([])
  })

  it('по умолчанию сохраняет город all и пустой список интересов', () => {
    renderPage()

    fireEvent.click(screen.getByTestId('apply-filters'))

    expect(readSaved()).toEqual({
      ageRange: [18, 40],
      distance: [50],
      selectedCity: 'all',
      selectedInterests: [],
    })
    expect(pushMock).toHaveBeenCalledWith('/search')
    expect(backMock).not.toHaveBeenCalled()
  })

  it('кнопка «назад» в шапке вызывает router.back', () => {
    const { container } = renderPage()

    const header = container.querySelector('header')
    expect(header).not.toBeNull()
    fireEvent.click(header!.querySelector('button')!)

    expect(backMock).toHaveBeenCalledTimes(1)
  })

  it('битый JSON в localStorage не роняет страницу и оставляет дефолты', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    localStorage.setItem('searchFilters', '{не json')

    renderPage()

    expect(screen.getByText('search.filters')).toBeInTheDocument()
    expect(lastOptions('filters.age_from_to')).toMatchObject({ from: 18, to: 40 })
    expect(screen.getAllByRole('combobox')).toHaveLength(1)

    errorSpy.mockRestore()
  })
})
