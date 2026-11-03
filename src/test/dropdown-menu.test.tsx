import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu'

function Menu() {
  return (
    <DropdownMenu open>
      <DropdownMenuTrigger>меню</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>Действия</DropdownMenuLabel>
        <DropdownMenuLabel inset className="label-inset">С меткой</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem>обычный</DropdownMenuItem>
        <DropdownMenuItem inset className="custom">со сдвигом</DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger inset>ещё</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem>вложенный</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

describe('DropdownMenu', () => {
  it('пункт с inset получает отступ, без inset — нет', () => {
    render(<Menu />)

    const plain = screen.getByText('обычный')
    const inset = screen.getByText('со сдвигом')

    expect(plain.className).toContain('rounded-sm')
    expect(plain.className).toContain('gap-2')
    expect(plain.className).not.toContain('pl-8')
    expect(inset.className).toContain('pl-8')
    expect(inset.className).toContain('custom')
  })

  it('рендерит метку, разделитель и вложенный подпункт', () => {
    render(<Menu />)

    expect(screen.getByText('Действия')).toBeInTheDocument()
    expect(screen.getByText('ещё')).toBeInTheDocument()
    const separator = document.querySelector('[role="separator"]')
    expect(separator).not.toBeNull()
    expect(separator?.className).toContain('bg-muted')
  })

  it('метка и подпункт уважают inset так же, как пункт', () => {
    render(<Menu />)

    expect(screen.getByText('С меткой').className).toContain('pl-8')
    expect(screen.getByText('С меткой').className).toContain('label-inset')
    expect(screen.getByText('ещё').className).toContain('pl-8')
  })
})
