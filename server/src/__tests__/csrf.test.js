import { describe, it, expect } from 'vitest'
import request from 'supertest'
import express from 'express'
import cookieParser from 'cookie-parser'
import { csrf, csrfGuard, csrfRouter, CSRF_COOKIE, CSRF_HEADER } from '../middleware/csrf.js'

function createApp() {
  const app = express()
  app.use(express.json())
  app.use(cookieParser())
  app.use(csrf)
  app.post('/protected', csrfGuard, (req, res) => res.json({ ok: true }))
  app.use(csrfRouter)
  return app
}

function cookieFrom(res, name = CSRF_COOKIE) {
  const setCookie = res.headers['set-cookie']
  expect(setCookie).toBeDefined()
  const c = setCookie.find((s) => s.startsWith(`${name}=`))
  expect(c).toBeDefined()
  return c.split(';')[0]
}

describe('CSRF double-submit', () => {
  const app = createApp()

  it('GET /api/auth/csrf returns token and sets cookie', async () => {
    const res = await request(app).get('/api/auth/csrf')
    expect(res.status).toBe(200)
    expect(res.body.token).toMatch(/^[0-9a-f]{48}$/)
    expect(cookieFrom(res)).toContain('csrf_token=')
  })

  it('reuses existing valid cookie token', async () => {
    const first = await request(app).get('/api/auth/csrf')
    const token = first.body.token
    const cookie = cookieFrom(first)
    // second call with the cookie must not rotate the token
    const second = await request(app).get('/api/auth/csrf').set('Cookie', cookie)
    expect(second.status).toBe(200)
    expect(second.body.token).toBe(token)
  })

  it('allows mutating request when no csrf cookie issued', async () => {
    const res = await request(app).post('/protected').send({})
    expect(res.status).toBe(200)
  })

  it('rejects mutating request with cookie but missing header', async () => {
    const issued = await request(app).get('/api/auth/csrf')
    const cookie = cookieFrom(issued)
    const res = await request(app).post('/protected').set('Cookie', cookie).send({})
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('CSRF_MISMATCH')
  })

  it('rejects mutating request with wrong header', async () => {
    const issued = await request(app).get('/api/auth/csrf')
    const cookie = cookieFrom(issued)
    const res = await request(app).post('/protected').set('Cookie', cookie).set(CSRF_HEADER, 'deadbeef').send({})
    expect(res.status).toBe(403)
  })

  it('accepts mutating request with matching header (double-submit)', async () => {
    const issued = await request(app).get('/api/auth/csrf')
    const cookie = cookieFrom(issued)
    const res = await request(app).post('/protected').set('Cookie', cookie).set(CSRF_HEADER, issued.body.token).send({})
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })
})