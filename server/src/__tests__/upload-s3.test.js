vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
  process.env.S3_BUCKET = 'swiftmatch-test'
  process.env.AWS_ACCESS_KEY_ID = 'test-key'
  process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key'
  process.env.AWS_REGION = 'us-east-1'
  process.env.S3_ENDPOINT = 'http://127.0.0.1:19001'
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'
import fs from 'fs'
import path from 'path'

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

const { sendMock, GetObjectCommandMock, PutObjectCommandMock, DeleteObjectCommandMock } = vi.hoisted(() => {
  const send = vi.fn(async () => ({}))
  return {
    sendMock: send,
    GetObjectCommandMock: vi.fn(function (input) { this.input = input; this.kind = 'Get' }),
    PutObjectCommandMock: vi.fn(function (input) { this.input = input; this.kind = 'Put' }),
    DeleteObjectCommandMock: vi.fn(function (input) { this.input = input; this.kind = 'Delete' }),
  }
})

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(function () { this.send = sendMock }),
  GetObjectCommand: GetObjectCommandMock,
  PutObjectCommand: PutObjectCommandMock,
  DeleteObjectCommand: DeleteObjectCommandMock,
}))

vi.mock('multer-s3', () => ({
  default: Object.assign(
    vi.fn(() => ({ s3: true })),
    { AUTO_CONTENT_TYPE: 'binary/octet-stream' },
  ),
}))

const { mockSingle } = vi.hoisted(() => {
  const single = vi.fn()
  return { mockSingle: single }
})

vi.mock('multer', () => ({
  default: Object.assign(() => ({ single: () => mockSingle }), { diskStorage: vi.fn(() => ({})) }),
}))

const { processImageMock } = vi.hoisted(() => ({ processImageMock: vi.fn() }))
vi.mock('../image-pipeline.js', () => ({
  processImage: processImageMock,
  getImageUrls: vi.fn((url) => ({ original: url, large: url + '_800x800.webp' })),
}))

const { moderateImageMock } = vi.hoisted(() => ({ moderateImageMock: vi.fn() }))
vi.mock('../ai-moderation.js', () => ({ moderateImage: moderateImageMock }))

import pool from '../db.js'
import logger from '../logger.js'
import { auditLog } from '../audit.js'
import { moderateImage } from '../ai-moderation.js'
import { processImage, getImageUrls } from '../image-pipeline.js'
import uploadRoutes, { s3KeyFromUrl } from '../routes/upload.js'
const JWT_SECRET = process.env.JWT_SECRET

const authHeader = (userId = 1) => 'Bearer ' + jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })

function createApp() {
  const app = express()
  app.use(express.json())
  app.use(uploadRoutes)
  return app
}

const app = createApp()

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NODE_ENV = 'test'
  delete process.env.PHOTO_MODERATION_MODE
  sendMock.mockImplementation(async (cmd) => {
    if (cmd && cmd.kind === 'Get') return { Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } }
    return {}
  })
  processImage.mockImplementation(async (filePath) => {
    const dir = path.dirname(filePath)
    const out = []
    for (const name of ['out_800x800.webp', 'out.avif']) {
      const p = path.join(dir, name)
      fs.writeFileSync(p, 'x')
      out.push({ path: p, format: name.endsWith('avif') ? 'avif' : 'webp' })
    }
    return out
  })
  moderateImage.mockResolvedValue({ safe: true, source: 'ai', reasons: [] })
})

function uploadWithFile(file = {}) {
  mockSingle.mockImplementationOnce((req, res, cb) => {
    req.file = {
      key: 'uploads/1700000000-123.jpg',
      location: 'http://swiftmatch-test.127.0.0.1:19001/uploads/1700000000-123.jpg',
      filename: '1700000000-123.jpg',
      ...file,
    }
    cb(null)
  })
  return request(app)
    .post('/api/upload')
    .set('Authorization', authHeader(3))
    .attach('photo', Buffer.from('x'), { filename: 'a.jpg', contentType: 'image/jpeg' })
}

describe('USE_S3: загрузка (S3-ветка)', () => {
  it('INSERT пишет S3 location как url, дальше качает оригинал и кладёт варианты', async () => {
    pool.query.mockResolvedValue([{ insertId: 55 }])
    const res = await uploadWithFile()
    expect(res.status).toBe(200)
    expect(res.body.url).toBe('http://swiftmatch-test.127.0.0.1:19001/uploads/1700000000-123.jpg')

    const insert = pool.query.mock.calls.find((c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO user_photos'))
    expect(insert[1][1]).toBe('http://swiftmatch-test.127.0.0.1:19001/uploads/1700000000-123.jpg')
  })

  it('S3-обработка падает: ошибка логируется, ответ всё равно 200 (фото уже вставлено)', async () => {
    pool.query.mockResolvedValue([{ insertId: 56 }])
    sendMock.mockRejectedValueOnce(new Error('s3 down'))
    const res = await uploadWithFile()
    expect(res.status).toBe(200)
    expect(logger.error).toHaveBeenCalledWith('S3 file process error:', expect.any(Error))
  })
})

describe('updateModeration: вердикт AI после INSERT (S3)', () => {
  it('safe=null / source=none → статус не трогается, только warn', async () => {
    pool.query.mockResolvedValue([{ insertId: 60 }])
    moderateImage.mockResolvedValueOnce({ safe: null, source: 'none', reasons: [] })
    const res = await uploadWithFile()
    expect(res.status).toBe(200)
    const upd = pool.query.mock.calls.find((c) => typeof c[0] === 'string' && c[0].includes("moderation_status = 'flagged'"))
    expect(upd).toBeUndefined()
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('left unmoderated'))
  })

  it('safe=false → flagged с причинами, аудит', async () => {
    pool.query.mockResolvedValue([{ insertId: 61 }])
    moderateImage.mockResolvedValueOnce({ safe: false, source: 'ai', reasons: ['nudity', 'violence'] })
    const res = await uploadWithFile()
    expect(res.status).toBe(200)
    const upd = pool.query.mock.calls.find((c) => typeof c[0] === 'string' && c[0].includes("moderation_status = 'flagged'"))
    expect(upd).toBeTruthy()
    expect(upd[1]).toEqual(['nudity, violence', 61])
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({
      tableName: 'user_photos',
      recordId: 61,
      action: 'update',
      newValues: { moderation_status: 'flagged', moderation_reason: 'nudity, violence' },
      userId: 3,
    }))
  })

  it('safe=true → approved без причины', async () => {
    pool.query.mockResolvedValue([{ insertId: 62 }])
    moderateImage.mockResolvedValueOnce({ safe: true, source: 'ai', reasons: [] })
    const res = await uploadWithFile()
    expect(res.status).toBe(200)
    const upd = pool.query.mock.calls.find((c) => typeof c[0] === 'string' && c[0].includes("moderation_status = 'approved'"))
    expect(upd).toBeTruthy()
    expect(upd[1]).toEqual([62])
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({
      tableName: 'user_photos',
      recordId: 62,
      action: 'update',
      newValues: { moderation_status: 'approved', moderation_reason: null },
    }))
  })

  it('пайплайн картинок падает, модерация ок → ошибка глотается, статус всё равно пишется', async () => {
    pool.query.mockResolvedValue([{ insertId: 63 }])
    processImage.mockRejectedValueOnce(new Error('sharp boom'))
    moderateImage.mockResolvedValueOnce({ safe: true, source: 'ai', reasons: [] })
    const res = await uploadWithFile()
    expect(res.status).toBe(200)
    expect(logger.error).toHaveBeenCalledWith('Image pipeline error:', expect.any(Error))
    const upd = pool.query.mock.calls.find((c) => typeof c[0] === 'string' && c[0].includes("moderation_status = 'approved'"))
    expect(upd).toBeTruthy()
  })

  it('модерация падает → ошибка глотается, INSERT уже сделан', async () => {
    pool.query.mockResolvedValue([{ insertId: 64 }])
    moderateImage.mockRejectedValueOnce(new Error('ai boom'))
    const res = await uploadWithFile()
    expect(res.status).toBe(200)
    expect(logger.error).toHaveBeenCalledWith('AI moderation error:', expect.any(Error))
  })
})

describe('DELETE /api/photos/:id (S3-ветка)', () => {
  it('удаляет оригинал и варианты через DeleteObjectCommand с ключами из s3KeyFromUrl', async () => {
    pool.query
      .mockResolvedValueOnce([[{ url: 'http://swiftmatch-test.127.0.0.1:19001/uploads/pic9.jpg' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
    const res = await request(app).delete('/api/photos/9').set('Authorization', authHeader(3))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })

    const deleteCalls = sendMock.mock.calls.filter((c) => c[0] && c[0].kind === 'Delete')
    expect(deleteCalls.length).toBe(2)
    expect(deleteCalls[0][0].input.Key).toBe('uploads/pic9.jpg')
    expect(deleteCalls[1][0].input.Key).toBe('uploads/pic9.jpg_800x800.webp')

    const del = pool.query.mock.calls.find((c) => typeof c[0] === 'string' && c[0].startsWith('DELETE FROM user_photos'))
    expect(del[1]).toEqual(['9', 3])
  })

  it('падение S3 → 500', async () => {
    pool.query.mockResolvedValueOnce([[{ url: 'http://swiftmatch-test.127.0.0.1:19001/uploads/pic9.jpg' }]])
    sendMock.mockRejectedValueOnce(new Error('s3 down'))
    const res = await request(app).delete('/api/photos/9').set('Authorization', authHeader(3))
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Delete failed')
  })
})

describe('s3KeyFromUrl: дополнительные ветки', () => {
  it('url без бакета в хосте и без ключа-бакета — ключ как есть', () => {
    expect(s3KeyFromUrl('https://cdn.example.com/other/x.jpg', 'swiftmatch-test')).toBe('other/x.jpg')
  })

  it('пустой bucket → path-style не срезает сегмент', () => {
    expect(s3KeyFromUrl('http://127.0.0.1:19001/b/uploads/x.jpg', '')).toBe('b/uploads/x.jpg')
  })

  it('url без пути после хоста → ключ пустой строкой', () => {
    expect(s3KeyFromUrl('http://example.com', 'swiftmatch-test')).toBe('')
  })
})

describe('fileFilter (S3-ветка модуля)', () => {
  it('getImageUrls вызывается с url из БД при удалении', async () => {
    pool.query
      .mockResolvedValueOnce([[{ url: '/uploads/z.jpg' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
    await request(app).delete('/api/photos/1').set('Authorization', authHeader(3))
    expect(getImageUrls).toHaveBeenCalledWith('/uploads/z.jpg')
  })
})
