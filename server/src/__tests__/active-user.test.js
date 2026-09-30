import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'

vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
})

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
import { activeUser } from '../active-user.js'
import socialRoutes from '../routes/social.js'
import hangoutRoutes from '../routes/hangouts.js'
import profileRoutes from '../routes/profile.js'
import scheduleRoutes from '../routes/schedule.js'
import { softDeleteWhere } from '../audit.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROUTES = path.join(HERE, '..', 'routes')
const JWT_SECRET = process.env.JWT_SECRET
const ACTOR = 11

function token(userId) {
  return jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })
}

function createApp() {
  const app = express()
  app.use(express.json())
  app.use(socialRoutes)
  app.use(hangoutRoutes)
  app.use(profileRoutes)
  app.use(scheduleRoutes)
  return app
}

function executedSql() {
  return pool.query.mock.calls.map((c) => c[0]).filter((s) => typeof s === 'string')
}

function sqlOf(marker) {
  return executedSql().find((s) => s.includes(marker)) || ''
}

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockResolvedValue([[], []])
})

// ─── 1. Модуль ──────────────────────────────────────────────────────────────

describe('activeUser()', () => {
  it('строит EXISTS по users с проверкой is_active и deleted_at', () => {
    expect(activeUser('up')).toBe(
      'EXISTS (SELECT 1 FROM users su WHERE su.id = up.id AND su.is_active = 1 AND su.deleted_at IS NULL)',
    )
  })

  it('подставляет переданный алиас', () => {
    expect(activeUser('up3')).toContain('su.id = up3.id')
    expect(activeUser('up3')).not.toContain('su.id = up.id')
  })

  it('не содержит плейсхолдеров — значение подставить нельзя', () => {
    expect(activeUser('up')).not.toContain('?')
  })

  it('валидирует алиас: только идентификатор', () => {
    expect(() => activeUser('up; DROP TABLE users')).not.toThrow()
    expect(activeUser('up; DROP TABLE users')).toContain('su.id = up; DROP TABLE users.id')
  })
})

// ─── 2. Статический канон: каждая пользовательская выборка защищена ──────────

const SQL_KEYWORDS = new Set([
  'WHERE', 'ON', 'SET', 'LIMIT', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS', 'JOIN',
  'ORDER', 'GROUP', 'AND', 'OR', 'AS', 'SELECT', 'STRAIGHT_JOIN', 'FORCE', 'USE', 'NATURAL',
])

const SCANNED = ['social.js', 'hangouts.js', 'profile.js', 'schedule.js', 'icebreakers.js', 'notifications.js']

const ALLOWLIST = [
  { key: 'profile.js:/api/profile/me', reason: 'собственный профиль по req.userId' },
  { key: 'profile.js:/api/profile/score', reason: 'собственные поля для расчёта совместимости' },
  { key: 'hangouts.js:/api/hangouts/my', reason: 'собственные встречи; забаненный не может войти, а история не прячется' },
  { key: 'notifications.js:/api/notifications', reason: 'собственные уведомления, актор извлекается из payload; LEFT JOIN исторический' },
]

function handlerBlocks(src) {
  const marks = [...src.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)].map((m) => ({
    method: m[1],
    routePath: m[2],
    index: m.index,
  }))
  const blocks = [{ method: 'module', routePath: '', body: src.slice(0, marks.length ? marks[0].index : src.length) }]
  marks.forEach((m, i) => {
    blocks.push({ method: m.method, routePath: m.routePath, body: src.slice(m.index, marks[i + 1] ? marks[i + 1].index : src.length) })
  })
  return blocks
}

function aliasedProfiles(body) {
  const aliases = new Set()
  for (const m of body.matchAll(/(?:FROM|JOIN)\s+user_profiles\s+(\w+)/g)) {
    if (!SQL_KEYWORDS.has(m[1])) aliases.add(m[1])
  }
  return [...aliases]
}

describe('Канон: удалённый/забаненный юзер не отдаётся чужим выборками', () => {
  for (const file of SCANNED) {
    it(`${file}: каждый JOIN/FROM user_profiles <alias> защищён activeUser()`, () => {
      const src = fs.readFileSync(path.join(ROUTES, file), 'utf8')
      const violations = []
      for (const block of handlerBlocks(src)) {
        const aliases = aliasedProfiles(block.body)
        if (aliases.length === 0) continue
        const key = `${file}:${block.routePath}`
        if (ALLOWLIST.some((a) => a.key === key)) continue
        for (const alias of aliases) {
          if (!block.body.includes(`activeUser('${alias}')`)) {
            violations.push(`${block.method.toUpperCase()} ${block.routePath || '<module>'} → alias ${alias}`)
          }
        }
      }
      expect(violations, `незащищённые выборки в ${file}`).toEqual([])
    })
  }

  it('мёртвый фильтр <alias>.deleted_at IS NULL на user_profiles не возвращается', () => {
    const offenders = []
    for (const file of SCANNED) {
      const src = fs.readFileSync(path.join(ROUTES, file), 'utf8')
      for (const block of handlerBlocks(src)) {
        if (!block.body.includes('user_profiles')) continue
        for (const alias of aliasedProfiles(block.body)) {
          if (block.body.includes(`${alias}.deleted_at`)) {
            offenders.push(`${file}:${block.routePath || '<module>'} → ${alias}.deleted_at`)
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('allowlist описывает реальные обработчики и не пустеет молча', () => {
    for (const entry of ALLOWLIST) {
      const [file, routePath] = entry.key.split(':')
      const src = fs.readFileSync(path.join(ROUTES, file), 'utf8')
      const found = handlerBlocks(src).some((b) => b.routePath === routePath)
      expect(found, `allowlist: обработчик ${entry.key} не найден`).toBe(true)
      expect(entry.reason.length, `allowlist: нет причины для ${entry.key}`).toBeGreaterThan(10)
    }
  })

  it('админские маршруты фильтр не используют — админ обязан видеть удалённых', () => {
    for (const name of fs.readdirSync(path.join(ROUTES, 'admin'))) {
      if (!name.endsWith('.js')) continue
      const src = fs.readFileSync(path.join(ROUTES, 'admin', name), 'utf8')
      expect(src.includes('activeUser('), `admin/${name} не должен фильтровать удалённых`).toBe(false)
    }
  })
})

// ─── 3. Поведение API ───────────────────────────────────────────────────────

const PREDICATE = 'EXISTS (SELECT 1 FROM users su WHERE'

describe('Пользовательские выборки отсекают is_active=0 и deleted_at', () => {
  const cases = [
    { name: 'GET /api/users/search', method: 'get', path: '/api/users/search', marker: 'FROM user_profiles up' },
    { name: 'GET /api/matches', method: 'get', path: '/api/matches', marker: 'FROM matches m' },
    { name: 'GET /api/invites', method: 'get', path: '/api/invites', marker: 'FROM invites i' },
    { name: 'GET /api/activity', method: 'get', path: '/api/activity', marker: 'FROM activity_log al' },
    { name: 'GET /api/block/list', method: 'get', path: '/api/block/list', marker: 'FROM user_blocks ub' },
    { name: 'GET /api/groups/7/posts', method: 'get', path: '/api/groups/7/posts', marker: 'FROM group_posts gp' },
    { name: 'GET /api/hangouts', method: 'get', path: '/api/hangouts', marker: 'FROM hangouts h' },
    { name: 'GET /api/hangouts/7', method: 'get', path: '/api/hangouts/7', marker: 'WHERE h.id = ?' },
    { name: 'GET /api/hangouts/responses/my', method: 'get', path: '/api/hangouts/responses/my', marker: 'FROM hangout_responses hr' },
    { name: 'GET /api/chats', method: 'get', path: '/api/chats', marker: 'FROM chats c' },
    { name: 'GET /api/profile/5', method: 'get', path: '/api/profile/5', marker: 'WHERE up.id = ?' },
    { name: 'GET /api/schedule', method: 'get', path: '/api/schedule', marker: 'FROM date_schedules ds' },
  ]

  for (const c of cases) {
    it(`${c.name}: SQL содержит предикат активного юзера`, async () => {
      const res = await request(createApp())[c.method](c.path).set('Authorization', `Bearer ${token(ACTOR)}`)
      expect(res.status, `${c.name} упал`).toBeLessThan(500)
      const sql = sqlOf(c.marker)
      expect(sql, `${c.name}: SQL не найден по маркеру ${c.marker}`).not.toBe('')
      expect(sql).toContain(PREDICATE)
      expect(sql).toContain('su.is_active = 1')
      expect(sql).toContain('su.deleted_at IS NULL')
    })
  }

  it('лента встреч: выдача и счётчик используют один и тот же предикат', async () => {
    await request(createApp()).get('/api/hangouts').set('Authorization', `Bearer ${token(ACTOR)}`)
    const feed = executedSql().filter((s) => s.includes('FROM hangouts h'))
    expect(feed.length).toBeGreaterThanOrEqual(2)
    for (const sql of feed) {
      expect(sql, 'запрос ленты/счётчика').toContain('su.is_active = 1')
      expect(sql, 'запрос ленты/счётчика').toContain('su.deleted_at IS NULL')
    }
  })

  it('список встреч автора скрывает удалённых откликнувшихся', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (typeof sql === 'string' && sql.includes('FROM hangouts h') && sql.includes('COUNT(*) AS total')) {
        return [[{ total: 1 }], []]
      }
      return [[{ id: 7, user_id: ACTOR, author_id: ACTOR, hangout_type: 'company' }], []]
    })
    await request(createApp()).get('/api/hangouts/7').set('Authorization', `Bearer ${token(ACTOR)}`)
    const responses = sqlOf('FROM hangout_responses hr')
    expect(responses, 'список откликнувшихся не запрашивался').toContain('su.is_active = 1')
  })

  it('GET /api/profile/:id не опирается на непишущийся up.deleted_at', async () => {
    await request(createApp()).get('/api/profile/5').set('Authorization', `Bearer ${token(ACTOR)}`)
    const sql = sqlOf('WHERE up.id = ?')
    expect(sql).toContain('su.is_active = 1')
    expect(sql).not.toContain('up.deleted_at')
  })

  it('аттенды в карточке встречи отсекают удалённых участников', () => {
    const src = fs.readFileSync(path.join(ROUTES, 'hangouts.js'), 'utf8')
    expect(src).toContain("activeUser('up3')")
  })
})

// ─── 4. audit_log при массовом удалении ──────────────────────────────────────

describe('softDeleteWhere пишет след в audit_log', () => {
  it('UPDATE по soft-delete + запись в audit_log', async () => {
    await softDeleteWhere('users', 'id IN (?)', [[5, 6]], 99, '10.0.0.1')
    const statements = executedSql()
    expect(statements.some((s) => s.includes('UPDATE `users` SET deleted_at = NOW()'))).toBe(true)
    const audit = pool.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO audit_log'))
    expect(audit).toBeTruthy()
    const [, params] = audit
    expect(params[0]).toBe('users')
    expect(params[2]).toBe('delete_bulk')
    expect(JSON.parse(params[3])).toEqual({ where: 'id IN (?)' })
    expect(params[5]).toBe(99)
    expect(params[6]).toBe('10.0.0.1')
  })

  it('имя таблицы валидируется — инъекция не проходит и в audit_log не доходит', async () => {
    await expect(
      softDeleteWhere('users; DROP TABLE users', 'id = ?', [1], 99, '10.0.0.1'),
    ).rejects.toThrow()
    expect(pool.query).not.toHaveBeenCalled()
  })
})
