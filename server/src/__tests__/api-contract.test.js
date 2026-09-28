// Этап 13 (P0 #3, аудиты qwen #3 / дипсик #3): контрактные тесты.
//
// Две половины, обе про дрейф, который молчал:
//
// 1) Документация против кода. Swagger собирается из JSDoc-аннотаций внутри
//    роутов, поэтому аннотация может разойтись с реальным кодом — и разойтись
//    так, что Swagger UI покажет «вход не нужен» там, где без токена 401.
//    Тест строит спеку из того же модуля, что отдаётся на /api-docs.json, и
//    сверяет её с роутами, восстановленными из исходников (путь + middleware).
// 2) Форма ответов, на которую завязан фронт. Единого конверта в проекте нет и
//    не вводится: часть list-эндпоинтов отдаёт голый массив, часть — объект.
//    Тест фиксирует фактическую форму ключами, чтобы переименование ключа
//    ломало сборку, а не продакшен.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import jwt from 'jsonwebtoken'

vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
})

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }))
vi.mock('../ws.js', () => ({ getIO: vi.fn(() => null) }))
vi.mock('../banned-words.js', () => ({
  getBannedWords: vi.fn(() => []),
  containsBannedWord: vi.fn(() => false),
}))
vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import pool from '../db.js'
import { swaggerSpec } from '../swagger.js'
import socialRoutes from '../routes/social.js'
import hangoutsRoutes from '../routes/hangouts.js'
import partnersRoutes from '../routes/partners.js'
import notificationsRoutes from '../routes/notifications.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(HERE, '..')
const ROUTES_DIR = path.join(SRC, 'routes')
const METHODS = ['get', 'post', 'put', 'patch', 'delete']

// ─── 1. Документация против кода ───────────────────────────────────────────

function readSpecOperations() {
  const ops = []
  for (const [p, item] of Object.entries(swaggerSpec.paths || {})) {
    for (const method of METHODS) {
      if (item[method]) ops.push({ path: p, method, op: item[method] })
    }
  }
  return ops
}

function listRouteFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) listRouteFiles(full, out)
    else if (entry.name.endsWith('.js')) out.push(full)
  }
  return out
}

function readRealRoutes() {
  const indexSrc = fs.readFileSync(path.join(SRC, 'index.js'), 'utf8')
  const imports = new Map()
  for (const m of indexSrc.matchAll(/import\s+(\w+)\s+from\s+'\.\/routes\/([^']+)'/g)) {
    imports.set(m[1], path.normalize(path.join('routes', m[2])))
  }
  const prefixes = new Map()
  for (const m of indexSrc.matchAll(/app\.use\(\s*'([^']*)'\s*,\s*(\w+)\s*\)/g)) {
    prefixes.set(m[2], m[1])
  }

  const routes = []
  const add = (method, rawPath, file, line, chain, behindAdminGate) => {
    const hard = /(^|[\s,(])auth([\s,)]|$)/.test(chain)
    const optional = /\boptionalAuth\b/.test(chain)
    const admin = /\badminAuth\b/.test(chain)
    routes.push({
      method,
      path: rawPath.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
      file,
      line,
      optional,
      requiresToken: admin || hard || behindAdminGate,
    })
  }

  for (const file of listRouteFiles(ROUTES_DIR)) {
    const code = fs.readFileSync(file, 'utf8')
    const rel = path.normalize(path.relative(SRC, file))
    let prefix = ''
    for (const [name, imported] of imports) {
      if (imported === rel) prefix = prefixes.get(name) ?? ''
    }
    for (const m of code.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)) {
      const tail = code.slice(m.index, m.index + 400)
      const handlerAt = tail.indexOf('(req')
      const chain = tail.slice(0, handlerAt > 0 ? handlerAt : 240)
      add(m[1], prefix + m[2], path.relative(SRC, file).replace(/\\/g, '/'),
        code.slice(0, m.index).split('\n').length, chain, prefix === '/api/admin')
    }
  }

  // Роутов, объявленных прямо в index.js, ровно несколько (login в частности
  // живёт там, а не в auth.js) — без них документация выглядит «осиротевшей».
  for (const m of indexSrc.matchAll(/app\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)) {
    const tail = indexSrc.slice(m.index, m.index + 300)
    const handlerAt = tail.indexOf('(req')
    add(m[1], m[2], 'index.js', indexSrc.slice(0, m.index).split('\n').length,
      tail.slice(0, handlerAt > 0 ? handlerAt : 200), m[2].startsWith('/api/admin'))
  }

  return routes
}

const documented = readSpecOperations()
const realRoutes = readRealRoutes()
const norm = (p) => p.replace(/\/$/, '') || '/'
const FRONT_DIR = path.resolve(SRC, '..', '..', 'src')

function listFrontFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'test') continue
      listFrontFiles(full, out)
    } else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

// Фронт собирает URL строкой, поэтому опечатку в пути компилятор не видит:
// 404 превращается в пустой массив, и панель выплат годами показывала «нет
// данных» вместо ошибки. Сверяем литералы с реальными роутами.
function stripComments(code) {
  // Комментарии затираются пробелами, а не вырезаются: длины строк сохраняются,
  // и номера строк в отчёте остаются настоящими.
  return code
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, keep) => keep + ' '.repeat(m.length - keep.length))
}

function readFrontApiCalls() {
  const calls = []
  for (const file of listFrontFiles(FRONT_DIR)) {
    const code = stripComments(fs.readFileSync(file, 'utf8'))
    const rel = path.relative(FRONT_DIR, file).replace(/\\/g, '/')
    for (const m of code.matchAll(/['"`](\/api\/[A-Za-z0-9_\-/{}$.]*)['"`]/g)) {
      if (m[1].includes('${')) continue
      calls.push({ file: rel, line: code.slice(0, m.index).split('\n').length, url: m[1].split('?')[0] })
    }
  }
  return calls
}

function pathMatches(url, serverPath) {
  // Строгое равенство, а не «параметр совпадает с чем угодно»: иначе
  // '/api/admin/partners/payouts' «находился» бы в PUT /{id} и баг проходил.
  return norm(url) === norm(serverPath)
}

function declaredHardSecurity(op) {
  const sec = op.security
  if (!Array.isArray(sec) || sec.length === 0) return false
  // [- bearerAuth: [], {}] = «токен желателен, но не обязателен»
  return !(sec.length === 2 && Object.keys(sec[1]).length === 0)
}

function declaredOptionalSecurity(op) {
  const sec = op.security
  return Array.isArray(sec) && sec.length === 2 && sec[0]?.bearerAuth !== undefined && Object.keys(sec[1]).length === 0
}

function findReal(method, docPath) {
  return realRoutes.find((r) => r.method === method && norm(r.path) === norm(docPath))
}

describe('Swagger: авторизация в документации совпадает с кодом', () => {
  it('каждая задокументированная операция, которой нужен токен, объявляет security', () => {
    const drift = documented
      .map((d) => ({ d, r: findReal(d.method, d.path) }))
      .filter(({ d, r }) => r && r.requiresToken && !declaredHardSecurity(d.op) && !declaredOptionalSecurity(d.op))
      .map(({ d, r }) => `${d.method.toUpperCase()} ${d.path} — код требует токен (${r.file}:${r.line}), в спеке security нет`)

    expect(drift).toEqual([])
  })

  it('ни одна операция не обещает защиты, которой в коде нет', () => {
    const lying = documented
      .map((d) => ({ d, r: findReal(d.method, d.path) }))
      .filter(({ d, r }) => r && declaredHardSecurity(d.op) && !r.requiresToken)
      .map(({ d, r }) => `${d.method.toUpperCase()} ${d.path} — спек требует токен, код пускает без него (${r.file}:${r.line})`)

    expect(lying).toEqual([])
  })

  it('optionalAuth в коде описан мягкой формой «токен или аноним»', () => {
    const drift = documented
      .map((d) => ({ d, r: findReal(d.method, d.path) }))
      .filter(({ d, r }) => r?.optional && !declaredOptionalSecurity(d.op))
      .map(({ d, r }) => `${d.method.toUpperCase()} ${d.path} — optionalAuth (${r.file}:${r.line}), а спек не говорит, что аноним допустим`)

    expect(drift).toEqual([])
  })

  it('каждый задокументированный путь и метод существует в коде', () => {
    const ghosts = documented
      .filter((d) => !findReal(d.method, d.path))
      .map((d) => `${d.method.toUpperCase()} ${d.path}`)

    expect(ghosts).toEqual([])
  })

  it('покрытие документацией не сжимается молча', () => {
    // 47 операций на момент этапа 13 из 208 роутов. Полное покрытие — отдельная
    // задача; здесь фиксируется нижняя граница, чтобы документацию не выпилили
    // по ходу других правок.
    expect(documented.length).toBeGreaterThanOrEqual(47)
    expect(swaggerSpec.components?.securitySchemes?.bearerAuth).toBeTruthy()
  })
})

describe('фронт не зовёт маршрутов, которых нет на сервере', () => {
  const serverPaths = [...new Set(realRoutes.map((r) => r.path))]

  it('каждый /api-литерал в src/ соответствует роуту', () => {
    const broken = readFrontApiCalls()
      .filter((c) => !serverPaths.some((sp) => pathMatches(c.url, sp)))
      // Литерал-база ('/api/profile', '/api/') сам маршрутом не является, но
      // собирается с '${BASE}/...' — такие пропускаем, если есть продолжение.
      .filter((c) => !serverPaths.some((sp) => norm(sp).startsWith(norm(c.url) + '/')))
      .map((c) => `${c.file}:${c.line} — ${c.url}`)

    expect(broken).toEqual([])
  })
})

// ─── 2. Форма ответов, на которую завязан фронт ─────────────────────────────

const JWT_SECRET = process.env.JWT_SECRET
const authHeader = `Bearer ${jwt.sign({ userId: 1, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })}`

const ROW = { id: 7, title: 'Row', display_name: 'Anna' }

function shapeMock(sql) {
  const s = String(sql).replace(/\s+/g, ' ')
  if (s.includes('COUNT(*) AS total')) return [[{ total: 1 }], []]
  if (s.includes('COUNT(*) AS unread')) return [[{ unread: 2 }], []]
  return [[ROW], []]
}

function createApp() {
  const app = express()
  app.use(express.json())
  app.use(socialRoutes)
  app.use(hangoutsRoutes)
  app.use(partnersRoutes)
  app.use(notificationsRoutes)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockImplementation(async (sql) => shapeMock(sql))
})

describe('контракт list-ответов', () => {
  it('GET /api/chats отдаёт голый массив (chats.tsx ждёт именно массив)', async () => {
    const res = await request(createApp()).get('/api/chats').set('Authorization', authHeader)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('GET /api/matches отдаёт голый массив', async () => {
    const res = await request(createApp()).get('/api/matches').set('Authorization', authHeader)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('GET /api/users/search отдаёт голый массив, а не { users, total }', async () => {
    const res = await request(createApp()).get('/api/users/search').set('Authorization', authHeader)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('GET /api/hangouts отдаёт ровно { items, total } (hangouts.tsx читает items)', async () => {
    const res = await request(createApp()).get('/api/hangouts').set('Authorization', authHeader)
    expect(res.status).toBe(200)
    expect(Object.keys(res.body).sort()).toEqual(['items', 'total'])
    expect(Array.isArray(res.body.items)).toBe(true)
  })

  it('GET /api/partners/offers отдаёт голый массив (useApi<PartnerOffer[]>)', async () => {
    const res = await request(createApp()).get('/api/partners/offers').set('Authorization', authHeader)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('GET /api/notifications отдаёт ровно { items, unread } (app-header читает оба)', async () => {
    const res = await request(createApp()).get('/api/notifications').set('Authorization', authHeader)
    expect(res.status).toBe(200)
    expect(Object.keys(res.body).sort()).toEqual(['items', 'unread'])
    expect(res.body.unread).toBe(2)
  })
})

describe('контракт ошибок', () => {
  it('401 — плоский { message } без конверта { error: { code } }', async () => {
    const res = await request(createApp()).get('/api/matches')
    expect(res.status).toBe(401)
    expect(Object.keys(res.body)).toEqual(['message'])
    expect(typeof res.body.message).toBe('string')
    expect(res.body.error).toBeUndefined()
    expect(res.body.code).toBeUndefined()
  })

  it('успешный ответ не тащит поле error (конверта в проекте нет)', async () => {
    const res = await request(createApp()).get('/api/hangouts').set('Authorization', authHeader)
    expect(res.body.error).toBeUndefined()
  })
})
