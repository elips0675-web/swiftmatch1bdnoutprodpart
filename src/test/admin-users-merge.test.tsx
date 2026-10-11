import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'

const t = (key: string) => key

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t, language: 'ru', setLanguage: () => {} }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/token', () => ({ getToken: () => 'admin-token' }))

import AdminUsersPage from '@/pages/admin-users'
import { toast } from 'sonner'

const dupGroups = [
  {
    key: 'phone:71234567890',
    kind: 'phone',
    users: [
      { id: 11, name: 'Ivan', email: 'ivan@test.ru', phone: '+7 123 456-78-90', city: 'Moscow', joined: '2026-09-01', status: 'active', matchesCount: 3, messagesCount: 12, activeSubs: 1 },
      { id: 12, name: 'Ivan Second', email: 'ivan2@test.ru', phone: '+7 (123) 456-78-90', city: 'Moscow', joined: '2026-09-15', status: 'active', matchesCount: 0, messagesCount: 0, activeSubs: 0 },
    ],
  },
  {
    key: 'email:dup@test.ru',
    kind: 'email',
    users: [
      { id: 21, name: 'Anna', email: 'dup@test.ru', phone: null, city: 'SPb', joined: '2026-08-20', status: 'active', matchesCount: 1, messagesCount: 5, activeSubs: 0 },
    ],
  },
]

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  fetchMock = vi.fn(async (url: unknown): Promise<{ ok: boolean; json: () => Promise<unknown> }> => {
    const u = String(url)
    if (u.includes('/users/duplicates')) {
      return { ok: true, json: async () => ({ groups: dupGroups }) }
    }
    if (u.includes('/merge')) {
      return { ok: true, json: async () => ({ message: 'Users merged' }) }
    }
    return { ok: true, json: async () => ({ users: [], total: 0, cities: [] }) }
  })
  global.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AdminUsersPage duplicates', () => {
  it('вкладка «Дубликаты» загружает группы и рисует юзеров, неактивная вкладка не грузит', async () => {
    const user = userEvent.setup()
    render(<AdminUsersPage />)
    expect(screen.getByTestId('tab-duplicates')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalledWith('/api/admin/users/duplicates', expect.anything())
    await user.click(screen.getByTestId('tab-duplicates'))
    await waitFor(() => expect(screen.getByTestId('dup-user-11')).toBeTruthy())
    expect(screen.getByTestId('dup-user-12')).toBeTruthy()
    expect(screen.getByTestId('dup-group-phone:71234567890')).toBeTruthy()
    expect(screen.getByTestId('dup-group-email:dup@test.ru')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/users/duplicates', expect.anything())
  })

  it('объединение шлёт POST merge только для не-keep юзеров и обновляет список', async () => {
    const user = userEvent.setup()
    render(<AdminUsersPage />)
    await user.click(screen.getByTestId('tab-duplicates'))
    await waitFor(() => expect(screen.getByTestId('dup-radio-11')).toBeTruthy())
    await user.click(screen.getByTestId('dup-radio-11'))
    const mergeBtn = screen.getByTestId('merge-group-phone:71234567890')
    await waitFor(() => expect((mergeBtn as HTMLButtonElement).disabled).toBe(false))
    await user.click(mergeBtn)
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/users/12/merge',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ keepId: 11 }),
        }),
      ),
    )
    expect(fetchMock).not.toHaveBeenCalledWith('/api/admin/users/11/merge', expect.anything())
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/users/duplicates', expect.anything()))
  })

  it('кнопка «Объединить» без выбранного keep заблокирована', async () => {
    const user = userEvent.setup()
    render(<AdminUsersPage />)
    await user.click(screen.getByTestId('tab-duplicates'))
    await waitFor(() => expect(screen.getByTestId('merge-group-phone:71234567890')).toBeTruthy())
    const mergeBtn = screen.getByTestId('merge-group-phone:71234567890') as HTMLButtonElement
    expect(mergeBtn.disabled).toBe(true)
  })
})