/**
 * Тесты гейта `scripts/env-consistency-audit.mjs` (этап 45, N7).
 *
 * Все проверки идут на temp-фикстурах: гейт читает `server/src`, `src`,
 * `server/.env.example`, корневой `.env.example` и `docker-compose.yml`, а
 * трогать репозиторий из теста нельзя — иначе «зелёный» тест означал бы, что
 * тест сломал проект. Отдельно проверяется, что гейт зелёный на настоящем
 * репозитории: гейт, который красный на текущем коде, бесполезен, а гейт,
 * который зелёный по построению, — тем более.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  audit,
  extractImportMetaEnv,
  extractProcessEnv,
  parseComposeEnv,
  parseEnvExample,
} from './env-consistency-audit.mjs'

const REPO_ROOT = path.resolve(import.meta.dirname, '..')

const SERVER_EXAMPLE = [
  'PORT=3002',
  'JWT_SECRET=change-me',
  'DB_HOST=localhost',
  'DB_USER=root',
  'DB_PASSWORD=root',
  'DB_NAME=swiftmatch',
  'NODE_ENV=development',
  'CORS_ORIGIN=http://localhost:8081',
  '# CACHE_TTL=60',
  '# REDIS_URL=redis://localhost:6379',
  '',
].join('\n')

const ROOT_EXAMPLE = [
  'NODE_ENV=development',
  'PORT=3002',
  'DB_HOST=localhost',
  'CLIENT_URL=http://localhost:8081',
  'VITE_API_URL=/api',
  'VITE_WS_URL=ws://localhost:8080',
  '# VITE_SUPABASE_URL=https://xxx.supabase.co',
  '',
].join('\n')

const COMPOSE = [
  'services:',
  '  db:',
  '    image: mysql:8',
  '    environment:',
  '      MYSQL_ROOT_PASSWORD: root',
  '  app:',
  '    build:',
  '      context: .',
  '    env_file:',
  '      - .env',
  '    environment:',
  '      PORT: 3002',
  '      DB_HOST: db',
  '      DB_USER: root',
  '      DB_PASSWORD: root',
  '      DB_NAME: swiftmatch',
  '      JWT_SECRET: ${JWT_SECRET:-change-me}',
  '      NODE_ENV: production',
  '      CORS_ORIGIN: ${CORS_ORIGIN:-http://localhost}',
  '      REDIS_URL: redis://redis:6379',
  '    depends_on:',
  '      db:',
  '        condition: service_healthy',
  '  nginx:',
  '    image: nginx',
  '',
].join('\n')

let dir = null

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-gate-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
  dir = null
})

function fixture(files = {}) {
  fs.mkdirSync(path.join(dir, 'server', 'src'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'server/.env.example'), SERVER_EXAMPLE)
  fs.writeFileSync(path.join(dir, '.env.example'), ROOT_EXAMPLE)
  fs.writeFileSync(path.join(dir, 'docker-compose.yml'), COMPOSE)
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(dir, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, text)
  }
  return dir
}

describe('parseEnvExample', () => {
  it('берёт активные и закомментированные ключи', () => {
    const keys = parseEnvExample('# PORT=3002\nDB_HOST=localhost\n# comment without key\n')
    expect([...keys].sort()).toEqual(['DB_HOST', 'PORT'])
  })

  it('игнорирует строки без =', () => {
    expect(parseEnvExample('NODE_ENV=production\nplain text\n').size).toBe(1)
  })
})

describe('extractProcessEnv', () => {
  it('находит process.env.X и запоминает первую строку', () => {
    const src = "const a = process.env.PORT\nconst b = process.env['DB_HOST']\nprocess.env.PORT\n"
    const vars = extractProcessEnv(src)
    expect([...vars.keys()].sort()).toEqual(['DB_HOST', 'PORT'])
    expect(vars.get('PORT')).toBe(1)
    expect(vars.get('DB_HOST')).toBe(2)
  })

  it('не считает process.env внутри строки-литерала', () => {
    expect(extractProcessEnv("const s = 'process.env.NODE_ENV'\n").size).toBe(0)
  })
})

describe('extractImportMetaEnv', () => {
  it('находит import.meta.env.X вне встроенных Vite', () => {
    const src = "const u = import.meta.env.VITE_API_URL\nconst d = import.meta.env.DEV\n"
    const vars = extractImportMetaEnv(src)
    expect([...vars.keys()].sort()).toEqual(['VITE_API_URL'])
  })
})

describe('parseComposeEnv', () => {
  it('берёт только environment сервиса app, не db/nginx и не depends_on', () => {
    const keys = parseComposeEnv(COMPOSE)
    expect([...keys].sort()).toEqual([
      'CORS_ORIGIN',
      'DB_HOST',
      'DB_NAME',
      'DB_PASSWORD',
      'DB_USER',
      'JWT_SECRET',
      'NODE_ENV',
      'PORT',
      'REDIS_URL',
    ])
  })
})

describe('audit (server: код ⊆ эталоны)', () => {
  it('всё объявлено — проблем нет', () => {
    const root = fixture({
      'server/src/routes/a.js': 'const p = process.env.PORT\nconst db = process.env.DB_HOST\n',
      'server/src/routes/b.js': "const s = process.env['JWT_SECRET']\n",
    })
    expect(audit(root).problems).toEqual([])
  })

  it('процесс.env без объявления ни в одном эталоне — находка с текстом', () => {
    const root = fixture({
      'server/src/routes/a.js': 'const x = process.env.NOT_DECLARED_ANYWHERE\nprocess.env.NODE_ENV\n',
    })
    const { problems } = audit(root)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('server/src/routes/a.js:1')
    expect(problems[0]).toContain('process.env.NOT_DECLARED_ANYWHERE')
    expect(problems[0]).toContain('ни в server/.env.example')
  })

  it('переменная, объявленная только в корневом .env.example, считается объявленной', () => {
    const root = fixture({
      'server/src/routes/a.js': 'const c = process.env.CLIENT_URL\n',
    })
    expect(audit(root).problems).toEqual([])
  })

  it('переменная, объявленная только в compose environment, считается объявленной', () => {
    const root = fixture({
      'server/src/routes/a.js': 'const r = process.env.REDIS_URL\n',
    })
    expect(audit(root).problems).toEqual([])
  })

  it('системные переменные (ProgramFiles, npm_*) не требуют объявления', () => {
    const root = fixture({
      'server/src/routes/a.js': 'const p = process.env.ProgramFiles\nconst v = process.env.npm_package_version\n',
    })
    expect(audit(root).problems).toEqual([])
  })

  it('тесты (__tests__) не сканируются', () => {
    const root = fixture({
      'server/src/__tests__/x.test.js': 'const t = process.env.TEST_ONLY_SECRET\n',
    })
    expect(audit(root).problems).toEqual([])
  })
})

describe('audit (front: import.meta.env ⊆ корневой .env.example)', () => {
  it('VITE_* без объявления в корневом .env.example — находка', () => {
    const root = fixture({
      'src/lib/api.ts': 'const u = import.meta.env.VITE_NOT_DECLARED\n',
    })
    const { problems } = audit(root)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('src/lib/api.ts:1')
    expect(problems[0]).toContain('import.meta.env.VITE_NOT_DECLARED')
    expect(problems[0]).toContain('корневом .env.example')
  })

  it('VITE_*, объявленный закомментированным ключом, — не находка (документация опции)', () => {
    const root = fixture({
      'src/lib/supabase.ts': 'const u = import.meta.env.VITE_SUPABASE_URL\n',
    })
    expect(audit(root).problems).toEqual([])
  })

  it('встроенные Vite-переменные (DEV/PROD/MODE) не требуют объявления', () => {
    const root = fixture({
      'src/main.tsx': 'const d = import.meta.env.DEV\nconst p = import.meta.env.PROD\nconst m = import.meta.env.MODE\n',
    })
    expect(audit(root).problems).toEqual([])
  })
})

describe('audit (compose: environment сервиса app ⊆ код)', () => {
  it('переменная compose, которую код не читает, — мёртвая настройка (находка)', () => {
    const root = fixture({
      'server/src/routes/a.js': 'const p = process.env.PORT\nconst db = process.env.DB_HOST\nconst r = process.env.REDIS_URL\n',
    })
    // Добавляем в compose мёртвую переменную — её нет ни в коде, ни в эталонах.
    const compose = fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8')
    fs.writeFileSync(
      path.join(root, 'docker-compose.yml'),
      compose.replace('      REDIS_URL: redis://redis:6379\n', '      REDIS_URL: redis://redis:6379\n      UNUSED_COMPOSE_VAR: 1\n'),
    )
    const { problems } = audit(root)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('сервис app передаёт UNUSED_COMPOSE_VAR в environment')
    expect(problems[0]).toContain('мёртвая настройка')
  })

  it('переменная compose, объявленная в server/.env.example, мёртвой не считается', () => {
    const root = fixture({
      'server/src/routes/a.js': 'const p = process.env.PORT\nconst db = process.env.DB_HOST\nconst r = process.env.REDIS_URL\n',
    })
    // Все compose-ключи объявлены в server/.env.example — мёртвых настроек нет.
    expect(audit(root).problems).toEqual([])
  })
})

describe('audit на настоящем репозитории', () => {
  it('код репозитория консистентен с эталонами окружения', () => {
    const { problems, facts } = audit(REPO_ROOT)
    expect(problems).toEqual([])
    expect(facts.serverEnv).toBeGreaterThan(40)
    expect(facts.frontEnv).toBeGreaterThan(5)
    expect(facts.composeKeys).toBeGreaterThanOrEqual(9)
  })
})