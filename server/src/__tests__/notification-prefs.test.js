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

import pool from '../db.js'
import notificationRoutes from '../routes/notifications.js'
import {
  NOTIFICATION_EVENTS, CHANNELS, defaultPrefs, normalizePrefs,
  getPrefs, getPrefsMap, savePrefs, isAllowed, isAllowedIn, describeMatrix,
} from '../notification-prefs.js'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'
const USER = 5

function token(userId = USER) {
  return jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })
}

function createApp() {
  const app = express()
  app.use(express.json())
  app.use(notificationRoutes)
  return app
}

function authGet(path) {
  return request(createApp()).get(path).set('Authorization', `Bearer ${token()}`)
}

function authPut(path, body) {
  return request(createApp())
    .put(path)
    .set('Authorization', `Bearer ${token()}`)
    .send(body)
}

function sqlCalls(prefix) {
  return pool.query.mock.calls.filter((c) => typeof c[0] === 'string' && c[0].includes(prefix))
}

function lastInsertParams() {
  const calls = sqlCalls('INSERT INTO notification_preferences')
  return calls.length ? calls[calls.length - 1][1] : null
}

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockResolvedValue([[], []])
})

describe('Канон матрицы событий', () => {
  it('описано 9 событий, покрывающих все точки отправки в коде', () => {
    expect(NOTIFICATION_EVENTS).toHaveLength(9)
    const keys = NOTIFICATION_EVENTS.map((e) => e.key)
    expect(new Set(keys).size).toBe(9)
  })

  it('каналов ровно два: inApp и push — email по этим событиям не отправляется', () => {
    expect(CHANNELS).toEqual(['inApp', 'push'])
  })

  it('все ключи матрицы соответствуют реальным type в БД и событиям push', () => {
    expect(NOTIFICATION_EVENTS.map((e) => e.key).sort()).toEqual([
      'chat_message', 'hangout_accepted', 'hangout_cancelled', 'hangout_declined',
      'hangout_joined', 'hangout_mutual_like', 'hangout_response', 'invite', 'like',
    ])
  })

  it('у события нет канала, которого нет в коде (нет мёртвых переключателей)', () => {
    const byKey = Object.fromEntries(describeMatrix().map((e) => [e.key, e.channels]))
    expect(byKey.invite).toEqual(['inApp'])
    expect(byKey.hangout_declined).toEqual(['inApp'])
    expect(byKey.chat_message).toEqual(['push'])
    expect(byKey.hangout_joined).toEqual(['push'])
  })

  it('описание матрицы не отдаёт внутренние ссылки на модуль', () => {
    for (const e of describeMatrix()) {
      expect(Object.keys(e)).toEqual(['key', 'channels'])
    }
  })
})

describe('normalizePrefs — приведение произвольного входа к матрице', () => {
  it('пустой вход = все включены', () => {
    const { prefs, invalid } = normalizePrefs({})
    expect(invalid).toEqual([])
    expect(prefs).toEqual(defaultPrefs())
  })

  it('null / массив / строка не считаются объектом настроек', () => {
    expect(normalizePrefs(null).prefs).toEqual(defaultPrefs())
    expect(normalizePrefs([]).prefs).toEqual(defaultPrefs())
    expect(normalizePrefs('all').prefs).toEqual(defaultPrefs())
  })

  it('применяет только переданные ячейки, остальные остаются включёнными', () => {
    const { prefs } = normalizePrefs({ chat_message: { push: false } })
    expect(prefs.chat_message.push).toBe(false)
    expect(prefs.like.inApp).toBe(true)
    expect(prefs.like.push).toBe(true)
  })

  it('неизвестное событие игнорируется, а не падает', () => {
    const { prefs, invalid } = normalizePrefs({ telepatii: { push: false } })
    expect(prefs).toEqual(defaultPrefs())
    expect(invalid).toEqual([])
  })

  it('нереализованный канал отбрасывается (invite.push не хранится)', () => {
    const { prefs, invalid } = normalizePrefs({ invite: { push: false } })
    expect(prefs.invite).toEqual({ inApp: true })
    expect(invalid).toEqual([])
  })

  it('не-boolean значение попадает в invalid, а не затирает настройку молча', () => {
    const { prefs, invalid } = normalizePrefs({ like: { inApp: 'nope' } })
    expect(invalid).toEqual(['like.inApp'])
    expect(prefs.like.inApp).toBe(true)
  })

  it('не-объект для события попадает в invalid', () => {
    const { invalid } = normalizePrefs({ invite: 'off' })
    expect(invalid).toEqual(['invite'])
  })

  it('настройки, записанные старой версией кода, сливаются с дефолтом', () => {
    const { prefs } = normalizePrefs({ like: { inApp: false } })
    expect(Object.keys(prefs)).toHaveLength(9)
    expect(prefs.hangout_joined.push).toBe(true)
  })

  it('defaultPrefs() возвращает независимую копию каждый раз', () => {
    const a = defaultPrefs()
    a.like.inApp = false
    expect(defaultPrefs().like.inApp).toBe(true)
  })
})

describe('Загрузка настроек — fail-open', () => {
  it('нет строки в БД = всё включено (старые аккаунты не теряют уведомления)', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    await expect(getPrefs(USER)).resolves.toBeNull()
    expect(await isAllowed(USER, 'like', 'inApp')).toBe(true)
  })

  it('ошибка БД не роняет отправку уведомления', async () => {
    pool.query.mockRejectedValueOnce(new Error('ER_NO_SUCH_TABLE'))
    await expect(getPrefs(USER)).resolves.toBeNull()
    expect(await isAllowed(USER, 'like', 'push')).toBe(true)
  })

  it('используется prepared statement, user_id подставляется параметром', async () => {
    await getPrefsMap([USER])
    const call = sqlCalls('FROM notification_preferences')[0]
    expect(call[0]).toContain('IN (?)')
    expect(call[0]).not.toContain(String(USER))
    expect(call[1]).toEqual([[USER]])
  })

  it('пустой список получателей не ходит в БД', async () => {
    const map = await getPrefsMap([])
    expect(map.size).toBe(0)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('не-числовые id отфильтровываются, дубликаты схлопываются', async () => {
    await getPrefsMap([USER, USER, 'abc', null, 7])
    const call = sqlCalls('FROM notification_preferences')[0]
    expect(call[1]).toEqual([[USER, 7]])
  })

  it('битый JSON в prefs не считается настройкой — fail-open', async () => {
    pool.query.mockResolvedValueOnce([[{ user_id: USER, prefs: '{oops' }], []])
    expect(await getPrefs(USER)).toBeNull()
    expect(await isAllowed(USER, 'like', 'inApp')).toBe(true)
  })

  it('JSON-строка из MySQL разбирается в объект', async () => {
    pool.query.mockResolvedValueOnce([
      [{ user_id: USER, prefs: JSON.stringify({ like: { inApp: false } }) }],
      [],
    ])
    const prefs = await getPrefs(USER)
    expect(prefs.like.inApp).toBe(false)
  })

  it('getPrefsMap отдаёт по одной записи на получателя, включая тех без строки', async () => {
    pool.query.mockResolvedValueOnce([[{ user_id: 7, prefs: { chat_message: { push: false } } }], []])
    const map = await getPrefsMap([7, 8])
    expect(map.size).toBe(2)
    expect(map.get(7).chat_message.push).toBe(false)
    expect(map.get(8)).toBeNull()
  })
})

describe('isAllowed — проверка ячейки', () => {
  it('выключенная ячейка запрещает канал', async () => {
    pool.query.mockResolvedValueOnce([[{ user_id: USER, prefs: { like: { inApp: false } } }], []])
    expect(await isAllowed(USER, 'like', 'inApp')).toBe(false)
  })

  it('выключение одного канала не влияет на второй', async () => {
    pool.query.mockResolvedValueOnce([[{ user_id: USER, prefs: { like: { inApp: false } } }], []])
    expect(await isAllowed(USER, 'like', 'push')).toBe(true)
  })

  it('выключение inApp у одного события не влияет на другие события', async () => {
    pool.query.mockResolvedValueOnce([[{ user_id: USER, prefs: { like: { inApp: false } } }], []])
    expect(await isAllowed(USER, 'hangout_response', 'inApp')).toBe(true)
  })

  it('неизвестное событие и неизвестный канал разрешены (fail-open)', () => {
    const map = new Map([[USER, { like: { inApp: false } }]])
    expect(isAllowedIn(map, USER, 'telepatii', 'inApp')).toBe(true)
    expect(isAllowedIn(map, USER, 'like', 'email')).toBe(true)
  })

  it('выход за пределы матрицы пользователя не блокирует чужие ячейки', () => {
    const map = new Map([[USER, { like: { inApp: false, push: false } }]])
    expect(isAllowedIn(map, 999, 'like', 'inApp')).toBe(true)
  })

  it('не-boolean в сохранённых данных откатывается к включённому (fail-open)', async () => {
    pool.query.mockResolvedValueOnce([[{ user_id: USER, prefs: { like: { inApp: 0, push: 1 } } }], []])
    expect(await isAllowed(USER, 'like', 'inApp')).toBe(true)
  })

  it('выключение переживает цикл сохранения: false не превращается в true', async () => {
    const { prefs } = normalizePrefs({ like: { inApp: false } })
    pool.query.mockResolvedValueOnce([[{ user_id: USER, prefs: JSON.stringify(prefs) }], []])
    expect(await isAllowed(USER, 'like', 'inApp')).toBe(false)
  })

  it('isAllowedIn судит строго: не-boolean в мапе считается выключенным', () => {
    const map = new Map([[USER, { like: { inApp: 1 } }]])
    expect(isAllowedIn(map, USER, 'like', 'inApp')).toBe(false)
  })
})

describe('GET /api/notifications/preferences', () => {
  it('без токена → 401', async () => {
    const res = await request(createApp()).get('/api/notifications/preferences')
    expect(res.status).toBe(401)
  })

  it('отдаёт полную матрицу 9 событий, даже если строки в БД нет', async () => {
    const res = await authGet('/api/notifications/preferences')
    expect(res.status).toBe(200)
    expect(res.body.events).toHaveLength(9)
    expect(res.body.prefs).toEqual(defaultPrefs())
  })

  it('отдаёт сохранённые настройки, а не дефолт', async () => {
    pool.query.mockResolvedValueOnce([[{ user_id: USER, prefs: { chat_message: { push: false } } }], []])
    const res = await authGet('/api/notifications/preferences')
    expect(res.body.prefs.chat_message.push).toBe(false)
    expect(res.body.prefs.like.inApp).toBe(true)
  })

  it('в ответе есть канон событий и дефолты для UI', async () => {
    const res = await authGet('/api/notifications/preferences')
    expect(res.body.channels).toEqual(['inApp', 'push'])
    expect(res.body.defaults).toEqual(defaultPrefs())
  })

  it('настройки одного пользователя не показываются другому', async () => {
    pool.query.mockResolvedValueOnce([[{ user_id: 999, prefs: { like: { inApp: false } } }], []])
    const res = await authGet('/api/notifications/preferences')
    expect(res.body.prefs.like.inApp).toBe(true)
  })
})

describe('PUT /api/notifications/preferences', () => {
  it('без токена → 401 и записи в БД нет', async () => {
    const res = await request(createApp())
      .put('/api/notifications/preferences')
      .send({ like: { inApp: false } })
    expect(res.status).toBe(401)
    expect(sqlCalls('INSERT INTO notification_preferences')).toHaveLength(0)
  })

  it('сохраняет матрицу upsert-ом с prepared statement', async () => {
    const res = await authPut('/api/notifications/preferences', {
      prefs: { like: { inApp: false, push: false } },
    })
    expect(res.status).toBe(200)
    const call = sqlCalls('INSERT INTO notification_preferences')[0]
    expect(call[0]).toContain('ON DUPLICATE KEY UPDATE')
    expect(call[0]).not.toContain(String(USER))
    const [userId, json] = call[1]
    expect(userId).toBe(USER)
    expect(JSON.parse(json).like).toEqual({ inApp: false, push: false })
  })

  it('принимает тело без обёртки prefs', async () => {
    const res = await authPut('/api/notifications/preferences', { like: { inApp: false } })
    expect(res.status).toBe(200)
    expect(JSON.parse(lastInsertParams()[1]).like.inApp).toBe(false)
  })

  it('ответ содержит ровно сохранённую матрицу', async () => {
    const res = await authPut('/api/notifications/preferences', { invite: { inApp: false } })
    expect(res.body.prefs.invite.inApp).toBe(false)
    expect(res.body.events).toHaveLength(9)
  })

  it('полная запись: не указанные события возвращаются в дефолт, а не затираются', async () => {
    const res = await authPut('/api/notifications/preferences', { like: { inApp: false } })
    expect(res.body.prefs.hangout_cancelled.inApp).toBe(true)
  })

  it('не-boolean → 400 со списком отклонённых ячеек, в БД не пишется', async () => {
    const res = await authPut('/api/notifications/preferences', { like: { inApp: 'off' } })
    expect(res.status).toBe(400)
    expect(res.body.invalid).toEqual(['like.inApp'])
    expect(sqlCalls('INSERT INTO notification_preferences')).toHaveLength(0)
  })

  it('массив вместо объекта → 400', async () => {
    const res = await authPut('/api/notifications/preferences', [])
    expect(res.status).toBe(400)
  })

  it('неизвестное событие не 500-ит и не пишется в БД', async () => {
    const res = await authPut('/api/notifications/preferences', { telepatii: { push: false } })
    expect(res.status).toBe(200)
    expect(JSON.parse(lastInsertParams()[1])).toEqual(defaultPrefs())
  })

  it('сохранённые настройки читаются обратно тем же GET', async () => {
    await authPut('/api/notifications/preferences', { chat_message: { push: false } })
    pool.query.mockResolvedValueOnce([
      [{ user_id: USER, prefs: JSON.stringify({ chat_message: { push: false } }) }],
      [],
    ])
    const res = await authGet('/api/notifications/preferences')
    expect(res.body.prefs.chat_message.push).toBe(false)
  })
})

describe('savePrefs — прямой вызов', () => {
  it('пишет JSON-строкую, а не объект', async () => {
    await savePrefs(USER, defaultPrefs())
    const call = sqlCalls('INSERT INTO notification_preferences')[0]
    expect(typeof call[1][1]).toBe('string')
  })
})
