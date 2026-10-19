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

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

const { ioMock, getIOMock } = vi.hoisted(() => {
  const io = {
    to: vi.fn(() => io),
    in: vi.fn(() => io),
    emit: vi.fn(),
    disconnectSockets: vi.fn(),
  }
  return { ioMock: io, getIOMock: vi.fn(() => io) }
})

vi.mock('../ws.js', () => ({ getIO: getIOMock }))

vi.mock('../audit.js', () => ({
  softDelete: vi.fn(async () => {}),
  softDeleteWhere: vi.fn(async () => {}),
  auditLog: vi.fn(async () => {}),
}))

import pool from '../db.js'
import logger from '../logger.js'
import { softDelete, softDeleteWhere, auditLog } from '../audit.js'
import adminUsers from '../routes/admin/users.js'

const JWT_SECRET = process.env.JWT_SECRET

function createApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/admin', (req, _res, next) => {
    req.admin = { id: 42, role: 'admin' }
    next()
  })
  app.use('/api/admin', adminUsers)
  return app
}

const app = createApp()

const makeConn = () => ({
  beginTransaction: vi.fn(async () => {}),
  commit: vi.fn(async () => {}),
  rollback: vi.fn(async () => {}),
  release: vi.fn(),
  query: vi.fn(async () => [{ affectedRows: 1 }]),
})

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockReset()
  getIOMock.mockReturnValue(ioMock)
})

describe('GET /api/admin/users — фильтры и пагинация', () => {
  const mockList = () => {
    pool.query
      .mockResolvedValueOnce([[{ total: 1 }]])
      .mockResolvedValueOnce([[{ id: 1, name: 'A', premium: 'free' }]])
      .mockResolvedValueOnce([[{ cities: '["Moscow"]' }]])
  }

  it('без фильтров → WHERE 1=1, дефолтный sort/limit, города парсятся', async () => {
    mockList()
    const res = await request(app).get('/api/admin/users')
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(1)
    expect(res.body.cities).toEqual(['Moscow'])

    const countSql = String(pool.query.mock.calls[0][0])
    expect(countSql).toContain('WHERE 1=1')
    const listParams = pool.query.mock.calls[1][1]
    expect(listParams).toEqual([15, 0])
  })

  it('search/status/city/premium добавляют условия и параметры', async () => {
    mockList()
    await request(app).get('/api/admin/users?search=ann&status=active&city=Moscow&premium=plus')
    const [, params] = pool.query.mock.calls[0]
    expect(params).toEqual(['%ann%', '%ann%', '%ann%', 1, 'Moscow', 'plus'])
    const countSql = String(pool.query.mock.calls[0][0])
    expect(countSql).toContain('u.email LIKE ?')
    expect(countSql).toContain('u.is_active = ?')
    expect(countSql).toContain('up.city = ?')
  })

  it('status=banned → is_active = 0', async () => {
    mockList()
    await request(app).get('/api/admin/users?status=banned')
    expect(pool.query.mock.calls[0][1]).toEqual([0])
  })

  it('status=all и city=all игнорируются', async () => {
    mockList()
    await request(app).get('/api/admin/users?status=all&city=all&premium=all')
    expect(pool.query.mock.calls[0][1]).toEqual([])
  })

  it('сортировка: age asc → ORDER BY up.age ASC, u.id ASC', async () => {
    mockList()
    await request(app).get('/api/admin/users?sort=age&dir=asc')
    const listSql = String(pool.query.mock.calls[1][0])
    expect(listSql).toContain('ORDER BY up.age ASC, u.id ASC')
  })

  it('неизвестный sort → дефолт u.created_at', async () => {
    mockList()
    await request(app).get('/api/admin/users?sort=evil%3BDROP')
    const listSql = String(pool.query.mock.calls[1][0])
    expect(listSql).toContain('ORDER BY u.created_at DESC')
  })

  it('page=3 → offset 30', async () => {
    pool.query
      .mockResolvedValueOnce([[{ total: 0 }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ cities: null }]])
    const res = await request(app).get('/api/admin/users?page=3')
    expect(res.status).toBe(200)
    expect(res.body.cities).toEqual([])
    expect(pool.query.mock.calls[1][1]).toEqual([15, 30])
  })

  it('падение БД → 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).get('/api/admin/users')
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to fetch users')
  })
})

describe('GET /api/admin/users/duplicates', () => {
  it('группирует по dupKey и вычисляет kind (phone/email), оставляя только группы > 1', async () => {
    pool.query.mockResolvedValueOnce([[
      { dupKey: 'phone:79990001122', id: 1, name: 'A', email: 'a@x', phone: '+79990001122', city: 'Moscow', joined: '2026-01-01', status: 'active', matchesCount: 1, messagesCount: 2, activeSubs: 0 },
      { dupKey: 'phone:79990001122', id: 2, name: 'B', email: 'b@x', phone: '+7 999 000 1122', city: 'SPb', joined: '2026-01-02', status: 'banned', matchesCount: 0, messagesCount: 0, activeSubs: 1 },
      { dupKey: 'email:solo@x', id: 3, name: 'C', email: 'solo@x', phone: null, city: 'Kazan', joined: '2026-01-03', status: 'active', matchesCount: 0, messagesCount: 0, activeSubs: 0 },
    ]])

    const res = await request(app).get('/api/admin/users/duplicates')
    expect(res.status).toBe(200)
    expect(res.body.groups).toHaveLength(1)
    expect(res.body.groups[0].key).toBe('phone:79990001122')
    expect(res.body.groups[0].kind).toBe('phone')
    expect(res.body.groups[0].users.map((u) => u.id)).toEqual([1, 2])
  })

  it('пустой результат → groups пуст', async () => {
    pool.query.mockResolvedValueOnce([[]])
    const res = await request(app).get('/api/admin/users/duplicates')
    expect(res.status).toBe(200)
    expect(res.body.groups).toEqual([])
  })

  it('группа по email → kind = «email»', async () => {
    pool.query.mockResolvedValueOnce([[
      { dupKey: 'email:dup@x', id: 1, name: 'A', email: 'dup@x', phone: null, city: 'M', joined: '2026-01-01', status: 'active', matchesCount: 0, messagesCount: 0, activeSubs: 0 },
      { dupKey: 'email:dup@x', id: 2, name: 'B', email: 'dup@x', phone: null, city: 'S', joined: '2026-01-02', status: 'active', matchesCount: 0, messagesCount: 0, activeSubs: 0 },
    ]])
    const res = await request(app).get('/api/admin/users/duplicates')
    expect(res.status).toBe(200)
    expect(res.body.groups).toHaveLength(1)
    expect(res.body.groups[0].kind).toBe('email')
  })

  it('падение БД → 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).get('/api/admin/users/duplicates')
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to fetch duplicates')
    expect(logger.error).toHaveBeenCalled()
  })
})

describe('GET /api/admin/users/:id', () => {
  it('найден → отдаёт строку пользователя', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 5, name: 'Ann', status: 'active' }]])
    const res = await request(app).get('/api/admin/users/5')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: 5, name: 'Ann', status: 'active' })
    expect(pool.query.mock.calls[0][1]).toEqual(['5'])
  })

  it('не найден → 404', async () => {
    pool.query.mockResolvedValueOnce([[]])
    const res = await request(app).get('/api/admin/users/999')
    expect(res.status).toBe(404)
    expect(res.body.message).toBe('User not found')
  })

  it('падение БД → 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).get('/api/admin/users/5')
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to fetch user')
  })
})

describe('POST /api/admin/users/:id/ban', () => {
  it('банит: is_active=0, пишет moderation_log, шлёт WS user:banned', async () => {
    pool.query.mockResolvedValue([{ affectedRows: 1 }])
    const res = await request(app).post('/api/admin/users/7/ban').send({ reason: 'spam' })
    expect(res.status).toBe(200)
    expect(res.body.message).toBe('User banned')

    const ban = pool.query.mock.calls.find((c) => String(c[0]).includes('UPDATE users SET is_active = 0'))
    expect(ban[1]).toEqual(['7'])
    const log = pool.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO moderation_log'))
    expect(log[1]).toEqual([42, '7', 'ban', 'spam'])

    expect(getIOMock).toHaveBeenCalled()
    expect(ioMock.to).toHaveBeenCalledWith('user:7')
    expect(ioMock.emit).toHaveBeenCalledWith('user:banned', { userId: 7 })
  })

  it('без reason → «No reason»', async () => {
    pool.query.mockResolvedValue([{ affectedRows: 1 }])
    await request(app).post('/api/admin/users/7/ban').send({})
    const log = pool.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO moderation_log'))
    expect(log[1][3]).toBe('No reason')
  })

  it('падение БД → 500', async () => {
    pool.query.mockRejectedValue(new Error('boom'))
    const res = await request(app).post('/api/admin/users/7/ban').send({})
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to ban user')
  })

  it('WS недоступен (getIO null) → всё равно 200, без вызова to', async () => {
    pool.query.mockResolvedValue([{ affectedRows: 1 }])
    getIOMock.mockReturnValueOnce(null)
    const res = await request(app).post('/api/admin/users/7/ban').send({})
    expect(res.status).toBe(200)
    expect(ioMock.to).not.toHaveBeenCalled()
  })

  it('WS бросает при emit → ошибка глотается, ответ всё равно 200', async () => {
    pool.query.mockResolvedValue([{ affectedRows: 1 }])
    ioMock.to.mockImplementationOnce(() => { throw new Error('ws boom') })
    const res = await request(app).post('/api/admin/users/7/ban').send({})
    expect(res.status).toBe(200)
    expect(logger.error).toHaveBeenCalledWith('notifyBanned WS error:', expect.any(Error))
    ioMock.to.mockReset()
    ioMock.to.mockImplementation(() => ioMock)
  })
})

describe('POST /api/admin/users/:id/unban', () => {
  it('разбанивает', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }])
    const res = await request(app).post('/api/admin/users/7/unban')
    expect(res.status).toBe(200)
    expect(res.body.message).toBe('User unbanned')
    expect(pool.query.mock.calls[0][1]).toEqual(['7'])
  })

  it('падение БД → 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).post('/api/admin/users/7/unban')
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to unban user')
  })
})

describe('DELETE /api/admin/users/:id', () => {
  it('soft delete + is_active=0', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }])
    const res = await request(app).delete('/api/admin/users/7')
    expect(res.status).toBe(200)
    expect(res.body.message).toBe('User deleted')
    expect(softDelete).toHaveBeenCalledWith('users', '7', 42, expect.any(String))
    const upd = pool.query.mock.calls.find((c) => String(c[0]).includes('UPDATE users SET is_active = 0'))
    expect(upd[1]).toEqual(['7'])
  })

  it('падение БД → 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).delete('/api/admin/users/7')
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to delete user')
  })
})

describe('POST /api/admin/users/:id/merge', () => {
  it('невалидные id (dup === keep) → 400 без обращения к БД', async () => {
    const res = await request(app).post('/api/admin/users/5/merge').send({ keepId: 5 })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Invalid merge ids')
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('нецелое keepId → 400', async () => {
    const res = await request(app).post('/api/admin/users/5/merge').send({ keepId: 'abc' })
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('дубликат не найден → 404', async () => {
    pool.query.mockResolvedValueOnce([[]])
    const res = await request(app).post('/api/admin/users/5/merge').send({ keepId: 6 })
    expect(res.status).toBe(404)
    expect(res.body.message).toBe('User not found')
  })

  it('дубликат — админ → 400 «Cannot merge an admin account»', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 5, role: 'admin' }]])
    const res = await request(app).post('/api/admin/users/5/merge').send({ keepId: 6 })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Cannot merge an admin account')
  })

  it('целевой (keep) не найден → 404', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 5, role: 'user' }]])
      .mockResolvedValueOnce([[]])
    const res = await request(app).post('/api/admin/users/5/merge').send({ keepId: 6 })
    expect(res.status).toBe(404)
    expect(res.body.message).toBe('User not found')
  })

  it('успех: переносы, чистка пар, вставка профиля, аудит, DELETE, commit, WS user:merged', async () => {
    const conn = makeConn()
    pool.getConnection.mockResolvedValueOnce(conn)
    pool.query
      .mockResolvedValueOnce([[{ id: 5, role: 'user' }]])
      .mockResolvedValueOnce([[{ id: 6, role: 'user' }]])

    const res = await request(app).post('/api/admin/users/5/merge').send({ keepId: 6 })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ message: 'Users merged', mergedFrom: 5, mergedInto: 6 })

    expect(conn.beginTransaction).toHaveBeenCalled()
    expect(conn.commit).toHaveBeenCalled()
    expect(conn.release).toHaveBeenCalled()

    const sqls = conn.query.mock.calls.map((c) => String(c[0]))
    expect(sqls.some((s) => s.includes('UPDATE IGNORE'))).toBe(true)
    expect(sqls.some((s) => s.includes('DELETE FROM'))).toBe(true)
    expect(sqls.some((s) => s.includes('INSERT INTO user_profiles'))).toBe(true)
    expect(sqls.some((s) => s.includes('UPDATE users SET referred_by = NULL'))).toBe(true)
    expect(sqls.some((s) => s.includes('INSERT INTO audit_log'))).toBe(true)
    expect(sqls.some((s) => s === 'DELETE FROM users WHERE id = ?')).toBe(true)

    expect(ioMock.to).toHaveBeenCalledWith('user:5')
    expect(ioMock.emit).toHaveBeenCalledWith('user:merged', { mergedInto: 6 })
  })

  it('WS бросает при notifyMerged → ошибка глотается, ответ 200', async () => {
    const conn = makeConn()
    pool.getConnection.mockResolvedValueOnce(conn)
    pool.query
      .mockResolvedValueOnce([[{ id: 5, role: 'user' }]])
      .mockResolvedValueOnce([[{ id: 6, role: 'user' }]])
    ioMock.to.mockImplementationOnce(() => { throw new Error('ws boom') })

    const res = await request(app).post('/api/admin/users/5/merge').send({ keepId: 6 })
    expect(res.status).toBe(200)
    expect(logger.error).toHaveBeenCalledWith('notifyMerged WS error:', expect.any(Error))
    ioMock.to.mockReset()
    ioMock.to.mockImplementation(() => ioMock)
  })

  it('WS недоступен (getIO null) → merge без вызова to', async () => {
    const conn = makeConn()
    pool.getConnection.mockResolvedValueOnce(conn)
    pool.query
      .mockResolvedValueOnce([[{ id: 5, role: 'user' }]])
      .mockResolvedValueOnce([[{ id: 6, role: 'user' }]])
    getIOMock.mockReturnValueOnce(null)

    const res = await request(app).post('/api/admin/users/5/merge').send({ keepId: 6 })
    expect(res.status).toBe(200)
    expect(ioMock.to).not.toHaveBeenCalled()
  })

  it('req.admin отсутствует → в аудите user_id = null', async () => {
    const bare = express()
    bare.use(express.json())
    bare.use('/api/admin', adminUsers)
    const conn = makeConn()
    pool.getConnection.mockResolvedValueOnce(conn)
    pool.query
      .mockResolvedValueOnce([[{ id: 5, role: 'user' }]])
      .mockResolvedValueOnce([[{ id: 6, role: 'user' }]])
    getIOMock.mockReturnValueOnce(null)

    const res = await request(bare).post('/api/admin/users/5/merge').send({ keepId: 6 })
    expect(res.status).toBe(200)
    const audit = conn.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO audit_log'))
    expect(audit[1][4]).toBeNull()
  })

  it('падение внутри транзакции → rollback, release, 500', async () => {
    const conn = makeConn()
    conn.query.mockImplementation(async (sql) => {
      if (String(sql).includes('INSERT INTO user_profiles')) throw new Error('constraint')
      return [{ affectedRows: 1 }]
    })
    pool.getConnection.mockResolvedValueOnce(conn)
    pool.query
      .mockResolvedValueOnce([[{ id: 5, role: 'user' }]])
      .mockResolvedValueOnce([[{ id: 6, role: 'user' }]])

    const res = await request(app).post('/api/admin/users/5/merge').send({ keepId: 6 })
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to merge users')
    expect(conn.rollback).toHaveBeenCalled()
    expect(conn.commit).not.toHaveBeenCalled()
    expect(conn.release).toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalled()
  })
})

describe('POST /api/admin/users/bulk', () => {
  it('нет ids → 400', async () => {
    const res = await request(app).post('/api/admin/users/bulk').send({ ids: [], action: 'ban' })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('No user IDs provided')
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('не массив ids → 400', async () => {
    const res = await request(app).post('/api/admin/users/bulk').send({ ids: 'x', action: 'ban' })
    expect(res.status).toBe(400)
  })

  it('delete → softDeleteWhere + is_active=0 + WS на каждый id', async () => {
    pool.query.mockResolvedValue([{ affectedRows: 5 }])
    const res = await request(app).post('/api/admin/users/bulk').send({ ids: [1, 2, 3], action: 'delete' })
    expect(res.status).toBe(200)
    expect(res.body.message).toBe('Bulk delete completed')
    expect(softDeleteWhere).toHaveBeenCalledWith('users', 'id IN (?)', [[1, 2, 3]], 42, expect.any(String))
    expect(ioMock.to).toHaveBeenCalledTimes(3)
  })

  it('ban → is_active=0 без soft delete', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 2 }])
    const res = await request(app).post('/api/admin/users/bulk').send({ ids: [1, 2], action: 'ban' })
    expect(res.status).toBe(200)
    expect(res.body.message).toBe('Bulk ban completed')
    expect(softDeleteWhere).not.toHaveBeenCalled()
  })

  it('suspend → is_active=0', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }])
    const res = await request(app).post('/api/admin/users/bulk').send({ ids: [9], action: 'suspend' })
    expect(res.status).toBe(200)
    expect(res.body.message).toBe('Bulk suspend completed')
  })

  it('неизвестное действие → 200 без записи в БД', async () => {
    const res = await request(app).post('/api/admin/users/bulk').send({ ids: [1], action: 'nope' })
    expect(res.status).toBe(200)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('падение БД → 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).post('/api/admin/users/bulk').send({ ids: [1], action: 'ban' })
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to perform bulk action')
  })

  it('req.admin отсутствует → softDeleteWhere с userId null', async () => {
    const bare = express()
    bare.use(express.json())
    bare.use('/api/admin', adminUsers)
    pool.query.mockResolvedValue([{ affectedRows: 1 }])
    const res = await request(bare).post('/api/admin/users/bulk').send({ ids: [1], action: 'delete' })
    expect(res.status).toBe(200)
    expect(softDeleteWhere).toHaveBeenCalledWith('users', 'id IN (?)', [[1]], undefined, expect.any(String))
  })
})

describe('POST /api/admin/impersonate/:userId', () => {
  it('невалидный id → 400 без БД', async () => {
    const res = await request(app).post('/api/admin/impersonate/0')
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Invalid user id')
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('нецелый id → 400', async () => {
    const res = await request(app).post('/api/admin/impersonate/abc')
    expect(res.status).toBe(400)
  })

  it('нет пользователя → 404', async () => {
    pool.query.mockResolvedValueOnce([[]])
    const res = await request(app).post('/api/admin/impersonate/7')
    expect(res.status).toBe(404)
    expect(res.body.message).toBe('User not found')
  })

  it('успех: подписанный токен impersonatedBy, TTL 3600, аудит', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 7, email: 'u@x.com' }]])
    const res = await request(app).post('/api/admin/impersonate/7')
    expect(res.status).toBe(200)
    expect(res.body.expiresIn).toBe(3600)
    expect(res.body.user).toEqual({ id: 7, email: 'u@x.com' })

    const decoded = jwt.verify(res.body.token, JWT_SECRET)
    expect(decoded.userId).toBe(7)
    expect(decoded.role).toBe('user')
    expect(decoded.impersonatedBy).toBe(42)

    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({
      tableName: 'users', recordId: 7, action: 'impersonate', userId: 42,
    }))
  })

  it('падение БД → 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).post('/api/admin/impersonate/7')
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to impersonate')
  })

  it('req.admin отсутствует → impersonatedBy = null', async () => {
    const bare = express()
    bare.use(express.json())
    bare.use('/api/admin', adminUsers)
    pool.query.mockResolvedValueOnce([[{ id: 8, email: 'z@x.com' }]])
    const res = await request(bare).post('/api/admin/impersonate/8')
    expect(res.status).toBe(200)
    const decoded = jwt.verify(res.body.token, JWT_SECRET)
    expect(decoded.impersonatedBy).toBeNull()
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ userId: null }))
  })
})
