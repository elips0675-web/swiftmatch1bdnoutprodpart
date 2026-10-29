import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { LoadingSpinner, PageLoading } from '@/components/shared/loading-screen'

afterEach(() => {
  cleanup()
})

const spinnerClass = (container: HTMLElement) => container.firstElementChild?.className ?? ''

describe('LoadingSpinner', () => {
  it('по умолчанию средний размер', () => {
    const { container } = render(<LoadingSpinner />)
    expect(spinnerClass(container)).toContain('h-8 w-8 border-3')
  })

  it('применяет класс размера sm', () => {
    const { container } = render(<LoadingSpinner size="sm" />)
    expect(spinnerClass(container)).toContain('h-5 w-5 border-2')
  })

  it('применяет класс размера lg', () => {
    const { container } = render(<LoadingSpinner size="lg" />)
    expect(spinnerClass(container)).toContain('h-12 w-12 border-4')
  })

  it('всегда крутится и держит оба цвета границы', () => {
    const { container } = render(<LoadingSpinner size="sm" />)
    const cls = spinnerClass(container)
    expect(cls).toContain('animate-spin')
    expect(cls).toContain('border-rose-200')
    expect(cls).toContain('border-t-rose-500')
  })
})

describe('PageLoading', () => {
  it('рисует крупный спиннер внутри контейнера страницы', () => {
    const { container } = render(<PageLoading />)
    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper.className).toContain('flex h-64 items-center justify-center')
    const spinner = wrapper.firstElementChild as HTMLElement
    expect(spinner.className).toContain('h-12 w-12 border-4')
  })
})
