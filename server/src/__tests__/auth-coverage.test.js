// Stage 106: покрытие остатка `server/src/routes/auth.js` — resend-verification,
// verify-email happy path, 500-ветки, fingerprint-mismatch, /api/auth/me.
//
// Мок `../mail.js` обязателен: реальные функции ходят в SMTP, а непойманное
// отклонение промиса (`sendVerificationEmail(...).catch(...)` ловится, но факт
// вызова надо проверять) делает тест либо медленным, либо плавающим.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import cookieParser from 'cookie-parser'
import jwt from 'jsonwebtoken'

vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
})

vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}))

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

const { mail } = vi.hoisted(() => ({
  mail: { sendVerificationEmail: vi.fn(), sendPasswordResetEmail: vi.fn() },
}))
vi.mock('../mail.js', () => mail)

import pool from '../db.js'
import logger from '../logger.js'
import authRoutes from '../routes/auth.js'

const JWT_SECRET = process.env.JWT_SECRET

function createApp() {
  const app = express()
  app.use(express.json())
  // cookie-parser подключён в index.js:105 — без него req.cookies пуст и ветки
  // «токен из cookie» неисполнимы в честном сценарии.
  app.use(cookieParser())
  app.use(authRoutes)
  return app
}

function authHeader(userId = 7) {
  return `Bearer ${jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })}`
}

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockReset()
  pool.query.mockResolvedValue([[], []])
  mail.sendVerificationEmail.mockResolvedValue(undefined)
  mail.sendPasswordResetEmail.mockResolvedValue(undefined)
})

describe('POST /api/auth/register — телефон, реферал, сбой письма', () => {
  it('отклоняет телефон не по формату', async () => {
    const res = await request(createApp())
      .post('/api/auth/register')
      .send({ email: 'ph@test.com', password: '123456', phone: '12' })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Invalid phone number format')
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('принимает телефон в международном формате и пишет его в БД', async () => {
    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ insertId: 55 }, []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
    const res = await request(createApp())
      .post('/api/auth/register')
      .send({ email: 'ph@test.com', password: '123456', phone: '+79991234567' })
    expect(res.status).toBe(201)
    expect(res.body.phone).toBe('+79991234567')
    expect(res.body.phone_verified).toBe(false)
    const insert = pool.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO users'))
    expect(insert[1][6]).toBe('+79991234567')
  })

  it('валидный реферальный код привязывает referred_by', async () => {
    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ id: 99 }], []])
      .mockResolvedValueOnce([{ insertId: 56 }, []])
      .mockResolvedValueOnce([[], []])
    const res = await request(createApp())
      .post('/api/auth/register')
      .send({ email: 'ref@test.com', password: '123456', referralCode: 'ABCDEF' })
    expect(res.status).toBe(201)
    const insert = pool.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO users'))
    expect(insert[1][5]).toBe(99)
  })

  it('несуществующий реферальный код оставляет referred_by пустым', async () => {
    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ insertId: 57 }, []])
      .mockResolvedValueOnce([[], []])
    const res = await request(createApp())
      .post('/api/auth/register')
      .send({ email: 'ref2@test.com', password: '123456', referralCode: 'NOPE' })
    expect(res.status).toBe(201)
    const insert = pool.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO users'))
    expect(insert[1][5]).toBeNull()
  })

  it('сбой отправки письма не роняет регистрацию, но логируется', async () => {
    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ insertId: 58 }, []])
      .mockResolvedValueOnce([[], []])
    mail.sendVerificationEmail.mockRejectedValue(new Error('smtp down'))
    const res = await request(createApp())
      .post('/api/auth/register')
      .send({ email: 'mail@test.com', password: '123456' })
    expect(res.status).toBe(201)
    await vi.waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith('Verification email send failed:', expect.any(Error))
    })
  })

  it('без displayName имя профиля берётся из email', async () => {
    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ insertId: 59 }, []])
      .mockResolvedValueOnce([[], []])
    const res = await request(createApp())
      .post('/api/auth/register')
      .send({ email: 'nick@test.com', password: '123456' })
    expect(res.status).toBe(201)
    const profile = pool.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO user_profiles'))
    expect(profile[1][1]).toBe('nick')
    expect(profile[1][2]).toBe('nick')
  })

  it('падение БД на вставке пользователя — 500 с логом', async () => {
    pool.query
      .mockResolvedValueOnce([[], []])
      .mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp())
      .post('/api/auth/register')
      .send({ email: 'boom@test.com', password: '123456' })
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to create account')
    expect(logger.error).toHaveBeenCalledWith('Register error:', expect.any(Error))
  })
})

describe('POST /api/auth/forgot-password — сбои', () => {
  it('сбой отправки письма не роняет ответ, но логируется', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 3 }], []])
      .mockResolvedValueOnce([[], []])
    mail.sendPasswordResetEmail.mockRejectedValue(new Error('smtp down'))
    const res = await request(createApp())
      .post('/api/auth/forgot-password')
      .send({ email: 'u@test.com' })
    expect(res.status).toBe(200)
    await vi.waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith('Password reset email send failed:', expect.any(Error))
    })
  })

  it('падение БД — 500 с логом', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp())
      .post('/api/auth/forgot-password')
      .send({ email: 'u@test.com' })
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to process request')
    expect(logger.error).toHaveBeenCalledWith('Forgot password error:', expect.any(Error))
  })
})

describe('POST /api/auth/reset-password — сбои', () => {
  it('короткий пароль — 400 до похода в БД', async () => {
    const res = await request(createApp())
      .post('/api/auth/reset-password')
      .send({ token: 't', password: '123' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/at least 6 characters/)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('падение БД — 500 с логом', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 9 }], []])
      .mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp())
      .post('/api/auth/reset-password')
      .send({ token: 't', password: '123456' })
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to reset password')
    expect(logger.error).toHaveBeenCalledWith('Reset password error:', expect.any(Error))
  })
})

describe('POST /api/auth/resend-verification', () => {
  it('без email — 400', async () => {
    const res = await request(createApp()).post('/api/auth/resend-verification').send({})
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Email required')
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('неизвестный email — 404', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(createApp())
      .post('/api/auth/resend-verification')
      .send({ email: 'nobody@test.com' })
    expect(res.status).toBe(404)
    expect(res.body.message).toBe('User not found')
  })

  it('известный email — перевыпускает токен и шлёт письмо', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 12 }], []])
      .mockResolvedValueOnce([[], []])
    const res = await request(createApp())
      .post('/api/auth/resend-verification')
      .send({ email: 'u@test.com' })
    expect(res.status).toBe(200)
    expect(res.body.message).toBe('Verification email sent')
    const update = pool.query.mock.calls.find((c) => String(c[0]).includes('SET verification_token = ?'))
    expect(update[1][1]).toBe(12)
    expect(mail.sendVerificationEmail).toHaveBeenCalledWith('u@test.com', update[1][0])
  })

  it('сбой отправки письма не роняет ответ, но логируется', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 13 }], []])
      .mockResolvedValueOnce([[], []])
    mail.sendVerificationEmail.mockRejectedValue(new Error('smtp down'))
    const res = await request(createApp())
      .post('/api/auth/resend-verification')
      .send({ email: 'u@test.com' })
    expect(res.status).toBe(200)
    await vi.waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith('Verification email resend failed:', expect.any(Error))
    })
  })

  it('падение БД — 500 с логом', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp())
      .post('/api/auth/resend-verification')
      .send({ email: 'u@test.com' })
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to resend verification')
    expect(logger.error).toHaveBeenCalledWith('Resend verification error:', expect.any(Error))
  })
})

describe('POST /api/auth/verify-email — успешный путь', () => {
  it('подтверждает email и обнуляет токен', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 21 }], []])
      .mockResolvedValueOnce([[], []])
    const res = await request(createApp()).post('/api/auth/verify-email').send({ token: 'good' })
    expect(res.status).toBe(200)
    expect(res.body.message).toBe('Email verified')
    const update = pool.query.mock.calls.find((c) => String(c[0]).includes('SET verification_token = NULL'))
    expect(update[1]).toEqual([21])
  })

  it('падение БД — 500 с логом', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp()).post('/api/auth/verify-email').send({ token: 'good' })
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to verify email')
    expect(logger.error).toHaveBeenCalledWith('Verify email error:', expect.any(Error))
  })
})

describe('POST /api/auth/refresh — fingerprint и сбой', () => {
  const row = { id: 1, user_id: 7, family_id: 'fam-1', revoked: 0, fingerprint: 'deadbeef' }

  it('несовпадение fingerprint не блокирует ротацию, но пишет предупреждение', async () => {
    pool.query
      .mockResolvedValueOnce([[row], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([{}, []])
    const res = await request(createApp())
      .post('/api/auth/refresh')
      .set('User-Agent', 'OtherDevice')
      .send({ refresh_token: 'tok' })
    expect(res.status).toBe(200)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Fingerprint mismatch for user 7'))
  })

  it('совпадение fingerprint молчит', async () => {
    const crypto = await import('node:crypto')
    const fp = crypto.createHash('sha256').update('::ffff:127.0.0.1|KnownDevice').digest('hex').slice(0, 32)
    pool.query
      .mockResolvedValueOnce([[{ ...row, fingerprint: fp }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([{}, []])
    const res = await request(createApp())
      .post('/api/auth/refresh')
      .set('User-Agent', 'KnownDevice')
      .send({ refresh_token: 'tok' })
    expect(res.status).toBe(200)
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('берёт refresh-токен из cookie, если тела нет', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(createApp())
      .post('/api/auth/refresh')
      .set('Cookie', 'sm_refresh=cookie-token')
    expect(res.status).toBe(401)
    expect(pool.query.mock.calls[0][1]).toEqual(['cookie-token'])
  })

  it('падение БД — 500 с логом', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp()).post('/api/auth/refresh').send({ refresh_token: 'tok' })
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to refresh token')
    expect(logger.error).toHaveBeenCalledWith('Refresh error:', expect.any(Error))
  })
})

describe('POST /api/auth/logout-all — сбой', () => {
  it('падение БД — 500 с логом', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp()).post('/api/auth/logout-all').set('Authorization', authHeader())
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to revoke sessions')
    expect(logger.error).toHaveBeenCalledWith('Logout-all error:', expect.any(Error))
  })
})

describe('GET /api/auth/sessions — сбой', () => {
  it('падение БД — 500 с логом', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp()).get('/api/auth/sessions').set('Authorization', authHeader())
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to list sessions')
    expect(logger.error).toHaveBeenCalledWith('Sessions list error:', expect.any(Error))
  })
})

describe('DELETE /api/auth/sessions/:familyId — сбой', () => {
  it('падение БД — 500 с логом', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp())
      .delete('/api/auth/sessions/11111111-1111-4111-8111-111111111111')
      .set('Authorization', authHeader())
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to revoke session')
    expect(logger.error).toHaveBeenCalledWith('Session revoke error:', expect.any(Error))
  })
})

describe('GET /api/auth/me', () => {
  const PROFILE = {
    id: 7,
    email: 'me@test.com',
    role: 'user',
    display_name: 'Я',
    avatar_url: 'https://cdn/a.png',
  }

  it('без токена — 200 с authenticated: false', async () => {
    const res = await request(createApp()).get('/api/auth/me')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ authenticated: false })
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('отдаёт профиль по Bearer-токену', async () => {
    pool.query.mockResolvedValueOnce([[PROFILE], []])
    const res = await request(createApp()).get('/api/auth/me').set('Authorization', authHeader(7))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      authenticated: true,
      id: 7,
      email: 'me@test.com',
      role: 'user',
      name: 'Я',
      avatar: 'https://cdn/a.png',
    })
    expect(pool.query.mock.calls[0][1]).toEqual([7])
  })

  it('читает токен из cookie, когда заголовка нет', async () => {
    pool.query.mockResolvedValueOnce([[PROFILE], []])
    const token = jwt.sign({ userId: 7, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })
    const res = await request(createApp()).get('/api/auth/me').set('Cookie', `sm_token=${token}`)
    expect(res.status).toBe(200)
    expect(res.body.authenticated).toBe(true)
  })

  it('битый токен — authenticated: false без падения', async () => {
    const res = await request(createApp()).get('/api/auth/me').set('Authorization', 'Bearer not.a.jwt')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ authenticated: false })
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('удалённый пользователь — authenticated: false', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(createApp()).get('/api/auth/me').set('Authorization', authHeader(404))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ authenticated: false })
  })
})
