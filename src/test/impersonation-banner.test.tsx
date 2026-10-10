import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import React from 'react'

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({
    t: (key: string, vars?: Record<string, string | number>) => (vars && 'name' in vars ? `${key}:${vars.name}` : key),
    language: 'ru',
    setLanguage: () => {},
  }),
}))

import { setToken } from '@/lib/token'
import { startImpersonation } from '@/lib/impersonation'
import { ImpersonationBanner } from '@/components/impersonation-banner'

describe('ImpersonationBanner', () => {
  beforeEach(() => {
    cleanup()
    sessionStorage.clear()
    localStorage.clear()
    setToken(null)
  })

  it('не рисуется, когда impersonation не активен', () => {
    render(<ImpersonationBanner />)
    expect(screen.queryByTestId('impersonation-banner')).toBeNull()
  })

  it('показывает имя пользователя и кнопку возврата в режиме impersonation', () => {
    setToken('admin-token')
    startImpersonation('user-token', { id: 5, name: 'Bob' })

    render(<ImpersonationBanner />)

    const banner = screen.getByTestId('impersonation-banner')
    expect(banner.textContent).toContain('admin.impersonate.banner:Bob')
    expect(screen.getByTestId('impersonation-return')).toBeTruthy()
  })
})
