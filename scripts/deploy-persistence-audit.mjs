/**
 * Гейт «деплой не теряет данные на диске» (этап 21, P0 #37).
 *
 * `docker compose up -d --build` пересоздаёт контейнер, и всё, что не
 * смонтировано volume'ом, исчезает. В `docker-compose.yml` у сервиса `app`
 * volume не было вовсе, поэтому каждый деплой удалял `/app/server/uploads` —
 * каталог с загруженными пользователями фото. Признаков в логах не
 * оставалось: фото просто переставали открываться, а страницы продолжали
 * отдавать 200 со ссылками на несуществующие файлы.
 *
 * Гейт не спрашивает «есть ли volume», а **выводит путь из кода** и сверяет
 * его с compose. Проверяются два инварианта, оба падали бы тихо:
 *
 *  1. Каталог записи (multer `diskStorage`, `upload.js`) и каталог отдачи
 *     (`express.static`, `index.js`) — один и тот же. Если их развести,
 *     фото успешно загружаются и никогда не открываются. Проверка нужна
 *     ещё и потому, что путь задан двумя независимыми выражениями
 *     (`path.resolve(__dirname, '../../uploads')` и
 *     `path.join(__dirname, '../uploads')`) — они обязаны сходиться.
 *  2. Путь записи смонтирован **именованным** volume'ом в сервисе `app`.
 *     Bind-mount в каталог, куда rsync ходит с `--delete` (например
 *     `./server/uploads`), фото тоже потеряет — поэтому годятся только
 *     именованные volume'а из раздела `volumes:`.
 *
 * Если запись в `uploads` в проде не нужна (S3/CDN вместо диска), гейт надо
 * не отключать, а научить читать переключатель. `upload.js` уже умеет S3
 * (`USE_S3 = !!(S3_BUCKET && AWS_ACCESS_KEY_ID)`, URL пишется в S3, а не на
 * диск). Правило (L7): дисковые проверки применяются, пока env сервиса `app`
 * (environment: в compose или корневой `.env` через env_file) не содержит
 * обоих ключей; если содержит — S3-режим включён, фото на диск не пишутся,
 * и гейт пропускает проверки тома/путей, но с явной пометкой в выводе, а не
 * молча. Ключи без S3-ветки в коде — FAIL: деплой ждёт S3, которого код не умеет.
 */

import fs from 'node:fs'
import path from 'node:path'

const UPLOAD_ROUTE = 'server/src/routes/upload.js'
const SERVER_ENTRY = 'server/src/index.js'
const COMPOSE = 'docker-compose.yml'

/** Контейнерный корень приложения: Dockerfile кладёт server/ в /app/server. */
const CONTAINER_ROOT = '/app'

function readRepoFile(root, relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8')
}

function toPosix(p) {
  return p.split(path.sep).join('/')
}

/**
 * Разрешает `path.resolve(__dirname, '<rel>')` / `path.join(__dirname, '<rel>')`
 * в путь внутри контейнера: __dirname файла известен из его положения в репозитории.
 *
 * У двух файлов разная глубина, и это ровно то, что нельзя «подровнять»:
 * `upload.js` лежит в `server/src/routes` и поднимается на два уровня
 * (`'../../uploads'`), `index.js` — в `server/src` и на один (`'../uploads'`).
 * Оба обязаны дать один каталог; префикс у `..` не срезается.
 */
function resolveFromDirname(fileRelPath, expr) {
  const dirInRepo = path.posix.dirname(toPosix(fileRelPath))
  const insideServer = toPosix(path.posix.join(dirInRepo, expr))
  if (insideServer.startsWith('..')) {
    throw new Error(`путь ${expr} в ${fileRelPath} выходит за пределы репозитория`)
  }
  return `${CONTAINER_ROOT}/${insideServer}`
}

export function findUploadWriteDir(root) {
  const src = readRepoFile(root, UPLOAD_ROUTE)
  const m = src.match(/const\s+UPLOAD_DIR\s*=\s*path\.resolve\(\s*__dirname\s*,\s*'([^']+)'\s*\)/)
  if (!m) return null
  return resolveFromDirname(UPLOAD_ROUTE, m[1])
}

export function findUploadStaticDir(root) {
  const src = readRepoFile(root, SERVER_ENTRY)
  const m = src.match(/app\.use\(\s*'\/uploads'\s*,\s*express\.static\(\s*path\.join\(\s*__dirname\s*,\s*'([^']+)'\s*\)/)
  if (!m) return null
  return resolveFromDirname(SERVER_ENTRY, m[1])
}

/** Секция сервиса `app` из docker-compose.yml (до следуого сервиса/верха уровня). */
export function getAppServiceSection(compose) {
  const lines = compose.split(/\r?\n/)
  const start = lines.findIndex((l) => /^ {2}app:\s*$/.test(l))
  if (start === -1) return ''
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => /^ {2}\S/.test(l) || /^\S/.test(l))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n')
}

/** Именованные volume'а, смонтированные в сервис `app` (без bind-mount'ов). */
export function getAppNamedVolumeMounts(compose) {
  const section = getAppServiceSection(compose)
  const mounts = []
  const lines = section.split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\s+volumes:\s*$/.test(lines[i])) continue
    for (let j = i + 1; j < lines.length; j += 1) {
      const m = lines[j].match(/^\s+-\s*([A-Za-z0-9_.-]+):(\S+)\s*$/)
      if (!m) break
      mounts.push({ name: m[1], target: m[2] })
    }
    break
  }
  return mounts
}

/** Volume'а, объявленные в верхнеуровневом разделе `volumes:`. */
export function getDeclaredVolumes(compose) {
  const names = new Set()
  const m = compose.match(/^volumes:\s*$\n([\s\S]*)/m)
  if (!m) return names
  for (const line of m[1].split(/\r?\n/)) {
    const name = line.match(/^ {2}([A-Za-z0-9_.-]+):\s*$/)
    if (name) names.add(name[1])
  }
  return names
}

/** Ключи `environment:` сервиса `app` из docker-compose (форма `KEY: value`). */
export function appServiceEnv(compose) {
  const section = getAppServiceSection(compose)
  const env = {}
  let started = false
  for (const line of section.split(/\r?\n/)) {
    if (/^\s+environment:\s*$/.test(line)) {
      started = true
      continue
    }
    if (!started) continue
    if (/^\s*[a-z_]/.test(line) && !/^\s+[A-Z]/.test(line)) break
    const m = line.match(/^\s+([A-Z][A-Z0-9_]*)\s*:\s*(.*)$/)
    if (m) env[m[1]] = m[2].trim()
  }
  return env
}

/** Разбор `KEY=VALUE`-строк корневого `.env` (env_file сервиса app). */
export function parseEnvFile(text) {
  const env = {}
  for (const m of text.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/gm)) env[m[1]] = m[2].trim()
  return env
}

/** S3 включён, если в env сервиса app или в корневом .env есть оба ключа (не пустые). */
export function envHasS3(appEnv, rootEnv) {
  const has = (obj, keys) => keys.every((k) => obj[k] && obj[k] !== '')
  return has(appEnv, ['S3_BUCKET', 'AWS_ACCESS_KEY_ID']) || has(rootEnv, ['S3_BUCKET', 'AWS_ACCESS_KEY_ID'])
}

/** upload.js действительно умеет S3: переключатель объявлен и URL пишется в S3. */
export function hasS3Branch(uploadSrc) {
  return /const\s+USE_S3/.test(uploadSrc) && /USE_S3\s*\?\s*req\.file\.location/.test(uploadSrc)
}

export function audit(root) {
  const compose = readRepoFile(root, COMPOSE)
  const uploadSrc = readRepoFile(root, UPLOAD_ROUTE)
  const writeDir = findUploadWriteDir(root)
  const staticDir = findUploadStaticDir(root)
  const mounts = getAppNamedVolumeMounts(compose)
  const declared = getDeclaredVolumes(compose)

  const s3Branch = hasS3Branch(uploadSrc)
  const envFile = fs.existsSync(path.join(root, '.env')) ? readRepoFile(root, '.env') : ''
  const s3Credentials = envHasS3(appServiceEnv(compose), parseEnvFile(envFile))
  const s3Enabled = s3Branch && s3Credentials

  const problems = []
  const notes = []

  if (s3Credentials && !s3Branch) {
    problems.push(`env сервиса app включает S3-ключи (S3_BUCKET/AWS_ACCESS_KEY_ID), но ${UPLOAD_ROUTE} не имеет S3-ветки (USE_S3) — деплой ждёт S3, а фото пойдут не туда`)
  }
  if (s3Enabled) {
    notes.push('S3-режим включён (S3_BUCKET + AWS_ACCESS_KEY_ID в env app): фото пишутся в S3, дисковые проверки записи/тома не применяются')
    return { writeDir, staticDir, mounts, s3Enabled, notes, problems }
  }

  if (!writeDir) {
    problems.push(`не найден UPLOAD_DIR в ${UPLOAD_ROUTE} — гейт не может вывести путь записи`)
  }
  if (!staticDir) {
    problems.push(`не найден express.static('/uploads', …) в ${SERVER_ENTRY} — гейт не может вывести путь отдачи`)
  }
  if (writeDir && staticDir && writeDir !== staticDir) {
    problems.push(`фото пишутся в ${writeDir}, а отдаются из ${staticDir} — загруженные фото никогда не откроются`)
  }
  if (writeDir) {
    const mount = mounts.find((mt) => mt.target === writeDir || `${mt.target}/` === `${writeDir}/`)
    if (!mount) {
      problems.push(`${writeDir} не смонтирован в сервис app: docker compose up --build пересоздаст контейнер и удалит фото`)
    } else if (!declared.has(mount.name)) {
      problems.push(`том ${mount.name} смонтирован в app, но не объявлен в разделе volumes:`)
    }
  }
  return { writeDir, staticDir, mounts, s3Enabled, notes, problems }
}

function main() {
  const root = process.argv[2] || process.cwd()
  const { writeDir, staticDir, mounts, s3Enabled, notes, problems } = audit(root)

  console.log(`путь записи (${UPLOAD_ROUTE}): ${writeDir || 'не найден'}`)
  console.log(`путь отдачи (${SERVER_ENTRY}): ${staticDir || 'не найден'}`)
  console.log(`тома в сервисе app: ${mounts.length ? mounts.map((m) => `${m.name} → ${m.target}`).join(', ') : 'нет'}`)
  console.log(`S3-режим: ${s3Enabled ? 'включён' : 'выключен'}${s3Enabled ? '' : ' (дисковые проверки применяются)'}`)
  for (const n of notes) console.log(`note: ${n}`)

  if (problems.length) {
    console.log('')
    for (const p of problems) console.log(`FAIL: ${p}`)
    console.log('\nИтог: деплой теряет (или уже потерял) данные на диске.')
    process.exit(1)
  }
  console.log(s3Enabled
    ? '\nИтог: фото в S3 — дисковые проверки не нужны (переключатель прочитан).'
    : '\nИтог: фото пишутся и отдаются из одного каталога, каталог переживает пересоздание контейнера.')
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main()
