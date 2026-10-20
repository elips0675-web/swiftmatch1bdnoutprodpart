vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
  process.env.S3_BUCKET = 'swiftmatch-test-bucket'
  process.env.AWS_ACCESS_KEY_ID = 'AKIATEST'
  process.env.AWS_SECRET_ACCESS_KEY = 'secret'
  process.env.AWS_REGION = 'eu-central-1'
  delete process.env.S3_ENDPOINT})

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'
import fs from 'fs'
import os from 'os'
import path from 'path'

const h = vi.hoisted(() => ({
  sent: [],
  sendImpl: null,
  s3Configs: [],
  storageOpts: [],
}))

class S3Client {
  constructor(config) {
    this.config = config
    h.s3Configs.push(config)
  }

  send(cmd) {
    h.sent.push(cmd)
    if (h.sendImpl) return h.sendImpl(cmd)
    return Promise.resolve({})
  }
}

class GetObjectCommand {
  constructor(input) {
    this.__type = 'Get'
    this.input = input
  }
}

class PutObjectCommand {
  constructor(input) {
    this.__type = 'Put'
    this.input = input
  }
}

class DeleteObjectCommand {
  constructor(input) {
    this.__type = 'Delete'
    this.input = input
  }
}

vi.mock('@aws-sdk/client-s3', () => ({ S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand }))

vi.mock('multer-s3', () => {
  const factory = (opts) => {
    h.storageOpts.push(opts)
    return { __s3StorageOptions: opts }
  }
  factory.AUTO_CONTENT_TYPE = 'AUTO_CONTENT_TYPE'
  return { default: factory }
})

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
  const stub = () => ({
    single: () => (req, _res, next) => {
      req.file = {
        filename: '1699999999999-123.jpg',
        location: 'https://swiftmatch-test-bucket.s3.eu-central-1.amazonaws.com/uploads/1699999999999-123.jpg',
        key: 'uploads/1699999999999-123.jpg',
        originalname: 'me.jpg',
        mimetype: 'image/jpeg',
        size: 1024,
      }
      next()
    },
  })
  return { default: stub }
})

import pool from '../db.js'
import logger from '../logger.js'
import { processImage } from '../image-pipeline.js'
import { moderateImage } from '../ai-moderation.js'
import { auditLog } from '../audit.js'
import uploadRoutes, { s3KeyFromUrl } from '../routes/upload.js'

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
  pool.query.mockResolvedValue([{ insertId: 77 }, []])
  h.sendImpl = null
  h.sent.length = 0
})

afterAll(() => {
  vi.restoreAllMocks()
})

describe('S3-режим upload.js: клиент, хранилище и пайплайн', () => {
  const app = createApp()

  it('при S3_BUCKET + ключах initStorage строится на multerS3, а не на диске', async () => {
    const res = await postPhoto(app)

    expect(res.status).toBe(200)
    expect(res.body.url).toBe('https://swiftmatch-test-bucket.s3.eu-central-1.amazonaws.com/uploads/1699999999999-123.jpg')

    const opts = h.storageOpts[0]
    expect(opts.bucket).toBe('swiftmatch-test-bucket')
    expect(opts.contentType).toBe('AUTO_CONTENT_TYPE')
    expect(typeof opts.key).toBe('function')

    expect(h.s3Configs[0]).toMatchObject({
      region: 'eu-central-1',
      credentials: { accessKeyId: 'AKIATEST', secretAccessKey: 'secret' },
    })
    expect(h.s3Configs[0].endpoint).toBeUndefined()

    const generated = await new Promise((resolve) => opts.key({}, { originalname: '../../evil.PNG' }, (_e, value) => resolve(value)))
    expect(generated).toMatch(/^uploads\/\d+-\d+\.PNG$/)
    expect(generated).not.toContain('..')
  })

  it('клиент S3 создаётся один раз на процесс (кэш s3ClientPromise)', async () => {
    const res = await postPhoto(app)
    expect(res.status).toBe(200)
    expect(h.s3Configs.length).toBe(1)
    expect(h.storageOpts.length).toBe(1)
  })

  it('S3-путь: GET оригинала, PUT вариантов и модерация', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-s3-variants-'))
    const v1 = path.join(dir, 'v1.webp')
    const v2 = path.join(dir, 'v2.avif')
    fs.writeFileSync(v1, Buffer.from('webp-bytes'))
    fs.writeFileSync(v2, Buffer.from('avif-bytes'))
    processImage.mockResolvedValue([{ path: v1, format: 'webp' }, { path: v2, format: 'avif' }])
    h.sendImpl = async (cmd) => {
      if (cmd.__type === 'Get') return { Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } }
      return {}
    }

    const res = await postPhoto(app)

    expect(res.status).toBe(200)
    expect(processImage).toHaveBeenCalled()
    const types = h.sent.map((c) => c.__type)
    expect(types[0]).toBe('Get')
    expect(types.filter((t) => t === 'Put').length).toBe(2)
    expect(h.sent[0].input).toMatchObject({ Bucket: 'swiftmatch-test-bucket', Key: 'uploads/1699999999999-123.jpg' })

    const putWebp = h.sent.find((c) => c.__type === 'Put' && c.input.Key === 'uploads/v1.webp')
    expect(putWebp.input.ContentType).toBe('image/webp')
    const putAvif = h.sent.find((c) => c.__type === 'Put' && c.input.Key === 'uploads/v2.avif')
    expect(putAvif.input.ContentType).toBe('image/avif')
    expect(moderateImage).toHaveBeenCalled()

    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('S3: падение GET логируется, ответ всё равно 200', async () => {
    h.sendImpl = async () => {
      throw new Error('s3 boom')
    }

    const res = await postPhoto(app)

    expect(res.status).toBe(200)
    expect(logger.error).toHaveBeenCalledWith('S3 file process error:', expect.any(Error))
  })

  it('S3: rejected-варианты логируются по индексу (пайплайн/модерация)', async () => {
    processImage.mockRejectedValue(new Error('sharp boom'))
    moderateImage.mockRejectedValue(new Error('ai boom'))
    h.sendImpl = async (cmd) => {
      if (cmd.__type === 'Get') return { Body: { transformToByteArray: async () => new Uint8Array([1]) } }
      return {}
    }

    const res = await postPhoto(app)

    expect(res.status).toBe(200)
    expect(logger.error).toHaveBeenCalledWith('Image pipeline error:', expect.any(Error))
    expect(logger.error).toHaveBeenCalledWith('AI moderation error:', expect.any(Error))
  })

  it('S3: вердикт AI «небезопасно» помечает фото flagged, ответ 200', async () => {
    moderateImage.mockResolvedValue({ safe: false, source: 'ai', reasons: ['nudity'] })
    h.sendImpl = async (cmd) => {
      if (cmd.__type === 'Get') return { Body: { transformToByteArray: async () => new Uint8Array([1]) } }
      return {}
    }

    const res = await postPhoto(app)

    expect(res.status).toBe(200)
    const flagged = pool.query.mock.calls.find((c) => /moderation_status = 'flagged'/.test(String(c[0])))
    expect(flagged).toBeTruthy()
    expect(flagged[1]).toEqual(['nudity', 77])
    expect(auditLog).toHaveBeenCalledTimes(2)
  })

  it('второй запрос использует уже готовый storage (ранний выход initStorage)', async () => {
    const first = await postPhoto(app)
    const second = await postPhoto(app)
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(h.storageOpts.length).toBe(1)
  })

  it('S3-DELETE фото: объект и его варианты удаляются из бакета', async () => {
    pool.query
      .mockResolvedValueOnce([[{ url: 'https://swiftmatch-test-bucket.s3.eu-central-1.amazonaws.com/uploads/7.jpg' }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
    h.sendImpl = async () => ({})

    const res = await request(app)
      .delete('/api/photos/7')
      .set('Authorization', authHeader())

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    const deletes = h.sent.filter((c) => c.__type === 'Delete')
    expect(deletes.length).toBe(5)
    for (const cmd of deletes) expect(cmd.input.Bucket).toBe('swiftmatch-test-bucket')
    expect(deletes[0].input.Key).toBe('uploads/7.jpg')
  })

  it('S3-DELETE: нет своей фотографии -> 404, объекты не трогаются', async () => {
    pool.query.mockResolvedValueOnce([[], []])

    const res = await request(app)
      .delete('/api/photos/999')
      .set('Authorization', authHeader())

    expect(res.status).toBe(404)
    expect(h.sent.filter((c) => c.__type === 'Delete').length).toBe(0)
  })

  it('S3-DELETE: сбой удаления объекта -> 500', async () => {
    pool.query.mockResolvedValueOnce([[{ url: 'uploads/8.jpg' }], []])
    h.sendImpl = async () => {
      throw new Error('s3 delete boom')
    }

    const res = await request(app)
      .delete('/api/photos/8')
      .set('Authorization', authHeader())

    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Delete photo error:', expect.any(Error))
  })

  it('GET /api/photos/:userId отдаёт одобренные фото', async () => {
    const rows = [{ id: 3, url: '/uploads/a.jpg', sort_order: 0, is_avatar: 0 }]
    pool.query.mockResolvedValueOnce([rows, []])

    const res = await request(app)
      .get('/api/photos/5')
      .set('Authorization', authHeader())

    expect(res.status).toBe(200)
    expect(res.body).toEqual(rows)
  })

  it('GET /api/photos/:userId при сбое БД -> 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))

    const res = await request(app)
      .get('/api/photos/5')
      .set('Authorization', authHeader())

    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Photos GET error:', expect.any(Error))
  })
})

describe('s3KeyFromUrl — ключ из URL без WHATWG-парсера', () => {
  it('virtual-hosted URL: ключ после хоста бакета', () => {
    expect(s3KeyFromUrl('https://swiftmatch-test-bucket.s3.eu-central-1.amazonaws.com/uploads/7.jpg'))
      .toBe('uploads/7.jpg')
  })

  it('path-style URL: сегмент бакета в пути отбрасывается', () => {
    expect(s3KeyFromUrl('http://127.0.0.1:19001/swiftmatch-test-bucket/uploads/7.jpg'))
      .toBe('uploads/7.jpg')
  })

  it('path-style с IP и не-бакетным первым сегментом отдаёт путь как есть', () => {
    expect(s3KeyFromUrl('http://127.0.0.1:19001/uploads/7.jpg', 'other-bucket'))
      .toBe('uploads/7.jpg')
  })

  it('без бакета (пустой аргумент) ключ берётся из пути', () => {
    expect(s3KeyFromUrl('https://cdn.example.com/uploads/7.jpg', ''))
      .toBe('uploads/7.jpg')
  })

  it('относительный /uploads/ приводится к ключу бакета', () => {
    expect(s3KeyFromUrl('/uploads/7.jpg')).toBe('uploads/7.jpg')
  })

  it('URL без пути после хоста не бросает Invalid URL', () => {
    expect(s3KeyFromUrl('http://bucket.127.0.0.1:19001')).toBe('')
  })
})
