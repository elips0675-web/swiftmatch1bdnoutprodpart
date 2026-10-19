vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
  delete process.env.REDIS_URL
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'

vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}))

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import pool from '../db.js'
import logger from '../logger.js'
import profileRoutes from '../routes/profile.js'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'
const app = express()
app.use(express.json())
app.use(profileRoutes)

const as = (userId = 1) => ({
  Authorization: `Bearer ${jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })}`,
})

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockResolvedValue([[], []])
})

describe('GET /api/profile/aliases', () => {
  it('500 при ошибке БД, а не пустой список', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await request(app).get('/api/profile/aliases').set(as())
    expect(res.status).toBe(500)
    expect(res.body.message).toMatch(/aliases/i)
    expect(logger.error).toHaveBeenCalledWith('Aliases GET error:', expect.any(Error))
  })
})

describe('POST /api/profile/aliases: валидация без похода в БД', () => {
  it('пустой псевдоним — 400, запрос в БД не уходит', async () => {
    const res = await request(app).post('/api/profile/aliases').set(as()).send({ alias: '   ' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/2-50/)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('один символ и 51 символ — 400', async () => {
    const short = await request(app).post('/api/profile/aliases').set(as()).send({ alias: 'a' })
    expect(short.status).toBe(400)
    const long = await request(app).post('/api/profile/aliases').set(as()).send({ alias: 'x'.repeat(51) })
    expect(long.status).toBe(400)
  })

  it('угловые скобки и кавычки — 400, инъекция в имя не проходит', async () => {
    const res = await request(app).post('/api/profile/aliases').set(as()).send({ alias: '<script>alert(1)</script>' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/forbidden/i)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('пустое тело запроса — 400, а не падение на деструктуризации', async () => {
    const res = await request(app).post('/api/profile/aliases').set(as()).send()
    expect(res.status).toBe(400)
  })
})

describe('POST /api/profile/aliases: создание', () => {
  it('первый псевдоним становится основным, пробелы обрезаны', async () => {
    pool.query
      .mockResolvedValueOnce([[{ count: 0 }], []])
      .mockResolvedValueOnce([{ insertId: 7 }, []])
    const res = await request(app).post('/api/profile/aliases').set(as()).send({ alias: '  Маша  ' })
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ id: 7, alias: 'Маша', is_primary: true })
    const insert = pool.query.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO user_aliases'))
    expect(insert[1]).toEqual([1, 'Маша', 1])
  })

  it('второй псевдоним создаётся неосновным', async () => {
    pool.query
      .mockResolvedValueOnce([[{ count: 2 }], []])
      .mockResolvedValueOnce([{ insertId: 8 }, []])
    const res = await request(app).post('/api/profile/aliases').set(as()).send({ alias: 'Мария' })
    expect(res.status).toBe(201)
    expect(res.body.is_primary).toBe(false)
    const insert = pool.query.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO user_aliases'))
    expect(insert[1]).toEqual([1, 'Мария', 0])
  })

  it('шестой псевдоним отбивается лимитом 400', async () => {
    pool.query.mockResolvedValueOnce([[{ count: 5 }], []])
    const res = await request(app).post('/api/profile/aliases').set(as()).send({ alias: 'Шестой' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/Maximum 5/)
    expect(pool.query.mock.calls.some((c) => String(c[0]).startsWith('INSERT INTO user_aliases'))).toBe(false)
  })

  it('дубль (ER_DUP_ENTRY) — 409, а не 500', async () => {
    const dup = Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' })
    pool.query.mockResolvedValueOnce([[{ count: 1 }], []]).mockRejectedValueOnce(dup)
    const res = await request(app).post('/api/profile/aliases').set(as()).send({ alias: 'Маша' })
    expect(res.status).toBe(409)
    expect(res.body.message).toMatch(/already exists/i)
  })

  it('прочая ошибка БД — 500 с логом', async () => {
    pool.query.mockResolvedValueOnce([[{ count: 1 }], []]).mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).post('/api/profile/aliases').set(as()).send({ alias: 'Маша' })
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Aliases POST error:', expect.any(Error))
  })
})

describe('PUT /api/profile/aliases/:aliasId/primary', () => {
  it('нечисловой id — 400 без запросов в БД', async () => {
    const res = await request(app).put('/api/profile/aliases/abc/primary').set(as())
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/Invalid alias id/)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('чужой/несуществующий псевдоним — 404', async () => {
    pool.query.mockResolvedValueOnce([[], []]).mockResolvedValueOnce([{ affectedRows: 0 }, []])
    const res = await request(app).put('/api/profile/aliases/999/primary').set(as())
    expect(res.status).toBe(404)
    expect(res.body.message).toMatch(/not found/i)
  })

  it('успех: сначала снимает флаг со всех, потом ставит выбранному', async () => {
    pool.query.mockResolvedValueOnce([[], []]).mockResolvedValueOnce([{ affectedRows: 1 }, []])
    const res = await request(app).put('/api/profile/aliases/12/primary').set(as())
    expect(res.status).toBe(200)
    const reset = pool.query.mock.calls[0]
    expect(reset[0]).toContain('SET is_primary = 0')
    expect(reset[1]).toEqual([1])
    const promote = pool.query.mock.calls[1]
    expect(promote[0]).toContain('SET is_primary = 1')
    expect(promote[1]).toEqual(['12', 1])
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).put('/api/profile/aliases/12/primary').set(as())
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Aliases PUT primary error:', expect.any(Error))
  })
})

describe('DELETE /api/profile/aliases/:aliasId', () => {
  it('нечисловой id — 400 без запросов в БД', async () => {
    const res = await request(app).delete('/api/profile/aliases/abc').set(as())
    expect(res.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('несуществующий псевдоним — 404', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(app).delete('/api/profile/aliases/999').set(as())
    expect(res.status).toBe(404)
  })

  it('неосновной псевдоним удаляется без назначения нового основного', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 9, is_primary: 0 }], []])
    const res = await request(app).delete('/api/profile/aliases/9').set(as())
    expect(res.status).toBe(200)
    expect(pool.query.mock.calls.some((c) => String(c[0]).includes('SET is_primary = 1'))).toBe(false)
    const del = pool.query.mock.calls.find((c) => String(c[0]).startsWith('DELETE FROM user_aliases'))
    expect(del[1]).toEqual(['9'])
  })

  it('основной псевдоним: основной становится самый старый из оставшихся', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 9, is_primary: 1 }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ id: 3 }], []])
      .mockResolvedValueOnce([[], []])
    const res = await request(app).delete('/api/profile/aliases/9').set(as())
    expect(res.status).toBe(200)
    const promote = pool.query.mock.calls.find((c) => String(c[0]).includes('SET is_primary = 1'))
    expect(promote[1]).toEqual([3])
  })

  it('основной псевдоним без оставшихся: повышать некого, лишнего UPDATE нет', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 9, is_primary: 1 }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
    const res = await request(app).delete('/api/profile/aliases/9').set(as())
    expect(res.status).toBe(200)
    expect(pool.query.mock.calls.some((c) => String(c[0]).includes('SET is_primary = 1'))).toBe(false)
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).delete('/api/profile/aliases/9').set(as())
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Aliases DELETE error:', expect.any(Error))
  })
})

describe('GET /api/profile/verification', () => {
  it('отдаёт статус и последние заявки', async () => {
    pool.query
      .mockResolvedValueOnce([[{ photo_verified: 1 }], []])
      .mockResolvedValueOnce([[{ id: 2, photo_url: '/v.jpg', status: 'pending' }], []])
    const res = await request(app).get('/api/profile/verification').set(as())
    expect(res.status).toBe(200)
    expect(res.body.verified).toBe(true)
    expect(res.body.submissions).toHaveLength(1)
  })

  it('нет профиля — verified false, а не падение', async () => {
    pool.query.mockResolvedValueOnce([[], []]).mockResolvedValueOnce([[], []])
    const res = await request(app).get('/api/profile/verification').set(as())
    expect(res.status).toBe(200)
    expect(res.body.verified).toBe(false)
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).get('/api/profile/verification').set(as())
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Verification GET error:', expect.any(Error))
  })
})

describe('POST /api/profile/verification', () => {
  it('без photo_url — 400 без запросов в БД', async () => {
    const res = await request(app).post('/api/profile/verification').set(as()).send({})
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/photo_url/)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('заявка уже на проверке — 409, дубль не создаётся', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 4 }], []])
    const res = await request(app).post('/api/profile/verification').set(as()).send({ photo_url: '/v.jpg' })
    expect(res.status).toBe(409)
    expect(res.body.message).toMatch(/already pending/i)
    expect(pool.query.mock.calls.some((c) => String(c[0]).startsWith('INSERT INTO user_verifications'))).toBe(false)
  })

  it('новая заявка — 201 pending', async () => {
    pool.query.mockResolvedValueOnce([[], []]).mockResolvedValueOnce([{ insertId: 15 }, []])
    const res = await request(app).post('/api/profile/verification').set(as()).send({ photo_url: '/v.jpg' })
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ id: 15, status: 'pending' })
    const insert = pool.query.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO user_verifications'))
    expect(insert[1]).toEqual([1, '/v.jpg'])
  })

  it('ошибка БД — 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).post('/api/profile/verification').set(as()).send({ photo_url: '/v.jpg' })
    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Verification POST error:', expect.any(Error))
  })
})
