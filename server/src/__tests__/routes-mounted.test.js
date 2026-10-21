// Stage 150: `POST /api/reports` был определён в `server/src/routes/report.js:25`,
// но не импортировался и не монтировался в `server/src/index.js` — в проде жалоба
// пользователя уходила в 404 «Cannot POST /api/reports». Юнит-тесты роута были
// зелёные: они собирают приложение из самого роутера, а монтирование в
// приложение не проверял никто.
//
// Проверяются две разные вещи:
//
//   1. HTTP-проверка СОБРАННОГО приложения: настоящий `server/src/index.js`
//      поднимается в дочернем процессе, и `POST /api/reports` без токена обязан
//      ответить 401 (роут есть, гейт авторизации отвечает), а не 404 (роута
//      нет). Контрольный запрос на заведомо несуществующий путь обязан дать
//      404 — иначе «404» ничего не различало бы.
//   2. Системная проверка: каждый файл `server/src/routes/**` обязан быть
//      импортирован в `index.js` и смонтирован через `app.use(...)`. Это
//      закрывает класс «роут определён и покрыт тестами, но недоступен» для
//      всех 44 файлов, а не только для жалоб.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const INDEX_FILE = path.join(SERVER_DIR, 'src', 'index.js')
const ROUTES_DIR = path.join(SERVER_DIR, 'src', 'routes')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function listRouteFiles(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listRouteFiles(full))
    else if (entry.name.endsWith('.js')) out.push(full)
  }
  return out.sort()
}

function httpRequest(port, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body)
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: urlPath,
        agent: false,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : {},
      },
      (res) => {
        let raw = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => { raw += chunk })
        res.on('end', () => resolve({ status: res.statusCode, body: raw }))
      },
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

let child = null
let port = 0
let childOutput = ''

beforeAll(async () => {
  port = await reservePort()
  child = spawn(process.execPath, ['src/index.js'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      JWT_SECRET: 'routes-mounted-test-secret',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (chunk) => { childOutput += chunk.toString() })
  child.stderr.on('data', (chunk) => { childOutput += chunk.toString() })

  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`сервер упал при старте (exit ${child.exitCode}):\n${childOutput.slice(-2000)}`)
    }
    if (childOutput.includes('Uncaught exception')) {
      throw new Error(`сервер упал при старте:\n${childOutput.slice(-2000)}`)
    }
    try {
      await httpRequest(port, 'GET', '/health')
      return
    } catch {
      await sleep(200)
    }
  }
  throw new Error(`сервер не поднялся за 30с:\n${childOutput.slice(-2000)}`)
}, 60000)

afterAll(async () => {
  if (!child || child.exitCode !== null) return
  const exited = new Promise((resolve) => child.once('exit', resolve))
  child.kill()
  const killer = setTimeout(() => { child.kill('SIGKILL') }, 5000)
  await exited
  clearTimeout(killer)
})

describe('POST /api/reports в собранном приложении', () => {
  it('роут доступен по HTTP: без токена 401, а не 404', async () => {
    const res = await httpRequest(port, 'POST', '/api/reports', { reported_id: 1, reason: 'spam' })
    expect(res.status).toBe(401)
    expect(JSON.parse(res.body).message).toBe('Authentication required')
  }, 30000)

  it('контрольный несуществующий путь отвечает 404', async () => {
    const res = await httpRequest(port, 'POST', '/api/__no_such_route__', { reported_id: 1 })
    expect(res.status).toBe(404)
  }, 30000)
})

describe('монтирование роутов в server/src/index.js', () => {
  it('каждый файл server/src/routes/** импортирован и смонтирован', () => {
    const lines = fs.readFileSync(INDEX_FILE, 'utf8').split(/\r?\n/)
    const problems = []

    for (const file of listRouteFiles(ROUTES_DIR)) {
      const spec = './routes/' + path.relative(ROUTES_DIR, file).split(path.sep).join('/')
      const importIndex = lines.findIndex((line) => line.includes(`from '${spec}'`))
      if (importIndex === -1) {
        problems.push(`${spec}: не импортирован в index.js`)
        continue
      }
      const ident = lines[importIndex].match(/^import\s+([A-Za-z0-9_$]+)/)?.[1]
      if (!ident) {
        problems.push(`${spec}: не удалось разобрать имя импорта в строке ${importIndex + 1}`)
        continue
      }
      const mountRe = new RegExp(`app\\.(use|get|post|put|patch|delete)\\([^)]*\\b${ident}\\b`)
      if (!lines.some((line) => mountRe.test(line))) {
        problems.push(`${spec}: импорт ${ident} есть, но роут не смонтирован (app.use с ${ident})`)
      }
    }

    expect(problems).toEqual([])
  })
})
