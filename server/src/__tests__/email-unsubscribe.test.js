vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}))

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('../mail.js', () => ({
  sendCustomEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  sendVerificationEmail: vi.fn(),
}))

vi.mock('../routes/push.js', () => ({
  sendPushToAll: vi.fn(),
  sendPushToUser: vi.fn(),
}))

import pool from '../db.js'
import { sendCustomEmail } from '../mail.js'
import { sendPushToAll } from '../routes/push.js'
import logger from '../logger.js'
import unsubscribeRoutes from '../routes/unsubscribe.js'
import adminMessaging from '../routes/admin/messaging.js'
import {
  unsubscribeToken,
  verifyUnsubscribeToken,
  buildUnsubscribeUrl,
  listEmailRecipients,
  isUnsubscribeFeatureEnabled,
  recordUnsubscribe,
} from '../email-unsubscribe.js'

const USER = { id: 5, email: 'User@Example.com' }

function userApp() {
  const app = express()
  app.use(express.json())
  app.use(unsubscribeRoutes)
  return app
}

function adminApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/admin', (req, res, next) => { req.admin = { id: 9, role: 'admin' }; next() })
  app.use('/api/admin', adminMessaging)
  return app
}

// Диспетчер по фрагменту SQL: в хендлере несколько запросов подряд,
// а очередь mockResolvedValueOnce переживала бы clearAllMocks между тестами.
function respond(responses, fallback = [[], []]) {
  pool.query.mockImplementation(async (sql) => {
    for (const [fragment, result] of Object.entries(responses)) {
      if (sql.includes(fragment)) return result
    }
    return fallback
  })
}

function unsubscribePost(userId, token) {
  return request(userApp()).post('/api/email/unsubscribe').send({ u: userId, t: token })
}

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockReset()
  sendCustomEmail.mockReset().mockResolvedValue({ queued: true })
  sendPushToAll.mockReset().mockResolvedValue(undefined)
})

describe('токен отписки', () => {
  it('принимает токен для этого же userId:email и отклоняет всё остальное', () => {
    const token = unsubscribeToken(USER.id, USER.email)
    expect(verifyUnsubscribeToken(USER.id, USER.email, token)).toBe(true)
    expect(verifyUnsubscribeToken(USER.id, 'user@example.com', token)).toBe(true)
    expect(verifyUnsubscribeToken(USER.id, 'other@example.com', token)).toBe(false)
    expect(verifyUnsubscribeToken(USER.id + 1, USER.email, token)).toBe(false)
  })

  it('мусор вместо токена отклоняется без исключений', () => {
    expect(verifyUnsubscribeToken(USER.id, USER.email, 'abc')).toBe(false)
    expect(verifyUnsubscribeToken(USER.id, USER.email, 'z'.repeat(64))).toBe(false)
    expect(verifyUnsubscribeToken(USER.id, USER.email, undefined)).toBe(false)
  })

  it('ссылка ведёт на SPA-страницу с u и t', () => {
    const url = buildUnsubscribeUrl(USER.id, USER.email)
    expect(url).toContain('/unsubscribe?u=5&t=')
    expect(url).toContain(unsubscribeToken(USER.id, USER.email))
  })

  it('отсутствующий email трактуется как пустая строка, токен всё равно детерминирован', () => {
    const fromNull = unsubscribeToken(USER.id, null)
    const fromUndefined = unsubscribeToken(USER.id, undefined)
    const fromEmpty = unsubscribeToken(USER.id, '')
    expect(fromNull).toBe(fromEmpty)
    expect(fromUndefined).toBe(fromEmpty)
    expect(fromNull).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe('запись отписки (recordUnsubscribe напрямую)', () => {
  it('без userId и без причины пишет null и нормализованный email', async () => {
    respond({ 'INSERT INTO email_unsubscribes': [[{ affectedRows: 1 }], []] })
    await recordUnsubscribe({ email: '  Mixed@Case.COM ', reason: undefined })
    const insert = pool.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO email_unsubscribes'))
    expect(insert[1]).toEqual([null, 'mixed@case.com', null])
  })

  it('пустая строка причины и не-строка дают null, длинная причина обрезается до 64', async () => {
    respond({ 'INSERT INTO email_unsubscribes': [[{ affectedRows: 1 }], []] })
    await recordUnsubscribe({ userId: 7, email: 'a@b.com', reason: '' })
    expect(pool.query.mock.calls.at(-1)[1][2]).toBeNull()

    await recordUnsubscribe({ userId: 7, email: 'a@b.com', reason: 12345 })
    expect(pool.query.mock.calls.at(-1)[1][2]).toBeNull()

    await recordUnsubscribe({ userId: 7, email: 'a@b.com', reason: 'x'.repeat(200) })
    expect(pool.query.mock.calls.at(-1)[1][2]).toHaveLength(64)
  })
})

describe('feature flag отписки', () => {
  it('включён при значении по умолчанию, выключен при 0 и fail-open при сбое БД', async () => {
    respond({})
    await expect(isUnsubscribeFeatureEnabled()).resolves.toBe(true)

    respond({ 'SELECT email_unsubscribe_enabled FROM feature_flags': [[{ email_unsubscribe_enabled: 0 }], []] })
    await expect(isUnsubscribeFeatureEnabled()).resolves.toBe(false)

    pool.query.mockRejectedValueOnce(new Error('boom'))
    await expect(isUnsubscribeFeatureEnabled()).resolves.toBe(true)
  })
})

describe('POST /api/email/unsubscribe', () => {
  it('нечисловой u или пустой токен → 400 без запроса в БД', async () => {
    const res = await unsubscribePost('abc', '')
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('UNSUBSCRIBE_INVALID')
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('флаг выключен → 404 UNSUBSCRIBE_DISABLED', async () => {
    respond({ 'SELECT email_unsubscribe_enabled FROM feature_flags': [[{ email_unsubscribe_enabled: 0 }], []] })
    const res = await unsubscribePost(USER.id, unsubscribeToken(USER.id, USER.email))
    expect(res.status).toBe(404)
    expect(res.body.code).toBe('UNSUBSCRIBE_DISABLED')
  })

  it('неизвестный id и неверный токен отвечают одинаково — без утечки существования', async () => {
    respond({ 'SELECT id, email FROM users': [[], []] })
    const missing = await unsubscribePost(404, 'a'.repeat(64))
    expect(missing.status).toBe(400)
    expect(missing.body.code).toBe('UNSUBSCRIBE_INVALID')

    respond({ 'SELECT id, email FROM users': [[USER], []] })
    const bad = await unsubscribePost(USER.id, 'a'.repeat(64))
    expect(bad.status).toBe(400)
    expect(bad.body.code).toBe('UNSUBSCRIBE_INVALID')

    expect(pool.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO email_unsubscribes'))).toBe(false)
  })

  it('валидный токен → 200 и идемпотентная запись отписки (email нормализован)', async () => {
    respond({
      'SELECT email_unsubscribe_enabled FROM feature_flags': [[{ email_unsubscribe_enabled: 1 }], []],
      'SELECT id, email FROM users': [[USER], []],
      'INSERT INTO email_unsubscribes': [[{ affectedRows: 1 }], []],
    })
    const res = await unsubscribePost(USER.id, unsubscribeToken(USER.id, USER.email))
    expect(res.status).toBe(200)
    expect(res.body.code).toBe('UNSUBSCRIBED')

    const insert = pool.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO email_unsubscribes'))
    expect(insert[0]).toContain('ON DUPLICATE KEY UPDATE')
    expect(insert[1]).toEqual([USER.id, 'user@example.com', 'link'])
  })

  it('сбой БД → 500 с code, а не 200', async () => {
    pool.query
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
    const res = await unsubscribePost(USER.id, unsubscribeToken(USER.id, USER.email))
    expect(res.status).toBe(500)
    expect(res.body.code).toBe('UNSUBSCRIBE_FAILED')
  })

  it('тело не распарсено (req.body undefined) → 400 без запроса в БД', async () => {
    const app = express()
    app.use(unsubscribeRoutes)
    const res = await request(app).post('/api/email/unsubscribe').set('Content-Type', 'application/json').send('{"u":5,"t":"x"}')
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('UNSUBSCRIBE_INVALID')
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('t не строка → 400 без запроса в БД', async () => {
    const res = await request(userApp()).post('/api/email/unsubscribe').send({ u: USER.id, t: 42 })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('UNSUBSCRIBE_INVALID')
    expect(pool.query).not.toHaveBeenCalled()
  })
})

describe('рассылка email-кампаний', () => {
  it('список получателей исключает отписанных через LEFT JOIN', async () => {
    let sqlUsed = ''
    pool.query.mockImplementation(async (sql) => { sqlUsed = sql; return [[], []] })
    await listEmailRecipients()
    expect(sqlUsed).toContain('LEFT JOIN email_unsubscribes')
    expect(sqlUsed).toContain('e.id IS NULL')
    expect(sqlUsed).toContain('u.is_active = 1')
  })

  it('неизвестный канал → 400 без INSERT в campaigns', async () => {
    const res = await request(adminApp()).post('/api/admin/campaigns')
      .send({ title: 'Hi', body: 'Body', channel: 'sms' })
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('email-кампания: письмо получателю со ссылкой отписки', async () => {
    respond({
      'INSERT INTO campaigns': [[{ insertId: 7 }], []],
      'SELECT u.id, u.email FROM users u': [[{ id: 2, email: 'a@example.com' }], []],
      'SELECT email_unsubscribe_enabled FROM feature_flags': [[{ email_unsubscribe_enabled: 1 }], []],
    })
    const res = await request(adminApp()).post('/api/admin/campaigns')
      .send({ title: 'Hi', body: 'Body', channel: 'email', target: 'all' })
    expect(res.status).toBe(201)
    expect(sendPushToAll).not.toHaveBeenCalled()
    expect(sendCustomEmail).toHaveBeenCalledTimes(1)

    const [email, subject, html] = sendCustomEmail.mock.calls[0]
    expect(email).toBe('a@example.com')
    expect(subject).toBe('Hi')
    expect(html).toContain('/unsubscribe?u=2&t=')
    expect(html).toContain(unsubscribeToken(2, 'a@example.com'))
  })

  it('флаг выключен → письмо уходит без ссылки, но отписки уважаются', async () => {
    respond({
      'INSERT INTO campaigns': [[{ insertId: 8 }], []],
      'SELECT u.id, u.email FROM users u': [[{ id: 2, email: 'a@example.com' }], []],
      'SELECT email_unsubscribe_enabled FROM feature_flags': [[{ email_unsubscribe_enabled: 0 }], []],
    })
    const res = await request(adminApp()).post('/api/admin/campaigns')
      .send({ title: 'Hi', body: 'Body', channel: 'email' })
    expect(res.status).toBe(201)
    const html = sendCustomEmail.mock.calls[0][2]
    expect(html).not.toContain('/unsubscribe')
  })

  it('push-кампания уходит через sendPushToAll и не трогает email', async () => {
    respond({ 'INSERT INTO campaigns': [[{ insertId: 9 }], []] })
    const res = await request(adminApp()).post('/api/admin/campaigns')
      .send({ title: 'Hi', body: 'Body', channel: 'push' })
    expect(res.status).toBe(201)
    expect(sendPushToAll).toHaveBeenCalledWith('Hi', 'Body', '/')
    expect(sendCustomEmail).not.toHaveBeenCalled()
  })

  it('массовая рассылка: письмо каждому получателю, у каждого своя ссылка отписки', async () => {
    respond({
      'INSERT INTO campaigns': [[{ insertId: 10 }], []],
      'SELECT u.id, u.email FROM users u': [[
        { id: 2, email: 'a@example.com' },
        { id: 3, email: 'b@example.com' },
      ], []],
      'SELECT email_unsubscribe_enabled FROM feature_flags': [[{ email_unsubscribe_enabled: 1 }], []],
    })
    const res = await request(adminApp()).post('/api/admin/campaigns')
      .send({ title: 'Hi', body: 'Body', channel: 'email' })
    expect(res.status).toBe(201)
    expect(sendCustomEmail).toHaveBeenCalledTimes(2)
    expect(sendCustomEmail.mock.calls.map((call) => call[0])).toEqual(['a@example.com', 'b@example.com'])

    const htmlA = sendCustomEmail.mock.calls[0][2]
    const htmlB = sendCustomEmail.mock.calls[1][2]
    expect(htmlA).toContain(unsubscribeToken(2, 'a@example.com'))
    expect(htmlB).toContain(unsubscribeToken(3, 'b@example.com'))
    expect(htmlA).not.toContain(unsubscribeToken(3, 'b@example.com'))
  })

  it('сбой отправки одному получателю не мешает остальным и не роняет кампанию', async () => {
    respond({
      'INSERT INTO campaigns': [[{ insertId: 11 }], []],
      'SELECT u.id, u.email FROM users u': [[
        { id: 2, email: 'bad@example.com' },
        { id: 3, email: 'good@example.com' },
      ], []],
      'SELECT email_unsubscribe_enabled FROM feature_flags': [[{ email_unsubscribe_enabled: 1 }], []],
    })
    sendCustomEmail.mockReset()
    sendCustomEmail.mockRejectedValueOnce(new Error('SMTP down')).mockResolvedValue({ queued: true })

    const res = await request(adminApp()).post('/api/admin/campaigns')
      .send({ title: 'Hi', body: 'Body', channel: 'email' })
    expect(res.status).toBe(201)
    expect(sendCustomEmail).toHaveBeenCalledTimes(2)
    expect(sendCustomEmail.mock.calls[1][0]).toBe('good@example.com')

    await new Promise((resolve) => setImmediate(resolve))
    expect(logger.error).toHaveBeenCalledWith('Campaign email send failed:', expect.any(Error))
  })
})
