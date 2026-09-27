vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import jwt from 'jsonwebtoken'
import { parseRadiusKm, RADIUS_DEFAULT_KM, RADIUS_MIN_KM, RADIUS_MAX_KM } from '../geo.js'

vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
    getConnection: vi.fn(),
  },
}))

vi.mock('../ws.js', () => ({
  getIO: vi.fn(() => ({
    to: vi.fn(() => ({ emit: vi.fn() })),
  })),
}))

vi.mock('../banned-words.js', () => ({
  getBannedWords: vi.fn(async () => []),
  containsBannedWord: vi.fn(() => false),
}))

vi.mock('./push.js', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  sendPushToUser: vi.fn(async () => {}),
  sendPushToAll: vi.fn(),
}))

vi.mock('./experiments.js', () => ({
  trackEvent: vi.fn(async () => {}),
}))

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import pool from '../db.js'
import socialRoutes from '../routes/social.js'
import hangoutsRoutes from '../routes/hangouts.js'
import partnerRoutes from '../routes/partners.js'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

function createApp(router) {
  const app = express()
  app.use(express.json())
  app.use(router)
  return app
}

function authToken(userId = 1) {
  return jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('parseRadiusKm: клампинг радиуса (P1 #7)', () => {
  it('корректное значение в диапазоне проходит без изменений', () => {
    expect(parseRadiusKm('5')).toBe(5)
    expect(parseRadiusKm(25)).toBe(25)
    expect(parseRadiusKm('499.5')).toBe(499.5)
  })

  it('не задан — null, вызывающий решает сам (без фильтра)', () => {
    expect(parseRadiusKm(undefined)).toBeNull()
    expect(parseRadiusKm(null)).toBeNull()
    expect(parseRadiusKm('')).toBeNull()
  })

  it('мусорный ввод даёт дефолт, а не NaN в SQL', () => {
    expect(parseRadiusKm('abc')).toBe(RADIUS_DEFAULT_KM)
    expect(parseRadiusKm('NaN')).toBe(RADIUS_DEFAULT_KM)
    expect(parseRadiusKm('Infinity')).toBe(RADIUS_DEFAULT_KM)
    expect(parseRadiusKm('1e400')).toBe(RADIUS_DEFAULT_KM)
    expect(parseRadiusKm({})).toBe(RADIUS_DEFAULT_KM)
  })

  it('ноль и отрицательные дают дефолт, а не пустую выдачу', () => {
    expect(parseRadiusKm(0)).toBe(RADIUS_DEFAULT_KM)
    expect(parseRadiusKm('0')).toBe(RADIUS_DEFAULT_KM)
    expect(parseRadiusKm(-5)).toBe(RADIUS_DEFAULT_KM)
    expect(parseRadiusKm('-0.5')).toBe(RADIUS_DEFAULT_KM)
  })

  it('верхняя граница 500 км', () => {
    expect(parseRadiusKm(10_000_000)).toBe(RADIUS_MAX_KM)
    expect(parseRadiusKm('99999999')).toBe(RADIUS_MAX_KM)
    expect(parseRadiusKm(500)).toBe(RADIUS_MAX_KM)
  })

  it('нижняя граница 1 км', () => {
    expect(parseRadiusKm(0.0001)).toBe(RADIUS_MIN_KM)
    expect(parseRadiusKm(1)).toBe(RADIUS_MIN_KM)
  })
})

describe('GET /api/users/search: radius в SQL', () => {
  function mockSearch() {
    pool.query
      .mockResolvedValueOnce([[{}], []])
      .mockResolvedValueOnce([[], []])
  }

  async function searchWith(query) {
    mockSearch()
    const app = createApp(socialRoutes)
    const res = await request(app)
      .get(`/api/users/search?lat=55.75&lng=37.61${query}`)
      .set('Authorization', `Bearer ${authToken(7)}`)
    expect(res.status).toBe(200)
    const [sql, params] = pool.query.mock.calls[1]
    return { sql, params }
  }

  it('радиус 10000000 км клампится до 500 км (500000 м)', async () => {
    const { params } = await searchWith('&radius=10000000')
    expect(params[params.length - 1]).toBe(RADIUS_MAX_KM * 1000)
  })

  it('отрицательный радиус даёт дефолт 50 км, а не пустую выдачу', async () => {
    const { params } = await searchWith('&radius=-100')
    expect(params[params.length - 1]).toBe(RADIUS_DEFAULT_KM * 1000)
  })

  it('нечисловой радиус даёт дефолт 50 км, а не NaN', async () => {
    const { params } = await searchWith('&radius=abc')
    expect(params[params.length - 1]).toBe(RADIUS_DEFAULT_KM * 1000)
    expect(Number.isNaN(params[params.length - 1])).toBe(false)
  })

  it('без радиуса — дефолт 50 км', async () => {
    const { params } = await searchWith('')
    expect(params[params.length - 1]).toBe(RADIUS_DEFAULT_KM * 1000)
  })

  it('корректный радиус доезжает до SQL без искажений', async () => {
    const { params } = await searchWith('&radius=7')
    expect(params[params.length - 1]).toBe(7000)
  })
})

describe('GET /api/hangouts: radius в SQL', () => {
  function mockFeed() {
    pool.query
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ total: 0 }], []])
  }

  it('радиус 10000000 км клампится до 500 км', async () => {
    mockFeed()
    const res = await request(createApp(hangoutsRoutes)).get('/api/hangouts?lat=55.75&lng=37.61&radius=10000000')
    expect(res.status).toBe(200)
    expect(pool.query.mock.calls[0][1]).toContain(RADIUS_MAX_KM)
    expect(pool.query.mock.calls[1][1]).toContain(RADIUS_MAX_KM)
  })

  it('мусорный радиус даёт дефолт 50 км в ленте и в счётчике', async () => {
    mockFeed()
    await request(createApp(hangoutsRoutes)).get('/api/hangouts?lat=55.75&lng=37.61&radius=abc')
    expect(pool.query.mock.calls[0][1]).toContain(RADIUS_DEFAULT_KM)
    expect(pool.query.mock.calls[1][1]).toContain(RADIUS_DEFAULT_KM)
  })
})

describe('GET /api/partners/offers: radius в SQL', () => {
  async function offers(query) {
    pool.query.mockResolvedValueOnce([[], []])
    const app = createApp(partnerRoutes)
    const res = await request(app)
      .get(`/api/partners/offers?lat=59.93&lng=30.33${query}`)
      .set('Authorization', `Bearer ${authToken(2)}`)
    expect(res.status).toBe(200)
    return pool.query.mock.calls[0]
  }

  it('радиус 10000000 км клампится до 500 км', async () => {
    const [, params] = await offers('&radius=10000000')
    expect(params).toContain(RADIUS_MAX_KM * 1000)
  })

  it('radius=0 больше не превращается в фильтр в 0 метров', async () => {
    const [sql, params] = await offers('&radius=0')
    expect(sql).toContain('HAVING distance_m < ?')
    expect(params).toContain(RADIUS_DEFAULT_KM * 1000)
    expect(params).not.toContain(0)
  })

  it('без радиуса фильтр по расстоянию не добавляется (прежнее поведение сохранено)', async () => {
    const [sql, params] = await offers('')
    expect(sql).not.toContain('HAVING')
    expect(params).toEqual([30.33, 59.93])
  })
})

describe('guard: HAVING не должен попадать в список WHERE-условий', () => {
  const routesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../routes')

  function collectJsFiles(dir) {
    const out = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) out.push(...collectJsFiles(full))
      else if (entry.name.endsWith('.js')) out.push(full)
    }
    return out
  }

  it('в routes нет ни одного push(...HAVING...) в where-списке', () => {
    const offenders = []
    for (const file of collectJsFiles(routesDir)) {
      const source = fs.readFileSync(file, 'utf8')
      source.split(/\r?\n/).forEach((line, i) => {
        if (/push\(\s*['"`]HAVING/.test(line)) offenders.push(`${path.relative(routesDir, file)}:${i + 1}`)
      })
    }
    expect(offenders).toEqual([])
  })

  it('geo-фильтр партнёров стоит после WHERE, а не внутри него', async () => {
    pool.query.mockResolvedValueOnce([[], []])
    const app = createApp(partnerRoutes)
    await request(app)
      .get('/api/partners/offers?lat=59.93&lng=30.33&radius=5')
      .set('Authorization', `Bearer ${authToken(2)}`)
    const [sql] = pool.query.mock.calls[0]
    expect(sql).toContain('HAVING distance_m < ?')
    expect(sql).not.toMatch(/AND HAVING/)
    expect(sql.indexOf('HAVING')).toBeGreaterThan(sql.indexOf('valid_to'))
  })
})
