vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'

vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}))

vi.mock('../ws.js', () => ({
  getIO: vi.fn(() => null),
}))

vi.mock('../banned-words.js', () => ({
  getBannedWords: vi.fn(() => []),
  containsBannedWord: vi.fn(() => false),
}))

vi.mock('../routes/push.js', () => ({
  sendPushToUser: vi.fn(async () => 0),
  sendPushToAll: vi.fn(async () => 0),
  default: {},
}))

import pool from '../db.js'
import socialRoutes from '../routes/social.js'
import hangoutRoutes from '../routes/hangouts.js'
import { sendPushToUser } from '../routes/push.js'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'
const ACTOR = 11
const TARGET = 22

function token(userId) {
  return jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })
}

function createApp() {
  const app = express()
  app.use(express.json())
  app.use(socialRoutes)
  app.use(hangoutRoutes)
  return app
}

function auth(method, path, body) {
  const req = request(createApp())[method](path).set('Authorization', `Bearer ${token(ACTOR)}`)
  return body === undefined ? req : req.send(body)
}

function sqlCalls(prefix) {
  return pool.query.mock.calls.filter((c) => typeof c[0] === 'string' && c[0].includes(prefix))
}

function insertNotificationTypes() {
  return sqlCalls('INSERT INTO notifications').map((c) => c[1][1])
}

// Маршрутизатор моков по куску SQL. Нужно, чтобы лимиты лайков и подписки
// проходили, а интереса представляли только notification_preferences и
// INSERT INTO notifications — их и проверяют тесты.
function mockDb({ prefs = null, prefsError = false, prefsRaw = null, newNotifId = 900 } = {}) {
  pool.query.mockImplementation(async (sql) => {
    if (typeof sql !== 'string') return [[], []]
    if (sql.includes('FROM notification_preferences')) {
      if (prefsError) throw new Error('ER_NO_SUCH_TABLE')
      if (prefsRaw !== null) return [[{ user_id: TARGET, prefs: prefsRaw }], []]
      if (prefs) return [[{ user_id: TARGET, prefs }], []]
      return [[], []]
    }
    if (sql.includes('FROM subscriptions')) return [[{ id: 1 }], []]
    if (sql.includes('COUNT(*) AS cnt')) return [[{ cnt: 0 }], []]
    if (sql.includes('INSERT IGNORE INTO likes')) return [{ affectedRows: 1 }, []]
    if (sql.includes('INSERT INTO notifications')) return [{ insertId: newNotifId }, []]
    if (sql.includes('display_name')) return [[{ display_name: 'Ann' }], []]
    return [[], []]
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockResolvedValue([[], []])
  sendPushToUser.mockResolvedValue(0)
})

function likeBody() {
  return { liked_user_id: TARGET, type: 'like' }
}

describe('POST /api/likes — уведомление о лайке', () => {
  it('без настроек: лайк создаёт in-app уведомление и шлёт push', async () => {
    mockDb({ newNotifId: 501 })
    const res = await auth('post', '/api/likes', likeBody())
    expect(res.status).toBe(201)
    expect(insertNotificationTypes()).toEqual(['like'])
    expect(sendPushToUser).toHaveBeenCalledTimes(1)
  })

  it('inApp выключен → INSERT в notifications нет, push всё равно уходит', async () => {
    mockDb({ prefs: { like: { inApp: false, push: true } } })
    const res = await auth('post', '/api/likes', likeBody())
    expect(res.status).toBe(201)
    expect(sqlCalls('INSERT INTO notifications')).toHaveLength(0)
    expect(sendPushToUser).toHaveBeenCalledTimes(1)
  })

  it('push выключен → уведомление в ленте есть, push не отправляется', async () => {
    mockDb({ prefs: { like: { inApp: true, push: false } } })
    const res = await auth('post', '/api/likes', likeBody())
    expect(res.status).toBe(201)
    expect(insertNotificationTypes()).toEqual(['like'])
    expect(sendPushToUser).not.toHaveBeenCalled()
  })

  it('оба канала выключены → лайк всё равно засчитан (201), уведомлений ноль', async () => {
    mockDb({ prefs: { like: { inApp: false, push: false } } })
    const res = await auth('post', '/api/likes', likeBody())
    expect(res.status).toBe(201)
    expect(sqlCalls('INSERT INTO notifications')).toHaveLength(0)
    expect(sendPushToUser).not.toHaveBeenCalled()
  })

  it('выключение супер-лайка не обходит настройку обычного лайка', async () => {
    mockDb({ prefs: { like: { inApp: false, push: false } } })
    const res = await auth('post', '/api/likes', { liked_user_id: TARGET, type: 'super_like' })
    expect(res.status).toBe(201)
    expect(sqlCalls('INSERT INTO notifications')).toHaveLength(0)
    expect(sendPushToUser).not.toHaveBeenCalled()
  })

  it('настройки выключают уведомление у получателя, а не у отправителя', async () => {
    mockDb({ prefs: { like: { inApp: false, push: false } } })
    const res = await auth('post', '/api/likes', likeBody())
    expect(res.status).toBe(201)
    const prefCall = sqlCalls('FROM notification_preferences')[0]
    expect(prefCall[1]).toEqual([[TARGET]])
    expect(sqlCalls('INSERT INTO notifications')).toHaveLength(0)
  })
})

describe('POST /api/invites — уведомление о приглашении', () => {
  it('inApp выключен → приглашение создано, уведомления нет', async () => {
    mockDb({ prefs: { invite: { inApp: false } } })
    const res = await auth('post', '/api/invites', { invitee_id: TARGET, type: 'coffee' })
    expect(res.status).toBe(201)
    expect(sqlCalls('INSERT INTO invites')).toHaveLength(1)
    expect(sqlCalls('INSERT INTO notifications')).toHaveLength(0)
  })

  it('выключенная настройка invite не влияет на уведомление о лайке', async () => {
    mockDb({ prefs: { invite: { inApp: false } } })
    const res = await auth('post', '/api/likes', likeBody())
    expect(res.status).toBe(201)
    expect(insertNotificationTypes()).toEqual(['like'])
  })

  it('выключенная настройка like не влияет на приглашение', async () => {
    mockDb({ prefs: { like: { inApp: false, push: false } } })
    const res = await auth('post', '/api/invites', { invitee_id: TARGET, type: 'coffee' })
    expect(res.status).toBe(201)
    expect(insertNotificationTypes()).toEqual(['invite'])
  })
})

describe('Ошибка чтения настроек не роняет бизнес-операцию', () => {
  it('падение SELECT настроек → лайк засчитан, уведомление создано', async () => {
    mockDb({ prefsError: true, newNotifId: 701 })
    const res = await auth('post', '/api/likes', likeBody())
    expect(res.status).toBe(201)
    expect(insertNotificationTypes()).toEqual(['like'])
  })

  it('битый JSON в настройках → fail-open, уведомление создано', async () => {
    mockDb({ prefsRaw: '{oops', newNotifId: 702 })
    const res = await auth('post', '/api/likes', likeBody())
    expect(res.status).toBe(201)
    expect(insertNotificationTypes()).toEqual(['like'])
  })
})

describe('Канон гейтов покрывает все точки отправки', () => {
  it('в social.js и hangouts.js не осталось безусловных INSERT в notifications', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const dir = path.resolve(process.cwd(), 'src/routes')
    for (const file of ['social.js', 'hangouts.js']) {
      const text = fs.readFileSync(path.join(dir, file), 'utf8')
      const lines = text.split(/\r?\n/)
      lines.forEach((line, i) => {
        if (!line.includes('INSERT INTO notifications')) return
        const before = lines.slice(Math.max(0, i - 12), i + 1).join('\n')
        expect(
          before,
          `${file}:${i + 1} — INSERT в notifications без проверки isAllowedIn выше по коду`,
        ).toMatch(/isAllowedIn\(|isAllowed\(/)
      })
    }
  })

  it('каждая отправка push в social.js и hangouts.js проверяет настройку', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const dir = path.resolve(process.cwd(), 'src/routes')
    for (const file of ['social.js', 'hangouts.js']) {
      const lines = fs.readFileSync(path.join(dir, file), 'utf8').split(/\r?\n/)
      lines.forEach((line, i) => {
        if (!/sendPushToUser\(/.test(line) || line.trimStart().startsWith('import')) return
        const before = lines.slice(Math.max(0, i - 12), i + 1).join('\n')
        expect(
          before,
          `${file}:${i + 1} — sendPushToUser без проверки isAllowed`,
        ).toMatch(/isAllowedIn\(|isAllowed\(/)
      })
    }
  })
})
