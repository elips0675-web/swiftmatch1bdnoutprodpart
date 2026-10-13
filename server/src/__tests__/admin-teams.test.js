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

import pool from '../db.js'
import adminTeams from '../routes/admin/teams.js'

// req.admin.teams — тот же контракт, что кладёт middleware/adminAuth.js (P3 #31):
// пустой список = супер-админ, непустой = модератор со скоупом.
function adminApp(teams) {
  const app = express()
  app.use(express.json())
  app.use('/api/admin', (req, res, next) => { req.admin = { id: 9, role: 'admin', teams }; next() })
  app.use('/api/admin', adminTeams)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/admin/teams: список команд', () => {
  it('отдаёт команды с числом участников', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 1, name: 'Основная', isActive: 1, memberCount: 2 }], []])
    const res = await request(adminApp([])).get('/api/admin/teams')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([{ id: 1, name: 'Основная', isActive: 1, memberCount: 2 }])
  })

  it('500 при сбое БД (не падает)', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(adminApp([])).get('/api/admin/teams')
    expect(res.status).toBe(500)
  })
})

describe('GET /api/admin/teams/:id/members', () => {
  it('нечисловой id → 400 без запроса в БД', async () => {
    const res = await request(adminApp([])).get('/api/admin/teams/abc/members')
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('отдаёт участников команды', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 9, name: 'Mod', email: 'm@b.c' }], []])
    const res = await request(adminApp([])).get('/api/admin/teams/1/members')
    expect(res.status).toBe(200)
    expect(res.body[0].id).toBe(9)
  })
})

describe('мутации команд: только супер-админ (нет своих команд)', () => {
  it('модератор со скоупом получает 403 SUPER_ADMIN_REQUIRED на создание', async () => {
    const res = await request(adminApp([3])).post('/api/admin/teams').send({ name: 'Новая' })
    expect(res.status).toBe(403)
    expect(res.body.message).toBe('SUPER_ADMIN_REQUIRED')
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('модератор со скоупом получает 403 на добавление участника', async () => {
    const res = await request(adminApp([3])).post('/api/admin/teams/1/members').send({ userId: 9 })
    expect(res.status).toBe(403)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('модератор со скоупом получает 403 на переназначение жалобы', async () => {
    const res = await request(adminApp([3])).post('/api/admin/reports/1/assign').send({ teamId: 2 })
    expect(res.status).toBe(403)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('супер-админ создаёт команду → 201', async () => {
    pool.query.mockResolvedValueOnce([{ insertId: 5 }, []])
    const res = await request(adminApp([])).post('/api/admin/teams').send({ name: '  Ночная  ' })
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ id: 5, name: 'Ночная', isActive: true, memberCount: 0 })
    expect(pool.query.mock.calls[0][1]).toEqual(['Ночная'])
  })

  it('пустое имя → 400 (CHECK-диапазон закрыт кодом)', async () => {
    const res = await request(adminApp([])).post('/api/admin/teams').send({ name: '   ' })
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('имя длиннее 120 символов → 400', async () => {
    const res = await request(adminApp([])).post('/api/admin/teams').send({ name: 'x'.repeat(121) })
    expect(res.status).toBe(400)
  })

  it('дубликат имени → 409, а не 500', async () => {
    pool.query.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' }))
    const res = await request(adminApp([])).post('/api/admin/teams').send({ name: 'Основная' })
    expect(res.status).toBe(409)
  })

  it('PATCH переименовывает команду → 200', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1 }], []])
      .mockResolvedValueOnce([[], []])
    const res = await request(adminApp([])).patch('/api/admin/teams/1').send({ name: 'Дневная' })
    expect(res.status).toBe(200)
    const [sql, params] = pool.query.mock.calls[1]
    expect(String(sql)).toMatch(/UPDATE moderation_teams SET name = \? WHERE id = \?/)
    expect(params).toEqual(['Дневная', 1])
  })

  it('PATCH isActive не boolean → 400', async () => {
    const res = await request(adminApp([])).patch('/api/admin/teams/1').send({ isActive: 'yes' })
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('PATCH несуществующей команды → 404', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(adminApp([])).patch('/api/admin/teams/99').send({ name: 'x' })
    expect(res.status).toBe(404)
  })

  it('DELETE несуществующей команды → 404', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(adminApp([])).delete('/api/admin/teams/99')
    expect(res.status).toBe(404)
  })

  it('DELETE существующей команды → 200', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1 }], []])
      .mockResolvedValueOnce([[], []])
    const res = await request(adminApp([])).delete('/api/admin/teams/1')
    expect(res.status).toBe(200)
  })
})

describe('состав команды', () => {
  it('обычного пользователя в команду не берём → 400', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1 }], []])
      .mockResolvedValueOnce([[{ id: 4, role: 'user' }], []])
    const res = await request(adminApp([])).post('/api/admin/teams/1/members').send({ userId: 4 })
    expect(res.status).toBe(400)
    const insert = pool.query.mock.calls.find(([sql]) => /INSERT/.test(String(sql)))
    expect(insert).toBeUndefined()
  })

  it('админа добавляем идемпотентно (INSERT IGNORE) → 200', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1 }], []])
      .mockResolvedValueOnce([[{ id: 9, role: 'admin' }], []])
      .mockResolvedValueOnce([[], []])
    const res = await request(adminApp([])).post('/api/admin/teams/1/members').send({ userId: 9 })
    expect(res.status).toBe(200)
    const insert = pool.query.mock.calls.find(([sql]) => /INSERT IGNORE INTO moderation_team_members/.test(String(sql)))
    expect(insert[1]).toEqual([1, 9])
  })

  it('несуществующая команда при добавлении → 404', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(adminApp([])).post('/api/admin/teams/1/members').send({ userId: 9 })
    expect(res.status).toBe(404)
  })

  it('удаление участника → 200', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(adminApp([])).delete('/api/admin/teams/1/members/9')
    expect(res.status).toBe(200)
    expect(pool.query.mock.calls[0][1]).toEqual([1, 9])
  })

  it('скоуп-модератор чужого участника убрать не может → 403', async () => {
    const res = await request(adminApp([3])).delete('/api/admin/teams/3/members/5')
    expect(res.status).toBe(403)
    expect(res.body.message).toBe('SUPER_ADMIN_REQUIRED')
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('скоуп-модератор может убрать СЕБЯ (иначе был бы заперт) → 200', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(adminApp([3])).delete('/api/admin/teams/3/members/9')
    expect(res.status).toBe(200)
    expect(pool.query.mock.calls[0][1]).toEqual([3, 9])
  })
})

describe('POST /api/admin/reports/:id/assign', () => {
  it('переназначает жалобу на команду → 200', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1 }], []])
      .mockResolvedValueOnce([[{ id: 2 }], []])
      .mockResolvedValueOnce([[], []])
    const res = await request(adminApp([])).post('/api/admin/reports/1/assign').send({ teamId: 2 })
    expect(res.status).toBe(200)
    const update = pool.query.mock.calls.find(([sql]) => /UPDATE reports SET team_id/.test(String(sql)))
    expect(update[1]).toEqual([2, 1])
  })

  it('teamId = null снимает привязку → 200', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1 }], []])
      .mockResolvedValueOnce([[], []])
    const res = await request(adminApp([])).post('/api/admin/reports/1/assign').send({ teamId: null })
    expect(res.status).toBe(200)
    const update = pool.query.mock.calls.find(([sql]) => /UPDATE reports SET team_id/.test(String(sql)))
    expect(update[1]).toEqual([null, 1])
  })

  it('несуществующая команда → 404, UPDATE не выполняется', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1 }], []])
      .mockResolvedValueOnce([[], []])
    const res = await request(adminApp([])).post('/api/admin/reports/1/assign').send({ teamId: 77 })
    expect(res.status).toBe(404)
    const update = pool.query.mock.calls.find(([sql]) => /UPDATE reports SET team_id/.test(String(sql)))
    expect(update).toBeUndefined()
  })

  it('несуществующая жалоба → 404', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(adminApp([])).post('/api/admin/reports/999/assign').send({ teamId: 1 })
    expect(res.status).toBe(404)
  })
})
