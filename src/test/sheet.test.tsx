import { describe, it, expect } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from '@/components/ui/sheet'

const Panel = ({ side, className }: { side?: 'top' | 'bottom' | 'left' | 'right'; className?: string }) => (
  <Sheet open>
    <SheetContent side={side} className={className}>
      <SheetHeader className="head-custom">
        <SheetTitle>Заголовок панели</SheetTitle>
        <SheetDescription>Описание панели</SheetDescription>
      </SheetHeader>
    </SheetContent>
  </Sheet>
)

describe('Sheet', () => {
  it('по умолчанию панель выезжает справа и держит заголовок с описанием', () => {
    render(<Panel />)

    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toContain('inset-y-0 right-0')
    expect(dialog.className).toContain('slide-in-from-right')
    expect(screen.getByText('Заголовок панели')).toBeTruthy()
    expect(screen.getByText('Описание панели')).toBeTruthy()

    const header = screen.getByText('Заголовок панели').closest('div.head-custom')
    expect(header?.className).toContain('flex flex-col space-y-2 text-center sm:text-left')
    expect(header?.className).toContain('head-custom')
  })

  it('side меняет сторону и сливается с пользовательским className', () => {
    const left = render(<Panel side="left" className="extra-left" />)
    const leftDialog = screen.getByRole('dialog')
    expect(leftDialog.className).toContain('inset-y-0 left-0')
    expect(leftDialog.className).toContain('slide-in-from-left')
    expect(leftDialog.className).toContain('extra-left')
    left.unmount()

    render(<Panel side="bottom" />)
    const bottomDialog = screen.getByRole('dialog')
    expect(bottomDialog.className).toContain('inset-x-0 bottom-0')
    expect(bottomDialog.className).toContain('slide-in-from-bottom')
  })

  it('кнопка закрытия закрывает панель через onOpenChange', async () => {
    render(
      <Sheet defaultOpen>
        <SheetTrigger>открыть</SheetTrigger>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Панель</SheetTitle>
            <SheetDescription>Описание</SheetDescription>
          </SheetHeader>
        </SheetContent>
      </Sheet>
    )

    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByText('открыть')).toBeTruthy()
  })
})
