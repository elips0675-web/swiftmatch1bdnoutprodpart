import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}))
vi.mock('../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  rootLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))
vi.mock('../middleware/adminAuth.js', async (importOriginal) => {
  const mod = await importOriginal()
  return {
    ...mod,
    adminAuth: (req, res, next) => {
      req.admin = { id: 1, email: 'admin@mail.ru', role: 'admin' }
      next()
    },
  }
})

import pool from '../db.js'
import twoFaRoutes from '../routes/totp-2fa.js'
import { generateTotpSecret, verifyTotpToken } from '../totp.js'
import { generateSync } from 'otplib'

function createApp() {
  const app = express()
  app.use(express.json())
  app.use(twoFaRoutes)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('totp.js unit', () => {
  it('roundtrip: токен от секрета проходит проверку', () => {
    const { secret, otpauthUrl } = generateTotpSecret('admin@mail.ru')
    expect(secret).toMatch(/^[A-Z2-7]+$/)
    expect(otpauthUrl).toMatch(/^otpauth:\/\/totp\//)
    const token = generateSync({ secret })
    expect(verifyTotpToken(secret, token)).toBe(true)
  })

  it('отвергает неверный код', () => {
    const { secret } = generateTotpSecret('admin@mail.ru')
    expect(verifyTotpToken(secret, '000000')).toBe(false)
  })

  it('отвергает кривой ввод', () => {
    expect(verifyTotpToken(null, '123456')).toBe(false)
    expect(verifyTotpToken('SECRET', '')).toBe(false)
    expect(verifyTotpToken('SECRET', 'abcdef')).toBe(false)
    expect(verifyTotpToken('SECRET', '12345')).toBe(false)
    expect(verifyTotpToken('', null)).toBe(false)
  })
})

describe('POST /api/auth/2fa/* (router)', () => {
  const app = createApp()

  it('setup: без мока adminAuth был бы 401; с моком возвращает otpauth URL и секрет', async () => {
    pool.query.mockResolvedValue([{ affectedRows: 1 }, []])
    const res = await request(app).post('/api/auth/2fa/setup').send({})
    expect(res.status).toBe(200)
    expect(res.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//)
    expect(res.body.secret).toMatch(/^[A-Z2-7]+$/)
    expect(pool.query.mock.calls[0][0]).toMatch(/UPDATE users SET totp_secret/)
  })

  it('enable: код обязателен', async () => {
    const res = await request(app).post('/api/auth/2fa/enable').send({})
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('CODE_REQUIRED')
  })

  it('enable: требует setup перед включением', async () => {
    pool.query.mockResolvedValue([[{ totp_secret: null, totp_enabled: 0 }], []])
    const res = await request(app).post('/api/auth/2fa/enable').send({ code: '123456' })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('SETUP_REQUIRED')
  })

  it('enable: неверный код -> TOTP_INVALID', async () => {
    pool.query.mockResolvedValue([[{ totp_secret: generateTotpSecret('x@y.z').secret, totp_enabled: 0 }], []])
    const res = await request(app).post('/api/auth/2fa/enable').send({ code: '000000' })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('TOTP_INVALID')
  })

  it('enable: верный код -> ok:true и totp_enabled=1', async () => {
    const { secret } = generateTotpSecret('admin@mail.ru')
    pool.query
      .mockResolvedValueOnce([[{ totp_secret: secret, totp_enabled: 0 }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
    const { generateSync } = await import('otplib')
    const code = generateSync({ secret })
    const res = await request(app).post('/api/auth/2fa/enable').send({ code })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(pool.query.mock.calls[1][0]).toMatch(/totp_enabled = 1/)
  })

  it('disable: не включённая 2FA -> NOT_ENABLED', async () => {
    pool.query.mockResolvedValue([[{ totp_secret: null, totp_enabled: 0 }], []])
    const res = await request(app).post('/api/auth/2fa/disable').send({ code: '123456' })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('NOT_ENABLED')
  })

  it('disable: верный код сбрасывает секрет и флаг', async () => {
    const { secret } = generateTotpSecret('admin@mail.ru')
    pool.query
      .mockResolvedValueOnce([[{ totp_secret: secret, totp_enabled: 1 }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
    const { generateSync } = await import('otplib')
    const code = generateSync({ secret })
    const res = await request(app).post('/api/auth/2fa/disable').send({ code })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(pool.query.mock.calls[1][0]).toMatch(/totp_enabled = 0, totp_secret = NULL/)
  })
})
