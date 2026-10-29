import { describe, it, expect, beforeEach } from 'vitest'
import { render, cleanup, screen, act } from '@testing-library/react'
import { toast } from 'sonner'
import { Toaster } from '@/components/ui/sonner'

beforeEach(() => {
  cleanup()
  toast.dismiss()
})

describe('Toaster', () => {
  it('монтирует область уведомлений в светлой теме и вешает классы на список', async () => {
    const { container } = render(<Toaster />)
    const section = container.querySelector('section')
    expect(section?.getAttribute('aria-label')).toBe('Notifications alt+T')

    act(() => {
      toast('Тема')
    })
    await screen.findByText('Тема')

    const list = container.querySelector('[data-sonner-toaster]')
    expect(list?.className).toContain('toaster group')
    expect(list?.getAttribute('data-theme')).toBe('light')
  })

  it('показывает уведомление, отправленное через toast', async () => {
    render(<Toaster />)
    act(() => {
      toast('Сохранено')
    })
    expect(await screen.findByText('Сохранено')).toBeTruthy()
  })

  it('навешивает классы по умолчанию на уведомление и описание', async () => {
    render(<Toaster />)
    act(() => {
      toast('Сохранено', { description: 'Профиль обновлён' })
    })
    const title = await screen.findByText('Сохранено')
    expect(title.closest('li')?.className).toContain('group toast')
    expect(screen.getByText('Профиль обновлён').className).toContain(
      'group-[.toast]:text-muted-foreground',
    )
  })

  it('переданные toastOptions перекрывают классы по умолчанию', async () => {
    render(<Toaster toastOptions={{ classNames: { toast: 'custom-toast' } }} />)
    act(() => {
      toast('Свои классы')
    })
    const item = (await screen.findByText('Свои классы')).closest('li')
    expect(item?.className).toContain('custom-toast')
    expect(item?.className).not.toContain('group toast')
  })
})
