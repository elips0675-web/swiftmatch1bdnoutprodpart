import { describe, it, expect } from 'vitest'
import { render, renderHook, screen } from '@testing-library/react'
import { useAntiScreenshot } from '@/hooks/useAntiScreenshot'

function Harness() {
  const ref = useAntiScreenshot<HTMLDivElement>()
  return <div ref={ref} data-testid="zone" />
}

const keydown = (el: Element, init: KeyboardEventInit) => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  el.dispatchEvent(event)
  return event.defaultPrevented
}

const stylesWithRules = () =>
  Array.from(document.head.querySelectorAll('style')).filter((style) =>
    String(style.textContent).includes('.anti-screenshot')
  )

describe('useAntiScreenshot', () => {
  it('вставляет глобальные стили один раз на все вызовы', () => {
    render(<Harness />)
    render(<Harness />)

    const styles = stylesWithRules()
    expect(styles).toHaveLength(1)
    expect(String(styles[0].textContent)).toContain('-webkit-user-select: none !important')
    expect(String(styles[0].textContent)).toContain('-webkit-touch-callout: none !important')
  })

  it('блокирует контекстное меню и копирование внутри зоны', () => {
    render(<Harness />)
    const zone = screen.getByTestId('zone')

    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    zone.dispatchEvent(menu)

    const copy = new Event('copy', { bubbles: true, cancelable: true })
    zone.dispatchEvent(copy)

    expect(menu.defaultPrevented).toBe(true)
    expect(copy.defaultPrevented).toBe(true)
  })

  it('блокирует горячие клавиши копирования, сохранения, печати и исходника', () => {
    render(<Harness />)
    const zone = screen.getByTestId('zone')

    expect(keydown(zone, { key: 'c', ctrlKey: true })).toBe(true)
    expect(keydown(zone, { key: 'C', ctrlKey: true })).toBe(true)
    expect(keydown(zone, { key: 's', metaKey: true })).toBe(true)
    expect(keydown(zone, { key: 'S', ctrlKey: true })).toBe(true)
    expect(keydown(zone, { key: 'p', ctrlKey: true })).toBe(true)
    expect(keydown(zone, { key: 'P', metaKey: true })).toBe(true)
    expect(keydown(zone, { key: 'u', ctrlKey: true })).toBe(true)
    expect(keydown(zone, { key: 'U', metaKey: true })).toBe(true)
  })

  it('блокирует PrintScreen и F12', () => {
    render(<Harness />)
    const zone = screen.getByTestId('zone')

    expect(keydown(zone, { key: 'PrintScreen' })).toBe(true)
    expect(keydown(zone, { key: 'F12' })).toBe(true)
  })

  it('не трогает обычный ввод и прочие сочетания', () => {
    render(<Harness />)
    const zone = screen.getByTestId('zone')

    expect(keydown(zone, { key: 'c' })).toBe(false)
    expect(keydown(zone, { key: 'a', ctrlKey: true })).toBe(false)
    expect(keydown(zone, { key: 'Enter' })).toBe(false)
  })

  it('снимает слушатели при размонтировании', () => {
    const view = render(<Harness />)
    const zone = screen.getByTestId('zone')
    view.unmount()

    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    zone.dispatchEvent(menu)

    expect(menu.defaultPrevented).toBe(false)
  })

  it('без привязанного элемента монтируется и размонтируется без ошибок', () => {
    const view = renderHook(() => useAntiScreenshot<HTMLDivElement>())

    expect(() => view.unmount()).not.toThrow()
  })
})
