vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'

vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
    execute: vi.fn(),
    getConnection: vi.fn(),
  },
}))

import pool from '../db.js'
import { FieldError } from '../profile-fields.js'
import checkinRoutes from '../routes/date-checkin.js'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

function createApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/checkin', checkinRoutes)
  return app
}

function authToken(userId = 1) {
  return jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/checkin/contacts', () => {
  it('creates a contact with trimmed fields', async () => {
    pool.execute.mockResolvedValueOnce([{ insertId: 4 }, []])
    const res = await request(createApp())
      .post('/api/checkin/contacts')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ name: '  Мама  ', phone: '+79161234567', email: 'a@b.c', relation: 'Мать' })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe(4)
    const [sql, params] = pool.execute.mock.calls[0]
    expect(sql).toContain('INSERT INTO emergency_contacts')
    expect(params).toEqual([1, 'Мама', '+79161234567', 'a@b.c', 'Мать'])
  })

  it('truncates overlong fields to column sizes instead of 500', async () => {
    pool.execute.mockResolvedValueOnce([{ insertId: 5 }, []])
    const res = await request(createApp())
      .post('/api/checkin/contacts')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ name: 'n'.repeat(300), phone: '1'.repeat(50), email: 'e'.repeat(260), relation: 'r'.repeat(150) })
    expect(res.status).toBe(201)
    const params = pool.execute.mock.calls[0][1]
    expect(params[1]).toHaveLength(255)
    expect(params[2]).toHaveLength(20)
    expect(params[3]).toHaveLength(255)
    expect(params[4]).toHaveLength(100)
  })

  it('rejects a too-short name without touching the DB', async () => {
    const res = await request(createApp())
      .post('/api/checkin/contacts')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ name: 'a' })
    expect(res.status).toBe(400)
    expect(pool.execute).not.toHaveBeenCalled()
  })

  it('rejects a missing name without touching the DB', async () => {
    const res = await request(createApp())
      .post('/api/checkin/contacts')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ phone: '+7' })
    expect(res.status).toBe(400)
    expect(pool.execute).not.toHaveBeenCalled()
  })

  it('empty optional fields are stored as null', async () => {
    pool.execute.mockResolvedValueOnce([{ insertId: 6 }, []])
    const res = await request(createApp())
      .post('/api/checkin/contacts')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ name: 'Друг', phone: '', email: '', relation: '' })
    expect(res.status).toBe(201)
    const params = pool.execute.mock.calls[0][1]
    expect(params).toEqual([1, 'Друг', null, null, null])
  })

  it('FieldError из слоя записи превращается в 400, а не 500', async () => {
    pool.execute.mockRejectedValueOnce(new FieldError('name', 'too long'))
    const res = await request(createApp())
      .post('/api/checkin/contacts')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ name: 'Валидное' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('too long')
  })

  it('падение БД даёт 500', async () => {
    pool.execute.mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp())
      .post('/api/checkin/contacts')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ name: 'Друг' })
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Failed to create contact')
  })

  it('без токена не доходит до БД', async () => {
    const res = await request(createApp()).post('/api/checkin/contacts').send({ name: 'Друг' })
    expect(res.status).toBe(401)
    expect(pool.execute).not.toHaveBeenCalled()
  })
})

describe('GET /api/checkin/contacts', () => {
  it('возвращает список контактов пользователя', async () => {
    const rows = [{ id: 1, name: 'Мама', phone: '+7', email: null, relation: 'Мать' }]
    pool.execute.mockResolvedValueOnce([rows])
    const res = await request(createApp())
      .get('/api/checkin/contacts')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual(rows)
    expect(pool.execute.mock.calls[0][1]).toEqual([1])
  })

  it('пустой результат отдаёт пустой массив, а не 500', async () => {
    pool.execute.mockResolvedValueOnce([null])
    const res = await request(createApp())
      .get('/api/checkin/contacts')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('падение БД даёт 500', async () => {
    pool.execute.mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp())
      .get('/api/checkin/contacts')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Failed to load contacts')
  })
})

describe('DELETE /api/checkin/contacts/:id', () => {
  it('удаляет контакт пользователя', async () => {
    pool.execute.mockResolvedValueOnce([{ affectedRows: 1 }])
    const res = await request(createApp())
      .delete('/api/checkin/contacts/5')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    expect(pool.execute.mock.calls[0][1]).toEqual(['5', 1])
  })

  it('чужой или несуществующий контакт даёт 404', async () => {
    pool.execute.mockResolvedValueOnce([{ affectedRows: 0 }])
    const res = await request(createApp())
      .delete('/api/checkin/contacts/999')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(404)
  })

  it('падение БД даёт 500', async () => {
    pool.execute.mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp())
      .delete('/api/checkin/contacts/5')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Failed to delete contact')
  })
})

describe('POST /api/checkin/start', () => {
  it('планирует проверку с дефолтными 60 минутами и location_sharing=0', async () => {
    pool.execute.mockResolvedValueOnce([{ insertId: 9 }, []])
    const res = await request(createApp())
      .post('/api/checkin/start')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({})
    expect(res.status).toBe(201)
    expect(res.body.id).toBe(9)
    expect(typeof res.body.checkin_at).toBe('string')
    const params = pool.execute.mock.calls[0][1]
    expect(params[0]).toBe(1)
    expect(params[1]).toBeNull()
    expect(params[2]).toBeNull()
    expect(params[4]).toBeNull()
    expect(params[5]).toBe(0)
  })

  it('location_sharing=1 и явные schedule/contact записываются', async () => {
    pool.execute.mockResolvedValueOnce([{ insertId: 10 }, []])
    const res = await request(createApp())
      .post('/api/checkin/start')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ schedule_id: 3, contact_id: 4, checkin_minutes: 120, message: 'буду поздно', location_sharing: true })
    expect(res.status).toBe(201)
    const params = pool.execute.mock.calls[0][1]
    expect(params[1]).toBe(3)
    expect(params[2]).toBe(4)
    expect(params[4]).toBe('буду поздно')
    expect(params[5]).toBe(1)
  })

  it('слишком короткое окно (14) отбито 400 без БД', async () => {
    const res = await request(createApp())
      .post('/api/checkin/start')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ checkin_minutes: 14 })
    expect(res.status).toBe(400)
    expect(pool.execute).not.toHaveBeenCalled()
  })

  it('слишком длинное окно (481) отбито 400 без БД', async () => {
    const res = await request(createApp())
      .post('/api/checkin/start')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ checkin_minutes: 481 })
    expect(res.status).toBe(400)
    expect(pool.execute).not.toHaveBeenCalled()
  })

  it('мусорное checkin_minutes падает в дефолт 60', async () => {
    pool.execute.mockResolvedValueOnce([{ insertId: 11 }, []])
    const res = await request(createApp())
      .post('/api/checkin/start')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ checkin_minutes: 'abc' })
    expect(res.status).toBe(201)
    const checkinAt = new Date(pool.execute.mock.calls[0][1][3]).getTime()
    const minutes = Math.round((checkinAt - Date.now()) / 60000)
    expect(minutes).toBeGreaterThanOrEqual(59)
    expect(minutes).toBeLessThanOrEqual(61)
  })

  it('падение БД даёт 500', async () => {
    pool.execute.mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp())
      .post('/api/checkin/start')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ checkin_minutes: 60 })
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Failed to start check-in')
  })
})

describe('POST /api/checkin/:id/checkin', () => {
  it('подтверждает активную проверку', async () => {
    pool.execute
      .mockResolvedValueOnce([[{ id: 7, status: 'active' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
    const res = await request(createApp())
      .post('/api/checkin/7/checkin')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true, status: 'checked_in' })
    expect(pool.execute).toHaveBeenCalledTimes(2)
  })

  it('несуществующая проверка даёт 404', async () => {
    pool.execute.mockResolvedValueOnce([[]])
    const res = await request(createApp())
      .post('/api/checkin/7/checkin')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(404)
    expect(pool.execute).toHaveBeenCalledTimes(1)
  })

  it('неактивная проверка (не active) даёт 400 без UPDATE', async () => {
    pool.execute.mockResolvedValueOnce([[{ id: 7, status: 'cancelled' }]])
    const res = await request(createApp())
      .post('/api/checkin/7/checkin')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Check-in is not active')
    expect(pool.execute).toHaveBeenCalledTimes(1)
  })

  it('падение БД даёт 500', async () => {
    pool.execute.mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp())
      .post('/api/checkin/7/checkin')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Failed to confirm check-in')
  })
})

describe('POST /api/checkin/:id/cancel', () => {
  it('отменяет активную проверку', async () => {
    pool.execute.mockResolvedValueOnce([{ affectedRows: 1 }])
    const res = await request(createApp())
      .post('/api/checkin/7/cancel')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
  })

  it('нет активной проверки — 404', async () => {
    pool.execute.mockResolvedValueOnce([{ affectedRows: 0 }])
    const res = await request(createApp())
      .post('/api/checkin/7/cancel')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(404)
  })

  it('падение БД даёт 500', async () => {
    pool.execute.mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp())
      .post('/api/checkin/7/cancel')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Failed to cancel check-in')
  })
})

describe('GET /api/checkin/active', () => {
  it('возвращает активные и пропущенные проверки', async () => {
    const rows = [{ id: 1, status: 'active', contact_name: 'Мама' }]
    pool.execute.mockResolvedValueOnce([rows])
    const res = await request(createApp())
      .get('/api/checkin/active')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual(rows)
    expect(pool.execute.mock.calls[0][1]).toEqual([1])
  })

  it('пустой результат отдаёт пустой массив', async () => {
    pool.execute.mockResolvedValueOnce([null])
    const res = await request(createApp())
      .get('/api/checkin/active')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('падение БД даёт 500', async () => {
    pool.execute.mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp())
      .get('/api/checkin/active')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Failed to load check-ins')
  })
})