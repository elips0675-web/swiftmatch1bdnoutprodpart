vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'

vi.mock('../db.js', () => ({
  default: { query: vi.fn(), getConnection: vi.fn() },
}))

vi.mock('../ws.js', () => ({
  getIO: vi.fn(() => ({ to: vi.fn(() => ({ emit: vi.fn() })) })),
}))

vi.mock('../banned-words.js', () => ({
  getBannedWords: vi.fn(async () => []),
  containsBannedWord: vi.fn(() => false),
}))

vi.mock('../routes/push.js', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  sendPushToUser: vi.fn(async () => {}),
  sendPushToAll: vi.fn(),
}))

vi.mock('../routes/experiments.js', () => ({
  trackEvent: vi.fn(async () => {}),
}))

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import pool from '../db.js'
import hangoutsRoutes from '../routes/hangouts.js'
import adminHangouts from '../routes/admin/hangouts.js'
import profileRoutes from '../routes/profile.js'

const JWT_SECRET = 'test-secret'

function token(userId = 1, role = 'user') {
  return jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: '1h' })
}

function createUserApp() {
  const app = express()
  app.use(express.json())
  app.use(hangoutsRoutes)
  app.use(profileRoutes)
  return app
}

function createAdminApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/admin', (req, res, next) => {
    req.admin = { id: 1, userId: 1, role: 'admin' }
    Object.defineProperty(req, 'ip', { value: '127.0.0.1', configurable: true })
    next()
  })
  app.use('/api/admin', adminHangouts)
  return app
}

function mockTransaction() {
  const conn = {
    query: vi.fn().mockResolvedValue([{}]),
    beginTransaction: vi.fn().mockResolvedValue({}),
    commit: vi.fn().mockResolvedValue({}),
    rollback: vi.fn().mockResolvedValue({}),
    release: vi.fn().mockResolvedValue({}),
  }
  pool.getConnection.mockResolvedValue(conn)
  return conn
}

const sqlCalls = () => pool.query.mock.calls.map((c) => String(c[0]))

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockReset()
  pool.getConnection.mockReset()
})

// ─── Tombstone: объединённая встреча не выходит из ленты/my ──────────────────

describe('merged tombstone скрыт', () => {
  it('лента добавляет h.merged_into IS NULL и в выдачу, и в счётчик', async () => {
    pool.query.mockResolvedValueOnce([[], []]).mockResolvedValueOnce([[{ total: 0 }], []])
    await request(createUserApp()).get('/api/hangouts')
    const feed = sqlCalls().filter((s) => s.includes('FROM hangouts h'))
    expect(feed.length).toBeGreaterThanOrEqual(2)
    for (const sql of feed) expect(sql).toContain('h.merged_into IS NULL')
  })

  it('/api/hangouts/my скрывает объединённые', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(createUserApp()).get('/api/hangouts/my').set('Authorization', `Bearer ${token(1)}`)
    expect(res.status).toBe(200)
    const sql = sqlCalls().find((s) => s.includes('h.user_id = ?'))
    expect(sql).toContain('h.merged_into IS NULL')
  })
})

// ─── Деталь: watcher_count / is_watching ─────────────────────────────────────

describe('GET /api/hangouts/:id (watchers)', () => {
  it('отдаёт watcher_count и is_watching как boolean', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (String(sql).includes('hangout_watchers hw2')) {
        return [[{ id: 7, user_id: 1, author_id: 1, hangout_type: 'single', watcher_count: 4, is_watching: 1 }], []]
      }
      return [[], []]
    })
    const res = await request(createUserApp()).get('/api/hangouts/7').set('Authorization', `Bearer ${token(1)}`)
    expect(res.status).toBe(200)
    expect(res.body.watcher_count).toBe(4)
    expect(res.body.is_watching).toBe(true)
    const detail = sqlCalls().find((s) => s.includes('hangout_watchers hw2'))
    expect(detail).toContain('h.merged_into IS NULL')
  })

  it('несуществующая/объединённая встреча → 404', async () => {
    pool.query.mockResolvedValue([[], []])
    const res = await request(createUserApp()).get('/api/hangouts/7')
    expect(res.status).toBe(404)
  })
})

// ─── Watch / unwatch ─────────────────────────────────────────────────────────

describe('POST/DELETE /api/hangouts/:id/watch', () => {
  it('нецелый id → 400 без запросов', async () => {
    const res = await request(createUserApp())
      .post('/api/hangouts/abc/watch')
      .set('Authorization', `Bearer ${token(1)}`)
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('встреча не найдена → 404', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(createUserApp())
      .post('/api/hangouts/7/watch')
      .set('Authorization', `Bearer ${token(1)}`)
    expect(res.status).toBe(404)
  })

  it('подписка: INSERT IGNORE и актуальный watcher_count', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 7 }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[{ watcher_count: 3 }], []])
    const res = await request(createUserApp())
      .post('/api/hangouts/7/watch')
      .set('Authorization', `Bearer ${token(1)}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ watching: true, watcher_count: 3 })
    expect(sqlCalls().some((s) => s.includes('INSERT IGNORE INTO hangout_watchers'))).toBe(true)
  })

  it('отписка возвращает watching:false', async () => {
    pool.query
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[{ watcher_count: 2 }], []])
    const res = await request(createUserApp())
      .delete('/api/hangouts/7/watch')
      .set('Authorization', `Bearer ${token(1)}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ watching: false, watcher_count: 2 })
  })
})

// ─── Relations ───────────────────────────────────────────────────────────────

describe('GET /api/hangouts/:id/related', () => {
  it('нецелый id → 400', async () => {
    const res = await request(createUserApp()).get('/api/hangouts/abc/related')
    expect(res.status).toBe(400)
  })

  it('встреча не найдена → 404', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(createUserApp()).get('/api/hangouts/7/related')
    expect(res.status).toBe(404)
  })

  it('отдаёт sameSeries и similar, оба с тайбрейкером h.id', async () => {
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql)
      if (s.includes('SELECT id, category, city, series_id FROM hangouts')) {
        return [[{ id: 7, category: 'cinema', city: 'Москва', series_id: 5 }], []]
      }
      if (s.includes('h.series_id = ?')) return [[{ id: 8, title: 'Part 2' }], []]
      if (s.includes('h.category = ?')) return [[{ id: 9, title: 'Similar' }], []]
      return [[], []]
    })
    const res = await request(createUserApp()).get('/api/hangouts/7/related')
    expect(res.status).toBe(200)
    expect(res.body.sameSeries).toHaveLength(1)
    expect(res.body.similar).toHaveLength(1)

    const seriesSql = sqlCalls().find((s) => s.includes('h.series_id = ?'))
    const similarSql = sqlCalls().find((s) => s.includes('h.category = ?'))
    expect(seriesSql).toContain('ORDER BY h.event_date ASC, h.id ASC')
    expect(similarSql).toContain('ORDER BY h.event_date ASC, h.id ASC')
    expect(similarSql).toContain('h.merged_into IS NULL')
    expect(similarSql).toContain('su.is_active = 1')
    expect(similarSql).toContain('NOT EXISTS (')
  })

  it('без серии sameSeries пустой, but similar всё равно ищется', async () => {
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql)
      if (s.includes('SELECT id, category, city, series_id FROM hangouts')) {
        return [[{ id: 7, category: 'cinema', city: null, series_id: null }], []]
      }
      if (s.includes('h.category = ?')) return [[{ id: 9 }], []]
      return [[], []]
    })
    const res = await request(createUserApp()).get('/api/hangouts/7/related')
    expect(res.status).toBe(200)
    expect(res.body.sameSeries).toEqual([])
    expect(res.body.similar).toHaveLength(1)
    expect(sqlCalls().some((s) => s.includes('h.series_id = ?'))).toBe(false)
  })
})

// ─── Series ──────────────────────────────────────────────────────────────────

describe('POST /api/hangouts/series', () => {
  it('без title → 400 без запроса', async () => {
    const res = await request(createUserApp())
      .post('/api/hangouts/series')
      .set('Authorization', `Bearer ${token(1)}`)
      .send({})
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('создаёт серию с обрезанным title', async () => {
    pool.query.mockResolvedValueOnce([{ insertId: 5 }, []])
    const res = await request(createUserApp())
      .post('/api/hangouts/series')
      .set('Authorization', `Bearer ${token(1)}`)
      .send({ title: '  Летние прогулки  ' })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe(5)
    expect(res.body.title).toBe('Летние прогулки')
    const params = pool.query.mock.calls[0][1]
    expect(params[0]).toBe('Летние прогулки')
    expect(params[2]).toBe(1)
  })
})

describe('GET /api/hangouts/series', () => {
  it('отдаёт свои серии со счётчиком встреч и без чужих', async () => {
    pool.query.mockResolvedValueOnce([[
      { id: 5, title: 'Летние прогулки', description: null, created_at: '2026-10-01', hangout_count: 3 },
    ], []])
    const res = await request(createUserApp())
      .get('/api/hangouts/series')
      .set('Authorization', `Bearer ${token(1)}`)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].hangout_count).toBe(3)
    const sql = String(pool.query.mock.calls[0][0])
    expect(sql).toContain('FROM hangout_series')
    expect(sql).toContain('created_by = ?')
    expect(sql).toContain('merged_into IS NULL')
    expect(pool.query.mock.calls[0][1]).toEqual([1])
  })
})

describe('PUT /api/hangouts/:id/series', () => {
  const put = (id, body, userId = 1) =>
    request(createUserApp())
      .put(`/api/hangouts/${id}/series`)
      .set('Authorization', `Bearer ${token(userId)}`)
      .send(body)

  it('нецелый id → 400', async () => {
    const res = await put('abc', { series_id: 5 })
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('нечисловой series_id → 400 без запроса', async () => {
    const res = await put(7, { series_id: 'abc' })
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('не автор → 403', async () => {
    pool.query.mockResolvedValueOnce([[{ user_id: 2, merged_into: null }], []])
    const res = await put(7, { series_id: 5 })
    expect(res.status).toBe(403)
  })

  it('чужая/несуществующая серия → 404', async () => {
    pool.query
      .mockResolvedValueOnce([[{ user_id: 1, merged_into: null }], []])
      .mockResolvedValueOnce([[], []])
    const res = await put(7, { series_id: 5 })
    expect(res.status).toBe(404)
  })

  it('успешно привязывает серию', async () => {
    pool.query
      .mockResolvedValueOnce([[{ user_id: 1, merged_into: null }], []])
      .mockResolvedValueOnce([[{ id: 5 }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
    const res = await put(7, { series_id: 5 })
    expect(res.status).toBe(200)
    expect(res.body.series_id).toBe(5)
    const upd = pool.query.mock.calls.find((c) => String(c[0]).startsWith('UPDATE hangouts SET series_id'))
    expect(upd[1]).toEqual([5, '7'])
  })

  it('null отвязывает серию без проверки владельца серии', async () => {
    pool.query
      .mockResolvedValueOnce([[{ user_id: 1, merged_into: null }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
    const res = await put(7, { series_id: null })
    expect(res.status).toBe(200)
    expect(res.body.series_id).toBeNull()
  })
})

// ─── Admin merge ─────────────────────────────────────────────────────────────

describe('POST /api/admin/hangouts/:id/merge', () => {
  const merge = (id, body) => request(createAdminApp()).post(`/api/admin/hangouts/${id}/merge`).send(body)

  it('нецелые/равные id → 400 без БД', async () => {
    expect((await merge('abc', { mergeIntoId: 1 })).status).toBe(400)
    expect((await merge(2, { mergeIntoId: 2 })).status).toBe(400)
    expect((await merge(2, { mergeIntoId: 0 })).status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('встреча не найдена → 404', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await merge(2, { mergeIntoId: 1 })
    expect(res.status).toBe(404)
    expect(pool.getConnection).not.toHaveBeenCalled()
  })

  it('уже объединённая (виктима) → 409', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 2, merged_into: 1 }, { id: 1, merged_into: null }], []])
    const res = await merge(2, { mergeIntoId: 1 })
    expect(res.status).toBe(409)
    expect(pool.getConnection).not.toHaveBeenCalled()
  })

  it('survivor уже tombstone → 409', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 2, merged_into: null }, { id: 1, merged_into: 3 }], []])
    const res = await merge(2, { mergeIntoId: 1 })
    expect(res.status).toBe(409)
  })

  it('успех: перенос дочерних, audit=merge, tombstone', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 2, merged_into: null }, { id: 1, merged_into: null }], []])
    const conn = mockTransaction()
    const res = await merge(2, { mergeIntoId: 1 })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ message: 'Hangouts merged', mergedFrom: 2, mergedInto: 1 })

    const calls = conn.query.mock.calls
    const q = calls.map((c) => String(c[0]))
    expect(q).toContain('UPDATE IGNORE `hangout_responses` SET hangout_id = ? WHERE hangout_id = ?')
    expect(q).toContain('UPDATE IGNORE `hangout_watchers` SET hangout_id = ? WHERE hangout_id = ?')
    expect(q).toContain('DELETE FROM `hangout_chats` WHERE hangout_id = ?')
    expect(q).toContain('UPDATE IGNORE `hangout_chats` SET hangout_id = ? WHERE hangout_id = ?')

    const audit = calls.find((c) => String(c[0]).startsWith('INSERT INTO audit_log'))
    expect(audit).toBeDefined()
    expect(audit[1][0]).toBe('hangouts')
    expect(audit[1][1]).toBe(2)
    expect(audit[1][2]).toBe('merge')

    const tomb = calls.find((c) => String(c[0]).startsWith('UPDATE hangouts SET status'))
    expect(tomb[1]).toEqual([1, 2])

    expect(conn.beginTransaction).toHaveBeenCalledTimes(1)
    expect(conn.commit).toHaveBeenCalledTimes(1)
    expect(conn.rollback).not.toHaveBeenCalled()
    expect(conn.release).toHaveBeenCalledTimes(1)
  })

  it('ошибка в транзакции → 500 и rollback', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 2, merged_into: null }, { id: 1, merged_into: null }], []])
    const conn = mockTransaction()
    conn.query.mockRejectedValue(new Error('db down'))
    const res = await merge(2, { mergeIntoId: 1 })
    expect(res.status).toBe(500)
    expect(conn.rollback).toHaveBeenCalledTimes(1)
    expect(conn.commit).not.toHaveBeenCalled()
    expect(conn.release).toHaveBeenCalledTimes(1)
  })
})

// ─── Подписка на пользователя (user_watches) ─────────────────────────────────

describe('Подписка на пользователя (/api/users/:id/watch)', () => {
  it('на себя → 400 без запроса', async () => {
    const res = await request(createUserApp())
      .post('/api/users/1/watch')
      .set('Authorization', `Bearer ${token(1)}`)
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('нецелый id → 400 без запроса', async () => {
    const res = await request(createUserApp())
      .post('/api/users/abc/watch')
      .set('Authorization', `Bearer ${token(1)}`)
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('несуществующий/неактивный юзер → 404', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(createUserApp())
      .post('/api/users/2/watch')
      .set('Authorization', `Bearer ${token(1)}`)
    expect(res.status).toBe(404)
  })

  it('подписка → watching:true', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 2 }], []]).mockResolvedValueOnce([{ affectedRows: 1 }, []])
    const res = await request(createUserApp())
      .post('/api/users/2/watch')
      .set('Authorization', `Bearer ${token(1)}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ watching: true })
    expect(sqlCalls().some((s) => s.includes('INSERT IGNORE INTO user_watches'))).toBe(true)
  })

  it('отписка → watching:false', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }, []])
    const res = await request(createUserApp())
      .delete('/api/users/2/watch')
      .set('Authorization', `Bearer ${token(1)}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ watching: false })
  })

  it('GET /api/users/watching фильтрует удалённых и заблокированных', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 2, display_name: 'Bob' }], []])
    const res = await request(createUserApp())
      .get('/api/users/watching')
      .set('Authorization', `Bearer ${token(1)}`)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    const [sql, params] = pool.query.mock.calls[0]
    expect(String(sql)).toContain('su.is_active = 1')
    expect(String(sql)).toContain('NOT EXISTS (')
    expect(params).toEqual([1, 1, 1])
  })
})
