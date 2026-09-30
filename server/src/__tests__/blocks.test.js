vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.mock('../db.js', () => ({
  default: { query: vi.fn(), getConnection: vi.fn() },
}))

vi.mock('../cache.js', () => ({
  cacheRoutePerUser: vi.fn(() => (_req, _res, next) => next()),
  cacheRoute: vi.fn(() => (_req, _res, next) => next()),
  invalidate: vi.fn(() => Promise.resolve()),
}))

vi.mock('../ws.js', () => ({ getIO: vi.fn(() => null) }))
vi.mock('../banned-words.js', () => ({
  getBannedWords: vi.fn(async () => []),
  containsBannedWord: vi.fn(() => false),
}))
vi.mock('../push.js', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  sendPushToUser: vi.fn(async () => {}),
  sendPushToAll: vi.fn(),
}))
vi.mock('./experiments.js', () => ({ trackEvent: vi.fn(async () => {}) }))
vi.mock('../circuit-breaker.js', () => ({ createBreaker: (fn) => ({ fire: (a) => fn(a) }) }))
vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import pool from '../db.js'
import { cacheRoute, cacheRoutePerUser, invalidate } from '../cache.js'
import profileRoutes from '../routes/profile.js'
import hangoutsRoutes from '../routes/hangouts.js'
import icebreakerRoutes from '../routes/icebreakers.js'
import { notBlocked } from '../user-blocks.js'

const JWT_SECRET = process.env.JWT_SECRET
const VIEWER = 42
const TARGET = 9

function token(userId) {
  return jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })
}

function createApp() {
  const app = express()
  app.use(express.json())
  app.use(profileRoutes)
  app.use(hangoutsRoutes)
  app.use(icebreakerRoutes)
  return app
}

const app = createApp()

function sqlOf(prefix) {
  return pool.query.mock.calls.find((c) => typeof c[0] === 'string' && c[0].includes(prefix))
}

function blockSql() {
  return pool.query.mock.calls.find(
    (c) => typeof c[0] === 'string' && c[0].includes('ub.blocker_id') && c[0].includes('user_profiles up'),
  )
}

beforeEach(() => {
  pool.query.mockReset()
  pool.query.mockResolvedValue([[], []])
})

describe('notBlocked: предикат', () => {
  it('проверяет обе стороны блокировки', () => {
    const { sql } = notBlocked('up', VIEWER)
    expect(sql).toContain('ub.blocker_id = ? AND ub.blocked_id = up.id')
    expect(sql).toContain('ub.blocker_id = up.id AND ub.blocked_id = ?')
  })

  it('зрителя передаёт параметрами, а не литералом в SQL', () => {
    const { sql, params } = notBlocked('up', VIEWER)
    expect(sql).not.toContain(String(VIEWER))
    expect(sql.match(/\?/g)).toHaveLength(2)
    expect(params).toEqual([VIEWER, VIEWER])
  })

  it('алиас берётся из аргумента, а не захардкожен', () => {
    expect(notBlocked('p', 1).sql).toContain('p.id')
  })
})

describe('GET /api/profile/:id — блокировка закрывает прямой просмотр', () => {
  it('в выборку входит предикат по user_blocks', async () => {
    pool.query.mockResolvedValueOnce([[{ id: TARGET, display_name: 'Ann' }], []])

    await request(app).get(`/api/profile/${TARGET}`).set('Authorization', `Bearer ${token(VIEWER)}`)

    const call = sqlOf('FROM user_profiles up')
    expect(call[0]).toContain('user_blocks')
    expect(call[0]).toContain('NOT EXISTS')
  })

  it('параметры: сначала id цели, потом зритель дважды', async () => {
    pool.query.mockResolvedValueOnce([[{ id: TARGET, display_name: 'Ann' }], []])

    await request(app).get(`/api/profile/${TARGET}`).set('Authorization', `Bearer ${token(VIEWER)}`)

    const params = sqlOf('FROM user_profiles up')[1]
    expect(params).toEqual([String(TARGET), VIEWER, VIEWER])
  })

  it('заблокированный пользователь получает 404, а не 403 (не подтверждаем существование)', async () => {
    // Предикат отфильтровал цель — выборка пуста
    pool.query.mockResolvedValueOnce([[], []])

    const res = await request(app).get(`/api/profile/${TARGET}`).set('Authorization', `Bearer ${token(VIEWER)}`)

    expect(res.status).toBe(404)
  })

  it('незаблокированный пользователь по-прежнему виден', async () => {
    pool.query.mockResolvedValueOnce([[{ id: TARGET, display_name: 'Ann' }], []])

    const res = await request(app).get(`/api/profile/${TARGET}`).set('Authorization', `Bearer ${token(VIEWER)}`)

    expect(res.status).toBe(200)
    expect(res.body.display_name).toBe('Ann')
  })

  it('прежний код без предиката провалил бы эти проверки — фиксируем регрессию', async () => {
    pool.query.mockResolvedValueOnce([[{ id: TARGET }], []])

    await request(app).get(`/api/profile/${TARGET}`).set('Authorization', `Bearer ${token(VIEWER)}`)

    expect(sqlOf('FROM user_profiles up')[1]).not.toEqual([String(TARGET)])
  })
})

describe('GET /api/profile/:id — кэш обязан быть per-user', () => {
  it('роут зарегистрирован через cacheRoutePerUser, а не через общий cacheRoute', () => {
    expect(cacheRoutePerUser).toHaveBeenCalled()
    expect(cacheRoute).not.toHaveBeenCalled()
  })

  it('инвалидация после PUT бьёт по ключу нового формата', async () => {
    const actual = await vi.importActual('../cache.js')

    await request(app)
      .put(`/api/profile/${VIEWER}`)
      .set('Authorization', `Bearer ${token(VIEWER)}`)
      .send({ display_name: 'Ann' })

    expect(invalidate).toHaveBeenCalled()
    const pattern = invalidate.mock.calls.at(-1)[0]
    const glob = `swiftmatch:${pattern}`
    // Ключ, который реально кладёт cacheRoutePerUser для этого пользователя
    const realKey = actual.cacheKey('user', `${VIEWER}:/api/profile/${VIEWER}`)
    expect(path.matchesGlob(realKey, glob)).toBe(true)
  })

  it('инвалидация накрывает кэш не только владельца, но и всех зрителей', async () => {
    const actual = await vi.importActual('../cache.js')

    await request(app)
      .put(`/api/profile/${VIEWER}`)
      .set('Authorization', `Bearer ${token(VIEWER)}`)
      .send({ display_name: 'Ann' })

    const glob = `swiftmatch:${invalidate.mock.calls.at(-1)[0]}`
    const другойЗритель = actual.cacheKey('user', `777:/api/profile/${VIEWER}`)
    expect(path.matchesGlob(другойЗритель, glob)).toBe(true)
  })
})

describe('прочие места, отдававшие чужой профиль', () => {
  it('icebreakers: предикат блокировки в выборке партнёра', async () => {
    pool.query.mockResolvedValue([[{ id: 1, display_name: 'Ann' }], []])

    await request(app)
      .post('/api/icebreakers/suggest')
      .set('Authorization', `Bearer ${token(VIEWER)}`)
      .send({ chat_user_id: TARGET })

    const call = blockSql()
    expect(call[0]).toContain('user_blocks')
    expect(call[1]).toEqual([TARGET, VIEWER, VIEWER])
  })

  it('hangouts/suggest: предикат блокировки в выборке партнёра', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 1 }], []]) // подписка → premium
    pool.query.mockResolvedValueOnce([[{ display_name: 'Я' }], []]) // свой профиль
    pool.query.mockResolvedValueOnce([[{ display_name: 'Bob' }], []]) // партнёр

    await request(app)
      .post('/api/hangouts/suggest')
      .set('Authorization', `Bearer ${token(VIEWER)}`)
      .send({ user_id: TARGET })

    const call = blockSql()
    expect(call[0]).toContain('user_blocks')
    expect(call[1]).toEqual([TARGET, VIEWER, VIEWER])
  })

  it('заблокированный партнёр в hangouts/suggest не ломает подбор', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 1 }], []])
    pool.query.mockResolvedValueOnce([[{ display_name: 'Я' }], []])
    pool.query.mockResolvedValueOnce([[], []]) // партнёр отфильтрован
    pool.query.mockResolvedValueOnce([[], []])

    const res = await request(app)
      .post('/api/hangouts/suggest')
      .set('Authorization', `Bearer ${token(VIEWER)}`)
      .send({ user_id: TARGET })

    expect(res.status).toBe(200)
  })

  it('свой профиль в hangouts/suggest тоже отсекается по activeUser', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 1 }], []])
    pool.query.mockResolvedValueOnce([[{ display_name: 'Я' }], []])
    pool.query.mockResolvedValueOnce([[], []])

    await request(app)
      .post('/api/hangouts/suggest')
      .set('Authorization', `Bearer ${token(VIEWER)}`)
      .send({ user_id: TARGET })

    expect(sqlOf('FROM user_profiles up WHERE up.id = ?')[0]).toContain('users su')
  })
})

describe('аудит: где ещё читается чужой профиль', () => {
  const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

  it('фильтр блокировок стоит на всех маршрутах с чужим bio', () => {
    for (const rel of ['routes/profile.js', 'routes/icebreakers.js', 'routes/hangouts.js']) {
      const src = fs.readFileSync(path.join(REPO_ROOT, 'server/src', rel), 'utf8')
      expect(src, rel).toContain("from '../user-blocks.js'")
    }
  })
})