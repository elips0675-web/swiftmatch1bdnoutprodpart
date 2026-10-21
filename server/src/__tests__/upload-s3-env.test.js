/**
 * Непокрытые ветки routes/upload.js в S3-режиме (Stage 154): регион по
 * умолчанию без AWS_REGION, непустой S3_ENDPOINT в конфиге клиента и
 * уборка временной папки, ошибка которой не должна ронять ответ.
 */
vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
  process.env.S3_BUCKET = 'swiftmatch-test-bucket'
  process.env.AWS_ACCESS_KEY_ID = 'AKIATEST'
  process.env.AWS_SECRET_ACCESS_KEY = 'secret'
  delete process.env.AWS_REGION
  process.env.S3_ENDPOINT = 'http://127.0.0.1:19001'
})

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'
import fs from 'fs'

const h = vi.hoisted(() => ({
  sent: [],
  s3Configs: [],
}))

class S3Client {
  constructor(config) {
    this.config = config
    h.s3Configs.push(config)
  }

  send(cmd) {
    h.sent.push(cmd)
    if (cmd.__type === 'Get') return Promise.resolve({ Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } })
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
  const factory = () => ({ __s3Storage: true })
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
        location: 'http://127.0.0.1:19001/swiftmatch-test-bucket/uploads/1699999999999-123.jpg',
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
  pool.query.mockResolvedValue([{ insertId: 77 }, []])
})

afterAll(() => {
  vi.restoreAllMocks()
})

describe('S3-режим: конфиг клиента без AWS_REGION и с S3_ENDPOINT', () => {
  const app = createApp()

  it('регион берётся из настроек по умолчанию, endpoint попадает в конфиг клиента', async () => {
    const res = await postPhoto(app)

    expect(res.status).toBe(200)
    expect(h.s3Configs.length).toBe(1)
    expect(h.s3Configs[0].region).toBe('us-east-1')
    expect(h.s3Configs[0].endpoint).toBe('http://127.0.0.1:19001')
    expect(h.s3Configs[0].credentials).toMatchObject({ accessKeyId: 'AKIATEST', secretAccessKey: 'secret' })
  })
})

describe('S3-режим: уборка временной папки', () => {
  const app = createApp()

  it('ошибка удаления временной папки не роняет ответ', async () => {
    const rmSpy = vi.spyOn(fs.promises, 'rm').mockRejectedValueOnce(new Error('rm boom'))
    const res = await postPhoto(app)

    expect(res.status).toBe(200)
    expect(rmSpy).toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalledWith('Upload error:', expect.anything())
    rmSpy.mockRestore()
  })
})
