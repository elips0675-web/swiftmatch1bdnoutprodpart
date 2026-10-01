import { setToken } from './token'

/**
 * Обновление access-токена по refresh-токену. Web берёт refresh из httpOnly cookie,
 * натив — из sessionStorage (там cookie нет).
 * Возвращает новый access-токен или null, если сессию продлить нельзя.
 */
export async function refreshAuthToken(): Promise<string | null> {
  const { isNative } = await import('./native')
  const refreshToken = isNative() ? sessionStorage.getItem('swiftmatch_refresh_token') : null
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      ...(refreshToken ? { body: JSON.stringify({ refresh_token: refreshToken }) } : {}),
    })
    if (!res.ok) return null
    const data = await res.json()
    const token = data?.token
    if (typeof token !== 'string' || !token) return null
    setToken(token)
    if (refreshToken && typeof data.refresh_token === 'string') {
      sessionStorage.setItem('swiftmatch_refresh_token', data.refresh_token)
    }
    return token
  } catch {
    return null
  }
}

/** Сессия окончательно мертва: разлогиниваем всё приложение. */
export function notifyUnauthorized(): void {
  window.dispatchEvent(new CustomEvent('auth:unauthorized'))
}