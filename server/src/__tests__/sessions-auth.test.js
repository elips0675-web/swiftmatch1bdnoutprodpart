// Этап 27 (P0 #5): GET /api/auth/sessions + DELETE /api/auth/sessions/:familyId.
//
// Мок БД здесь НЕ «принимает любые параметры» (питфолл 13): он разбирает текст
// запроса и применяет WHERE. Иначе проверка IDOR была бы фиктивной — с обычным
// mockResolvedValue тест остался бы зелёным, даже если бы из UPDATE выкинули
// `user_id = ?`. Ниже это проверено ломкой: с выброшенным user_id краснеют
// тесты «IDOR: чужая сессия не отзывается» и «404 на чужую сессию».
//
// Про IP: supertest выполняет запрос в том же процессе, поэтому req.ip = ::ffff:127.0.0.1.
// Чтобы fingerprint сессии совпал с fingerprint текущего запроса, сиды сеют
// с этим же адресом, а различаются только User-Agent (он и есть «устройство»).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'

vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}))

import pool from '../db.js'
import authRoutes from '../routes/auth.js'

// Тот же приём, что в admin-auth.test.js:2 и active-user.test.js:10 — короткое
// тестовое значение. И длинное (>32) тоже не подходит: secrets-leak-audit считает
// присваивание секрета по длине значения, поэтому «безопасное на вид» имя длиннее
// 24 символов превращает тест в утечку (проверено ломкой гейта).
process.env.JWT_SECRET = 'test-secret'

const ALICE = 1
const BOB = 2

const REQ_IP = '::ffff:127.0.0.1'
const ALICE_DESKTOP = '11111111-1111-4111-8111-111111111111'
const ALICE_PHONE = '22222222-2222-4222-8222-222222222222'
const BOB_LAPTOP = '33333333-3333-4333-8333-333333333333'
const ABSENT = '44444444-4444-4444-8444-444444444444'

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0'
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/605.1'
const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Firefox/133.0'

function tokenFor(userId) {
  return jwt.sign({ userId, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '1h' })
}

function fingerprintFor(userAgent, ip = REQ_IP) {
  // та же формула, что в makeFingerprint (routes/auth.js)
  return crypto.createHash('sha256').update(ip + '|' + userAgent).digest('hex').slice(0, 32)
}

let tokens = []
let nextId = 1

function seed({ userId, familyId, userAgent, revoked = 0, expired = false, ip = REQ_IP }) {
  const id = nextId++
  tokens.push({
    id,
    user_id: userId,
    family_id: familyId,
    fingerprint: fingerprintFor(userAgent, ip),
    ip_address: ip,
    user_agent: userAgent,
    revoked,
    created_at: new Date(2026, 0, 1, 10, id).toISOString().slice(0, 19).replace('T', ' '),
    expires_at: expired ? '2000-01-01 00:00:00' : '2099-01-01 00:00:00',
  })
  return id
}

const isActive = t => t.revoked === 0 && t.expires_at > '2026-10-01 00:00:00'

// Плейсхолдеры связываются ПО ТЕКСТУ запроса, как их связала бы MySQL.
// Первый вариант фейка деструктурировал params фиксированно ([userId, familyId]),
// и на сломанном коде без `user_id = ?` значения сдвигались — IDOR-тест получал
// family_id = undefined, отдавал 404 и оставался ЗЕЛЁНЫМ на уязвимом коде.
// Теперь номер параметра вычисляется из позиции `user_id = ?` в тексте.
function placeholderIndex(sql, column) {
  const m = new RegExp(`${column}\\s*=\\s*\\?`, 'i').exec(sql)
  if (!m) return -1
  return sql.slice(0, m.index).split('?').length - 1
}

// SQL-aware фейк: различает запросы по тексту и фильтрует по тому, что реально
// написано в WHERE, а не по тому, что мы хотели бы там видеть.
function fakeQuery(sql, params = []) {
  if (sql.includes('JOIN (') && sql.includes('MAX(id) AS latest_id')) {
    const userId = params[placeholderIndex(sql, 'user_id')]
    const active = tokens.filter(t => t.user_id === userId && isActive(t))
    const latest = []
    for (const t of active) {
      const idx = latest.findIndex(l => l.family_id === t.family_id)
      if (idx < 0) latest.push(t)
      else if (t.id > latest[idx].id) latest[idx] = t
    }
    return Promise.resolve([latest, []])
  }

  if (sql.startsWith('SELECT family_id, fingerprint FROM refresh_tokens')) {
    const userIdx = placeholderIndex(sql, 'user_id')
    const familyIdx = placeholderIndex(sql, 'family_id')
    const userId = userIdx >= 0 ? params[userIdx] : null
    const familyId = params[familyIdx]
    // Если в SQL нет user_id = ? — MySQL отдала бы чужую строку. Воспроизводим.
    const row = tokens.find(
      t => t.family_id === familyId && isActive(t) && (userId === null || t.user_id === userId),
    )
    return Promise.resolve([row ? [{ family_id: row.family_id, fingerprint: row.fingerprint }] : [], []])
  }

  if (sql.startsWith('UPDATE refresh_tokens SET revoked = 1')) {
    const userIdx = placeholderIndex(sql, 'user_id')
    const familyIdx = placeholderIndex(sql, 'family_id')
    const userId = userIdx >= 0 ? params[userIdx] : null
    const familyId = params[familyIdx]
    const hit = tokens.filter(
      t => t.family_id === familyId && t.revoked === 0 && (userId === null || t.user_id === userId),
    )
    hit.forEach((t) => { t.revoked = 1 })
    return Promise.resolve([{ affectedRows: hit.length }, []])
  }

  return Promise.resolve([[], []])
}

function createApp() {
  const app = express()
  app.use(express.json())
  app.use(authRoutes)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  tokens = []
  nextId = 1
  pool.query.mockImplementation(fakeQuery)
})

describe('GET /api/auth/sessions', () => {
  it('требует авторизации', async () => {
    const res = await request(createApp()).get('/api/auth/sessions')
    expect(res.status).toBe(401)
  })

  it('возвращает активные сессии с ip и user_agent', async () => {
    seed({ userId: ALICE, familyId: ALICE_DESKTOP, userAgent: CHROME })
    seed({ userId: ALICE, familyId: ALICE_PHONE, userAgent: SAFARI })

    const res = await request(createApp())
      .get('/api/auth/sessions')
      .set('Authorization', `Bearer ${tokenFor(ALICE)}`)

    expect(res.status).toBe(200)
    expect(res.body.count).toBe(2)
    const s = res.body.sessions.find(x => x.familyId === ALICE_DESKTOP)
    expect(s.userAgent).toBe(CHROME)
    expect(s.ipAddress).toBe(REQ_IP)
  })

  it('помечает текущую сессию по fingerprint запроса', async () => {
    seed({ userId: ALICE, familyId: ALICE_DESKTOP, userAgent: CHROME })
    seed({ userId: ALICE, familyId: ALICE_PHONE, userAgent: SAFARI })

    const res = await request(createApp())
      .get('/api/auth/sessions')
      .set('Authorization', `Bearer ${tokenFor(ALICE)}`)
      .set('User-Agent', CHROME)

    expect(res.body.current.familyId).toBe(ALICE_DESKTOP)
    expect(res.body.sessions.find(s => s.familyId === ALICE_DESKTOP).current).toBe(true)
    expect(res.body.sessions.find(s => s.familyId === ALICE_PHONE).current).toBe(false)
  })

  it('current = null, если ни одна сессия не совпала (другое устройство)', async () => {
    seed({ userId: ALICE, familyId: ALICE_DESKTOP, userAgent: CHROME })

    const res = await request(createApp())
      .get('/api/auth/sessions')
      .set('Authorization', `Bearer ${tokenFor(ALICE)}`)
      .set('User-Agent', FIREFOX)

    expect(res.body.sessions.length).toBe(1)
    expect(res.body.current).toBeNull()
  })

  it('не показывает отозванные и просроченные сессии', async () => {
    seed({ userId: ALICE, familyId: ALICE_DESKTOP, userAgent: CHROME })
    seed({ userId: ALICE, familyId: ALICE_PHONE, userAgent: SAFARI, revoked: 1 })
    seed({ userId: ALICE, familyId: ABSENT, userAgent: SAFARI, expired: true })

    const res = await request(createApp())
      .get('/api/auth/sessions')
      .set('Authorization', `Bearer ${tokenFor(ALICE)}`)

    expect(res.body.sessions.map(s => s.familyId)).toEqual([ALICE_DESKTOP])
  })

  it('не показывает сессии других пользователей', async () => {
    seed({ userId: BOB, familyId: BOB_LAPTOP, userAgent: CHROME })
    seed({ userId: ALICE, familyId: ALICE_DESKTOP, userAgent: CHROME })

    const res = await request(createApp())
      .get('/api/auth/sessions')
      .set('Authorization', `Bearer ${tokenFor(ALICE)}`)

    expect(res.body.count).toBe(1)
    expect(res.body.sessions[0].familyId).toBe(ALICE_DESKTOP)
  })

  it('одна строка на семейство, даже если токен ротировался', async () => {
    seed({ userId: ALICE, familyId: ALICE_DESKTOP, userAgent: CHROME })
    seed({ userId: ALICE, familyId: ALICE_DESKTOP, userAgent: CHROME })
    seed({ userId: ALICE, familyId: ALICE_DESKTOP, userAgent: CHROME })

    const res = await request(createApp())
      .get('/api/auth/sessions')
      .set('Authorization', `Bearer ${tokenFor(ALICE)}`)

    expect(res.body.count).toBe(1)
  })
})

describe('DELETE /api/auth/sessions/:familyId', () => {
  it('требует авторизации', async () => {
    const res = await request(createApp()).delete(`/api/auth/sessions/${ALICE_DESKTOP}`)
    expect(res.status).toBe(401)
  })

  it('отклоняет некорректный идентификатор сессии', async () => {
    const res = await request(createApp())
      .delete('/api/auth/sessions/not-a-uuid')
      .set('Authorization', `Bearer ${tokenFor(ALICE)}`)
    expect(res.status).toBe(400)
  })

  it('отзывает ВСЮ семью, а не только указанный токен', async () => {
    seed({ userId: ALICE, familyId: ALICE_PHONE, userAgent: SAFARI })
    seed({ userId: ALICE, familyId: ALICE_PHONE, userAgent: SAFARI })

    const res = await request(createApp())
      .delete(`/api/auth/sessions/${ALICE_PHONE}`)
      .set('Authorization', `Bearer ${tokenFor(ALICE)}`)
      .set('User-Agent', CHROME)

    expect(res.status).toBe(200)
    expect(res.body.affected).toBe(2)
    expect(tokens.filter(t => t.family_id === ALICE_PHONE && t.revoked === 0)).toHaveLength(0)
  })

  it('не трогает соседние семейства', async () => {
    seed({ userId: ALICE, familyId: ALICE_DESKTOP, userAgent: CHROME })
    seed({ userId: ALICE, familyId: ALICE_PHONE, userAgent: SAFARI })

    await request(createApp())
      .delete(`/api/auth/sessions/${ALICE_PHONE}`)
      .set('Authorization', `Bearer ${tokenFor(ALICE)}`)

    expect(tokens.find(t => t.family_id === ALICE_DESKTOP).revoked).toBe(0)
  })

  it('IDOR: чужая сессия не отзывается и отдаёт 404', async () => {
    seed({ userId: BOB, familyId: BOB_LAPTOP, userAgent: CHROME })

    const res = await request(createApp())
      .delete(`/api/auth/sessions/${BOB_LAPTOP}`)
      .set('Authorization', `Bearer ${tokenFor(ALICE)}`)

    expect(res.status).toBe(404)
    expect(tokens.find(t => t.family_id === BOB_LAPTOP).revoked).toBe(0)
  })

  // Ловушка, найденная ломкой: если scope стоит ТОЛЬКО в SELECT, то UPDATE с
  // голым family_id остаётся зелёным на всех тестах выше — SELECT отдаёт 404
  // раньше, чем UPDATE выполнится, и дырявый UPDATE замаскирован. Значит
  // «scope в UPDATE» — это defence in depth, а не основная защита, и проверить
  // его можно только по тексту SQL, который реально уходит в БД.
  it('UPDATE отзывает по (user_id, family_id), а не по одному family_id', async () => {
    seed({ userId: ALICE, familyId: ALICE_PHONE, userAgent: SAFARI })

    await request(createApp())
      .delete(`/api/auth/sessions/${ALICE_PHONE}`)
      .set('Authorization', `Bearer ${tokenFor(ALICE)}`)
      .set('User-Agent', CHROME)

    const update = pool.query.mock.calls
      .map(c => String(c[0]))
      .find(s => s.startsWith('UPDATE refresh_tokens SET revoked = 1'))

    expect(update).toBeTruthy()
    expect(update).toMatch(/WHERE user_id = \? AND family_id = \?/)
    expect(update).toMatch(/revoked = 0/)
  })

  it('404 на несуществующую сессию', async () => {
    const res = await request(createApp())
      .delete(`/api/auth/sessions/${ABSENT}`)
      .set('Authorization', `Bearer ${tokenFor(ALICE)}`)
    expect(res.status).toBe(404)
  })

  it('отзыв своей нетекущей сессии не трогает куки текущей', async () => {
    seed({ userId: ALICE, familyId: ALICE_PHONE, userAgent: SAFARI })

    const res = await request(createApp())
      .delete(`/api/auth/sessions/${ALICE_PHONE}`)
      .set('Authorization', `Bearer ${tokenFor(ALICE)}`)
      .set('User-Agent', CHROME)

    expect(res.status).toBe(200)
    expect(res.body.currentRevoked).toBe(false)
    expect(res.headers['set-cookie']).toBeUndefined()
  })

  it('отзыв текущей сессии чистит куки и сообщает currentRevoked', async () => {
    seed({ userId: ALICE, familyId: ALICE_DESKTOP, userAgent: CHROME })

    const res = await request(createApp())
      .delete(`/api/auth/sessions/${ALICE_DESKTOP}`)
      .set('Authorization', `Bearer ${tokenFor(ALICE)}`)
      .set('User-Agent', CHROME)

    expect(res.status).toBe(200)
    expect(res.body.currentRevoked).toBe(true)
    expect(res.headers['set-cookie']?.join(' ')).toMatch(/sm_token=;/)
  })

  it('список после отзыва не содержит отозванную сессию', async () => {
    seed({ userId: ALICE, familyId: ALICE_DESKTOP, userAgent: CHROME })
    seed({ userId: ALICE, familyId: ALICE_PHONE, userAgent: SAFARI })

    await request(createApp())
      .delete(`/api/auth/sessions/${ALICE_PHONE}`)
      .set('Authorization', `Bearer ${tokenFor(ALICE)}`)

    const res = await request(createApp())
      .get('/api/auth/sessions')
      .set('Authorization', `Bearer ${tokenFor(ALICE)}`)

    expect(res.body.sessions.map(s => s.familyId)).toEqual([ALICE_DESKTOP])
  })
})

describe('createRefreshToken пишет ip_address и user_agent (миграция 052)', () => {
  it('обрезает ip до 45 и user-agent до 500 символов', async () => {
    const { createRefreshToken } = await import('../routes/auth.js')
    const longUa = 'u'.repeat(900)

    await createRefreshToken(ALICE, undefined, 'fp', { ip: '1'.repeat(120), headers: { 'user-agent': longUa } })

    const call = pool.query.mock.calls.find(c => String(c[0]).includes('INSERT INTO refresh_tokens'))
    expect(call).toBeTruthy()
    expect(String(call[0])).toMatch(/ip_address/)
    expect(String(call[0])).toMatch(/user_agent/)
    expect(call[1][4].length).toBeLessThanOrEqual(45)
    expect(call[1][5].length).toBeLessThanOrEqual(500)
  })

  it('null вместо пустых строк, чтобы в БД не писалась пустота', async () => {
    const { createRefreshToken } = await import('../routes/auth.js')
    await createRefreshToken(ALICE, undefined, 'fp', { headers: {} })

    const call = pool.query.mock.calls.find(c => String(c[0]).includes('INSERT INTO refresh_tokens'))
    expect(call[1][4]).toBeNull()
    expect(call[1][5]).toBeNull()
  })

  it('проброс req и в регистрацию, и в логин (единая воронка)', async () => {
    const { createRefreshToken } = await import('../routes/auth.js')
    await createRefreshToken(ALICE, ALICE_DESKTOP, 'fp', { ip: REQ_IP, headers: { 'user-agent': CHROME } })

    const call = pool.query.mock.calls.find(c => String(c[0]).includes('INSERT INTO refresh_tokens'))
    expect(call[1][2]).toBe(ALICE_DESKTOP)
    expect(call[1][4]).toBe(REQ_IP)
    expect(call[1][5]).toBe(CHROME)
  })
})