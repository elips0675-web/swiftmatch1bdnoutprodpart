/**
 * S3-контрактный смоук INT-01: настоящий server/src/index.js против живого
 * S3-совместимого сервера (zenko/cloudserver, контур
 * docker-compose.integration.yml, хост-порт 19001).
 *
 * Что он доказывает и чего не может мок: S3-код — это сетевой контракт
 * (клиент SDK ↔ сервер), а мок принимает любой ключ и любой ответ. Здесь
 * проверяются четыре свойства, которые юнит-тест закрепить не в силах:
 *  1. upload: multer-s3 кладёт оригинал в бакет (HeadObject 200), конвейер
 *     sharp создаёт 4 варианта (3 webp + avif) отдельными объектами;
 *  2. ключ объекта, выведенный из url фото, существует в бакете — url,
 *     который multer-s3 отдаёт при self-hosted эндпоинте, разбирается без
 *     new URL (иначе DELETE фото отвечает 500);
 *  3. GET /api/photos/:userId отдаёт фото (ALLOW_UNMODERATED_PHOTOS=true,
 *     недоступный Rekognition — safe: null — статус не портит, upload.js:93);
 *  4. DELETE /api/photos/:id уносит оригинал И все 4 варианта: сирота-ресайз
 *     оставался в бакете навсегда, пока DELETE удалял только оригинал.
 *
 * Режимы (канон queue-smoke.mjs:9-10):
 *  - без флага и без инфраструктуры — честный SKIP, exit 0;
 *  - REQUIRE_INTEGRATION=1 (CI, scripts/integration-smoke-run.mjs) — любая
 *    недоступная зависимость или упавший шаг есть exit 1, а не пропуск.
 *
 * Контур поднимается отдельно (docker-compose.integration.yml: db 3308,
 * redis 6380, s3 19001), уборка за runner'ом: down -v. API-порт 3103 — второй
 * смоук после integration-smoke.mjs, который держит 3102.
 */
import { spawn } from 'node:child_process'
import { connect as netConnect } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'
import sharp from 'sharp'
import {
  S3Client,
  ListBucketsCommand,
  CreateBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'

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
const S3_ENDPOINT = process.env.S3_ENDPOINT || 'http://127.0.0.1:19001'
const S3_REGION = process.env.AWS_REGION || 'us-east-1'
// accessKey1/verySecretKey1 — публичные дефолты образа cloudserver (не секреты)
const S3_ACCESS_KEY = process.env.AWS_ACCESS_KEY_ID || 'accessKey1'
const S3_SECRET_KEY = process.env.AWS_SECRET_ACCESS_KEY || 'verySecretKey1'
const S3_BUCKET = process.env.S3_BUCKET || 'swiftmatch-itest'
const API_PORT = Number(process.env.SMOKE_S3_API_PORT) || 3103
const API = `http://127.0.0.1:${API_PORT}`

// Суффиксы вариантов — image-pipeline.js:5-9 (3 webp) + avif (там же).
const VARIANT_SUFFIXES = ['_800x800.webp', '_400x400.webp', '_200x200.webp', '_800x800.avif']

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const s3 = new S3Client({
  region: S3_REGION,
  endpoint: S3_ENDPOINT,
  forcePathStyle: true,
  credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
})

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

async function probeS3() {
  try {
    await s3.send(new ListBucketsCommand({}))
    return true
  } catch {
    return false
  }
}

async function ensureBucket() {
  try {
    await s3.send(new CreateBucketCommand({ Bucket: S3_BUCKET }))
  } catch (err) {
    // Повторный прогон против поднятого контура: бакет уже есть — это не ошибка.
    if (!/BucketAlreadyExists|BucketAlreadyOwnedByYou/i.test(String(err?.name))) throw err
  }
}

/** Ключ S3 из url фото — зеркало продового правила (upload.js): new URL не
 *  используется, path-style несёт бакет первым сегментом пути. */
function keyFromUrl(url) {
  const match = String(url).match(/^https?:\/\/([^/]+)\/(.+)$/)
  if (!match) throw new Error(`не S3-url: ${url}`)
  const [, authority, key] = match
  if (!authority.startsWith(`${S3_BUCKET}.`) && key.startsWith(`${S3_BUCKET}/`)) {
    return key.slice(S3_BUCKET.length + 1)
  }
  return key
}

async function headOk(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }))
    return true
  } catch {
    return false
  }
}

async function listKeys(prefix) {
  const res = await s3.send(new ListObjectsV2Command({ Bucket: S3_BUCKET, Prefix: prefix }))
  return (res.Contents || []).map((o) => o.Key)
}

async function makePng() {
  return sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 210, g: 40, b: 60 } },
  })
    .png()
    .toBuffer()
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
    JWT_SECRET: 's3-contract-smoke-secret-not-for-production',
    DB_HOST: DB.host,
    DB_PORT: String(DB.port),
    DB_USER: DB.user,
    DB_PASSWORD: DB.password,
    DB_NAME: DB.database,
    REDIS_URL,
    S3_BUCKET,
    AWS_ACCESS_KEY_ID: S3_ACCESS_KEY,
    AWS_SECRET_ACCESS_KEY: S3_SECRET_KEY,
    AWS_REGION: S3_REGION,
    S3_ENDPOINT,
    // В проде «модерация настроена» при AWS-кредах (runtime.js), и без этого
    // Rekognition-клиент ушёл бы в настоящий AWS. Уводим его в контур: ответ
    // S3-сервера на Rekognition-запрос — ошибка → safe: null → статус не
    // трогается (upload.js:93), фото остаётся 'approved'.
    AWS_ENDPOINT_URL_REKOGNITION: S3_ENDPOINT,
    ALLOW_UNMODERATED_PHOTOS: 'true',
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

async function main() {
  console.log(
    `[s3-contract-smoke] db=${DB.host}:${DB.port}/${DB.database} redis=${REDIS_URL} s3=${S3_ENDPOINT}/${S3_BUCKET} api=${API}`,
  )

  // Пробы с дедлайном, а не одиночный снапшот: даже после `--wait` узлы
  // могут быть на грани готовности (медленная машина, первый старт). Гонка
  // «упало 1 из 3» — питфолл «падение 1 из 4 = гонка по времени, а не флак».
  const infraDeadline = Date.now() + 90_000
  let probes = { db: false, redis: false, s3: false }
  do {
    const [db, redis, s3Ok] = await Promise.all([probeMySQL(), probeRedis(REDIS_URL), probeS3()])
    probes = { db, redis, s3: s3Ok }
    if (db && redis && s3Ok) break
    await sleep(2000)
  } while (Date.now() < infraDeadline)
  const { db: dbOk, redis: redisOk, s3: s3Ok } = probes
  if (!dbOk || !redisOk || !s3Ok) {
    const missing = [
      !dbOk && `MySQL ${DB.host}:${DB.port}`,
      !redisOk && `Redis ${REDIS_URL}`,
      !s3Ok && `S3 ${S3_ENDPOINT}`,
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
  check('S3 отвечает (ListBuckets)', s3Ok)

  await ensureBucket()
  check(`бакет ${S3_BUCKET} готов`, true)

  const email = `s3itest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`
  const password = 'SmokeTest123!'
  const { child, tail } = startServer()
  let conn = null

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
      body: JSON.stringify({ email, password, displayName: 'S3 Contract Smoke' }),
    })
    check('POST /api/auth/register → 201', reg.status === 201, `status=${reg.status}`)
    const token = reg.body?.token
    const userId = reg.body?.userId
    check('register вернул token и userId', Boolean(token) && Boolean(userId))
    if (!token || !userId) return

    const png = await makePng()
    const form = new FormData()
    form.append('photo', new Blob([png], { type: 'image/png' }), 'contract.png')
    const upRes = await fetch(`${API}/api/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(30_000),
    })
    let up = null
    try {
      up = await upRes.json()
    } catch {
      /* не JSON */
    }
    check('POST /api/upload → 200', upRes.status === 200, `status=${upRes.status}`)
    const photoId = up?.id
    const url = up?.url
    check('upload вернул id и url', Boolean(photoId) && typeof url === 'string', `url=${url}`)
    if (!photoId || typeof url !== 'string') return
    check(`url указывает на бакет ${S3_BUCKET}`, url.includes(S3_BUCKET), `url=${url}`)

    const originalKey = keyFromUrl(url)
    check('HeadObject: оригинал физически в бакете', await headOk(originalKey), `key=${originalKey}`)

    const base = originalKey.replace(/\.[^./]+$/, '')
    const expected = [originalKey, ...VARIANT_SUFFIXES.map((s) => `${base}${s}`)]
    const afterUpload = await listKeys(base)
    const missingVariants = expected.filter((k) => !afterUpload.includes(k))
    check(
      'ListObjectsV2: оригинал + 4 варианта ресайза (3 webp + avif)',
      afterUpload.length === 5 && missingVariants.length === 0,
      `KeyCount=${afterUpload.length}${missingVariants.length ? ` нет: ${missingVariants.join(', ')}` : ''}`,
    )

    const photos = await jsonFetch(`${API}/api/photos/${userId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    check(
      'GET /api/photos/:userId отдаёт загруженное фото',
      photos.status === 200 && Array.isArray(photos.body) && photos.body.some((p) => p.url === url),
      `status=${photos.status} count=${Array.isArray(photos.body) ? photos.body.length : 'n/a'}`,
    )

    const del = await jsonFetch(`${API}/api/photos/${photoId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    check('DELETE /api/photos/:id → 200 success', del.status === 200 && del.body?.success === true, `status=${del.status}`)

    check('HeadObject после DELETE: оригинала нет (404)', !(await headOk(originalKey)), `key=${originalKey}`)
    const afterDelete = await listKeys(base)
    check(
      'варианты удалены: KeyCount по префиксу 0 (раньше 4 сироты)',
      afterDelete.length === 0,
      `осталось=${afterDelete.length}${afterDelete.length ? `: ${afterDelete.join(', ')}` : ''}`,
    )
  } finally {
    await stopServer(child)

    try {
      conn = await mysql.createConnection({ ...DB, connectTimeout: 5000 })
      const [rows] = await conn.query('DELETE FROM users WHERE email = ?', [email])
      const [left] = await conn.query('SELECT COUNT(*) AS n FROM users WHERE email = ?', [email])
      check(
        'cleanup: тест-юзер удалён (FK CASCADE чистит профиль/токены/фото)',
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
    console.log(`\nFAIL  s3-contract-smoke: ${failures.length} проверок упало`)
    process.exit(1)
  }
  console.log('\nOK  s3-contract-smoke: контракт S3 подтверждён')
}

main().catch((err) => {
  console.error('s3-contract-smoke упал:', err)
  process.exit(1)
})
