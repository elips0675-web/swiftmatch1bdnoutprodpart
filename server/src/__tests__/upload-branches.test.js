/**
 * Непокрытые ветки routes/upload.js в локальном режиме (Stage 154):
 * колбэк назначения каталога multer.diskStorage и ветка «отказ модерации»
 * в локальном пайплайне (индекс задачи 1 — «AI moderation error:»).
 */
vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
  delete process.env.S3_BUCKET
  delete process.env.AWS_ACCESS_KEY_ID
  delete process.env.S3_ENDPOINT
})

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'
import path from 'path'
import fs from 'fs'

const h = vi.hoisted(() => ({
  storageOpts: [],
  failFactory: false,
}))

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
  getImageUrls: vi.fn((url) => ({
    original: url,
    large: url + '_800x800.webp',
    medium: url + '_400x400.webp',
    small: url + '_200x200.webp',
    thumbnail: url + '_100x100.webp',
  })),
}))

vi.mock('../ai-moderation.js', () => ({
  moderateImage: vi.fn(async () => ({ safe: true, source: 'ai', reasons: [] })),
}))

vi.mock('multer', () => {
  const stub = () => {
    if (h.failFactory) {
      h.failFactory = false
      throw new Error('multer init boom')
    }
    return {
      single: () => (req, _res, next) => {
        req.file = {
          filename: '1699999999999-123.jpg',
          path: path.join('uploads', '1699999999999-123.jpg'),
          originalname: 'me.jpg',
          mimetype: 'image/jpeg',
          size: 1024,
        }
        next()
      },
    }
  }
  stub.diskStorage = (opts) => {
    h.storageOpts.push(opts)
    return { __diskStorageOptions: opts }
  }
  return { default: stub }
})

import pool from '../db.js'
import logger from '../logger.js'
import { moderateImage } from '../ai-moderation.js'
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

function postPhoto(app) {
  return request(app)
    .post('/api/upload')
    .set('Authorization', authHeader())
    .attach('photo', Buffer.from('fake'), { filename: 'me.jpg', contentType: 'image/jpeg' })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.storageOpts.length = 0
  h.failFactory = false
  pool.query.mockResolvedValue([{ insertId: 42 }, []])
})

afterAll(() => {
  vi.restoreAllMocks()
})

describe('локальный режим: сбой инициализации хранилища', () => {
  it('упавшая сборка multer: следующий запрос переиспользует уже созданное хранилище', async () => {
    vi.resetModules()
    const freshDb = (await import('../db.js')).default
    const freshLogger = (await import('../logger.js')).default
    const freshUpload = (await import('../routes/upload.js')).default
    freshDb.query.mockResolvedValue([{ insertId: 42 }, []])
    h.failFactory = true

    const app = express()
    app.use(express.json())
    app.use(freshUpload)

    const first = await postPhoto(app)
    expect(first.status).toBe(500)
    expect(first.body.message).toBe('Upload failed')
    expect(freshLogger.error).toHaveBeenCalledWith('Upload error:', expect.any(Error))

    const second = await postPhoto(app)
    expect(second.status).toBe(200)
    expect(h.storageOpts.length).toBe(1)
  })
})

describe('локальный режим: колбэк каталога diskStorage', () => {
  const app = createApp()

  it('destination отдаёт каталог загрузок, файл кладётся именно туда', async () => {
    const res = await postPhoto(app)
    expect(res.status).toBe(200)

    const opts = h.storageOpts[0]
    expect(typeof opts.destination).toBe('function')

    const dir = await new Promise((resolve, reject) => {
      opts.destination({}, { originalname: 'me.jpg' }, (err, value) => (err ? reject(err) : resolve(value)))
    })
    expect(path.basename(dir)).toBe('uploads')
    expect(fs.existsSync(dir)).toBe(true)
  })
})

describe('локальный режим: отказ модерации в пайплайне', () => {
  const app = createApp()

  it('отказ задачи модерации (индекс 1) логируется как AI moderation error, ответ 200', async () => {
    moderateImage.mockRejectedValueOnce(new Error('ai boom'))
    const res = await postPhoto(app)
    expect(res.status).toBe(200)
    expect(logger.error).toHaveBeenCalledWith('AI moderation error:', expect.any(Error))
  })
})
