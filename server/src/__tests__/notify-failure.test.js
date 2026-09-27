import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
  },
}))

const sendVerificationEmail = vi.fn()
const sendPasswordResetEmail = vi.fn()

vi.mock('../mail.js', () => ({
  sendVerificationEmail: (...args) => sendVerificationEmail(...args),
  sendPasswordResetEmail: (...args) => sendPasswordResetEmail(...args),
}))

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import pool from '../db.js'
import logger from '../logger.js'
import authRoutes from '../routes/auth.js'

function createApp() {
  const app = express()
  app.use(express.json())
  app.use(authRoutes)
  return app
}

const MAIL_DOWN = new Error('SMTP unavailable: connect ECONNREFUSED')

beforeEach(() => {
  vi.clearAllMocks()
  sendVerificationEmail.mockRejectedValue(MAIL_DOWN)
  sendPasswordResetEmail.mockRejectedValue(MAIL_DOWN)
})

describe('Падение почты не ломает auth-роуты (P2 #20)', () => {
  it('регистрация возвращает 201, хотя sendVerificationEmail отверг promise', async () => {
    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ insertId: 1 }, []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{}, []])

    const app = createApp()
    const res = await request(app).post('/api/auth/register').send({ email: 'down@test.com', password: '123456' })

    expect(res.status).toBe(201)
    expect(res.body).toHaveProperty('token')
    expect(res.body.userId).toBe(1)
    expect(sendVerificationEmail).toHaveBeenCalledTimes(1)
  })

  it('падение почты на регистрации залогировано, а не проглочено молча', async () => {
    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ insertId: 1 }, []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{}, []])

    const app = createApp()
    await request(app).post('/api/auth/register').send({ email: 'down2@test.com', password: '123456' })

    const call = logger.error.mock.calls.find((c) => String(c[0]).includes('Verification email send failed'))
    expect(call).toBeTruthy()
    expect(call[1]).toBe(MAIL_DOWN)
  })

  it('сброс пароля возвращает 200, хотя sendPasswordResetEmail отверг promise', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 5 }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])

    const app = createApp()
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'exists@test.com' })

    expect(res.status).toBe(200)
    expect(res.body.message).toMatch(/If the email exists/i)
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1)
  })

  it('повторная отправка верификации возвращает 200 при упавшей почте', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 5 }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])

    const app = createApp()
    const res = await request(app).post('/api/auth/resend-verification').send({ email: 'exists@test.com' })

    expect(res.status).toBe(200)
    expect(res.body.message).toMatch(/Verification email sent/i)
    expect(sendVerificationEmail).toHaveBeenCalledTimes(1)
  })

  it('сброс пароля логирует ошибку отправки, а не роняет роут', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 5 }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])

    const app = createApp()
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'exists@test.com' })

    expect(res.status).toBe(200)
    const call = logger.error.mock.calls.find((c) => String(c[0]).includes('Password reset email send failed'))
    expect(call).toBeTruthy()
    expect(call[1]).toBe(MAIL_DOWN)
  })

  it('повторная верификация логирует ошибку отправки', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 5 }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])

    const app = createApp()
    const res = await request(app).post('/api/auth/resend-verification').send({ email: 'exists@test.com' })

    expect(res.status).toBe(200)
    const call = logger.error.mock.calls.find((c) => String(c[0]).includes('Verification email resend failed'))
    expect(call).toBeTruthy()
    expect(call[1]).toBe(MAIL_DOWN)
  })

  it('успешная отправка письма не пишет в лог ошибку', async () => {
    sendVerificationEmail.mockResolvedValue({ queued: true })
    pool.query
      .mockResolvedValueOnce([[{ id: 5 }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])

    const app = createApp()
    const res = await request(app).post('/api/auth/resend-verification').send({ email: 'ok@test.com' })

    expect(res.status).toBe(200)
    expect(logger.error).not.toHaveBeenCalled()
  })
})
