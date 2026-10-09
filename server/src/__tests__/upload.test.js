vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}))

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('multer', () => {
  const mockSingle = vi.fn()
  return {
    default: Object.assign(() => ({ single: () => mockSingle }), {
      diskStorage: vi.fn(() => ({})),
    }),
    __mockSingle: mockSingle,
  }
})

import pool from '../db.js'
import uploadRoutes from '../routes/upload.js'
import { __mockSingle as mockSingle } from 'multer'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

function authHeader(userId = 1) {
  return 'Bearer ' + jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })
}

function createApp() {
  const app = express()
  app.use(express.json())
  app.use(uploadRoutes)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/photos/:userId', () => {
  const app = createApp()

  it('returns user photos', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 1, url: '/uploads/1.jpg', sort_order: 0, is_avatar: false }], []])
    const res = await request(app).get('/api/photos/1').set('Authorization', authHeader())
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body[0].url).toBe('/uploads/1.jpg')
  })

  it('returns empty array for no photos', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(app).get('/api/photos/99').set('Authorization', authHeader())
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('handles database error', async () => {
    pool.query.mockRejectedValue(new Error('DB error'))
    const res = await request(app).get('/api/photos/1').set('Authorization', authHeader())
    expect(res.status).toBe(500)
  })
})

describe('DELETE /api/photos/:id', () => {
  const app = createApp()

  it('returns 404 for non-existent photo', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const res = await request(app).delete('/api/photos/999').set('Authorization', authHeader())
    expect(res.status).toBe(404)
  })

  it('deletes existing photo', async () => {
    pool.query
      .mockResolvedValueOnce([[{ url: '/uploads/test.jpg' }], []])
      .mockResolvedValueOnce([[], []])
    const res = await request(app).delete('/api/photos/1').set('Authorization', authHeader())
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  it('handles database error', async () => {
    pool.query.mockRejectedValue(new Error('DB error'))
    const res = await request(app).delete('/api/photos/1').set('Authorization', authHeader())
    expect(res.status).toBe(500)
  })
})

// Регрессия: на чистом чекауте server/uploads не существует, и multer падал с
// ENOENT -> 500 "Upload failed" при любой загрузке фото. Каталог создаётся сам.
describe('POST /api/upload: каталог назначения', () => {
  const app2 = createApp()

  it('uploads/ создан до записи файла', async () => {
    mockSingle.mockImplementationOnce((req, res, cb) => cb(null))
    const res = await request(app2).post('/api/upload').set('Authorization', authHeader())
    expect(res.status).toBe(400)
    expect(fs.existsSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../uploads'))).toBe(true)
  })
})

// Этап 39 (слепые зоны, аудит kimi): security-тесты загрузки файлов
describe('POST /api/upload security', () => {
  const app2 = createApp()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('non-image mimetype отклоняется (multer fileFilter)', async () => {
    mockSingle.mockImplementationOnce((req, res, cb) => cb(new Error('Only image files (jpg, jpeg, png, gif, webp) are allowed')))
    const res = await request(app2)
      .post('/api/upload')
      .set('Authorization', authHeader())
      .attach('photo', Buffer.from('<?php echo 1; ?>'), { filename: 'shell.php', contentType: 'application/x-php' })
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Upload failed')
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('без файла -> 400 No file uploaded', async () => {
    mockSingle.mockImplementationOnce((req, res, cb) => cb(null))
    const res = await request(app2).post('/api/upload').set('Authorization', authHeader())
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('No file uploaded')
  })

  it('неавторизованный запрос отклоняется до multer (файл не пишется на диск)', async () => {
    const res = await request(app2).post('/api/upload').attach('photo', Buffer.from('x'), { filename: 'a.jpg' })
    expect(res.status).toBe(401)
    expect(mockSingle).not.toHaveBeenCalled()
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('user_id из тела запроса не позволяет вешать фото на чужой профиль', async () => {
    mockSingle.mockImplementationOnce((req, res, cb) => {
      req.file = { filename: 'a.jpg', originalname: 'a.jpg' }
      cb(null)
    })
    pool.query.mockResolvedValue([{ insertId: 9 }, []])
    const res = await request(app2)
      .post('/api/upload')
      .set('Authorization', authHeader(1))
      .field('user_id', '999')
      .attach('photo', Buffer.from('x'), { filename: 'a.jpg', contentType: 'image/jpeg' })
    expect(res.status).toBe(200)
    const insert = pool.query.mock.calls.find((c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO user_photos'))
    expect(insert[1][0]).toBe(1)
  })

  it('path traversal в имени не попадает в url: хранится uuid.ext', async () => {
    mockSingle.mockImplementationOnce((req, res, cb) => {
      req.file = { filename: '1700000000-123456789.jpg', originalname: '../../etc/passwd.jpg', path: '/tmp/x.jpg' }
      cb(null)
    })
    pool.query.mockResolvedValue([{ insertId: 7 }, []])
    const res = await request(app2)
      .post('/api/upload')
      .set('Authorization', authHeader())
      .attach('photo', Buffer.from('x'), { filename: '../../etc/passwd.jpg', contentType: 'image/jpeg' })
    expect(res.status).toBe(200)
    expect(res.body.url).toBe('/uploads/1700000000-123456789.jpg')
    expect(res.body.url).not.toContain('..')
    expect(res.body.url).toMatch(/\.jpg$/i)
  })

  it('двойное расширение shell.php.jpg хранится как .jpg', async () => {
    mockSingle.mockImplementationOnce((req, res, cb) => {
      req.file = { filename: '1700000001-987654321.jpg', originalname: 'shell.php.jpg', path: '/tmp/y.jpg' }
      cb(null)
    })
    pool.query.mockResolvedValue([{ insertId: 8 }, []])
    const res = await request(app2)
      .post('/api/upload')
      .set('Authorization', authHeader())
      .attach('photo', Buffer.from('x'), { filename: 'shell.php.jpg', contentType: 'image/jpeg' })
    expect(res.status).toBe(200)
    expect(res.body.url.endsWith('.jpg')).toBe(true)
    expect(res.body.url.includes('.php')).toBe(false)
  })
})

describe('POST /api/upload: модерация не настроена (N3, P0-E)', () => {
  const app3 = createApp()
  const envKeys = ['NODE_ENV', 'ALLOW_UNMODERATED_PHOTOS', 'PHOTO_MODERATION_MODE', 'OPENAI_API_KEY', 'AWS_ACCESS_KEY_ID', 'JWT_SECRET']
  const prodSecret = '0123456789abcdef0123456789abcdef0123456789abcdef'
  let saved

  beforeEach(() => {
    vi.clearAllMocks()
    saved = {}
    for (const key of envKeys) saved[key] = process.env[key]
    delete process.env.OPENAI_API_KEY
    delete process.env.AWS_ACCESS_KEY_ID
    delete process.env.ALLOW_UNMODERATED_PHOTOS
    delete process.env.PHOTO_MODERATION_MODE
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  const token = () => 'Bearer ' + jwt.sign({ userId: 1, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '1h' })

  const upload = () => {
    mockSingle.mockImplementationOnce((req, res, cb) => {
      req.file = { filename: 'a.jpg', originalname: 'a.jpg' }
      cb(null)
    })
    return request(app3)
      .post('/api/upload')
      .set('Authorization', token())
      .attach('photo', Buffer.from('x'), { filename: 'a.jpg', contentType: 'image/jpeg' })
  }

  it('прод без ключей AI: 503 с кодом, INSERT в user_photos не уходит', async () => {
    process.env.NODE_ENV = 'production'
    process.env.JWT_SECRET = prodSecret
    const res = await upload()
    expect(res.status).toBe(503)
    expect(res.body.code).toBe('PHOTO_MODERATION_UNAVAILABLE')
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('вне прода без разрешения: тот же отказ', async () => {
    process.env.NODE_ENV = 'development'
    const res = await upload()
    expect(res.status).toBe(503)
    expect(res.body.code).toBe('PHOTO_MODERATION_UNAVAILABLE')
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('вне прода с ALLOW_UNMODERATED_PHOTOS=true: фото принимается', async () => {
    process.env.NODE_ENV = 'development'
    process.env.ALLOW_UNMODERATED_PHOTOS = 'true'
    pool.query.mockResolvedValue([{ insertId: 11 }, []])
    const res = await upload()
    expect(res.status).toBe(200)
    const insert = pool.query.mock.calls.find((c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO user_photos'))
    expect(insert).toBeTruthy()
  })

  it('прод с настроенной модерацией: фото принимается', async () => {
    process.env.NODE_ENV = 'production'
    process.env.JWT_SECRET = prodSecret
    process.env.OPENAI_API_KEY = 'sk-test-moderation'
    pool.query.mockResolvedValue([{ insertId: 12 }, []])
    const res = await upload()
    expect(res.status).toBe(200)
    expect(res.body.id).toBe(12)
  })

  it('strict (PHOTO_MODERATION_MODE=strict): INSERT пишет pending, а не approved', async () => {
    process.env.NODE_ENV = 'test'
    process.env.PHOTO_MODERATION_MODE = 'strict'
    pool.query.mockResolvedValueOnce([{ insertId: 21 }, []])
    const res = await upload()
    expect(res.status).toBe(200)
    const insert = pool.query.mock.calls.find((c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO user_photos'))
    expect(insert[0]).toContain('moderation_status')
    expect(insert[1][3]).toBe('pending')
  })

  it('permissive вне прода: INSERT сразу пишет approved, иначе dev-фото невидимо', async () => {
    process.env.NODE_ENV = 'test'
    pool.query.mockResolvedValueOnce([{ insertId: 22 }, []])
    const res = await upload()
    expect(res.status).toBe(200)
    const insert = pool.query.mock.calls.find((c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO user_photos'))
    expect(insert[1][3]).toBe('approved')
  })

  it('#34: прод, модерация «настроена», но вердикта Rekognition нет -> pending, автоподтверждения нет', async () => {
    process.env.NODE_ENV = 'production'
    process.env.JWT_SECRET = prodSecret
    process.env.OPENAI_API_KEY = 'sk-test-moderation'
    process.env.PHOTO_MODERATION_MODE = 'strict'
    mockSingle.mockImplementationOnce((req, res, cb) => {
      req.file = { filename: 'a.jpg', originalname: 'a.jpg', path: '/tmp/none.jpg' }
      cb(null)
    })
    pool.query.mockResolvedValue([{ insertId: 41 }, []])
    const res = await request(app3)
      .post('/api/upload')
      .set('Authorization', token())
      .attach('photo', Buffer.from('x'), { filename: 'a.jpg', contentType: 'image/jpeg' })
    expect(res.status).toBe(200)
    const insert = pool.query.mock.calls.find((c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO user_photos'))
    expect(insert[1][3]).toBe('pending')
    const approval = pool.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes("moderation_status = 'approved'"),
    )
    expect(approval).toBeUndefined()
  })
})