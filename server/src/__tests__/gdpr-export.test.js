import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('../middleware.js', () => ({
  auth: (req, _res, next) => {
    req.userId = 1
    next()
  },
}))

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }))

import pool from '../db.js'
import gdprRouter from '../routes/gdpr.js'
import {
  buildExportPayload,
  buildExportArchive,
  resolveLocalPhotoPath,
  PHOTOS_PREFIX,
  EXPORT_README,
} from '../gdpr-export.js'

function readEntries(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  expect(eocd).toBeGreaterThanOrEqual(0)
  const count = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16)
  const entries = []
  for (let i = 0; i < count; i++) {
    const size = buf.readUInt32LE(off + 24)
    const nameLen = buf.readUInt16LE(off + 28)
    const extraLen = buf.readUInt16LE(off + 30)
    const commentLen = buf.readUInt16LE(off + 32)
    const localOff = buf.readUInt32LE(off + 42)
    const localNameLen = buf.readUInt16LE(localOff + 26)
    const localExtraLen = buf.readUInt16LE(localOff + 28)
    const dataStart = localOff + 30 + localNameLen + localExtraLen
    entries.push({
      name: buf.subarray(off + 46, off + 46 + nameLen).toString('utf8'),
      data: buf.subarray(dataStart, dataStart + size),
    })
    off += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

function mockDbQueries(rows = {}) {
  pool.query.mockImplementation(async (sql) => {
    if (/FROM users\b/.test(sql)) return [rows.users ?? []]
    if (/FROM user_profiles/.test(sql)) return [rows.user_profiles ?? []]
    if (/FROM user_photos/.test(sql)) return [rows.user_photos ?? []]
    if (/FROM likes/.test(sql)) return [rows.likes ?? []]
    if (/FROM matches/.test(sql)) return [rows.matches ?? []]
    if (/FROM chats/.test(sql)) return [rows.chats ?? []]
    if (/FROM messages/.test(sql)) return [rows.messages ?? []]
    if (/FROM subscriptions/.test(sql)) return [rows.subscriptions ?? []]
    if (/FROM consent_log/.test(sql)) return [rows.consent_log ?? []]
    if (/FROM activity_log/.test(sql)) return [rows.activity_log ?? []]
    return [[]]
  })
}

const baseRows = {
  users: [{ id: 1, email: 'user@mail.ru', is_active: 1, created_at: '2026-01-01T00:00:00.000Z' }],
  user_profiles: [{ id: 1, display_name: 'Ann', birth_date: new Date('1995-03-04T00:00:00Z') }],
  user_photos: [{ id: 7, url: '/uploads/7_a.jpg', sort_order: 0, is_avatar: 1, created_at: '2026-01-02T00:00:00.000Z' }],
  likes: [{ id: 1, from_user_id: 1, to_user_id: 2, type: 'like', created_at: '2026-01-03T00:00:00.000Z' }],
  matches: [{ id: 1, user1_id: 1, user2_id: 2, created_at: '2026-01-04T00:00:00.000Z' }],
  chats: [{ id: 3, created_at: '2026-01-05T00:00:00.000Z' }],
  messages: [{ id: 9, chat_id: 3, text: 'hi', created_at: '2026-01-06T00:00:00.000Z' }],
  subscriptions: [],
  consent_log: [{ id: 5, consent_type: 'data_processing', granted: 1, ip_address: '127.0.0.1', created_at: '2026-01-07T00:00:00.000Z' }],
  activity_log: [],
}

const createApp = () => {
  const app = express()
  app.use(express.json())
  app.use(gdprRouter)
  return app
}

const app = createApp()

beforeEach(() => {
  vi.clearAllMocks()
})

describe('buildExportPayload', () => {
  it('returns the documented sections with a normalized birth date', async () => {
    mockDbQueries(baseRows)
    const payload = await buildExportPayload(pool, 1, { now: () => new Date('2026-10-13T00:00:00.000Z') })

    expect(Object.keys(payload)).toEqual([
      'exported_at', 'user', 'profile', 'photos', 'likes', 'matches',
      'chats', 'messages', 'subscriptions', 'consents', 'activity',
    ])
    expect(payload.exported_at).toBe('2026-10-13T00:00:00.000Z')
    expect(payload.user).toEqual({ id: 1, email: 'user@mail.ru', registered_at: '2026-01-01T00:00:00.000Z' })
    expect(payload.profile.birth_date).toBe('1995-03-04')
    expect(payload.consents).toHaveLength(1)
    expect(payload.photos[0].url).toBe('/uploads/7_a.jpg')
  })

  it('returns null when the user does not exist', async () => {
    mockDbQueries({ users: [] })
    const payload = await buildExportPayload(pool, 1, { now: () => new Date('2026-10-13T00:00:00.000Z') })
    expect(payload).toBe(null)
  })
})

describe('resolveLocalPhotoPath', () => {
  const uploadsDir = join(tmpdir(), 'swiftmatch-uploads')

  it('resolves a local /uploads URL inside the uploads directory', () => {
    const full = resolveLocalPhotoPath('/uploads/7_a.jpg', uploadsDir)
    expect(full).toBe(join(uploadsDir, '7_a.jpg'))
  })

  it('rejects remote, nested and traversal URLs', () => {
    expect(resolveLocalPhotoPath('https://cdn.example.com/a.jpg', uploadsDir)).toBe(null)
    expect(resolveLocalPhotoPath(null, uploadsDir)).toBe(null)
    expect(resolveLocalPhotoPath('/uploads/', uploadsDir)).toBe(null)
    expect(resolveLocalPhotoPath('/uploads/../../secret.txt', uploadsDir)).toBe(null)
    expect(resolveLocalPhotoPath('/uploads/sub/dir/a.jpg', uploadsDir)).toBe(null)
  })
})

describe('buildExportArchive', () => {
  it('packs data.json, local photo bytes and README', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gdpr-export-'))
    writeFileSync(join(dir, '7_a.jpg'), Buffer.from([9, 8, 7]))
    mockDbQueries(baseRows)

    const archive = await buildExportArchive({
      db: pool,
      userId: 1,
      uploadsDir: dir,
      now: () => new Date('2026-10-13T00:00:00.000Z'),
    })

    expect(archive.filename).toBe('swiftmatch-data-2026-10-13T00-00-00-000Z.zip')
    const entries = readEntries(archive.buffer)
    expect(entries.map(e => e.name).sort()).toEqual(['README.txt', `${PHOTOS_PREFIX}7_7_a.jpg`, 'data.json'].sort())
    const photo = entries.find(e => e.name === `${PHOTOS_PREFIX}7_7_a.jpg`)
    expect(photo.data.equals(Buffer.from([9, 8, 7]))).toBe(true)
    const dataJson = JSON.parse(entries.find(e => e.name === 'data.json').data.toString('utf8'))
    expect(dataJson.user.email).toBe('user@mail.ru')
    expect(entries.find(e => e.name === 'README.txt').data.toString('utf8')).toBe(EXPORT_README)
  })

  it('keeps going when a listed photo file is missing on disk', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gdpr-export-missing-'))
    mockDbQueries(baseRows)

    const archive = await buildExportArchive({ db: pool, userId: 1, uploadsDir: dir, now: () => new Date('2026-10-13T00:00:00.000Z') })
    const names = readEntries(archive.buffer).map(e => e.name)
    expect(names).toContain('data.json')
    expect(names).not.toContain(`${PHOTOS_PREFIX}7_7_a.jpg`)
  })

  it('returns null when the user does not exist', async () => {
    mockDbQueries({ users: [] })
    expect(await buildExportArchive({ db: pool, userId: 1, uploadsDir: tmpdir(), now: () => new Date() })).toBe(null)
  })
})

describe('GET /api/data/export', () => {
  it('returns JSON by default (frontend/E2E contract)', async () => {
    mockDbQueries(baseRows)
    const res = await request(app).get('/api/data/export')

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.consents)).toBe(true)
    expect(res.body.user.email).toBe('user@mail.ru')
  })

  it('returns a ZIP archive for ?format=zip', async () => {
    mockDbQueries(baseRows)
    const res = await request(app)
      .get('/api/data/export?format=zip')
      .buffer(true)
      .parse((r, cb) => {
        const chunks = []
        r.on('data', c => chunks.push(c))
        r.on('end', () => cb(null, Buffer.concat(chunks)))
      })

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('application/zip')
    expect(res.headers['content-disposition']).toContain('attachment')
    expect(res.headers['content-disposition']).toContain('.zip')
    const buffer = res.body
    expect(buffer.subarray(0, 2).toString('ascii')).toBe('PK')
    expect(readEntries(buffer).map(e => e.name)).toContain('data.json')
  })

  it('returns 404 when the user is gone', async () => {
    mockDbQueries({ users: [] })
    const res = await request(app).get('/api/data/export')
    expect(res.status).toBe(404)
  })

  it('returns 500 when the database fails', async () => {
    pool.query.mockRejectedValue(new Error('boom'))
    const res = await request(app).get('/api/data/export')
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to export data')
  })

  it('Accept: application/zip тоже отдаёт архив (без ?format)', async () => {
    mockDbQueries(baseRows)
    const res = await request(app)
      .get('/api/data/export')
      .set('Accept', 'application/zip')
      .buffer(true)
      .parse((r, cb) => {
        const chunks = []
        r.on('data', (c) => chunks.push(c))
        r.on('end', () => cb(null, Buffer.concat(chunks)))
      })

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('application/zip')
    expect(res.body.subarray(0, 2).toString('ascii')).toBe('PK')
  })

  it('ZIP + отсутствующий пользователь → 404 (не 500)', async () => {
    mockDbQueries({ users: [] })
    const res = await request(app).get('/api/data/export?format=zip')
    expect(res.status).toBe(404)
    expect(res.body.message).toBe('User not found')
  })
})
