/**
 * Гейт «секреты не уезжают в артефакты» (этап 20, P0-C).
 *
 * Два независимых канала утечки, оба молчаливые:
 *
 *  1. Контекст сборки образа. `COPY server/ ./server/` (Dockerfile:16) кладёт в
 *     прод-образ ВСЁ содержимое server/. Паттерн `.env` в .dockerignore матчится
 *     по полному относительному пути, поэтому `.env` — это только корневой файл,
 *     а `server/.env` и `server/.jwt-dev-secret` в образ попадали. Образ потом
 *     уезжает на VPS в реестр, и секрет читается без root.
 *
 *  2. rsync на деплое. `rsync --delete` без `--exclude .env` УДАЛЯЕТ прод-`.env`
 *     на VPS (файла нет в источнике и он не исключён). Следующая строка workflow
 *     (`test -f .env || cp .env.example .env`) молча пересоздаёт его из примера —
 *     и прод поднимается с публичным JWT_SECRET, SMTP/Stripe/OpenAI выключены.
 *
 * Гейт не доверяет глазам: он обходит дерево репозитория, применяет правила
 * .dockerignore и требует, чтобы ни один файл с признаками секрета не попал в
 * контекст; отдельно проверяет, что rsync-строка в deploy.yml исключает
 * секреты и uploads.
 */

import fs from 'node:fs'
import path from 'node:path'

const REQUIRED_DOCKERIGNORE_PATTERNS = [
  '**/.env',
  '**/.env.*',
  '**/*.secret',
  '**/*-secret',
  '**/*.pem',
  '**/*.key',
  '**/node_modules',
  '**/dist',
]

const REQUIRED_RSYNC_EXCLUDES = ['.env', '*.secret', '*.pem', '*.key', 'uploads']

const ALWAYS_SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'coverage', '.vite'])

// Признаки файла-секрета. `.env.example` — не секрет: он и должен ехать в
// репозиторий, и его использует деплой (`cp .env.example .env`).
// `.jwt-dev-secret` — реальное имя dev-секрета (server/src/middleware.js:8),
// суффикс через дефис, поэтому в список попал явно, а не общим `\.(secret|…)$`.
const SECRET_FILE_RE = /(^|\/)\.env$|(^|\/)\.env\.(local|production|development)$|(^|\/)\.jwt-dev-secret$|\.(secret|pem|key|p12|pfx)$|(^|\/)id_(rsa|ed25519)$/

function isSecretPath(relPath) {
  if (/(^|\/)\.env\.example$/.test(relPath)) return false
  return SECRET_FILE_RE.test(relPath)
}

/**
 * Мини-матчер правил .dockerignore: поддерживает `*`, `?`, `**`, `/` в конце и `!`.
 *
 * ВАЖНО про семантику — здесь она НЕ как у rsync и НЕ как у .gitignore.
 * Docker сопоставляет паттерн с полным относительным путём (filepath.Match),
 * поэтому:
 *   `.env`          исключает ТОЛЬКО корневой .env; `server/.env` проходит насквозь
 *   `*.md`          не исключает `docs/что.md`
 *   `node_modules`  не исключает `server/node_modules`
 * Ровно эта асимметрия и была причиной P0-C: паттерн `.env` выглядит как
 * «секреты исключены», а в образ уезжал `server/.env` и `server/.jwt-dev-secret`.
 * У rsync наоборот — паттерн без слеша матчит basename на любой глубине.
 * Если бы матчер ниже повторял rsync-семантику, гейт зелёнил бы сломанный
 * .dockerignore и молча пропускал бы ту же утечку, поэтому здесь нет префикса
 * с необязательным каталогом в начале — паттерн всегда сверяется с полным
 * относительным путём. Написать его в комментарии в виде регулярки нельзя:
 * последовательность «звёздочка-слэш» внутри блок-комментария закрывает его
 * сам (см. грабли в docs/AGENTS-pitfalls.md).
 */
function compilePattern(pattern) {
  const negated = pattern.startsWith('!')
  let body = negated ? pattern.slice(1) : pattern
  const dirOnly = body.endsWith('/')
  if (dirOnly) body = body.slice(0, -1)
  let re = ''
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]
    if (ch === '*') {
      if (body[i + 1] === '*') {
        re += '.*'
        i += 1
        if (body[i + 1] === '/') i += 1
      } else {
        re += '[^/]*'
      }
    } else if (ch === '?') {
      re += '[^/]'
    } else {
      re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return { negated, re: new RegExp(`^${re}$`), dirOnly }
}

export function parseDockerignore(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map(compilePattern)
}

export function isExcluded(relPath, isDir, rules) {
  let excluded = false
  for (const rule of rules) {
    if (rule.dirOnly && !isDir) continue
    if (!rule.re.test(relPath)) continue
    excluded = !rule.negated
  }
  return excluded
}

function walk(root, rel = '', out = []) {
  const abs = path.join(root, rel)
  let entries
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (ALWAYS_SKIP_DIRS.has(entry.name)) continue
    const childRel = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) walk(root, childRel, out)
    else out.push(childRel)
  }
  return out
}

/**
 * Каталоги-загрязнители, которые НЕ отфильтрованы .dockerignore.
 *
 * Тот же класс дефекта, что и с секретами, только без утечки: `node_modules`
 * паттерном исключал только корневой каталог, а `COPY server/ ./server/`
 * (Dockerfile:16) копировал `server/node_modules` ПОВЕРХ `npm ci --omit=dev`
 * (Dockerfile:12). В образ попадали dev-зависимости и бинарники `sharp`,
 * собранные под хост сборки, — в Linux-контейнере обработка фото падала бы.
 */
const NOISE_DIRS = new Set(['node_modules', 'dist'])

function collectDirs(root, rel = '', out = []) {
  let entries
  try {
    entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.name === '.git') continue
    if (!entry.isDirectory()) continue
    const childRel = rel ? `${rel}/${entry.name}` : entry.name
    out.push(childRel)
    collectDirs(root, childRel, out)
  }
  return out
}

export function findIncludedNoiseDirs(root) {
  const rules = parseDockerignore(fs.readFileSync(path.join(root, '.dockerignore'), 'utf8'))
  return collectDirs(root)
    .filter((rel) => NOISE_DIRS.has(path.basename(rel)))
    .filter((rel) => !isExcluded(rel, true, rules))
    .sort()
}

/** Файлы с признаками секрета, которые НЕ отфильтрованы правилами .dockerignore. */
export function findContextSecrets(root) {
  const rules = parseDockerignore(fs.readFileSync(path.join(root, '.dockerignore'), 'utf8'))
  const dirRules = rules.filter((r) => r.dirOnly)
  const files = walk(root)
  const leaks = []
  for (const rel of files) {
    if (!isSecretPath(rel)) continue
    if (isExcluded(rel, false, rules)) continue
    const parts = rel.split('/')
    let underIgnoredDir = false
    for (let i = 1; i < parts.length; i += 1) {
      if (isExcluded(parts.slice(0, i).join('/'), true, dirRules)) {
        underIgnoredDir = true
        break
      }
    }
    if (!underIgnoredDir) leaks.push(rel)
  }
  return leaks.sort()
}

export function checkDockerignorePatterns(root) {
  const text = fs.readFileSync(path.join(root, '.dockerignore'), 'utf8')
  const present = new Set(
    text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')),
  )
  return REQUIRED_DOCKERIGNORE_PATTERNS.filter((p) => !present.has(p))
}

export function findRsyncSwitches(deployYml) {
  const match = deployYml.match(/^\s*switches:\s*(.+)$/m)
  return match ? match[1].trim() : ''
}

export function checkRsyncExcludes(deployYml) {
  const switches = findRsyncSwitches(deployYml)
  const missing = REQUIRED_RSYNC_EXCLUDES.filter(
    (ex) => !new RegExp(`--exclude\\s+['"]?${ex.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]?(\\s|$)`).test(switches),
  )
  return missing
}

export function audit(root) {
  const dockerignoreMissing = checkDockerignorePatterns(root)
  const contextSecrets = findContextSecrets(root)
  const includedNoiseDirs = findIncludedNoiseDirs(root)
  const deployYml = fs.readFileSync(path.join(root, '.github/workflows/deploy.yml'), 'utf8')
  const rsyncMissing = checkRsyncExcludes(deployYml)
  return { dockerignoreMissing, contextSecrets, includedNoiseDirs, rsyncMissing }
}

function main() {
  const root = process.argv[2] || process.cwd()
  const { dockerignoreMissing, contextSecrets, includedNoiseDirs, rsyncMissing } = audit(root)
  let failed = false

  if (dockerignoreMissing.length) {
    failed = true
    console.log(`FAIL: в .dockerignore нет правил: ${dockerignoreMissing.join(', ')}`)
  } else {
    console.log(`OK: .dockerignore содержит все ${REQUIRED_DOCKERIGNORE_PATTERNS.length} обязательных правил`)
  }

  if (contextSecrets.length) {
    failed = true
    console.log(`FAIL: в контекст образа попадают секреты (${contextSecrets.length}):`)
    for (const f of contextSecrets) console.log(`  - ${f}`)
  } else {
    console.log('OK: в контексте сборки образа нет файлов-секретов')
  }

  if (includedNoiseDirs.length) {
    failed = true
    console.log(`FAIL: в контекст образа попадают node_modules/dist (${includedNoiseDirs.length}):`)
    for (const d of includedNoiseDirs) console.log(`  - ${d}`)
    console.log('  последствие: COPY server/ затрёт npm ci --omit=dev бинарниками хоста сборки')
  } else {
    console.log('OK: в контексте сборки образа нет node_modules/dist (в т.ч. вложенных)')
  }

  if (rsyncMissing.length) {
    failed = true
    console.log(`FAIL: rsync-строка в deploy.yml не исключает: ${rsyncMissing.join(', ')}`)
  } else {
    console.log(`OK: rsync исключает ${REQUIRED_RSYNC_EXCLUDES.join(', ')} (прод-.env переживает --delete)`)
  }

  if (failed) {
    console.log('\nИтог: контекст сборки и rsync-деплой не защищены.')
    process.exit(1)
  }
  console.log('\nИтог: секреты и мусор не попадают ни в образ, ни под rsync --delete.')
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main()
