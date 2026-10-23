import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, within, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

const h = vi.hoisted(() => ({
  language: 'RU' as 'RU' | 'EN',
  setLanguage: vi.fn(),
  t: (key: string) => `t.${key}`,
}))

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t: h.t, language: h.language, setLanguage: h.setLanguage }),
}))

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar'
import { AdminLayout } from '@/components/layout/admin-layout'
import { AdminSidebar } from '@/components/navigation/admin-sidebar'

function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
}

function Probe() {
  const { state, open, openMobile, isMobile, toggleSidebar, setOpen, setOpenMobile } = useSidebar()
  return (
    <div>
      <span data-testid="state">{state}</span>
      <span data-testid="open">{String(open)}</span>
      <span data-testid="openMobile">{String(openMobile)}</span>
      <span data-testid="isMobile">{String(isMobile)}</span>
      <button type="button" onClick={toggleSidebar}>
        toggle
      </button>
      <button type="button" onClick={() => setOpen(!open)}>
        flip
      </button>
      <button type="button" onClick={() => setOpen(false)}>
        close
      </button>
      <button type="button" onClick={() => setOpenMobile(true)}>
        open-mobile
      </button>
    </div>
  )
}

function renderProvider(children: ReactNode, props: { defaultOpen?: boolean; open?: boolean; onOpenChange?: (open: boolean) => void; className?: string } = {}) {
  return render(<SidebarProvider {...props}>{children}</SidebarProvider>)
}

function getCookie(name: string) {
  return document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
}

function tooltipPanel() {
  return document.querySelector('[data-radix-popper-content-wrapper] > div') as HTMLElement | null
}

beforeEach(() => {
  setViewport(1280)
  h.language = 'RU'
  h.setLanguage.mockReset()
  document.cookie = 'sidebar_state=; path=/; max-age=0'
})

afterEach(() => {
  cleanup()
  setViewport(1280)
})

describe('useSidebar', () => {
  it('требует провайдер и падает без него', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrowError('useSidebar must be used within a SidebarProvider.')
    consoleError.mockRestore()
  })

  it('по умолчанию отдаёт развёрнутое состояние на широком экране', async () => {
    renderProvider(<Probe />)
    expect(screen.getByTestId('state')).toHaveTextContent('expanded')
    expect(screen.getByTestId('open')).toHaveTextContent('true')
    expect(screen.getByTestId('openMobile')).toHaveTextContent('false')
    await waitFor(() => expect(screen.getByTestId('isMobile')).toHaveTextContent('false'))
    expect(getCookie('sidebar_state')).toBeUndefined()
  })

  it('defaultOpen={false} даёт свёрнутое состояние', () => {
    renderProvider(<Probe />, { defaultOpen: false })
    expect(screen.getByTestId('state')).toHaveTextContent('collapsed')
    expect(screen.getByTestId('open')).toHaveTextContent('false')
  })

  it('переключает состояние и пишет cookie на весь сайт', async () => {
    const user = userEvent.setup()
    renderProvider(<Probe />)
    await user.click(screen.getByRole('button', { name: 'toggle' }))
    expect(screen.getByTestId('state')).toHaveTextContent('collapsed')
    expect(getCookie('sidebar_state')).toBe('sidebar_state=false')
    await user.click(screen.getByRole('button', { name: 'toggle' }))
    expect(screen.getByTestId('state')).toHaveTextContent('expanded')
    expect(getCookie('sidebar_state')).toBe('sidebar_state=true')
  })

  it('поддерживает функциональный setOpen во внутреннем состоянии', async () => {
    const user = userEvent.setup()
    renderProvider(<Probe />)
    await user.click(screen.getByRole('button', { name: 'flip' }))
    expect(screen.getByTestId('open')).toHaveTextContent('false')
    await user.click(screen.getByRole('button', { name: 'flip' }))
    expect(screen.getByTestId('open')).toHaveTextContent('true')
  })

  it('принимает прямое булево значение вместо функции', async () => {
    const user = userEvent.setup()
    renderProvider(<Probe />)
    await user.click(screen.getByRole('button', { name: 'close' }))
    expect(screen.getByTestId('open')).toHaveTextContent('false')
    expect(screen.getByTestId('state')).toHaveTextContent('collapsed')
    expect(getCookie('sidebar_state')).toBe('sidebar_state=false')
  })

  it('в контролируемом режиме сообщает наружу и не меняет состояние сам', async () => {
    const onOpenChange = vi.fn()
    const user = userEvent.setup()
    renderProvider(<Probe />, { open: false, onOpenChange })
    expect(screen.getByTestId('state')).toHaveTextContent('collapsed')
    await user.click(screen.getByRole('button', { name: 'toggle' }))
    expect(onOpenChange).toHaveBeenCalledWith(true)
    expect(screen.getByTestId('state')).toHaveTextContent('collapsed')
    expect(getCookie('sidebar_state')).toBe('sidebar_state=true')
  })

  it('на узком экране переключает мобильную панель, а не основную', async () => {
    setViewport(420)
    const user = userEvent.setup()
    renderProvider(<Probe />)
    await waitFor(() => expect(screen.getByTestId('isMobile')).toHaveTextContent('true'))
    expect(screen.getByTestId('open')).toHaveTextContent('true')
    await user.click(screen.getByRole('button', { name: 'toggle' }))
    expect(screen.getByTestId('openMobile')).toHaveTextContent('true')
    expect(screen.getByTestId('open')).toHaveTextContent('true')
    expect(getCookie('sidebar_state')).toBeUndefined()
  })
})

describe('горячая клавиша панели', () => {
  it('Ctrl+B переключает панель и гасит действие браузера', () => {
    renderProvider(<Probe />)
    const event = new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, cancelable: true })
    act(() => {
      window.dispatchEvent(event)
    })
    expect(event.defaultPrevented).toBe(true)
    expect(screen.getByTestId('state')).toHaveTextContent('collapsed')
  })

  it('Cmd+B на маке тоже переключает панель', () => {
    renderProvider(<Probe />)
    act(() => {
      fireEvent.keyDown(window, { key: 'b', metaKey: true })
    })
    expect(screen.getByTestId('state')).toHaveTextContent('collapsed')
  })

  it('не реагирует на b без модификатора и на другие клавиши с Ctrl', () => {
    renderProvider(<Probe />)
    act(() => {
      fireEvent.keyDown(window, { key: 'b' })
      fireEvent.keyDown(window, { key: 'j', ctrlKey: true })
    })
    expect(screen.getByTestId('state')).toHaveTextContent('expanded')
  })

  it('снимает обработчик при размонтировании', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderProvider(<Probe />)
    unmount()
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
    removeSpy.mockRestore()
  })
})

describe('провайдер и оболочка', () => {
  it('прокидывает ширину панели в стили и склеивает className', () => {
    const { container } = renderProvider(<div>контент</div>, { className: 'custom-wrapper' })
    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper).toHaveClass('custom-wrapper', 'group/sidebar-wrapper')
    expect(wrapper.style.getPropertyValue('--sidebar-width')).toBe('16rem')
    expect(wrapper.style.getPropertyValue('--sidebar-width-icon')).toBe('3rem')
    expect(wrapper).toHaveTextContent('контент')
  })

  it('collapsible="none" отдаёт плоский контейнер без состояния', () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar collapsible="none" className="plain-sidebar" data-testid="plain">
          <span>меню</span>
        </Sidebar>
      </SidebarProvider>,
    )
    const plain = container.querySelector('[data-testid="plain"]') as HTMLElement
    expect(plain.tagName).toBe('DIV')
    expect(plain).toHaveClass('plain-sidebar')
    expect(plain).not.toHaveAttribute('data-state')
    expect(plain).toHaveTextContent('меню')
  })

  it('развёрнутая панель помечает состояние и вариант', () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar side="left" variant="sidebar" collapsible="icon">
          <span>меню</span>
        </Sidebar>
      </SidebarProvider>,
    )
    const shell = container.querySelector('[data-state]') as HTMLElement
    expect(shell).toHaveAttribute('data-state', 'expanded')
    expect(shell).toHaveAttribute('data-collapsible', '')
    expect(shell).toHaveAttribute('data-variant', 'sidebar')
    expect(shell).toHaveAttribute('data-side', 'left')
    const inner = shell.querySelector('[data-sidebar="sidebar"]') as HTMLElement
    expect(inner).toHaveClass('flex', 'h-full', 'w-full', 'flex-col')
    expect(shell.querySelector('.left-0')).toBeTruthy()
  })

  it('свёрнутая панель справа отдаёт признак icon и классы floating', () => {
    const { container } = render(
      <SidebarProvider defaultOpen={false}>
        <Sidebar side="right" variant="floating" collapsible="icon" className="right-shell">
          <span>меню</span>
        </Sidebar>
      </SidebarProvider>,
    )
    const shell = container.querySelector('[data-state]') as HTMLElement
    expect(shell).toHaveAttribute('data-state', 'collapsed')
    expect(shell).toHaveAttribute('data-collapsible', 'icon')
    expect(shell).toHaveAttribute('data-variant', 'floating')
    expect(shell).toHaveAttribute('data-side', 'right')
    const panel = shell.querySelector('.right-shell') as HTMLElement
    expect(panel).toHaveClass('p-2')
    expect(panel.className).toContain('right-0')
  })

  it('на узком экране рисует выдвижную панель и закрывает её крестиком', async () => {
    setViewport(480)
    const user = userEvent.setup()
    render(
      <SidebarProvider>
        <Probe />
        <Sidebar collapsible="icon" side="left">
          <span>мобильное меню</span>
        </Sidebar>
      </SidebarProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('isMobile')).toHaveTextContent('true'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'open-mobile' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAttribute('data-sidebar', 'sidebar')
    expect(dialog).toHaveAttribute('data-mobile', 'true')
    expect(within(dialog).getByText('мобильное меню')).toBeInTheDocument()
    expect(dialog.style.getPropertyValue('--sidebar-width')).toBe('18rem')
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('openMobile')).toHaveTextContent('false')
  })
})

describe('кнопки управления панелью', () => {
  it('SidebarTrigger переключает панель и сохраняет внешний onClick', async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()
    renderProvider(<SidebarTrigger className="trigger-extra" onClick={onClick} />)
    const trigger = screen.getByRole('button')
    expect(trigger).toHaveAttribute('data-sidebar', 'trigger')
    expect(trigger).toHaveClass('trigger-extra', 'h-7', 'w-7')
    expect(within(trigger).getByText('Toggle Sidebar')).toHaveClass('sr-only')
    await user.click(trigger)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(getCookie('sidebar_state')).toBe('sidebar_state=false')
  })

  it('SidebarRail переключает панель кликом с клавиатуры и мышью', async () => {
    const user = userEvent.setup()
    renderProvider(<SidebarRail className="rail-extra" />)
    const rail = screen.getByRole('button', { name: 'Toggle Sidebar' })
    expect(rail).toHaveAttribute('data-sidebar', 'rail')
    expect(rail).toHaveAttribute('tabindex', '-1')
    expect(rail).toHaveClass('rail-extra')
    await user.click(rail)
    expect(getCookie('sidebar_state')).toBe('sidebar_state=false')
  })

  it('SidebarInset отдаёт main с прокидкой className', () => {
    const { container } = renderProvider(<SidebarInset className="inset-extra">страница</SidebarInset>)
    const main = container.querySelector('main') as HTMLElement
    expect(main).toHaveClass('inset-extra', 'flex-1')
    expect(main).toHaveTextContent('страница')
  })
})

describe('строительные блоки панели', () => {
  it('Input, Separator, Header, Footer, Content и Group помечают себя data-sidebar', () => {
    const { container } = renderProvider(
      <>
        <SidebarHeader className="header-extra">заголовок</SidebarHeader>
        <SidebarInput placeholder="поиск" className="input-extra" />
        <SidebarSeparator className="sep-extra" />
        <SidebarGroup className="group-extra">
          <SidebarGroupContent className="group-content-extra">группа</SidebarGroupContent>
        </SidebarGroup>
        <SidebarFooter className="footer-extra">подвал</SidebarFooter>
        <SidebarContent className="content-extra">контент</SidebarContent>
      </>,
    )
    const header = container.querySelector('[data-sidebar="header"]') as HTMLElement
    expect(header).toHaveClass('header-extra', 'flex-col')
    const input = container.querySelector('input') as HTMLInputElement
    expect(input.placeholder).toBe('поиск')
    expect(input).toHaveAttribute('data-sidebar', 'input')
    expect(input).toHaveClass('input-extra', 'h-8')
    expect(container.querySelector('[data-sidebar="separator"]')).toHaveClass('sep-extra')
    const group = container.querySelector('[data-sidebar="group"]') as HTMLElement
    expect(group).toHaveClass('group-extra', 'relative')
    const content = container.querySelector('[data-sidebar="group-content"]') as HTMLElement
    expect(content).toHaveClass('group-content-extra', 'text-sm')
    expect(container.querySelector('[data-sidebar="footer"]')).toHaveClass('footer-extra')
    expect(container.querySelector('[data-sidebar="content"]')).toHaveClass('content-extra', 'overflow-auto')
  })

  it('SidebarGroupLabel рисует div, а с asChild — переданный элемент', () => {
    const { container: plain } = renderProvider(<SidebarGroupLabel className="label-extra">Метка</SidebarGroupLabel>)
    const label = plain.querySelector('[data-sidebar="group-label"]') as HTMLElement
    expect(label.tagName).toBe('DIV')
    expect(label).toHaveClass('label-extra', 'text-xs')

    const { container: slotted } = renderProvider(
      <SidebarGroupLabel asChild className="slot-label">
        <span>Слот</span>
      </SidebarGroupLabel>,
    )
    const slot = slotted.querySelector('[data-sidebar="group-label"]') as HTMLElement
    expect(slot.tagName).toBe('SPAN')
    expect(slot).toHaveClass('slot-label')
    expect(slot).toHaveTextContent('Слот')
  })

  it('SidebarGroupAction рисует кнопку, а с asChild — ссылку', () => {
    const { container: plain } = renderProvider(<SidebarGroupAction className="action-extra">+</SidebarGroupAction>)
    const action = plain.querySelector('[data-sidebar="group-action"]') as HTMLElement
    expect(action.tagName).toBe('BUTTON')
    expect(action).toHaveClass('action-extra')

    const { container: slotted } = renderProvider(
      <SidebarGroupAction asChild>
        <a href="/admin/teams">команды</a>
      </SidebarGroupAction>,
    )
    const link = slotted.querySelector('[data-sidebar="group-action"]') as HTMLElement
    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', '/admin/teams')
  })
})

describe('меню панели', () => {
  it('Menu, MenuItem и MenuBadge помечают себя и склеивают классы', () => {
    const { container } = renderProvider(
      <SidebarMenu className="menu-extra">
        <SidebarMenuItem className="item-extra">
          <SidebarMenuBadge className="badge-extra">7</SidebarMenuBadge>
        </SidebarMenuItem>
      </SidebarMenu>,
    )
    const menu = container.querySelector('[data-sidebar="menu"]') as HTMLElement
    expect(menu.tagName).toBe('UL')
    expect(menu).toHaveClass('menu-extra', 'gap-1')
    const item = container.querySelector('[data-sidebar="menu-item"]') as HTMLElement
    expect(item.tagName).toBe('LI')
    expect(item).toHaveClass('item-extra', 'group/menu-item')
    const badge = container.querySelector('[data-sidebar="menu-badge"]') as HTMLElement
    expect(badge).toHaveClass('badge-extra', 'tabular-nums')
    expect(badge).toHaveTextContent('7')
  })

  it('MenuButton по умолчанию неактивен и отдаёт размер по умолчанию', () => {
    const { container } = renderProvider(<SidebarMenuButton className="btn-extra">Пункт</SidebarMenuButton>)
    const button = container.querySelector('[data-sidebar="menu-button"]') as HTMLElement
    expect(button.tagName).toBe('BUTTON')
    expect(button).toHaveAttribute('data-active', 'false')
    expect(button).toHaveAttribute('data-size', 'default')
    expect(button).toHaveClass('btn-extra')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('MenuButton передаёт активность, размер и вариант', () => {
    const { container } = renderProvider(
      <SidebarMenuButton isActive size="lg" variant="outline">
        Пункт
      </SidebarMenuButton>,
    )
    const button = container.querySelector('[data-sidebar="menu-button"]') as HTMLElement
    expect(button).toHaveAttribute('data-active', 'true')
    expect(button).toHaveAttribute('data-size', 'lg')
    expect(button.className).toContain('bg-background')
    expect(button.className).toContain('h-12')
  })

  it('MenuButton с asChild отдаёт разметку ссылке', () => {
    const { container } = renderProvider(
      <SidebarMenuButton asChild>
        <a href="/admin">Панель</a>
      </SidebarMenuButton>,
    )
    const link = container.querySelector('[data-sidebar="menu-button"]') as HTMLElement
    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', '/admin')
  })

  it('MenuButton показывает строковый тултип только в свёрнутой панели', async () => {
    setViewport(1280)
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    renderProvider(
      <SidebarMenuButton tooltip="Подсказка">Пункт</SidebarMenuButton>,
      { defaultOpen: false },
    )
    await user.hover(screen.getByRole('button'))
    await waitFor(() => expect(tooltipPanel()).not.toBeNull())
    expect(tooltipPanel()).not.toHaveAttribute('hidden')
    expect(tooltipPanel()).toHaveTextContent('Подсказка')
  })

  it('MenuButton прячет тултип при развёрнутой панели', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    renderProvider(<SidebarMenuButton tooltip="Подсказка">Пункт</SidebarMenuButton>)
    await user.hover(screen.getByRole('button'))
    await waitFor(() => expect(tooltipPanel()).not.toBeNull())
    expect(tooltipPanel()).toHaveAttribute('hidden')
  })

  it('MenuButton принимает объект настроек тултипа', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    renderProvider(
      <SidebarMenuButton tooltip={{ children: 'Своя подсказка', side: 'left' }}>Пункт</SidebarMenuButton>,
      { defaultOpen: false },
    )
    await user.hover(screen.getByRole('button'))
    await waitFor(() => expect(tooltipPanel()).not.toBeNull())
    expect(tooltipPanel()).toHaveTextContent('Своя подсказка')
    expect(tooltipPanel()).toHaveAttribute('data-side', 'left')
  })

  it('MenuAction рисует кнопку и добавляет классы показа по наведению', () => {
    const { container: plain } = renderProvider(<SidebarMenuAction className="action-btn">×</SidebarMenuAction>)
    const action = plain.querySelector('[data-sidebar="menu-action"]') as HTMLElement
    expect(action.tagName).toBe('BUTTON')
    expect(action.className).not.toContain('md:opacity-0')

    const { container: hover } = renderProvider(<SidebarMenuAction showOnHover>×</SidebarMenuAction>)
    const hoverAction = hover.querySelector('[data-sidebar="menu-action"]') as HTMLElement
    expect(hoverAction.className).toContain('md:opacity-0')
    expect(hoverAction.className).toContain('group-hover/menu-item:opacity-100')
  })

  it('MenuAction с asChild отдаёт разметку ссылке', () => {
    const { container } = renderProvider(
      <SidebarMenuAction asChild>
        <a href="/more">ещё</a>
      </SidebarMenuAction>,
    )
    const link = container.querySelector('[data-sidebar="menu-action"]') as HTMLElement
    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', '/more')
  })

  it('MenuSkeleton без иконки рисует одну заглушку с шириной 50–89 %', () => {
    const { container } = renderProvider(<SidebarMenuSkeleton className="skeleton-extra" />)
    const skeleton = container.querySelector('[data-sidebar="menu-skeleton"]') as HTMLElement
    expect(skeleton).toHaveClass('skeleton-extra')
    expect(container.querySelector('[data-sidebar="menu-skeleton-icon"]')).toBeNull()
    const text = container.querySelector('[data-sidebar="menu-skeleton-text"]') as HTMLElement
    const width = Number(text.style.getPropertyValue('--skeleton-width').replace('%', ''))
    expect(width).toBeGreaterThanOrEqual(50)
    expect(width).toBeLessThanOrEqual(89)
  })

  it('MenuSkeleton с иконкой добавляет квадратную заглушку', () => {
    const { container } = renderProvider(<SidebarMenuSkeleton showIcon />)
    expect(container.querySelector('[data-sidebar="menu-skeleton-icon"]')).not.toBeNull()
    expect(container.querySelector('[data-sidebar="menu-skeleton-text"]')).not.toBeNull()
  })

  it('MenuSub и SubItem создают вложенный список', () => {
    const { container } = renderProvider(
      <SidebarMenuSub className="sub-extra">
        <SidebarMenuSubItem className="sub-item-extra">элемент</SidebarMenuSubItem>
      </SidebarMenuSub>,
    )
    const sub = container.querySelector('[data-sidebar="menu-sub"]') as HTMLElement
    expect(sub.tagName).toBe('UL')
    expect(sub).toHaveClass('sub-extra', 'border-l')
    const item = sub.querySelector('li') as HTMLElement
    expect(item).toHaveClass('sub-item-extra')
    expect(item).toHaveTextContent('элемент')
  })

  it('SubButton по умолчанию средний размер, а со size="sm" — мелкий текст', () => {
    const { container: medium } = renderProvider(<SidebarMenuSubButton href="/a">Пункт</SidebarMenuSubButton>)
    const md = medium.querySelector('[data-sidebar="menu-sub-button"]') as HTMLElement
    expect(md.tagName).toBe('A')
    expect(md).toHaveAttribute('data-size', 'md')
    expect(md.className).toContain('text-sm')
    expect(md).not.toHaveAttribute('data-active')

    const { container: small } = renderProvider(
      <SidebarMenuSubButton size="sm" isActive>
        Пункт
      </SidebarMenuSubButton>,
    )
    const sm = small.querySelector('[data-sidebar="menu-sub-button"]') as HTMLElement
    expect(sm.className).toContain('text-xs')
    expect(sm).toHaveAttribute('data-active', 'true')
  })

  it('SubButton с asChild отдаёт разметку переданному элементу', () => {
    const { container } = renderProvider(
      <SidebarMenuSubButton asChild>
        <span>Слот</span>
      </SidebarMenuSubButton>,
    )
    const slot = container.querySelector('[data-sidebar="menu-sub-button"]') as HTMLElement
    expect(slot.tagName).toBe('SPAN')
    expect(slot).toHaveClass('-translate-x-px')
  })
})

describe('AdminLayout', () => {
  it('рисует заголовок админки и контент страницы', () => {
    render(
      <MemoryRouter>
        <AdminLayout>
          <div>контент админки</div>
        </AdminLayout>
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('t.admin.panel')
    expect(screen.getByText('контент админки').closest('main')).not.toBeNull()
    expect(screen.getByRole('link', { name: /t\.admin\.panel/ })).toHaveAttribute('href', '/admin')
  })

  it('держит кнопку панели в том же брейкпоинте, что и мобильная панель', () => {
    render(
      <MemoryRouter>
        <AdminLayout>контент</AdminLayout>
      </MemoryRouter>,
    )
    const trigger = screen.getByRole('button', { name: 'Toggle Sidebar' })
    expect(trigger).toHaveClass('md:hidden')
    expect(trigger).not.toHaveClass('sm:hidden')
    expect(screen.queryByText('Toggle Menu')).not.toBeInTheDocument()
  })

  it('на ширине 700px открывает меню админки через выдвижную панель', async () => {
    setViewport(700)
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/admin/users']}>
        <AdminLayout>контент</AdminLayout>
      </MemoryRouter>,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Toggle Sidebar' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('link', { name: /t\.admin\.dashboard/ })).toHaveAttribute('href', '/admin')
    expect(within(dialog).getByRole('link', { name: /t\.admin\.users/ })).toHaveAttribute('href', '/admin/users')
  })

  it('на десктопе держит панель на месте и не открывает диалог', async () => {
    setViewport(1440)
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <AdminLayout>контент</AdminLayout>
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: /t\.admin\.dashboard/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Toggle Sidebar' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('AdminSidebar', () => {
  function renderSidebar(pathname = '/admin') {
    return render(
      <MemoryRouter initialEntries={[pathname]}>
        <SidebarProvider>
          <AdminSidebar />
        </SidebarProvider>
      </MemoryRouter>,
    )
  }

  it('показывает все пункты навигации со ссылками', () => {
    renderSidebar()
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(20)
    expect(screen.getByRole('link', { name: /t\.admin\.queues/ })).toHaveAttribute('href', '/admin/queues')
    expect(screen.getByRole('link', { name: /t\.admin\.partners/ })).toHaveAttribute('href', '/admin/partners')
    expect(screen.getByRole('link', { name: 'SwiftMatch' })).toHaveAttribute('href', '/admin')
  })

  it('подсвечивает текущий пункт и вложенный маршрут', () => {
    const { unmount } = renderSidebar('/admin/analytics')
    const analytics = screen.getByRole('link', { name: /t\.admin\.analytics/ })
    expect(analytics).toHaveAttribute('data-active', 'true')
    expect(screen.getByRole('link', { name: /t\.admin\.users/ })).toHaveAttribute('data-active', 'false')
    unmount()

    renderSidebar('/admin/users/42')
    expect(screen.getByRole('link', { name: /t\.admin\.users/ })).toHaveAttribute('data-active', 'true')
    expect(screen.getByRole('link', { name: /t\.admin\.dashboard/ })).toHaveAttribute('data-active', 'false')
  })

  it('схлопывает панель кнопкой и прячет название', async () => {
    const user = userEvent.setup()
    renderSidebar()
    expect(screen.getByRole('link', { name: 'SwiftMatch' })).toBeInTheDocument()
    const collapse = screen.getAllByRole('button')[0]
    await user.click(collapse)
    await waitFor(() => expect(screen.queryByText('SwiftMatch')).not.toBeInTheDocument())
    expect(getCookie('sidebar_state')).toBe('sidebar_state=false')
  })

  it('открывает выбор языка и переключает его', async () => {
    const user = userEvent.setup()
    renderSidebar()
    const trigger = screen.getByRole('button', { name: /t\.admin\.language/ })
    await user.click(trigger)
    const english = await screen.findByRole('menuitem', { name: 'English' })
    await user.click(english)
    expect(h.setLanguage).toHaveBeenCalledWith('EN')
  })

  it('помечает выбранный язык галочкой', async () => {
    h.language = 'EN'
    const user = userEvent.setup()
    renderSidebar()
    await user.click(screen.getByRole('button', { name: /t\.admin\.language/ }))
    const english = await screen.findByRole('menuitem', { name: 'English' })
    expect(english.querySelector('svg')).not.toBeNull()
    const russian = screen.getByRole('menuitem', { name: 'Русский' })
    expect(russian.querySelector('svg')).toBeNull()
  })

  it('переключает язык на русский', async () => {
    const user = userEvent.setup()
    renderSidebar()
    await user.click(screen.getByRole('button', { name: /t\.admin\.language/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'Русский' }))
    expect(h.setLanguage).toHaveBeenCalledWith('RU')
  })

  it('держит ссылки «в приложение» и «выйти»', () => {
    renderSidebar()
    expect(screen.getByRole('link', { name: /t\.admin\.back_to_app/ })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: /t\.admin\.logout/ })).toHaveAttribute('href', '/login')
  })
})
