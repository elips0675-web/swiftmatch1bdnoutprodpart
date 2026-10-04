vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'

vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}))

import pool from '../db.js'
import profileRoutes from '../routes/profile.js'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'
const app = express()
app.use(express.json())
app.use(profileRoutes)

function authToken(userId = 1) {
  return jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/profile/:id', () => {
  it('returns 404 for missing profile', async () => {
    pool.query.mockResolvedValue([[], []])
    const res = await request(app).get('/api/profile/999').set('Authorization', `Bearer ${authToken(1)}`)
    expect(res.status).toBe(404)
    expect(res.body.message).toMatch(/not found/i)
  })

  it('returns profile with photos and interests', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1, display_name: 'Test', email: 'test@test.com' }], []])
      .mockResolvedValueOnce([[{ id: 1, url: '/photo.jpg', sort_order: 0, is_avatar: 1 }], []])
      .mockResolvedValueOnce([[{ id: 1, name_ru: 'Спорт', name_en: 'Sport' }], []])
      .mockResolvedValueOnce([[{ interests: '["sport","music"]' }], []])
      .mockResolvedValueOnce([[{ id: 1, name_en: 'Sport' }, { id: 2, name_en: 'Music' }], []])

    const res = await request(app).get('/api/profile/1').set('Authorization', `Bearer ${authToken(1)}`)
    expect(res.status).toBe(200)
    expect(res.body.display_name).toBe('Test')
    expect(res.body.photos).toHaveLength(1)
    expect(res.body.interests).toHaveLength(1)
  })

  it('returns birth_date along with profile fields', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1, display_name: 'Test', age: 30, birth_date: '1995-06-15', email: 't@t.com' }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ interests: '[]' }], []])
      .mockResolvedValueOnce([[], []])

    const res = await request(app).get('/api/profile/1').set('Authorization', `Bearer ${authToken(1)}`)
    expect(res.status).toBe(200)
    expect(res.body.birth_date).toBe('1995-06-15')
    expect(res.body.age).toBe(30)
  })

  it('drops interests absent from canonical content_config (e.g. Animals/Politics)', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1, display_name: 'Test', email: 'test@test.com' }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([
        [
          { id: 13, name_ru: 'Животные', name_en: 'Animals' },
          { id: 1, name_ru: 'Спорт', name_en: 'Sport' },
        ],
        [],
      ])
      .mockResolvedValueOnce([[{ interests: '["sport"]' }], []])
      .mockResolvedValueOnce([[{ id: 13, name_en: 'Animals' }, { id: 1, name_en: 'Sport' }], []])

    const res = await request(app).get('/api/profile/1').set('Authorization', `Bearer ${authToken(1)}`)
    expect(res.status).toBe(200)
    expect(res.body.interests).toHaveLength(1)
    expect(res.body.interests[0].id).toBe(1)
    expect(res.body.interests[0].name_ru).toBe('Спорт')
  })

  it('sanitizes legacy XSS payload stored in bio (defense in depth on read)', async () => {
    pool.query
      .mockResolvedValueOnce(
        [[{ id: 2, display_name: 'Ann <b>x</b>', bio: '<script>alert("xss")</script>', email: 'a@t.com' }], []],
      )
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ interests: '[]' }], []])
      .mockResolvedValueOnce([[], []])

    const res = await request(app).get('/api/profile/2').set('Authorization', `Bearer ${authToken(1)}`)
    expect(res.status).toBe(200)
    expect(res.body.bio).not.toContain('<script>')
    expect(res.body.bio).not.toContain('alert(')
    expect(res.body.display_name).not.toContain('<b>')
  })

  it('handles database error', async () => {
    pool.query.mockRejectedValue(new Error('DB error'))
    const res = await request(app).get('/api/profile/1').set('Authorization', `Bearer ${authToken(1)}`)
    expect(res.status).toBe(500)
  })
})

describe('PUT /api/profile/:id', () => {
  it('updates profile fields', async () => {
    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ id: 1, display_name: 'Updated', bio: 'New bio' }], []])

    const res = await request(app)
      .put('/api/profile/1')
      .set('Authorization', `Bearer ${authToken(1)}`)
      .send({ display_name: 'Updated', bio: 'New bio' })
    expect(res.status).toBe(200)
    expect(res.body.display_name).toBe('Updated')
  })

  it('updates interests if provided: один INSERT на весь список, а не по интересу', async () => {
    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ interests: '["sport","music"]' }], []])
      .mockResolvedValueOnce([[{ id: 1, name_en: 'Sport' }, { id: 2, name_en: 'Music' }], []])
      .mockResolvedValue([[], []])

    const res = await request(app)
      .put('/api/profile/1')
      .set('Authorization', `Bearer ${authToken(1)}`)
      .send({ display_name: 'Test', interests: [1, 2, 3] })
    expect(res.status).toBe(200)
    const insertCalls = pool.query.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].startsWith('INSERT IGNORE INTO user_interests'),
    )
    expect(insertCalls).toHaveLength(1)
    expect(insertCalls[0][0]).toContain('(?, ?), (?, ?)')
    expect(insertCalls[0][1]).toEqual(['1', 1, '1', 2])
  })

  it('filters out non-canonical interest ids on save (e.g. Animals/Politics)', async () => {
    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ interests: '["sport"]' }], []])
      .mockResolvedValueOnce([[{ id: 13, name_en: 'Animals' }, { id: 1, name_en: 'Sport' }], []])
      .mockResolvedValue([[], []])

    const res = await request(app)
      .put('/api/profile/1')
      .set('Authorization', `Bearer ${authToken(1)}`)
      .send({ display_name: 'Test', interests: [13, 1] })
    expect(res.status).toBe(200)
    const insertCalls = pool.query.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].startsWith('INSERT IGNORE INTO user_interests'),
    )
    expect(insertCalls).toHaveLength(1)
    expect(insertCalls.map((c) => c[1].slice(1))).toEqual([[1]])
  })

  it('keeps canonical interests added later (Coffee=26, Design=37) and drops Animals(13)', async () => {
    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ interests: '["sport","coffee","design"]' }], []])
      .mockResolvedValueOnce([
        [
          { id: 13, name_en: 'Animals' },
          { id: 26, name_en: 'Coffee' },
          { id: 37, name_en: 'Design' },
        ],
        [],
      ])
      .mockResolvedValue([[], []])

    const res = await request(app)
      .put('/api/profile/1')
      .set('Authorization', `Bearer ${authToken(1)}`)
      .send({ display_name: 'Test', interests: [26, 37, 13] })
    expect(res.status).toBe(200)
    const insertCalls = pool.query.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].startsWith('INSERT IGNORE INTO user_interests'),
    )
    expect(insertCalls).toHaveLength(1)
    expect(insertCalls[0][1]).toEqual(['1', 26, '1', 37])
  })

  it('recomputes age from birth_date on save and stores birth_date', async () => {
    const bd = new Date('2000-01-01')
    const today = new Date()
    let expectedAge = today.getFullYear() - bd.getFullYear()
    const m = today.getMonth() - bd.getMonth()
    if (m < 0 || (m === 0 && today.getDate() < bd.getDate())) expectedAge -= 1
    expectedAge = Math.max(18, expectedAge)

    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ id: 1, display_name: 'Updated' }], []])

    const res = await request(app)
      .put('/api/profile/1')
      .set('Authorization', `Bearer ${authToken(1)}`)
      .send({ display_name: 'Updated', birth_date: '2000-01-01' })
    expect(res.status).toBe(200)

    const updateCall = pool.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].startsWith('UPDATE user_profiles'),
    )
    expect(updateCall).toBeDefined()
    const params = updateCall[1]
    expect(params[2]).toBe(expectedAge)
    expect(params[3]).toBe('2000-01-01')
  })

  it('clamps very recent birth_date to min age 18', async () => {
    const bd = new Date()
    const birthDateStr = `${bd.getFullYear()}-${String(bd.getMonth() + 1).padStart(2, '0')}-${String(bd.getDate()).padStart(2, '0')}`

    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ id: 1, display_name: 'Baby' }], []])

    const res = await request(app)
      .put('/api/profile/1')
      .set('Authorization', `Bearer ${authToken(1)}`)
      .send({ display_name: 'Baby', birth_date: birthDateStr })
    expect(res.status).toBe(200)

    const updateCall = pool.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].startsWith('UPDATE user_profiles'),
    )
    expect(updateCall[1][2]).toBe(18)
  })
})

// Регрессия: пустой number/select-инпут отдавал '' в COALESCE(?, col), MySQL
// отвечал ER_WARN_DATA_OUT_OF_RANGE, а маршрут — 500 на весь PUT, из-за чего
// одно незаполненное поле блокировало сохранение всех остальных.
describe('PUT /api/profile/:id: незаполненные поля не роняют сохранение', () => {
  // Мок по SQL, а не очередью mockResolvedValueOnce: в ветках 400 ни одного
  // запроса не уходит, и непрочитанная очередь утекала бы в соседние describe.
  let stored

  beforeEach(() => {
    pool.query.mockReset()
    stored = { id: 1, display_name: 'Stored', age: 30, birth_date: '1990-07-04' }
    pool.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.startsWith('SELECT * FROM user_profiles')) {
        return Promise.resolve([[stored], []])
      }
      return Promise.resolve([[], []])
    })
  })

  afterEach(() => {
    pool.query.mockReset()
  })

  async function put(body) {
    return request(app)
      .put('/api/profile/1')
      .set('Authorization', `Bearer ${authToken(1)}`)
      .send(body)
  }

  function updateCall() {
    return pool.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].startsWith('UPDATE user_profiles'),
    )
  }

  it('пустые height, age, gender, looking_for сохраняются как 200', async () => {
    const res = await put({ display_name: 'Updated', height: '', age: '', gender: '', looking_for: '' })
    expect(res.status).toBe(200)
  })

  it("пустой height чистится в NULL, а не уходит в COALESCE как ''", async () => {
    const res = await put({ display_name: 'Updated', height: '' })
    expect(res.status).toBe(200)
    expect(updateCall()[0]).toMatch(/height = \?/)
    expect(updateCall()[0]).not.toMatch(/height = COALESCE/)
    expect(updateCall()[1][8]).toBeNull()
  })

  it('height=0 от клиента (поле не заполнено) чистится, а не роняет CHECK 100..250', async () => {
    const res = await put({ display_name: 'Updated', height: 0 })
    expect(res.status).toBe(200)
    expect(updateCall()[1][8]).toBeNull()
  })

  it('неприсланный height оставляет прежний (COALESCE), а не затирает', async () => {
    const res = await put({ display_name: 'Updated' })
    expect(res.status).toBe(200)
    expect(updateCall()[0]).toMatch(/height = COALESCE/)
    expect(updateCall()[1][8]).toBeUndefined()
  })

  it('рост вне 100..250 отвечает 400, а не ER_CHECK_CONSTRAINT_VIOLATED -> 500', async () => {
    const res = await put({ display_name: 'Updated', height: 300 })
    expect(res.status).toBe(400)
    expect(res.body.field).toBe('height')
  })

  it('строка из number-инпута приводится к числу', async () => {
    await put({ display_name: 'Updated', height: '172' })
    expect(updateCall()[1][8]).toBe(172)
  })

  it('неизвестный ENUM отвечает 400 с именем поля, а не 500', async () => {
    const res = await put({ display_name: 'Updated', gender: 'bogus' })
    expect(res.status).toBe(400)
    expect(res.body.field).toBe('gender')
  })

  it('рост вне диапазона отвечает 400, а не 500', async () => {
    const res = await put({ display_name: 'Updated', height: -5 })
    expect(res.status).toBe(400)
    expect(res.body.field).toBe('height')
  })

  it('мусор в birth_date отвечает 400, а не 500', async () => {
    const res = await put({ display_name: 'Updated', birth_date: 'мусор' })
    expect(res.status).toBe(400)
    expect(res.body.field).toBe('birth_date')
  })

  it('слишком длинное имя обрезается под varchar(100) вместо 500', async () => {
    const res = await put({ display_name: 'x'.repeat(101) })
    expect(res.status).toBe(200)
    expect(updateCall()[1][0]).toHaveLength(100)
  })

  it('очистка bio пустой строкой сохраняется (поле можно очистить)', async () => {
    await put({ display_name: 'Updated', bio: '' })
    expect(updateCall()[1][4]).toBe('')
  })

  it('явная очистка birth_date (null) пишет NULL, а не игнорируется COALESCE', async () => {
    await put({ display_name: 'Updated', birth_date: null })
    expect(updateCall()[0]).toMatch(/birth_date = \?/)
    expect(updateCall()[0]).not.toMatch(/birth_date = COALESCE/)
    expect(updateCall()[1][3]).toBeNull()
  })

  it('ответ отдаёт birth_date как дату, а не Date с уходом на сутки', async () => {
    stored = { id: 1, display_name: 'Updated', birth_date: new Date('1990-07-04T00:00:00Z') }
    const res = await put({ display_name: 'Updated' })
    expect(res.status).toBe(200)
    expect(res.body.birth_date).toBe('1990-07-04')
  })
})

describe('DELETE /api/profile/me', () => {
  it('requires auth', async () => {
    const res = await request(app).delete('/api/profile/me')
    expect(res.status).toBe(401)
  })

  it('deletes account', async () => {
    pool.query.mockResolvedValue([[], []])
    const res = await request(app)
      .delete('/api/profile/me')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.message).toMatch(/deleted/i)
  })
})

describe('GET /api/profile/me (what /profile/edit loads)', () => {
  it('returns birth_date, otherwise the date input is always empty', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1, display_name: 'Test', age: 30, birth_date: '1995-06-15' }], []])
      .mockResolvedValueOnce([[{ id: 7, url: '/uploads/a.jpg', sort_order: 0, is_avatar: 0 }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ interests: '[]' }], []])

    const res = await request(app).get('/api/profile/me').set('Authorization', `Bearer ${authToken(1)}`)
    expect(res.status).toBe(200)
    expect(res.body.birth_date).toBe('1995-06-15')
    expect(res.body.photos).toEqual([{ id: 7, url: '/uploads/a.jpg', sort_order: 0, is_avatar: 0 }])
  })

  it('SELECT of /me contains up.birth_date (regression: column was missing)', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1, display_name: 'Test', age: 30 }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ interests: '[]' }], []])

    await request(app).get('/api/profile/me').set('Authorization', `Bearer ${authToken(1)}`)

    const meSql = pool.query.mock.calls[0][0]
    expect(meSql).toMatch(/up\.birth_date/)
  })
})

describe('Static routes before /:id (regression: shadowing)', () => {
  it('GET /api/profile/aliases must NOT be swallowed by /api/profile/:id', async () => {
    const res = await request(app).get('/api/profile/aliases')
    expect(res.status).toBe(401)
  })

  it('GET /api/profile/verification must NOT be swallowed by /api/profile/:id', async () => {
    const res = await request(app).get('/api/profile/verification')
    expect(res.status).toBe(401)
  })

  it('GET /api/profile/aliases returns aliases with auth', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 1, alias: 'Alex', is_primary: 1 }], []])
    const res = await request(app)
      .get('/api/profile/aliases')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].alias).toBe('Alex')
  })

  it('GET /api/profile/verification returns verification state with auth', async () => {
    pool.query.mockResolvedValueOnce([[{ photo_verified: 0 }], []])
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(app)
      .get('/api/profile/verification')
      .set('Authorization', `Bearer ${authToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.verified).toBe(false)
  })
})
