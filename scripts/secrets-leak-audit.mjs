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
 *  3. Содержимое отслеживаемых текстовых файлов. Первые два канала смотрят на
 *     ИМЯ файла, поэтому секрет, вписанный значением в обычный `README.md`,
 *     для них невидим. Именно так в репозиторий попал VAPID-приватный ключ:
 *     `README.md:371` в блоке «Настройка .env» содержал реальный
 *     `VAPID_PRIVATE_KEY=b370…`, и он уехал на GitHub вместе с историей —
 *     гейт был зелёный, потому что `.dockerignore` про `*.md` не говорит.
 *
 * Гейт не доверяет глазам: он обходит дерево репозитория, применяет правила
 * .dockerignore и требует, чтобы ни один файл с признаками секрета не попал в
 * контекст; отдельно проверяет, что rsync-строка в deploy.yml исключает
 * секреты и uploads; и читает содержимое текстовых файлов, отбрасывая
 * placeholder'ы (`change-me`, `your-…`, `${…}`), иначе гейт краснеет на
 * `.env.example` и его отключают.
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

// Обязательные rsync-исключения — только то, что не выводится из правил
// секретов: `.env` (прод-конфиг, который переживает --delete) и `uploads`
// (каталог фото на volume, не секрет). Классы файлов-секретов проверяются
// отдельно и вычисляются, а не перечисляются здесь: список-константа была
// ровно тем дефектом, который закрывает этап 35 (см. SECRET_FILE_SAMPLES).
const REQUIRED_RSYNC_EXCLUDES = ['.env', 'uploads']

/**
 * Образцы имён файлов-секретов: по одному на каждую ветку `SECRET_FILE_RE`.
 *
 * Это НЕ список «что сейчас лежит в репозитории»: в CI после checkout таких
 * файлов нет вообще (`.env` и `.jwt-dev-secret` в `.gitignore`), и проверка по
 * наличию файлов была бы честно зелёной на настоящей дыре. Именно так и вышло:
 * `server/.jwt-dev-secret` исключён `.dockerignore` (паттерн для файлов, имя
 * которых заканчивается на дефис и `secret`) и потому не попадал в образ, но
 * не матчился НИ ОДНИМ rsync-исключением — и ехал на VPS, пока гейт
 * оставался зелёным. Тест гейта требует, чтобы каждый образец сам
 * признавался секретом в `isSecretPath`, иначе эти два списка разъедутся.
 */
export const SECRET_FILE_SAMPLES = [
  '.env',
  '.env.local',
  '.env.production',
  '.env.development',
  '.jwt-dev-secret',
  'app.secret',
  'tls.pem',
  'tls.key',
  'tls.p12',
  'tls.pfx',
  'id_rsa',
  'id_ed25519',
]

const ALWAYS_SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'coverage', '.vite'])

// Признаки файла-секрета. `.env.example` — не секрет: он и должен ехать в
// репозиторий, и его использует деплой (`cp .env.example .env`).
// `.jwt-dev-secret` — реальное имя dev-секрета (server/src/middleware.js:8),
// суффикс через дефис, поэтому в список попал явно, а не общим `\.(secret|…)$`.
const SECRET_FILE_RE = /(^|\/)\.env$|(^|\/)\.env\.(local|production|development)$|(^|\/)\.jwt-dev-secret$|\.(secret|pem|key|p12|pfx)$|(^|\/)id_(rsa|ed25519)$/

export function isSecretPath(relPath) {
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

/** Значения `--exclude` из строки switches (кавычки у rsync — часть синтаксиса). */
export function parseRsyncExcludes(switches) {
  return [...switches.matchAll(/--exclude(?:=|\s+)['"]?([^'"\s]+)['"]?/g)].map((m) => m[1])
}

/**
 * Мини-матчер шаблона rsync, семантика ровно rsync-овая и в одном пункте
 * противоположна .dockerignore: шаблон БЕЗ слеша матчит basename на любой
 * глубине (`.env` — это и `.env`, и `server/.env`), а `*` не проходит через
 * `/`. Шаблон со слешем (или ведущим `/`) сверяется с полным относительным
 * путём. Если бы матчер повторял docker-семантику, гейт зеленил бы сломанную
 * rsync-строку и пропустил бы ровно ту утечку, ради которой он написан.
 */
export function compileRsyncPattern(pattern) {
  const body = pattern.replace(/^\//, '')
  const byPath = body.includes('/')
  let re = ''
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]
    if (ch === '*') {
      if (body[i + 1] === '*') {
        re += '.*'
        i += 1
      } else {
        re += '[^/]*'
      }
    } else if (ch === '?') {
      re += '[^/]'
    } else {
      re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return { byPath, re: new RegExp(`^${re}$`) }
}

/**
 * Классы файлов-секретов, не покрытые ни одним rsync-исключением: именно они
 * уедут на VPS, оставаясь в `.gitignore` (в образ их закрывает `.dockerignore`).
 */
export function findRsyncSecretGaps(deployYml, samples = SECRET_FILE_SAMPLES) {
  const rules = parseRsyncExcludes(findRsyncSwitches(deployYml)).map(compileRsyncPattern)
  return samples.filter(
    (sample) => !rules.some((rule) => rule.re.test(rule.byPath ? sample : path.posix.basename(sample))),
  )
}

/**
 * Расширения файлов, содержимое которых имеет смысл читать. Двоичные и
 * vendor-каталоги отсекаются раньше по ALWAYS_SKIP_DIRS; `.env` и `.env.*`
 * попадают сюда по имени, а не по расширению (у них его нет).
 */
const CONTENT_SCAN_EXTENSIONS = new Set([
  '.md', '.txt', '.yml', '.yaml', '.json', '.ts', '.tsx', '.js', '.mjs', '.cjs',
  '.ps1', '.sh', '.bat', '.conf', '.html', '.env', '.example',
])

/**
 * Признаки настоящего секрета в строке документа или исходника.
 *
 * Провайдерские правила берутся по формату самого токена (префиксы `sk-`,
 * `AKIA`, `sk_live_`, `ghp_`), общее — по имени переменной. Значение общего
 * правила отбрасывается двумя фильтрами: PLACEHOLDER (настоящие заглушки,
 * которые обязаны лежать в репозитории) и CI_VALUE (тестовые константы в
 * workflow, где секретами не являются).
 */
const SECRET_VALUE_RULES = [
  { name: 'VAPID private key', re: /VAPID_PRIVATE_KEY\s*[=:]\s*["']?([A-Za-z0-9_-]{40,})/ },
  { name: 'приватный ключ PEM', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'ключ OpenAI', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/ },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'живой ключ Stripe', re: /\b[sr]k_live_[A-Za-z0-9]{16,}/ },
  { name: 'токен GitHub', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/ },
  { name: 'токен Slack', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  {
    name: 'присваивание секрета',
    re: /\b([A-Z][A-Z0-9_]*(?:SECRET|PRIVATE_KEY|ACCESS_TOKEN|API_KEY|PASSWORD|DSN|TOKEN))\s*[=:]\s*["']?([^\s"'#,;)\]}]{24,})/,
  },
]

const PLACEHOLDER_PREFIX_RE = /^(?:change[-_]?|example\b|placeholder|your[-_]|dummy|sample|redact|insert|replace)/i

const PLACEHOLDER_ANYWHERE_RE = /\$\{|\$\(|process\.env|import\.meta\.env|example\.(?:invalid|com|org|net|test)|localhost|127\.0\.0\.1|<\w|\.\.\.|\bundefined\b|\bnull\b|\bxxx+\b|\byyy+\b|\bdummy\b|\bsample\b|\bredact/i

const CI_VALUE_RE = /^(?:ci|test|demo|dev|local)[-_]|^(?:swiftmatch|demo|local)_|^(?:test|demo|local)[0-9]/i

/**
 * Файлы, освобождённые от проверки содержимого: тест самого гейта обязан
 * содержать правдоподобные токены, иначе проверять правила нечем.
 */
const CONTENT_SCAN_ALLOWLIST = new Set(['scripts/secrets-leak-audit.test.mjs'])

/** Секреты, записанные значением в отслеживаемые текстовые файлы. */
export function findContentSecrets(root) {
  const hits = []
  for (const rel of walk(root)) {
    if (CONTENT_SCAN_ALLOWLIST.has(rel)) continue
    const base = path.basename(rel)
    const ext = path.extname(base) || (/^\.env/.test(base) ? '.env' : '')
    if (!CONTENT_SCAN_EXTENSIONS.has(ext)) continue
    let text
    try {
      text = fs.readFileSync(path.join(root, rel), 'utf8')
    } catch {
      continue
    }
    const lines = text.split(/\r?\n/)
    for (const rule of SECRET_VALUE_RULES) {
      for (let i = 0; i < lines.length; i += 1) {
        rule.re.lastIndex = 0
        const match = rule.re.exec(lines[i])
        if (!match) continue
        const value = String(match[2] ?? match[1] ?? match[0])
        if (PLACEHOLDER_PREFIX_RE.test(value) || PLACEHOLDER_ANYWHERE_RE.test(value)) continue
        if (rule.name === 'присваивание секрета' && CI_VALUE_RE.test(value)) continue
        hits.push({ file: rel, line: i + 1, rule: rule.name, value })
      }
    }
  }
  return hits.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
}

export function audit(root) {
  const dockerignoreMissing = checkDockerignorePatterns(root)
  const contextSecrets = findContextSecrets(root)
  const includedNoiseDirs = findIncludedNoiseDirs(root)
  const contentSecrets = findContentSecrets(root)
  const deployYml = fs.readFileSync(path.join(root, '.github/workflows/deploy.yml'), 'utf8')
  const rsyncMissing = checkRsyncExcludes(deployYml)
  const rsyncSecretGaps = findRsyncSecretGaps(deployYml)
  return { dockerignoreMissing, contextSecrets, includedNoiseDirs, contentSecrets, rsyncMissing, rsyncSecretGaps }
}

function main() {
  const root = process.argv[2] || process.cwd()
  const { dockerignoreMissing, contextSecrets, includedNoiseDirs, contentSecrets, rsyncMissing, rsyncSecretGaps } = audit(root)
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

  if (contentSecrets.length) {
    failed = true
    console.log(`FAIL: секреты записаны значением в отслеживаемых файлах (${contentSecrets.length}):`)
    for (const hit of contentSecrets) {
      console.log(`  - ${hit.file}:${hit.line} [${hit.rule}] ${hit.value.slice(0, 12)}…`)
    }
    console.log('  последствие: значение уезжает в публичный репозиторий вместе с историей коммитов')
  } else {
    console.log('OK: в отслеживаемых текстовых файлах нет значений секретов (только placeholder-ы)')
  }

  if (rsyncMissing.length) {
    failed = true
    console.log(`FAIL: rsync-строка в deploy.yml не исключает: ${rsyncMissing.join(', ')}`)
  } else {
    console.log(`OK: rsync исключает ${REQUIRED_RSYNC_EXCLUDES.join(', ')} (прод-.env переживает --delete)`)
  }

  if (rsyncSecretGaps.length) {
    failed = true
    console.log(`FAIL: rsync на деплое не исключает файлы-секреты (${rsyncSecretGaps.length}): ${rsyncSecretGaps.join(', ')}`)
    console.log('  последствие: эти файлы закрыты .dockerignore и .gitignore, поэтому в образ не попадают, но едут на VPS')
  } else {
    console.log(`OK: rsync исключает все ${SECRET_FILE_SAMPLES.length} классов файлов-секретов, а не только перечисленные в гейте`)
  }

  if (failed) {
    console.log('\nИтог: контекст сборки, rsync-деплой и содержимое документации не защищены.')
    process.exit(1)
  }
  console.log('\nИтог: секреты не попадают ни в образ, ни под rsync --delete, ни в репозиторий значениями.')
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main()
