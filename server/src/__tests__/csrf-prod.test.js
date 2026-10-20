import { describe, it, expect, vi, afterEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import cookieParser from 'cookie-parser'

describe('CSRF — production-ветки и отдача токена без middleware', () => {
  const savedEnv = process.env.NODE_ENV

  afterEach(() => {
    process.env.NODE_ENV = savedEnv
    vi.resetModules()
  })

  it('в production имя cookie меняется на __Host-csrf, а флаг secure включается', async () => {
    process.env.NODE_ENV = 'production'
    vi.resetModules()
    const mod = await import('../middleware/csrf.js')
    expect(mod.CSRF_COOKIE).toBe('__Host-csrf')

    const app = express()
    app.use(cookieParser())
    app.use(mod.csrf)
    app.post('/protected', mod.csrfGuard, (req, res) => res.json({ ok: true }))
    app.use(mod.csrfRouter)

    const issued = await request(app).get('/api/auth/csrf')
    expect(issued.status).toBe(200)
    expect(issued.body.token).toMatch(/^[0-9a-f]{48}$/)
    const setCookie = issued.headers['set-cookie'].find((s) => s.startsWith('__Host-csrf='))
    expect(setCookie).toBeDefined()
    expect(setCookie).toContain('Secure')
  })

  it('роут /api/auth/csrf без middleware берёт токен из cookie, а без cookie отдаёт null', async () => {
    vi.resetModules()
    const mod = await import('../middleware/csrf.js')

    const app = express()
    app.use(cookieParser())
    app.use(mod.csrfRouter)

    const noCookie = await request(app).get('/api/auth/csrf')
    expect(noCookie.status).toBe(200)
    expect(noCookie.body.token).toBeNull()

    const withCookie = await request(app)
      .get('/api/auth/csrf')
      .set('Cookie', `${mod.CSRF_COOKIE}=abcdef0123456789`)
    expect(withCookie.status).toBe(200)
    expect(withCookie.body.token).toBe('abcdef0123456789')
  })

  it('короткая cookie (меньше 16 символов) игнорируется и токен пересоздаётся', async () => {
    vi.resetModules()
    const mod = await import('../middleware/csrf.js')
    const app = express()
    app.use(cookieParser())
    app.use(mod.csrf)
    app.use(mod.csrfRouter)

    const res = await request(app)
      .get('/api/auth/csrf')
      .set('Cookie', `${mod.CSRF_COOKIE}=short`)
    expect(res.status).toBe(200)
    expect(res.body.token).toMatch(/^[0-9a-f]{48}$/)
    expect(res.body.token).not.toBe('short')
  })
})
