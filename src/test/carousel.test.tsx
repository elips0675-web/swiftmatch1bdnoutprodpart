import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
} from '@/components/ui/carousel'

const embla = vi.hoisted(() => {
  const api = {
    canScrollPrev: vi.fn(() => false),
    canScrollNext: vi.fn(() => false),
    scrollPrev: vi.fn(),
    scrollNext: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  }
  type EmblaApiMock = typeof api
  const useEmblaCarousel = vi.fn<() => [() => void, EmblaApiMock | undefined]>(() => [
    vi.fn(),
    api,
  ])
  return { api, useEmblaCarousel }
})

vi.mock('embla-carousel-react', () => ({ default: embla.useEmblaCarousel }))

const carousel = (props: React.ComponentProps<typeof Carousel> = {}) => (
  <LanguageProvider>
    <Carousel {...props}>
      <CarouselContent>
        <CarouselItem>Слайд 1</CarouselItem>
        <CarouselItem>Слайд 2</CarouselItem>
      </CarouselContent>
      <CarouselPrevious />
      <CarouselNext />
    </Carousel>
  </LanguageProvider>
)

beforeEach(() => {
  cleanup()
  localStorage.clear()
  embla.useEmblaCarousel.mockClear()
  embla.api.canScrollPrev.mockReset().mockReturnValue(false)
  embla.api.canScrollNext.mockReset().mockReturnValue(false)
  embla.api.scrollPrev.mockClear()
  embla.api.scrollNext.mockClear()
  embla.api.on.mockClear()
  embla.api.off.mockClear()
})

describe('Carousel', () => {
  it('рисует горизонтальную карусель с осями и переводит стрелки в выключенное состояние', () => {
    const { container } = render(carousel())
    const region = container.querySelector('[aria-roledescription="carousel"]')
    expect(region).toBeTruthy()
    expect(embla.useEmblaCarousel).toHaveBeenCalledWith({ axis: 'x' }, undefined)
    expect(screen.getByRole('button', { name: 'Предыдущий слайд' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Следующий слайд' })).toHaveProperty('disabled', true)
    expect(container.querySelector('.relative')).toBe(region)
  })

  it('для вертикальной ориентации берёт ось y и вертикальные отступы', () => {
    const { container } = render(carousel({ orientation: 'vertical' }))
    expect(embla.useEmblaCarousel).toHaveBeenCalledWith({ axis: 'y' }, undefined)
    const content = container.querySelector('.overflow-hidden > div')
    expect(content?.className).toContain('-mt-4')
    expect(content?.className).toContain('flex-col')
    expect(screen.getByText('Слайд 1').className).toContain('pt-4')
    expect(container.querySelector('[aria-roledescription="carousel"]')?.className).toContain(
      'relative',
    )
  })

  it('включает стрелки, когда Embla сообщает о возможности прокрутки, и листает по клику', () => {
    embla.api.canScrollPrev.mockReturnValue(true)
    embla.api.canScrollNext.mockReturnValue(true)
    render(carousel())

    const prev = screen.getByRole('button', { name: 'Предыдущий слайд' })
    const next = screen.getByRole('button', { name: 'Следующий слайд' })
    expect(prev).toHaveProperty('disabled', false)
    expect(next).toHaveProperty('disabled', false)

    fireEvent.click(prev)
    fireEvent.click(next)
    expect(embla.api.scrollPrev).toHaveBeenCalledTimes(1)
    expect(embla.api.scrollNext).toHaveBeenCalledTimes(1)
  })

  it('листает стрелками клавиатуры по горизонтали и игнорирует посторонние клавиши', () => {
    const { container } = render(carousel())
    const item = screen.getByText('Слайд 2')

    fireEvent.keyDown(item, { key: 'ArrowLeft' })
    fireEvent.keyDown(item, { key: 'ArrowRight' })
    fireEvent.keyDown(item, { key: 'ArrowUp' })
    fireEvent.keyDown(item, { key: 'a' })

    expect(embla.api.scrollPrev).toHaveBeenCalledTimes(1)
    expect(embla.api.scrollNext).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[aria-roledescription="carousel"]')).toBeTruthy()
  })

  it('вертикальная карусель слушает стрелки вверх и вниз', () => {
    render(carousel({ orientation: 'vertical' }))
    const item = screen.getByText('Слайд 1')

    fireEvent.keyDown(item, { key: 'ArrowUp' })
    fireEvent.keyDown(item, { key: 'ArrowDown' })
    fireEvent.keyDown(item, { key: 'ArrowLeft' })

    expect(embla.api.scrollPrev).toHaveBeenCalledTimes(1)
    expect(embla.api.scrollNext).toHaveBeenCalledTimes(1)
  })

  it('подписывается на select и reInit, а при размонтировании снимает обе подписки', () => {
    const { unmount } = render(carousel())

    expect(embla.api.on).toHaveBeenCalledWith('reInit', expect.any(Function))
    expect(embla.api.on).toHaveBeenCalledWith('select', expect.any(Function))

    unmount()

    expect(embla.api.off).toHaveBeenCalledWith('select', expect.any(Function))
    expect(embla.api.off).toHaveBeenCalledWith('reInit', expect.any(Function))
  })

  it('отдаёт api наружу через setApi', () => {
    const setApi = vi.fn()
    render(carousel({ setApi }))
    expect(setApi).toHaveBeenCalledWith(embla.api)
  })

  it('переключает подписи стрелок на английские', async () => {
    localStorage.setItem('app_lang', 'EN')
    render(carousel())
    expect(await screen.findByRole('button', { name: 'Previous slide' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Next slide' })).toBeTruthy()
  })

  it('падает с понятной ошибкой вне Carousel', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<CarouselItem>Слайд</CarouselItem>)).toThrow(
      'useCarousel must be used within a <Carousel />',
    )
    spy.mockRestore()
  })

  it('не падает и не разблокирует стрелки, если Embla вызовет обработчик без api', () => {
    render(carousel())
    const select = embla.api.on.mock.calls.find(([name]) => name === 'select')?.[1]

    act(() => {
      select(undefined)
    })

    expect(screen.getByRole('button', { name: 'Предыдущий слайд' })).toHaveProperty('disabled', true)
  })

  it('не подписывается на события, пока Embla не отдала api', () => {
    embla.useEmblaCarousel.mockReturnValueOnce([vi.fn(), undefined])
    const setApi = vi.fn()
    render(carousel({ setApi }))

    expect(embla.api.on).not.toHaveBeenCalled()
    expect(setApi).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Предыдущий слайд' })).toHaveProperty('disabled', true)
  })
})
