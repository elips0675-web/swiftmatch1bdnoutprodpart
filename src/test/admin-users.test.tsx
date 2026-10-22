import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'

const mockFetch = vi.fn()
globalThis.fetch = mockFetch as unknown as typeof fetch

const h = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  token: 'admin-token' as string | null,
  impersonate: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    success: (message?: string) => h.toastSuccess(message),
    error: (message?: string) => h.toastError(message),
  },
}))

vi.mock('@/lib/token', () => ({ getToken: () => h.token }))
vi.mock('@/lib/impersonation', () => ({ startImpersonation: h.impersonate }))

vi.mock('@/context/language-context', () => {
  const t = (key: string) => key
  return { useLanguage: () => ({ t, language: 'RU', setLanguage: () => {} }) }
})

vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange?: (value: string) => void; children?: React.ReactNode }) => (
    <select value={value} onChange={(event) => onValueChange?.(event.target.value)}>{children}</select>
  ),
  SelectTrigger: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children?: React.ReactNode }) => <option value={value}>{children}</option>,
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children?: React.ReactNode }) => <div role="menu">{children}</div>,
  DropdownMenuItem: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
    <button type="button" role="menuitem" onClick={onClick}>{children}</button>
  ),
  DropdownMenuSeparator: () => <hr />,
}))

vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ open, children }: { open?: boolean; children?: React.ReactNode }) => (open ? <div role="dialog">{children}</div> : null),
  SheetContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children?: React.ReactNode }) => <h2>{children}</h2>,
  SheetDescription: ({ children }: { children?: React.ReactNode }) => <p>{children}</p>,
}))

import AdminUsersPage from '@/pages/admin-users'

const users = [
  {
    id: 1, name: 'Анна', age: 28, email: 'anna@test.ru', city: 'Москва', status: 'active',
    premium: 'gold', online: true, joined: '2026-09-01', lastActive: '2026-10-20', bio: 'Люблю горы',
  },
  {
    id: 2, name: 'Борис', age: 34, email: 'boris@test.ru', city: 'Санкт-Петербург', status: 'banned',
    premium: 'free', online: false, joined: '2026-08-15', lastActive: '2026-10-01', bio: '',
  },
  {
    id: 3, name: 'Вера', age: 41, email: 'vera@test.ru', city: 'Москва', status: 'pending',
    premium: 'platinum', online: false, joined: '2026-07-10', lastActive: '2026-10-19', bio: 'Кино',
  },
]

const detail = {
  id: 1, name: 'Анна', age: 28, email: 'anna@test.ru', city: 'Москва', status: 'active',
  premium: 'gold', online: true, joined: '2026-09-01', lastActive: '2026-10-20', bio: 'Люблю горы',
  matchesCount: 7, reportsCount: 2,
}

const groups = [
  {
    key: 'phone:71234567890',
    kind: 'phone',
    users: [
      { id: 11, name: 'Иван', email: 'ivan@test.ru', phone: '+7 123 456-78-90', city: 'Москва', joined: '2026-09-01', status: 'active', matchesCount: 3, messagesCount: 12, activeSubs: 1 },
      { id: 12, name: 'Иван Второй', email: 'ivan2@test.ru', phone: null, city: null, joined: '2026-09-15', status: 'banned', matchesCount: 0, messagesCount: 0, activeSubs: 0 },
    ],
  },
]

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response)
}

function usersResponse(overrides: Record<string, unknown> = {}) {
  return { users, total: 40, cities: ['Москва', 'Санкт-Петербург'], ...overrides }
}

function defaultFetch(url: string, init?: RequestInit) {
  const method = init?.method ?? 'GET'
  if (url.startsWith('/api/admin/users?') && method === 'GET') return jsonResponse(usersResponse())
  if (url === '/api/admin/users/duplicates') return jsonResponse({ groups })
  if (url === '/api/admin/users/1' && method === 'GET') return jsonResponse(detail)
  if (url === '/api/admin/users/1' && method === 'DELETE') return jsonResponse({ message: 'deleted' })
  if (url.endsWith('/bulk')) return jsonResponse({ updated: 2 })
  if (url.endsWith('/ban') || url.endsWith('/unban')) return jsonResponse({ message: 'ok' })
  if (url.includes('/impersonate/')) return jsonResponse({ token: 'imp-token' })
  if (url.endsWith('/merge')) return jsonResponse({ message: 'merged' })
  return jsonResponse({})
}

function usersCalls() {
  return mockFetch.mock.calls.filter(([url]) => String(url).startsWith('/api/admin/users?'))
}

function lastUsersUrl() {
  const calls = usersCalls()
  return new URL(String(calls[calls.length - 1][0]), 'http://localhost')
}

async function renderLoaded() {
  const utils = render(<AdminUsersPage />)
  await screen.findByText('Анна, 28')
  return utils
}

function firstRow() {
  return screen.getByText('Анна, 28').closest('tr') as HTMLTableRowElement
}

let createObjectURL: ReturnType<typeof vi.fn>
let revokeObjectURL: ReturnType<typeof vi.fn>
let anchorClick: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  mockFetch.mockReset()
  mockFetch.mockImplementation(defaultFetch)
  h.token = 'admin-token'
  createObjectURL = vi.fn(() => 'blob:users')
  revokeObjectURL = vi.fn()
  Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true })
  Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true })
  anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

afterEach(() => {
  anchorClick.mockRestore()
})

describe('admin-users: список и загрузка', () => {
  it('заполняет таблицу пользователями (регресс: setUsers отсутствовал) и городами фильтра', async () => {
    await renderLoaded()

    expect(screen.getByText('Анна, 28')).toBeTruthy()
    expect(screen.getByText('Борис, 34')).toBeTruthy()
    expect(screen.getByText('Вера, 41')).toBeTruthy()
    expect(screen.getByText('anna@test.ru')).toBeTruthy()
    expect(screen.getAllByText('admin.users.status.active').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Gold').length).toBeGreaterThan(0)
    expect(screen.getByText('1 / 3')).toBeTruthy()

    const citySelect = screen.getAllByRole('combobox')[1]
    expect(within(citySelect as HTMLElement).getByText('Москва')).toBeTruthy()

    const call = usersCalls()[0]
    expect((call[1] as RequestInit).headers).toEqual({ Authorization: 'Bearer admin-token' })
  })

  it('показывает спиннер до ответа', async () => {
    let resolveFetch: (value: Response) => void = () => {}
    mockFetch.mockImplementation(() => new Promise<Response>((resolve) => { resolveFetch = resolve }))
    const { container } = render(<AdminUsersPage />)
    expect(container.querySelector('.animate-spin')).not.toBeNull()
    resolveFetch((await jsonResponse(usersResponse())) as Response)
    await screen.findByText('Анна, 28')
    expect(container.querySelector('.animate-spin')).toBeNull()
  })

  it('ошибка загрузки — тост и пустая таблица', async () => {
    mockFetch.mockRejectedValue(new Error('network down'))
    render(<AdminUsersPage />)
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('admin.error.load'))
    expect(screen.queryByText('Анна, 28')).toBeNull()
  })

  it('без токена запрос уходит без Authorization', async () => {
    h.token = null
    await renderLoaded()
    const call = usersCalls()[0]
    expect((call[1] as RequestInit).headers).toEqual({})
  })

  it('пустой список городов не затирает подписи фильтра', async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) =>
      url.startsWith('/api/admin/users?') ? jsonResponse(usersResponse({ cities: [] })) : defaultFetch(url, init),
    )
    await renderLoaded()
    const citySelect = screen.getAllByRole('combobox')[1] as HTMLElement
    expect(within(citySelect).queryByText('Москва')).toBeNull()
  })
})

describe('admin-users: фильтры, сортировка и пагинация', () => {
  it('поиск и три фильтра сбрасывают страницу и уходят в query', async () => {
    const user = userEvent.setup()
    await renderLoaded()

    await user.type(screen.getByTestId('search-users'), 'Анна')
    await waitFor(() => expect(lastUsersUrl().searchParams.get('search')).toBe('Анна'))

    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[0], { target: { value: 'banned' } })
    await waitFor(() => expect(lastUsersUrl().searchParams.get('status')).toBe('banned'))
    fireEvent.change(selects[1], { target: { value: 'Москва' } })
    await waitFor(() => expect(lastUsersUrl().searchParams.get('city')).toBe('Москва'))
    fireEvent.change(selects[2], { target: { value: 'gold' } })
    await waitFor(() => expect(lastUsersUrl().searchParams.get('premium')).toBe('gold'))

    expect(lastUsersUrl().searchParams.get('page')).toBe('1')
  })

  it('клик по колонке меняет поле сортировки, повторный — направление', async () => {
    const user = userEvent.setup()
    await renderLoaded()

    await user.click(screen.getByText(/admin\.users\.name/))
    await waitFor(() => expect(lastUsersUrl().searchParams.get('sort')).toBe('name'))
    expect(lastUsersUrl().searchParams.get('dir')).toBe('asc')

    await user.click(screen.getByText(/admin\.users\.name/))
    await waitFor(() => expect(lastUsersUrl().searchParams.get('dir')).toBe('desc'))

    await user.click(screen.getByText(/admin\.users\.age/))
    await waitFor(() => expect(lastUsersUrl().searchParams.get('sort')).toBe('age'))
    expect(lastUsersUrl().searchParams.get('dir')).toBe('asc')
  })

  it('пагинация вперёд и назад, крайние кнопки заблокированы', async () => {
    const user = userEvent.setup()
    await renderLoaded()

    const buttons = screen.getAllByRole('button')
    const prev = buttons[buttons.length - 2] as HTMLButtonElement
    const next = buttons[buttons.length - 1] as HTMLButtonElement
    expect(prev.disabled).toBe(true)
    expect(next.disabled).toBe(false)

    await user.click(next)
    await waitFor(() => expect(screen.getByText('2 / 3')).toBeTruthy())
    expect(lastUsersUrl().searchParams.get('page')).toBe('2')

    await user.click(prev)
    await waitFor(() => expect(screen.getByText('1 / 3')).toBeTruthy())
  })

  it('повторный клик по дате регистрации даёт сортировку по возрастанию', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    await user.click(screen.getByText(/admin\.users\.joined/))
    await waitFor(() => expect(lastUsersUrl().searchParams.get('sort')).toBe('joined'))
    expect(lastUsersUrl().searchParams.get('dir')).toBe('asc')
  })

  it('последняя страница: кнопка «вперёд» заблокирована', async () => {    mockFetch.mockImplementation((url: string, init?: RequestInit) =>
      url.startsWith('/api/admin/users?') ? jsonResponse(usersResponse({ total: 30 })) : defaultFetch(url, init),
    )
    await renderLoaded()
    const user = userEvent.setup()
    const buttons = screen.getAllByRole('button')
    await user.click(buttons[buttons.length - 1])
    await waitFor(() => expect(screen.getByText('2 / 2')).toBeTruthy())
    expect((screen.getAllByRole('button').at(-1) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('admin-users: выбор и массовые действия', () => {
  it('выбирает всех и снимает выбор чекбоксом в заголовке', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    const headerCheckbox = screen.getAllByRole('checkbox')[0]
    await user.click(headerCheckbox)
    expect(screen.getByText('3 admin.users.selected')).toBeTruthy()
    await user.click(headerCheckbox)
    expect(screen.queryByText('3 admin.users.selected')).toBeNull()
  })

  it('снимает выбор отдельного пользователя', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[1])
    expect(screen.getByText('1 admin.users.selected')).toBeTruthy()
    await user.click(checkboxes[1])
    expect(screen.queryByText('1 admin.users.selected')).toBeNull()
  })

  it.each([
    ['admin.users.ban', 'ban'],
    ['admin.users.suspend', 'suspend'],
    ['admin.users.delete', 'delete'],
  ])('массовое действие %s отправляет POST bulk с action=%s', async (label, action) => {
    const user = userEvent.setup()
    await renderLoaded()
    await user.click(screen.getAllByRole('checkbox')[1])
    await user.click(screen.getAllByText(label)[0])
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/admin/users/bulk', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ ids: [1], action }),
    })))
    expect(h.toastSuccess).toHaveBeenCalledWith(`1 — admin.users.bulk_${action === 'ban' ? 'banned' : action === 'suspend' ? 'suspended' : 'deleted'}`)
    await waitFor(() => expect(screen.queryByText('1 admin.users.selected')).toBeNull())
  })

  it('ошибка массового действия — тост, выбор сохранён', async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) =>
      url.endsWith('/bulk') ? jsonResponse({ message: 'nope' }, 500) : defaultFetch(url, init),
    )
    const user = userEvent.setup()
    await renderLoaded()
    await user.click(screen.getAllByRole('checkbox')[1])
    await user.click(screen.getByText('admin.users.ban'))
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('admin.error.operation'))
    expect(screen.getByText('1 admin.users.selected')).toBeTruthy()
  })
})

describe('admin-users: действия строки', () => {
  it('удаляет пользователя из меню строки и перезагружает список', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    await user.click(within(firstRow()).getAllByRole('menuitem')[3])

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/admin/users/1', expect.objectContaining({ method: 'DELETE' })))
    expect(h.toastSuccess).toHaveBeenCalledWith('admin.users.deleted_toast')
    await waitFor(() => expect(usersCalls().length).toBeGreaterThan(1))
  })

  it('ошибка удаления — тост ошибки', async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) =>
      url === '/api/admin/users/1' && init?.method === 'DELETE'
        ? jsonResponse({ message: 'nope' }, 500)
        : defaultFetch(url, init),
    )
    const user = userEvent.setup()
    await renderLoaded()
    await user.click(within(firstRow()).getAllByRole('menuitem')[3])
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('admin.error.operation'))
  })

  it('банит активного пользователя', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    await user.click(within(firstRow()).getAllByRole('menuitem')[2])

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/admin/users/1/ban', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ reason: 'Admin action' }),
    })))
    expect(h.toastSuccess).toHaveBeenCalledWith('admin.users.banned_toast')
  })

  it('разбанивает забаненного пользователя', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    const bannedRow = screen.getByText('Борис, 34').closest('tr') as HTMLTableRowElement
    await user.click(within(bannedRow).getAllByRole('menuitem')[2])

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/admin/users/2/unban', expect.objectContaining({ method: 'POST' })))
    expect(h.toastSuccess).toHaveBeenCalledWith('admin.users.unbanned_toast')
  })

  it('ошибка разбана — тост ошибки', async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) =>
      url.endsWith('/unban') ? jsonResponse({ message: 'nope' }, 500) : defaultFetch(url, init),
    )
    const user = userEvent.setup()
    await renderLoaded()
    const bannedRow = screen.getByText('Борис, 34').closest('tr') as HTMLTableRowElement
    await user.click(within(bannedRow).getAllByRole('menuitem')[2])

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('admin.error.operation'))
    expect(h.toastSuccess).not.toHaveBeenCalledWith('admin.users.unbanned_toast')
  })

  it('просмотр из меню строки открывает карточку', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    await user.click(within(firstRow()).getAllByRole('menuitem')[0])

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('anna@test.ru')).toBeTruthy()
  })

  it('ошибка бана — тост ошибки, а не ложный успех', async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) =>
      url.endsWith('/ban') ? jsonResponse({ message: 'nope' }, 500) : defaultFetch(url, init),
    )
    const user = userEvent.setup()
    await renderLoaded()
    await user.click(within(firstRow()).getAllByRole('menuitem')[2])

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('admin.error.operation'))
    expect(h.toastSuccess).not.toHaveBeenCalledWith('admin.users.banned_toast')
  })

  it('имперсонация из меню ставит токен пользователя', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    await user.click(within(firstRow()).getAllByRole('menuitem')[1])

    await waitFor(() => expect(h.impersonate).toHaveBeenCalledWith('imp-token', { id: 1, name: 'Анна' }))
    expect(h.toastError).not.toHaveBeenCalled()
  })

  it('имперсонация без токена в ответе — тост ошибки', async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) =>
      url.includes('/impersonate/') ? jsonResponse({}) : defaultFetch(url, init),
    )
    const user = userEvent.setup()
    await renderLoaded()
    await user.click(within(firstRow()).getAllByRole('menuitem')[1])

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('admin.impersonate.error'))
    expect(h.impersonate).not.toHaveBeenCalled()
  })

  it('имперсонация при отказе сервера — тост ошибки', async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) =>
      url.includes('/impersonate/') ? jsonResponse({ message: 'forbidden' }, 403) : defaultFetch(url, init),
    )
    const user = userEvent.setup()
    await renderLoaded()
    await user.click(within(firstRow()).getAllByRole('menuitem')[1])

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('admin.impersonate.error'))
    expect(h.impersonate).not.toHaveBeenCalled()
  })

  it('имперсонация при падении сети — тост ошибки', async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) =>
      url.includes('/impersonate/') ? Promise.reject(new Error('net')) : defaultFetch(url, init),
    )
    const user = userEvent.setup()
    await renderLoaded()
    await user.click(within(firstRow()).getAllByRole('menuitem')[1])

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('admin.impersonate.error'))
  })
})

describe('admin-users: карточка пользователя', () => {
  it('открывает карточку с деталями по клику на имя', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    await user.click(screen.getByText('Анна, 28'))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('anna@test.ru')).toBeTruthy()
    expect(within(dialog).getByText('Люблю горы')).toBeTruthy()
    expect(within(dialog).getByText('7')).toBeTruthy()
    expect(within(dialog).getByText('2')).toBeTruthy()
  })

  it('ошибка загрузки карточки — тост, карточка не открывается', async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) =>
      url === '/api/admin/users/1' && (init?.method ?? 'GET') === 'GET'
        ? jsonResponse({ message: 'nope' }, 500)
        : defaultFetch(url, init),
    )
    const user = userEvent.setup()
    await renderLoaded()
    await user.click(screen.getByText('Анна, 28'))

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('admin.error.load'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('удаление из карточки закрывает её и перезагружает список', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    await user.click(screen.getByText('Анна, 28'))
    const dialog = await screen.findByRole('dialog')
    const buttons = within(dialog).getAllByRole('button')
    await user.click(buttons[buttons.length - 1])

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith('admin.users.deleted_toast'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('бан из карточки отправляет запрос и обновляет данные', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    await user.click(screen.getByText('Анна, 28'))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getAllByRole('button')[1])

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/admin/users/1/ban', expect.objectContaining({ method: 'POST' })))
    expect(h.toastSuccess).toHaveBeenCalledWith('admin.users.banned_toast')
  })

  it('имперсонация из карточки', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    await user.click(screen.getByText('Анна, 28'))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByTestId('impersonate-drawer'))

    await waitFor(() => expect(h.impersonate).toHaveBeenCalledWith('imp-token', { id: 1, name: 'Анна' }))
  })

  it('карточка: неизвестные статус и план, пустые счётчики и био показывают прочерки', async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) =>
      url === '/api/admin/users/1' && (init?.method ?? 'GET') === 'GET'
        ? jsonResponse({ ...detail, status: 'weird', premium: 'unknown', matchesCount: null, reportsCount: null, bio: '' })
        : defaultFetch(url, init),
    )
    const user = userEvent.setup()
    await renderLoaded()
    await user.click(screen.getByText('Анна, 28'))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('weird')).toBeTruthy()
    expect(within(dialog).getByText('unknown')).toBeTruthy()
    expect(within(dialog).getAllByText('—')).toHaveLength(3)
  })

  it('карточка забаненного предлагает разбан', async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) =>
      url === '/api/admin/users/2' && (init?.method ?? 'GET') === 'GET'
        ? jsonResponse({ ...detail, id: 2, name: 'Борис', status: 'banned' })
        : defaultFetch(url, init),
    )
    const user = userEvent.setup()
    await renderLoaded()
    await user.click(screen.getByText('Борис, 34'))
    const dialog = await screen.findByRole('dialog')

    expect(within(dialog).getByText('admin.users.unblock')).toBeTruthy()
  })
})

describe('admin-users: экспорт CSV', () => {
  it('выгружает пользователей в CSV и показывает тост', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    await user.click(screen.getByRole('button', { name: /CSV/ }))

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:users')
    expect(anchorClick).toHaveBeenCalledTimes(1)
    expect(h.toastSuccess).toHaveBeenCalledWith('admin.users.csv_downloaded')

    const blob = (createObjectURL.mock.calls[0] as [Blob])[0]
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsText(blob)
    })
    expect(text).toContain('ID,Name,Age,Email,City,Status,Plan,Joined')
    expect(text).toContain('"Анна"')
    expect(text).toContain('"admin.users.status.active"')
  })

  it('неизвестный статус в CSV выгружается как есть', async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) =>
      url.startsWith('/api/admin/users?')
        ? jsonResponse(usersResponse({ users: [{ ...users[0], status: 'mystery' }], total: 1 }))
        : defaultFetch(url, init),
    )
    const user = userEvent.setup()
    await renderLoaded()
    await user.click(screen.getByRole('button', { name: /CSV/ }))

    const blob = (createObjectURL.mock.calls[0] as [Blob])[0]
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsText(blob)
    })
    expect(text).toContain('"mystery"')
  })

  it('пустой список — файл не создаётся', async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) =>
      url.startsWith('/api/admin/users?') ? jsonResponse(usersResponse({ users: [], total: 0 })) : defaultFetch(url, init),
    )
    const user = userEvent.setup()
    render(<AdminUsersPage />)
    await waitFor(() => expect(screen.getByText('admin.users.duplicates')).toBeTruthy())
    await user.click(screen.getByRole('button', { name: /CSV/ }))

    expect(createObjectURL).not.toHaveBeenCalled()
    expect(h.toastSuccess).not.toHaveBeenCalled()
  })
})

describe('admin-users: дубликаты', () => {
  it('вкладка дубликатов загружает и показывает группы', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    await user.click(screen.getByTestId('tab-duplicates'))

    await waitFor(() => expect(screen.getByTestId('dup-group-phone:71234567890')).toBeTruthy())
    expect(screen.getByTestId('dup-user-11')).toBeTruthy()
    expect(screen.getByTestId('dup-user-12')).toBeTruthy()
    expect(screen.getByText(/ivan@test\.ru · \+7 123 456-78-90 · Москва/)).toBeTruthy()
  })

  it('ошибка загрузки дубликатов — тост и пустое состояние', async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) =>
      url === '/api/admin/users/duplicates' ? jsonResponse({ message: 'nope' }, 500) : defaultFetch(url, init),
    )
    const user = userEvent.setup()
    await renderLoaded()
    await user.click(screen.getByTestId('tab-duplicates'))

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('admin.error.load'))
    expect(screen.getByText('admin.users.duplicates.empty')).toBeTruthy()
  })

  it('дубликаты без поля groups — пустое состояние', async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) =>
      url === '/api/admin/users/duplicates' ? jsonResponse({}) : defaultFetch(url, init),
    )
    const user = userEvent.setup()
    await renderLoaded()
    await user.click(screen.getByTestId('tab-duplicates'))

    await waitFor(() => expect(screen.getByText('admin.users.duplicates.empty')).toBeTruthy())
  })

  it('ошибка объединения — тост merge_error и спиннер снят', async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) =>
      url.endsWith('/merge') ? jsonResponse({ message: 'nope' }, 500) : defaultFetch(url, init),
    )
    const user = userEvent.setup()
    await renderLoaded()
    await user.click(screen.getByTestId('tab-duplicates'))
    await waitFor(() => expect(screen.getByTestId('dup-radio-11')).toBeTruthy())
    await user.click(screen.getByTestId('dup-radio-11'))
    const merge = screen.getByTestId('merge-group-phone:71234567890') as HTMLButtonElement
    await waitFor(() => expect(merge.disabled).toBe(false))
    await user.click(merge)

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('admin.users.duplicates.merge_error'))
    expect((screen.getByTestId('merge-group-phone:71234567890') as HTMLButtonElement).disabled).toBe(false)
    expect(h.toastSuccess).not.toHaveBeenCalledWith('admin.users.duplicates.merged')
  })
})
