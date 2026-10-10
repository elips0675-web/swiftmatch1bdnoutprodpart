import { describe, it, expect, beforeEach } from 'vitest'
import { setToken, getToken } from '@/lib/token'
import { startImpersonation, getImpersonatedUser, isImpersonating, stopImpersonation } from '@/lib/impersonation'

describe('impersonation helpers', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    setToken(null)
  })

  it('startImpersonation подменяет токен и запоминает пользователя', () => {
    setToken('admin-token')
    startImpersonation('user-token', { id: 5, name: 'Bob' })

    expect(getToken()).toBe('user-token')
    expect(isImpersonating()).toBe(true)
    expect(getImpersonatedUser()).toEqual({ id: 5, name: 'Bob' })
  })

  it('stopImpersonation возвращает админский токен', () => {
    setToken('admin-token')
    startImpersonation('user-token', { id: 5, name: 'Bob' })

    expect(stopImpersonation()).toBe(true)
    expect(getToken()).toBe('admin-token')
    expect(isImpersonating()).toBe(false)
    expect(getImpersonatedUser()).toBeNull()
  })

  it('stopImpersonation без сохранённого админ-токена ничего не меняет', () => {
    setToken('user-token')
    expect(stopImpersonation()).toBe(false)
    expect(getToken()).toBe('user-token')
  })

  it('getImpersonatedUser устойчив к битому JSON', () => {
    sessionStorage.setItem('swiftmatch_impersonated_user', '{not-json')
    expect(getImpersonatedUser()).toBeNull()
  })
})
