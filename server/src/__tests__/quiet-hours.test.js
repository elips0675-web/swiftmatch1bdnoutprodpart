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
  QUIET_DEFAULTS, isValidTimezone, isQuietAt, normalizeQuiet,
  getQuiet, isQuietNow, saveQuiet, quietUserSet,
} from '../quiet-hours.js'

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

function quietRow(overrides = {}) {
  return {
    enabled: 1,
    start: '22:00',
    end: '08:00',
    timezone: 'UTC',
    flag: 1,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockResolvedValue([[], []])
})

describe('isQuietAt — чистая проверка окна', () => {
  it('тишина выключена = никогда не тихо, даже внутри окна', () => {
    expect(isQuietAt({ enabled: false, start: '22:00', end: '08:00' }, new Date('2026-10-19T23:00:00Z'))).toBe(false)
  })

  it('окно нулевой длины (start === end) не гасит push', () => {
    expect(isQuietAt({ enabled: true, start: '22:00', end: '22:00' }, new Date('2026-10-19T22:00:00Z'))).toBe(false)
  })

  it('окно в пределах дня: внутри — тихо, на границах — start включительно, end исключительно', () => {
    const quiet = { enabled: true, start: '09:00', end: '17:00', timezone: 'UTC' }
    expect(isQuietAt(quiet, new Date('2026-10-19T08:59:00Z'))).toBe(false)
    expect(isQuietAt(quiet, new Date('2026-10-19T09:00:00Z'))).toBe(true)
    expect(isQuietAt(quiet, new Date('2026-10-19T12:00:00Z'))).toBe(true)
    expect(isQuietAt(quiet, new Date('2026-10-19T16:59:00Z'))).toBe(true)
    expect(isQuietAt(quiet, new Date('2026-10-19T17:00:00Z'))).toBe(false)
  })

  it('окно через полночь: 22:00–08:00 тихо и ночью, и под утро, но не днём', () => {
    const quiet = { enabled: true, start: '22:00', end: '08:00', timezone: 'UTC' }
    expect(isQuietAt(quiet, new Date('2026-10-19T21:59:00Z'))).toBe(false)
    expect(isQuietAt(quiet, new Date('2026-10-19T22:00:00Z'))).toBe(true)
    expect(isQuietAt(quiet, new Date('2026-10-19T23:30:00Z'))).toBe(true)
    expect(isQuietAt(quiet, new Date('2026-10-20T07:59:00Z'))).toBe(true)
    expect(isQuietAt(quiet, new Date('2026-10-20T08:00:00Z'))).toBe(false)
    expect(isQuietAt(quiet, new Date('2026-10-19T12:00:00Z'))).toBe(false)
  })

  it('сравнение идёт по локальному времени пояса пользователя, а не по UTC', () => {
    const quiet = { enabled: true, start: '00:00', end: '01:00', timezone: 'Asia/Tokyo' }
    expect(isQuietAt(quiet, new Date('2026-10-19T15:30:00Z'))).toBe(true)
    expect(isQuietAt(quiet, new Date('2026-10-19T16:30:00Z'))).toBe(false)
    expect(isQuietAt(quiet, new Date('2026-10-19T15:30:00Z'))).toBe(true)
  })

  it('некорректные часы и неизвестный пояс не гасят push (fail-open)', () => {
    expect(isQuietAt({ enabled: true, start: '9:00', end: '17:00', timezone: 'UTC' }, new Date('2026-10-19T12:00:00Z'))).toBe(false)
    expect(isQuietAt({ enabled: true, start: '24:00', end: '25:00', timezone: 'UTC' }, new Date('2026-10-19T12:00:00Z'))).toBe(false)
    expect(isQuietAt({ enabled: true, start: '22:60', end: '08:00', timezone: 'UTC' }, new Date('2026-10-19T22:30:00Z'))).toBe(false)
    expect(isQuietAt({ enabled: true, start: '22:00', end: '08:00', timezone: 'Mars/Olympus' }, new Date('2026-10-19T23:00:00Z'))).toBe(false)
  })

  it('неполный объект подставляет дефолты (22:00–08:00 UTC)', () => {
    expect(isQuietAt({ enabled: true }, new Date('2026-10-19T23:00:00Z'))).toBe(true)
    expect(QUIET_DEFAULTS).toEqual({ enabled: false, start: '22:00', end: '08:00', timezone: 'UTC' })
  })
})

describe('isValidTimezone — проверка пояса через Intl', () => {
  it('принимает реальные пояса', () => {
    expect(isValidTimezone('UTC')).toBe(true)
    expect(isValidTimezone('Europe/Moscow')).toBe(true)
    expect(isValidTimezone('America/New_York')).toBe(true)
  })

  it('отклоняет несуществующий пояс и пустую строку', () => {
    expect(isValidTimezone('Mars/Olympus')).toBe(false)
    expect(isValidTimezone('')).toBe(false)
  })

  it('отклоняет не-строки и строки длиннее varchar(64)', () => {
    expect(isValidTimezone(42)).toBe(false)
    expect(isValidTimezone(null)).toBe(false)
    expect(isValidTimezone('a'.repeat(65))).toBe(false)
  })
})

describe('normalizeQuiet — приведение произвольного входа', () => {
  it('null / массив / строка = дефолт с invalid ["quiet"]', () => {
    for (const bad of [null, [], 'all', 7]) {
      const { quiet, invalid } = normalizeQuiet(bad)
      expect(quiet).toEqual(QUIET_DEFAULTS)
      expect(invalid).toEqual(['quiet'])
    }
  })

  it('полный валидный объект проходит без замечаний', () => {
    const { quiet, invalid } = normalizeQuiet({ enabled: true, start: '23:15', end: '07:45', timezone: 'Europe/Moscow' })
    expect(invalid).toEqual([])
    expect(quiet).toEqual({ enabled: true, start: '23:15', end: '07:45', timezone: 'Europe/Moscow' })
  })

  it('непереданные поля остаются дефолтными', () => {
    const { quiet, invalid } = normalizeQuiet({ enabled: true })
    expect(invalid).toEqual([])
    expect(quiet).toEqual({ enabled: true, start: '22:00', end: '08:00', timezone: 'UTC' })
  })

  it('не-boolean enabled попадает в invalid, а не затирает настройку', () => {
    expect(normalizeQuiet({ enabled: 'yes' }).invalid).toEqual(['enabled'])
    expect(normalizeQuiet({ enabled: 1 }).invalid).toEqual(['enabled'])
  })

  it('битые часы попадают в invalid по имени поля', () => {
    expect(normalizeQuiet({ start: '9:0' }).invalid).toEqual(['start'])
    expect(normalizeQuiet({ end: '25:00' }).invalid).toEqual(['end'])
    expect(normalizeQuiet({ start: '22:60' }).invalid).toEqual(['start'])
  })

  it('неизвестный пояс попадает в invalid', () => {
    expect(normalizeQuiet({ timezone: 'Mars/Olympus' }).invalid).toEqual(['timezone'])
    expect(normalizeQuiet({ timezone: 42 }).invalid).toEqual(['timezone'])
  })

  it('несколько битых полей перечислены разом', () => {
    const { invalid } = normalizeQuiet({ enabled: 'x', start: 'bad', timezone: 'bad' })
    expect(invalid).toEqual(['enabled', 'start', 'timezone'])
  })

  it('неизвестные ключи молча игнорируются, а не 500-ят', () => {
    const { quiet, invalid } = normalizeQuiet({ telepatii: true })
    expect(invalid).toEqual([])
    expect(quiet).toEqual(QUIET_DEFAULTS)
  })
})

describe('Чтение из БД — fail-open', () => {
  it('нет строки = дефолт (тишина выключена)', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    expect(await getQuiet(USER)).toEqual(QUIET_DEFAULTS)
  })

  it('ошибка БД не роняет чтение — дефолт вместо исключения', async () => {
    pool.query.mockRejectedValueOnce(new Error('ER_NO_SUCH_TABLE'))
    expect(await getQuiet(USER)).toEqual(QUIET_DEFAULTS)
  })

  it('строка из БД маппится в настройки, null-колонки заменяются дефолтами', async () => {
    pool.query.mockResolvedValueOnce([[quietRow({ start: null, timezone: null })], []])
    expect(await getQuiet(USER)).toEqual({ enabled: true, start: '22:00', end: '08:00', timezone: 'UTC' })
  })

  it('запрос использует prepared statement, user_id подставляется параметром', async () => {
    await getQuiet(USER)
    const call = sqlCalls('FROM notification_preferences')[0]
    expect(call[0]).toContain('WHERE np.user_id = ?')
    expect(call[0]).not.toContain(String(USER))
    expect(call[1]).toEqual([USER])
  })
})

describe('isQuietNow — тишина с учётом feature flag', () => {
  it('флаг выключен = push идёт, даже если пользователь включил тишину', async () => {
    pool.query.mockResolvedValueOnce([[quietRow({ flag: 0 })], []])
    expect(await isQuietNow(USER, new Date('2026-10-19T23:00:00Z'))).toBe(false)
  })

  it('флаг включён + окно активно = тихо', async () => {
    pool.query.mockResolvedValueOnce([[quietRow({ flag: 1 })], []])
    expect(await isQuietNow(USER, new Date('2026-10-19T23:00:00Z'))).toBe(true)
  })

  it('флаг включён + окно неактивно = push идёт', async () => {
    pool.query.mockResolvedValueOnce([[quietRow({ flag: 1 })], []])
    expect(await isQuietNow(USER, new Date('2026-10-19T12:00:00Z'))).toBe(false)
  })

  it('ошибка БД = push идёт (fail-open, уведомления не теряются молча)', async () => {
    pool.query.mockRejectedValueOnce(new Error('gone'))
    expect(await isQuietNow(USER)).toBe(false)
  })
})

describe('saveQuiet — upsert настроек', () => {
  it('пишет upsert-ом с prepared statement, SQL не содержит id', async () => {
    await saveQuiet(USER, { enabled: true, start: '23:30', end: '07:15', timezone: 'Europe/Moscow' })
    const call = sqlCalls('INSERT INTO notification_preferences')[0]
    expect(call[0]).toContain('ON DUPLICATE KEY UPDATE')
    expect(call[0]).toContain('quiet_enabled')
    expect(call[0]).not.toContain(String(USER))
    expect(call[1]).toEqual([USER, 1, '23:30', '07:15', 'Europe/Moscow'])
  })

  it('enabled=false пишется нулём', async () => {
    await saveQuiet(USER, QUIET_DEFAULTS)
    expect(lastInsertParams()).toEqual([USER, 0, '22:00', '08:00', 'UTC'])
  })
})

describe('quietUserSet — пакетная проверка рассылок', () => {
  it('пустой и полностью мусорный списки не ходят в БД', async () => {
    expect((await quietUserSet([])).size).toBe(0)
    expect((await quietUserSet(['abc', null, undefined, -3])).size).toBe(0)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('не-числовые id отфильтровываются, дубликаты схлопываются', async () => {
    await quietUserSet([USER, 'abc', null, 7, 7])
    const call = sqlCalls('FROM notification_preferences')[0]
    expect(call[1]).toEqual([[USER, 7]])
  })

  it('в возвращаемый набор попадают только те, у кого сейчас тихо', async () => {
    pool.query.mockResolvedValueOnce([[
      quietRow({ user_id: 1 }),
      quietRow({ user_id: 2, start: '09:00', end: '17:00' }),
    ], []])
    const quiet = await quietUserSet([1, 2], new Date('2026-10-19T12:00:00Z'))
    expect(quiet.has(1)).toBe(false)
    expect(quiet.has(2)).toBe(true)
  })

  it('выключенный флаг = пустой набор (JOIN по feature_flags отсекает)', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    expect((await quietUserSet([1, 2])).size).toBe(0)
  })

  it('ошибка БД = пустой набор (fail-open)', async () => {
    pool.query.mockRejectedValueOnce(new Error('gone'))
    expect((await quietUserSet([1])).size).toBe(0)
  })
})

describe('GET /api/notifications/quiet-hours', () => {
  it('без токена → 401', async () => {
    const res = await request(createApp()).get('/api/notifications/quiet-hours')
    expect(res.status).toBe(401)
  })

  it('нет строки = дефолт в ответе', async () => {
    const res = await authGet('/api/notifications/quiet-hours')
    expect(res.status).toBe(200)
    expect(res.body.quiet).toEqual(QUIET_DEFAULTS)
  })

  it('отдаёт сохранённые настройки', async () => {
    pool.query.mockResolvedValueOnce([[quietRow({ start: '23:45', end: '06:30', timezone: 'Asia/Tokyo' })], []])
    const res = await authGet('/api/notifications/quiet-hours')
    expect(res.body.quiet).toEqual({ enabled: true, start: '23:45', end: '06:30', timezone: 'Asia/Tokyo' })
  })
})

describe('PUT /api/notifications/quiet-hours', () => {
  it('без токена → 401 и записи в БД нет', async () => {
    const res = await request(createApp())
      .put('/api/notifications/quiet-hours')
      .send({ enabled: true })
    expect(res.status).toBe(401)
    expect(sqlCalls('INSERT INTO notification_preferences')).toHaveLength(0)
  })

  it('сохраняет настройки и эхо-отвечает ими', async () => {
    const res = await authPut('/api/notifications/quiet-hours', {
      quiet: { enabled: true, start: '23:00', end: '07:00', timezone: 'Europe/Moscow' },
    })
    expect(res.status).toBe(200)
    expect(res.body.quiet).toEqual({ enabled: true, start: '23:00', end: '07:00', timezone: 'Europe/Moscow' })
    expect(lastInsertParams()).toEqual([USER, 1, '23:00', '07:00', 'Europe/Moscow'])
  })

  it('принимает тело без обёртки quiet', async () => {
    const res = await authPut('/api/notifications/quiet-hours', { enabled: true, start: '21:00', end: '05:00' })
    expect(res.status).toBe(200)
    expect(res.body.quiet).toEqual({ enabled: true, start: '21:00', end: '05:00', timezone: 'UTC' })
  })

  it('невалидные часы → 400 со списком полей, в БД не пишется', async () => {
    const res = await authPut('/api/notifications/quiet-hours', { start: '9:00' })
    expect(res.status).toBe(400)
    expect(res.body.invalid).toEqual(['start'])
    expect(sqlCalls('INSERT INTO notification_preferences')).toHaveLength(0)
  })

  it('массив вместо объекта → 400', async () => {
    const res = await authPut('/api/notifications/quiet-hours', [])
    expect(res.status).toBe(400)
  })

  it('не-объект под обёрткой quiet → 400', async () => {
    const res = await authPut('/api/notifications/quiet-hours', { quiet: 'nope' })
    expect(res.status).toBe(400)
  })

  it('неизвестные ключи не 500-ят и не пишутся', async () => {
    const res = await authPut('/api/notifications/quiet-hours', { telepatii: true })
    expect(res.status).toBe(200)
    expect(res.body.quiet).toEqual(QUIET_DEFAULTS)
  })
})
