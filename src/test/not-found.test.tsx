import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LanguageProvider } from '@/context/language-context'
import NotFound from '@/pages/NotFound'

const renderPage = () =>
  render(
    <MemoryRouter>
      <LanguageProvider>
        <NotFound />
      </LanguageProvider>
    </MemoryRouter>,
  )

beforeEach(() => {
  cleanup()
  localStorage.clear()
})

describe('NotFound', () => {
  it('показывает 404 и русские тексты по умолчанию', () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('404')
    expect(screen.getByText('Страница не найдена')).toBeTruthy()
    expect(screen.getByText('Такой страницы нет или она была удалена')).toBeTruthy()
  })

  it('ведёт на главную ссылкой, а не перезагрузкой страницы', () => {
    renderPage()
    const link = screen.getByRole('link', { name: 'На главную' })
    expect(link.getAttribute('href')).toBe('/')
  })

  it('переключается на английские тексты', async () => {
    localStorage.setItem('app_lang', 'EN')
    renderPage()
    expect(await screen.findByText('Page not found')).toBeTruthy()
    expect(screen.getByText('This page does not exist or has been removed')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to Home' })).toBeTruthy()
  })
})
