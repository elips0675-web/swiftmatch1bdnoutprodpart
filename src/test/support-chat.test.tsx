import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import React from 'react'

const backMock = vi.fn()

vi.mock('@/shims/next-navigation', () => ({
  useRouter: () => ({ back: () => backMock(), push: vi.fn(), replace: vi.fn() }),
}))

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t: (key: string) => key, language: 'RU', setLanguage: vi.fn() }),
}))

const toastMock = vi.fn()

vi.mock('@/hooks/use-toast', () => ({
  toast: (opts: unknown) => toastMock(opts),
  useToast: () => ({ toast: toastMock, toasts: [] }),
}))

const filterState = { forbidden: false, gibberish: false }

vi.mock('@/lib/word-filter', () => ({
  containsForbiddenWords: () => filterState.forbidden,
  isGibberish: () => filterState.gibberish,
}))

import SupportChatPage from '@/pages/support-chat'

function renderPage() {
  return render(
    <MemoryRouter>
      <SupportChatPage />
    </MemoryRouter>,
  )
}

function input() {
  return screen.getByPlaceholderText('support.placeholder')
}

function sendButton() {
  const buttons = screen.getAllByRole('button')
  return buttons[buttons.length - 1]
}

function typeAndSend(text: string) {
  fireEvent.change(input(), { target: { value: text } })
  fireEvent.keyDown(input(), { key: 'Enter' })
}

describe('Страница support-chat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    filterState.forbidden = false
    filterState.gibberish = false
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('рисует шапку, приветствие агента и промо-ссылку на FAQ', () => {
    renderPage()

    expect(screen.getByText('support.title')).toBeInTheDocument()
    expect(screen.getByText(/chats\.online/)).toBeInTheDocument()
    expect(screen.getByText('support.greeting')).toBeInTheDocument()
    expect(screen.getByText(/^support\.faq_promo\.$/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'support.faq_promo_link' })).toHaveAttribute('href', '/faq')
  })

  it('кнопка «назад» вызывает router.back', () => {
    renderPage()

    fireEvent.click(screen.getAllByRole('button')[0])

    expect(backMock).toHaveBeenCalledTimes(1)
  })

  it('Enter отправляет сообщение и очищает поле', () => {
    renderPage()

    typeAndSend('Привет, поддержка')

    expect(screen.getByText('Привет, поддержка')).toBeInTheDocument()
    expect(input()).toHaveValue('')
  })

  it('после отправки приходит автоответ поддержки', async () => {
    renderPage()

    typeAndSend('Привет')

    await waitFor(() => expect(screen.getByText('chats.typing')).toBeInTheDocument(), { timeout: 3000 })
    await waitFor(() => expect(screen.getByText('support.response')).toBeInTheDocument(), { timeout: 6000 })
  })

  it('пустая и пробельная строка не отправляется и не рождает сообщение', () => {
    renderPage()

    fireEvent.change(input(), { target: { value: '   ' } })
    expect(sendButton()).toBeDisabled()

    fireEvent.click(sendButton())
    fireEvent.keyDown(input(), { key: 'Enter' })

    expect(toastMock).not.toHaveBeenCalled()
    expect(screen.queryByText('support.response')).toBeNull()
    expect(input()).toHaveValue('   ')
  })

  it('запрещённые слова блокируют отправку и показывают тост', () => {
    filterState.forbidden = true
    renderPage()

    typeAndSend('плохое слово')

    expect(toastMock).toHaveBeenCalledWith({
      variant: 'destructive',
      title: 'filter.toast.title',
      description: 'filter.toast.description',
    })
    expect(screen.queryByText('плохое слово')).toBeNull()
  })

  it('бессмысленный текст блокируется отдельным описанием тоста', () => {
    filterState.gibberish = true
    renderPage()

    typeAndSend('asdkjhasd')

    expect(toastMock).toHaveBeenCalledWith({
      variant: 'destructive',
      title: 'filter.toast.title',
      description: 'filter.toast.gibberish_description',
    })
    expect(screen.queryByText('asdkjhasd')).toBeNull()
  })
})
