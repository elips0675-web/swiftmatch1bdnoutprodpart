/**
 * Тесты гейта `scripts/swagger-coverage-audit.mjs` (этап 45, N7).
 *
 * Гейт парсит `@openapi`-блоки из исходников роутов и сверяет их с реальными
 * router- и app-объявлениями. Фикстуры — temp-каталог с мини-репо: index.js
 * (импорты + app.use-префиксы), routes/*.js и @openapi-аннотации. Реальный
 * репозиторий проверяется отдельно: гейт, который красный на текущем коде,
 * бесполезен, а гейт, который зелёный по построению, — тем более.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  audit,
  parseOpenApiOperations,
  readRealRoutes,
} from './swagger-coverage-audit.mjs'

const REPO_ROOT = path.resolve(import.meta.dirname, '..')

let dir = null

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swagger-gate-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
  dir = null
})

const INDEX = `import express from 'express'
import authRoutes from './routes/auth.js'
import adminPartners from './routes/admin/partners.js'
import eventsRoutes from './routes/events.js'

const app = express()
app.use(authRoutes)
app.use('/api/admin', adminPartners)
app.use(eventsRoutes)
app.get('/api/admin/me', (req, res) => res.json({ ok: true }))
export default app
`

function fixture(files = {}) {
  fs.mkdirSync(path.join(dir, 'server', 'src', 'routes', 'admin'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'server/src/index.js'), INDEX)
  const defaults = {
    'server/src/routes/auth.js': `/**
 * @openapi
 * /api/auth/login:
 *   post:
 */
router.post('/api/auth/login', (req, res) => {})
`,
    'server/src/routes/admin/partners.js': `/**
 * @openapi
 * /api/admin/partners:
 *   get:
 * /api/admin/partners:
 *   post:
 * /api/admin/partners/{id}:
 *   delete:
 */
router.get('/partners', (req, res) => {})
router.post('/partners', (req, res) => {})
router.delete('/partners/:id', (req, res) => {})
`,
    'server/src/routes/events.js': `/**
 * @openapi
 * /api/events:
 *   get:
 */
router.get('/api/events', (req, res) => {})
`,
  }
  fs.writeFileSync(path.join(dir, 'server/src/routes/auth.js'), defaults['server/src/routes/auth.js'])
  fs.writeFileSync(path.join(dir, 'server/src/routes/admin/partners.js'), defaults['server/src/routes/admin/partners.js'])
  fs.writeFileSync(path.join(dir, 'server/src/routes/events.js'), defaults['server/src/routes/events.js'])
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(dir, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, text)
  }
  return dir
}

describe('parseOpenApiOperations', () => {
  it('извлекает операции из одного блока с несколькими путями и методами', () => {
    const src = `/**
 * @openapi
 * /api/foo:
 *   get:
 *   post:
 * /api/foo/{id}:
 *   delete:
 */
`
    expect(parseOpenApiOperations(src)).toEqual([
      { path: '/api/foo', method: 'get' },
      { path: '/api/foo', method: 'post' },
      { path: '/api/foo/{id}', method: 'delete' },
    ])
  })

  it('игнорирует YAML-ключи не-методов и не трогает блоки без @openapi', () => {
    const src = `/**
 * @openapi
 * /api/bar:
 *   get:
 *     tags: [X]
 *     responses:
 *       200: { description: ok }
 * not-a-path:
 *   get:
 */
/**
 * обычный JSDoc, не openapi
 * /api/ignored:
 *   post:
 */
`
    const ops = parseOpenApiOperations(src)
    expect(ops).toEqual([{ path: '/api/bar', method: 'get' }])
  })

  it('не путает summary/description c методами и ловит метод до первого пути? нет — метод без пути игнорируется', () => {
    const src = `/**
 * @openapi
 *   get:
 * /api/baz:
 *   put:
 */
`
    expect(parseOpenApiOperations(src)).toEqual([{ path: '/api/baz', method: 'put' }])
  })
})

describe('readRealRoutes', () => {
  it('собирает router.* с префиксом app.use и app.* из index.js, нормализуя :id → {id}', () => {
    const routes = readRealRoutes(fixture())
    const keys = routes.map((r) => `${r.method} ${r.path}`).sort()
    expect(keys).toEqual([
      'delete /api/admin/partners/{id}',
      'get /api/admin/me',
      'get /api/admin/partners',
      'get /api/events',
      'post /api/admin/partners',
      'post /api/auth/login',
    ])
  })
})

describe('audit', () => {
  it('зелёный, когда документация совпадает с кодом', () => {
    const { problems, facts } = audit(fixture(), { baselineOps: 5 })
    expect(problems).toEqual([])
    expect(facts.documentedOps).toBe(5)
    expect(facts.documentedPaths).toBe(4)
    expect(facts.realRoutes).toBe(6)
  })

  it('документированный путь без кода — находка (Swagger показывает 404)', () => {
    const root = fixture({
      'server/src/routes/extra.js': `/**
 * @openapi
 * /api/ghost:
 *   get:
 */
router.get('/api/real', (req, res) => {})
`,
    })
    const { problems } = audit(root, { baselineOps: 5 })
    expect(problems.some((p) => p.includes('/api/ghost') && p.includes('не существует в коде'))).toBe(true)
  })

  it('мёртвая операция: путь есть в коде, а метода нет', () => {
    const root = fixture({
      'server/src/routes/extra.js': `/**
 * @openapi
 * /api/events:
 *   delete:
 */
`,
    })
    const { problems } = audit(root, { baselineOps: 5 })
    expect(problems.some((p) => p.includes('мёртвая операция') && p.includes('DELETE /api/events'))).toBe(true)
  })

  it('базовая линия: задокументировано меньше минимума — находка', () => {
    // В фикстуре 5 операций, а базовая линия репозитория 47 (этап 13) —
    // гейт обязан сообщить о сжатии документации.
    const { problems } = audit(fixture())
    expect(problems.some((p) => p.includes('операций в Swagger-документации стало 5') && p.includes('минимум 47'))).toBe(true)
  })
})

describe('audit на настоящем репозитории', () => {
  it('документация не разошлась с кодом, базовая линия держится', () => {
    const { problems, facts } = audit(REPO_ROOT)
    expect(problems).toEqual([])
    expect(facts.documentedOps).toBeGreaterThanOrEqual(47)
    expect(facts.realRoutes).toBeGreaterThan(200)
  })
})