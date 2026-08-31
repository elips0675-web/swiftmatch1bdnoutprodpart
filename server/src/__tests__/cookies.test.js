// Этап 42 (аудит kimi 1.2): __Host- префикс cookie в production
import { describe, it, expect, vi } from 'vitest'

// модуль читает NODE_ENV на import — динамически переимпортируем для каждого режима
async function importCookies(env) {
  vi.resetModules()
  const old = process.env.NODE_ENV
  process.env.NODE_ENV = env
  try {
    return await import('../cookies.js')
  } finally {
    process.env.NODE_ENV = old
  }
}

describe('cookie names (__Host- prefix)', () => {
  it('в dev — обычные имена', async () => {
    const c = await importCookies('development')
    expect(c.ACCESS_COOKIE).toBe('sm_token')
    expect(c.REFRESH_COOKIE).toBe('sm_refresh')
  })

  it('в production — __Host- префикс (защита от перезаписи с поддомена)', async () => {
    const c = await importCookies('production')
    expect(c.ACCESS_COOKIE).toBe('__Host-sm_token')
    expect(c.REFRESH_COOKIE).toBe('__Host-sm_refresh')
  })

  it('extractToken в production читает __Host-sm_token', async () => {
    const c = await importCookies('production')
    const req = { cookies: { '__Host-sm_token': 'jwt-x' } }
    expect(c.extractToken(req)).toBe('jwt-x')
    // Bearer приоритетнее
    expect(c.extractToken({ headers: { authorization: 'Bearer y' }, cookies: req.cookies })).toBe('y')
  })

  it('extractToken: мусорный/истёкший Bearer не маскируется cookie (Bearer приоритетен всегда)', async () => {
    const c = await importCookies('development')
    // Даже если Bearer мусорный, extractToken вернёт его (не cookie) — решение о валидности
    // принимает auth-мидлварь, а не extractToken. Это защищает от легаси localStorage.
    const req = { headers: { authorization: 'Bearer garbage.jwt' }, cookies: { sm_token: 'valid-cookie-token' } }
    expect(c.extractToken(req)).toBe('garbage.jwt')
  })

  it('extractToken: без Bearer читает cookie, без обоих — null', async () => {
    const c = await importCookies('development')
    expect(c.extractToken({ cookies: { sm_token: 'cookie-token' } })).toBe('cookie-token')
    expect(c.extractToken({ cookies: {} })).toBeNull()
    expect(c.extractToken({})).toBeNull()
    // 'Bearer ' c пустым токеном возвращает '' и НЕ маскируется cookie — auth-мидлварь
    // отклонит пустой токен 401, валидная cookie не «протащит» сессию с битым хедером
    expect(c.extractToken({ headers: { authorization: 'Bearer ' }, cookies: { sm_token: 'x' } })).toBe('')
  })

  it('setAuthCookies выставляет httpOnly+secure+sameSite+lax и maxAge', async () => {
    const c = await importCookies('production')
    const res = { cookie: vi.fn() }
    c.setAuthCookies(res, 'access-jwt', 'refresh-jwt')
    expect(res.cookie).toHaveBeenCalledTimes(2)
    const [name, value, opts] = res.cookie.mock.calls[0]
    expect(name).toBe('__Host-sm_token')
    expect(value).toBe('access-jwt')
    expect(opts.httpOnly).toBe(true)
    expect(opts.secure).toBe(true)
    expect(opts.sameSite).toBe('lax')
    expect(opts.path).toBe('/')
    expect(opts.maxAge).toBe(24 * 60 * 60 * 1000)
    const [rName, rVal, rOpts] = res.cookie.mock.calls[1]
    expect(rName).toBe('__Host-sm_refresh')
    expect(rVal).toBe('refresh-jwt')
    expect(rOpts.maxAge).toBe(7 * 24 * 60 * 60 * 1000)
  })

  it('setAuthCookies без refresh не ставит refresh-cookie', async () => {
    const c = await importCookies('development')
    const res = { cookie: vi.fn() }
    c.setAuthCookies(res, 'access-jwt', null)
    expect(res.cookie).toHaveBeenCalledTimes(1)
  })

  it('clearAuthCookies чистит обе cookie (logout)', async () => {
    const c = await importCookies('production')
    const res = { clearCookie: vi.fn() }
    c.clearAuthCookies(res)
    expect(res.clearCookie).toHaveBeenCalledTimes(2)
    const names = res.clearCookie.mock.calls.map(([n]) => n)
    expect(names).toContain('__Host-sm_token')
    expect(names).toContain('__Host-sm_refresh')
  })
})
