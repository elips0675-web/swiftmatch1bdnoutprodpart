/**
 * Интеграционный смоук TEST-03: настоящий server/src/index.js против живых
 * контейнеров mysql:8.4 + redis:7-alpine + maildev (SMTP-ловушка).
 *
 * Что он доказывает и чего не может юнит-тест: цепочку HTTP → MySQL (INSERT
 * users/user_profiles) → Bull/Redis (email-очередь, queue.js:69) → nodemailer
 * (jobs/email.job.js) → реальный SMTP-сервер → письмо, которое лежит в maildev.
 * Ни один мок не проверяет этот путь целиком: queue-smoke доходит только до
 * Bull, а auth-тесты шлют sendVerificationEmail в заглушку.
 *
 * Режимы (канон queue-smoke.mjs:9-10):
 *  - без флага и без инфраструктуры — честный SKIP, exit 0;
 *  - REQUIRE_INTEGRATION=1 (CI, scripts/integration-smoke-run.mjs) — любая
 *    недоступная зависимость или упавший шаг есть exit 1, а не пропуск.
 *
 * Контур поднимается отдельно (docker-compose.integration.yml, порты мимо
 * Laragon: 3308/6380/1125/1180), уборка за runner'ом: down -v.
 */
import { spawn } from 'node:child_process'
import { connect as netConnect } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'

const requireIntegration =
  process.env.REQUIRE_INTEGRATION === '1' || process.argv.includes('--require')

const DB = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3308,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD ?? 'root',
  database: process.env.DB_NAME || 'swiftmatch1bd',
}
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6380'
const SMTP_HOST = process.env.SMTP_HOST || '127.0.0.1'
const SMTP_PORT = Number(process.env.SMTP_PORT) || 1125
const MAILDEV_URL = process.env.MAILDEV_URL || 'http://127.0.0.1:1180'
const API_PORT = Number(process.env.SMOKE_API_PORT) || 3102
const API = `http://127.0.0.1:${API_PORT}`

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const VERIFY_SUBJECT = 'Verify your SwiftMatch email'

const failures = []
function check(label, ok, extra = '') {
  console.log(`${ok ? 'ok' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`)
  if (!ok) failures.push(label)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function probeMySQL() {
  let conn
  try {
    conn = await mysql.createConnection({ ...DB, connectTimeout: 5000 })
    await conn.query('SELECT 1')
    return true
  } catch {
    return false
  } finally {
    if (conn) await conn.end().catch(() => {})
  }
}

/** RAW PING через net — без ioredis: он транзитивный (от bull), а прямой
 *  импорт транзитивной зависимости провалил бы check:deps (package.json ⊆ код). */
function probeRedis(url) {
  return new Promise((resolve) => {
    let settled = false
    const done = (ok) => {
      if (settled) return
      settled = true
      sock.destroy()
      resolve(ok)
    }
    let parsed
    try {
      parsed = new URL(url)
    } catch {
      return resolve(false)
    }
    const sock = netConnect(Number(parsed.port) || 6379, parsed.hostname, () => {
      sock.write('PING\r\n')
    })
    sock.setTimeout(3000, () => done(false))
    sock.on('data', (chunk) => done(String(chunk).startsWith('+PONG')))
    sock.on('error', () => done(false))
  })
}

async function probeMaildev() {
  try {
    const res = await fetch(`${MAILDEV_URL}/email`, { signal: AbortSignal.timeout(3000) })
    return res.ok
  } catch {
    return false
  }
}

async function waitForHealth(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${API}/health`, { signal: AbortSignal.timeout(2000) })
      if (res.ok) {
        const body = await res.json()
        if (body.db === 'connected') return true
      }
    } catch {
      /* сервер ещё стартует */
    }
    await sleep(500)
  }
  return false
}

function startServer() {
  const env = {
    ...process.env,
    PORT: String(API_PORT),
    JWT_SECRET: 'test-integration-smoke-secret-not-for-production',
    DB_HOST: DB.host,
    DB_PORT: String(DB.port),
    DB_USER: DB.user,
    DB_PASSWORD: DB.password,
    DB_NAME: DB.database,
    REDIS_URL,
    // email.job.js:16-20 без SMTP_USER/SMTP_PASS возвращает transport=null
    // (письмо «skipped») — ловушка maildev креды не проверяет, но код их требует.
    SMTP_HOST,
    SMTP_PORT: String(SMTP_PORT),
    SMTP_USER: 'smoke',
    SMTP_PASS: 'smoke',
    SMTP_SECURE: 'false',
    CORS_ORIGIN: API,
  }
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: SERVER_DIR,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const tail = []
  const keep = (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (!line.trim()) continue
      tail.push(line)
      if (tail.length > 150) tail.shift()
    }
  }
  child.stdout.on('data', keep)
  child.stderr.on('data', keep)
  return { child, tail }
}

async function stopServer(child) {
  if (child.exitCode !== null) return
  child.kill()
  for (let i = 0; i < 50 && child.exitCode === null; i++) await sleep(100)
  if (child.exitCode === null) child.kill('SIGKILL')
}

async function jsonFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    signal: AbortSignal.timeout(5000),
  })
  let body = null
  try {
    body = await res.json()
  } catch {
    /* не JSON — оставляем null */
  }
  return { status: res.status, body }
}

async function waitForVerificationMail(email, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${MAILDEV_URL}/email`, { signal: AbortSignal.timeout(3000) })
      if (res.ok) {
        const list = await res.json()
        const hit = list.find(
          (m) =>
            m.subject === VERIFY_SUBJECT &&
            JSON.stringify(m.to ?? '').includes(email),
        )
        if (hit) return hit
      }
    } catch {
      /* maildev ещё поднимается */
    }
    await sleep(500)
  }
  return null
}

async function main() {
  console.log(
    `[integration-smoke] db=${DB.host}:${DB.port}/${DB.database} redis=${REDIS_URL} smtp=${SMTP_HOST}:${SMTP_PORT} maildev=${MAILDEV_URL} api=${API}`,
  )

  // Пробы с дедлайном, а не одиночный снапшот: даже после `--wait` узлы
  // могут быть на грани готовности (медленная машина, первый старт). Гонка
  // «упало 1 из 4» — питфолл «падение 1 из 4 = гонка по времени, а не флак».
  const infraDeadline = Date.now() + 90_000
  let probes = { db: false, redis: false, maildev: false }
  do {
    const [db, redis, maildev] = await Promise.all([
      probeMySQL(),
      probeRedis(REDIS_URL),
      probeMaildev(),
    ])
    probes = { db, redis, maildev }
    if (db && redis && maildev) break
    await sleep(2000)
  } while (Date.now() < infraDeadline)
  const { db: dbOk, redis: redisOk, maildev: maildevOk } = probes
  const infraOk = dbOk && redisOk && maildevOk
  if (!infraOk) {
    const missing = [
      !dbOk && `MySQL ${DB.host}:${DB.port}`,
      !redisOk && `Redis ${REDIS_URL}`,
      !maildevOk && `maildev ${MAILDEV_URL}`,
    ]
      .filter(Boolean)
      .join(', ')
    if (requireIntegration) {
      console.log(`FAIL  инфраструктура недоступна: ${missing} — REQUIRE_INTEGRATION=1`)
      process.exit(1)
    }
    console.log(`SKIP  интеграционный контур не поднят (${missing}) — без REQUIRE_INTEGRATION смоук честно пропускается`)
    process.exit(0)
  }
  check('MySQL отвечает (SELECT 1)', dbOk)
  check('Redis отвечает (PING)', redisOk)
  check('maildev API отвечает', maildevOk)

  const email = `itest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`
  const password = 'SmokeTest123!'
  const { child, tail } = startServer()
  let conn = null
  let mailId = null

  try {
    const healthy = await waitForHealth(60_000)
    check(`server поднялся и /health видит БД (порт ${API_PORT})`, healthy, healthy ? '' : 'timeout 60с')
    if (!healthy) {
      console.log('--- хвост лога сервера ---')
      for (const line of tail.slice(-40)) console.log(line)
      return
    }

    const reg = await jsonFetch(`${API}/api/auth/register`, {
      method: 'POST',
      body: JSON.stringify({ email, password, displayName: 'Integration Smoke' }),
    })
    check('POST /api/auth/register → 201', reg.status === 201, `status=${reg.status}`)
    const token = reg.body?.token
    check('register вернул токен', Boolean(token))
    if (reg.status !== 201) return

    const mail = await waitForVerificationMail(email, 20_000)
    mailId = mail?.id ?? null
    check(
      `письмо «${VERIFY_SUBJECT}» дошло через очередь → SMTP → maildev`,
      Boolean(mail),
      mail ? `id=${mail.id}` : 'timeout 20с — письмо не появилось',
    )

    const login = await jsonFetch(`${API}/api/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
    check('POST /api/auth/login → 200 (чтение users + bcrypt)', login.status === 200, `status=${login.status}`)
    check(
      'login отдаёт boolean email_verified (иначе фронт всегда рисует баннер «подтвердите email»)',
      login.body?.email_verified === false,
      `email_verified=${JSON.stringify(login.body?.email_verified)}`,
    )

    const me = await jsonFetch(`${API}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    check(
      'GET /api/auth/me с Bearer отдаёт пользователя из БД',
      me.body?.authenticated === true && me.body?.email === email,
      `authenticated=${me.body?.authenticated}`,
    )
  } finally {
    await stopServer(child)

    if (mailId) {
      try {
        await fetch(`${MAILDEV_URL}/email/${mailId}`, {
          method: 'DELETE',
          signal: AbortSignal.timeout(3000),
        })
      } catch {
        /* контейнер падает вместе с down -v */
      }
    }

    try {
      conn = await mysql.createConnection({ ...DB, connectTimeout: 5000 })
      const [rows] = await conn.query('DELETE FROM users WHERE email = ?', [email])
      const [left] = await conn.query('SELECT COUNT(*) AS n FROM users WHERE email = ?', [email])
      check(
        'cleanup: тест-юзер удалён (FK CASCADE чистит профиль/токены)',
        Number(left[0].n) === 0,
        `удалено строк=${rows.affectedRows}`,
      )
    } catch (err) {
      check('cleanup: тест-юзер удалён', false, err.message)
    } finally {
      if (conn) await conn.end().catch(() => {})
    }
  }

  if (failures.length) {
    console.log('\n--- хвост лога сервера ---')
    for (const line of tail.slice(-40)) console.log(line)
    console.log(`\nFAIL: ${failures.length} проверок: ${failures.join('; ')}`)
    process.exit(1)
  }
  console.log('\nИтог: server+MySQL+Redis+Bull+SMTP отработали целиком, письмо доставлено, мусор убран.')
  process.exit(0)
}

main().catch((err) => {
  console.error(`FAIL  необработанная ошибка смоука: ${err.stack || err.message}`)
  process.exit(1)
})
