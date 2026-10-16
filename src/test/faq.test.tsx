import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import React from 'react'

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t: (key: string) => key, language: 'RU', setLanguage: vi.fn() }),
}))

vi.mock('@/components/layout/app-header', () => ({
  AppHeader: () => <div data-testid="app-header" />,
}))

import FaqPage from '@/pages/faq'

const QUESTIONS = ['faq.q1', 'faq.q2', 'faq.q3', 'faq.q4', 'faq.q5', 'faq.q9', 'faq.q10', 'faq.q6', 'faq.q7', 'faq.q8']

function renderPage() {
  return render(<FaqPage />)
}

describe('Страница faq', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('рисует заголовок, описание и все 10 вопросов, ответы скрыты', () => {
    renderPage()

    expect(screen.getByTestId('app-header')).toBeInTheDocument()
    expect(screen.getByText('faq.page_title')).toBeInTheDocument()
    expect(screen.getByText('faq.description')).toBeInTheDocument()

    for (const q of QUESTIONS) {
      expect(screen.getByText(`${q}.question`)).toBeInTheDocument()
      expect(screen.queryByText(`${q}.answer`)).toBeNull()
    }
  })

  it('клик по вопросу раскрывает ответ, повторный клик скрывает', async () => {
    renderPage()

    fireEvent.click(screen.getByText('faq.q1.question'))
    expect(await screen.findByText('faq.q1.answer')).toBeInTheDocument()

    fireEvent.click(screen.getByText('faq.q1.question'))
    await waitFor(() => expect(screen.queryByText('faq.q1.answer')).toBeNull())
  })

  it('аккордеон одиночный: раскрытие второго вопроса закрывает первый', async () => {
    renderPage()

    fireEvent.click(screen.getByText('faq.q1.question'))
    expect(await screen.findByText('faq.q1.answer')).toBeInTheDocument()

    fireEvent.click(screen.getByText('faq.q2.question'))
    expect(await screen.findByText('faq.q2.answer')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('faq.q1.answer')).toBeNull())
  })
})
