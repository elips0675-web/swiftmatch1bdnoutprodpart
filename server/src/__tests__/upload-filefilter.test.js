vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
  delete process.env.S3_BUCKET
  delete process.env.AWS_ACCESS_KEY_ID
})

import { describe, it, expect, vi, beforeEach, afterAll, afterEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'
import fs from 'fs'
import os from 'os'
import path from 'path'

const TEST_UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-upload-test-'))

vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}))

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('../audit.js', () => ({
  auditLog: vi.fn(async () => {}),
  softDelete: vi.fn(async () => {}),
  softDeleteWhere: vi.fn(async () => {}),
}))

vi.mock('../image-pipeline.js', () => ({
  processImage: vi.fn(async () => []),
  getImageUrls: vi.fn((url) => ({ original: url, large: url + '_800x800.webp' })),
}))

vi.mock('../ai-moderation.js', () => ({
  moderateImage: vi.fn(async () => ({ safe: null, source: 'none', reasons: [] })),
}))

vi.mock('multer', async (importOriginal) => {
  const actual = await importOriginal()
  const realDisk = actual.default.diskStorage
  const diskStorage = (opts) => realDisk({
    destination: (req, file, cb) => cb(null, TEST_UPLOAD_DIR),
    filename: opts && opts.filename,
  })
  return {
    ...actual,
    default: Object.assign(actual.default, { diskStorage }),
  }
})

import pool from '../db.js'
import logger from '../logger.js'
import { auditLog } from '../audit.js'
import { processImage } from '../image-pipeline.js'
import uploadRoutes from '../routes/upload.js'

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

function dirFileCount() {
  return fs.existsSync(TEST_UPLOAD_DIR) ? fs.readdirSync(TEST_UPLOAD_DIR).length : 0
}

afterAll(() => {
  fs.rmSync(TEST_UPLOAD_DIR, { recursive: true, force: true })
})

afterEach(() => {
  for (const f of fs.readdirSync(TEST_UPLOAD_DIR)) {
    try { fs.unlinkSync(path.join(TEST_UPLOAD_DIR, f)) } catch {}
  }
})

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockResolvedValue([{ insertId: 42 }, []])
})

describe('multer fileFilter — реальная проверка, не мок', () => {
  const app = createApp()

  it('image/* с недопустимым расширением (image/svg+xml .svg) отклоняется -> 500', async () => {
    const res = await request(app)
      .post('/api/upload')
      .set('Authorization', authHeader())
      .attach('photo', Buffer.from('<svg/>'), { filename: 'logo.svg', contentType: 'image/svg+xml' })
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Upload failed')
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('не-image mimetype (application/x-php) с расширением .jpg отклоняется -> 500, файл не пишется', async () => {
    const before = dirFileCount()
    const res = await request(app)
      .post('/api/upload')
      .set('Authorization', authHeader())
      .attach('photo', Buffer.from('<?php ?>'), { filename: 'shell.jpg', contentType: 'application/x-php' })
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Upload failed')
    expect(pool.query).not.toHaveBeenCalled()
    expect(dirFileCount()).toBe(before)
  })

  it('image/jpeg с расширением .jpg проходит fileFilter и сохраняется на диск', async () => {
    const res = await request(app)
      .post('/api/upload')
      .set('Authorization', authHeader())
      .attach('photo', Buffer.from('fake-jpeg'), { filename: 'me.jpg', contentType: 'image/jpeg' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ id: 42, is_avatar: false })
    const storedName = path.basename(res.body.url)
    expect(storedName).toMatch(/^\d+-\d+\.jpg$/)
    expect(fs.existsSync(path.join(TEST_UPLOAD_DIR, storedName))).toBe(true)
    expect(pool.query).toHaveBeenCalled()
    expect(processImage).toHaveBeenCalled()
    expect(auditLog).toHaveBeenCalled()
  })

  it('image/png с расширением .png проходит и пишет sort_order из тела', async () => {
    const res = await request(app)
      .post('/api/upload')
      .field('sort_order', '3')
      .set('Authorization', authHeader())
      .attach('photo', Buffer.from('fake-png'), { filename: 'pic.png', contentType: 'image/png' })
    expect(res.status).toBe(200)
    expect(res.body.sort_order).toBe(3)
    const storedName = path.basename(res.body.url)
    expect(fs.existsSync(path.join(TEST_UPLOAD_DIR, storedName))).toBe(true)
  })

  it('path traversal в имени не уезжает за пределы каталога (хранится uuid.ext)', async () => {
    const res = await request(app)
      .post('/api/upload')
      .set('Authorization', authHeader())
      .attach('photo', Buffer.from('fake'), { filename: '../../evil.jpg', contentType: 'image/jpeg' })
    expect(res.status).toBe(200)
    const storedName = path.basename(res.body.url)
    expect(storedName).toMatch(/^\d+-\d+\.jpg$/)
    expect(res.body.url).not.toContain('..')
  })
})

describe('updateModeration — ветка «вердикта нет»', () => {
  const app = createApp()

  it('вердикт AI отсутствует (safe=null): статус не трогается, но загрузка отвечает 200', async () => {
    const before = pool.query.mock.calls.length
    const res = await request(app)
      .post('/api/upload')
      .set('Authorization', authHeader())
      .attach('photo', Buffer.from('fake'), { filename: 'x.jpg', contentType: 'image/jpeg' })
    expect(res.status).toBe(200)
    const updates = pool.query.mock.calls.slice(before).filter((c) => /UPDATE user_photos/.test(String(c[0])))
    expect(updates).toEqual([])
    expect(logger.warn).toHaveBeenCalled()
  })

  it('INSERT без insertId: updateModeration выходит сразу, статус не трогается', async () => {
    pool.query.mockReset()
    pool.query.mockResolvedValue([{ insertId: undefined }, []])
    const res = await request(app)
      .post('/api/upload')
      .set('Authorization', authHeader())
      .attach('photo', Buffer.from('fake'), { filename: 'y.jpg', contentType: 'image/jpeg' })
    expect(res.status).toBe(200)
    const updates = pool.query.mock.calls.filter((c) => /UPDATE user_photos/.test(String(c[0])))
    expect(updates).toEqual([])
  })
})

describe('пайплайн локальной загрузки: падение задачи логируется, ответ не рушится', () => {
  const app = createApp()

  it('processImage реджектится -> лог pipeline error, ответ всё равно 200', async () => {
    processImage.mockRejectedValueOnce(new Error('sharp boom'))
    const res = await request(app)
      .post('/api/upload')
      .set('Authorization', authHeader())
      .attach('photo', Buffer.from('fake'), { filename: 'z.jpg', contentType: 'image/jpeg' })
    expect(res.status).toBe(200)
    expect(logger.error).toHaveBeenCalledWith('Image pipeline error:', expect.any(Error))
  })
})
