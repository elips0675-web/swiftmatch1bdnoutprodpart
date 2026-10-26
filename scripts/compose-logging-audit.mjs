/**
 * Гейт «логи контейнеров ограничены, а диск не чистят командой, убивающей
 * откат» (26.10.2026).
 *
 * Класс дыр: Docker выглядит виновником «съеденного диска», но `docker system
 * df` показывает 4 ГБ образов и ноль контейнеров — то есть смотреть некуда.
 * Причина складывается из трёх независимых вещей, и каждая молчит по-своему:
 *
 *  1. У сервиса в `docker-compose.yml` нет `logging:` — драйвер json-file
 *     пишет `/var/lib/docker/containers/<id>/<id>-json.log` без предела, а
 *     `docker system prune` логи РАБОТАЮЩЕГО контейнера не удаляет: файл растёт
 *     годами и не виден ни в одном отчёте Docker.
 *  2. У Prometheus не задан retention: том `prometheus_data` растёт по
 *     дефолту драйвера, и «сколько осталось» видно только по `df` на VPS.
 *  3. Очистка через `docker system prune -a` / `--volumes` удаляет то, что не
 *     занято запущенным контейнером, — то есть **образ под тегом `:rollback`**
 *     (`deploy.yml` снимает его до сборки как цель автоматического отката) и
 *     тома `db_data` / `uploads_data`. «Освободили диск» = откат больше
 *     физически невозможен, а база и фото пользователей удалены.
 *
 * Гейт держит структуру, а не поведение на VPS: он не запускает Docker и не
 * читает живой демон (локально Docker может отсутствовать), но без лимита в
 * compose логи снова никем не ограничены, а без запрета prune деплой-скрипт
 * снова может «починить место» ценой отката.
 */

import fs from 'node:fs'
import path from 'node:path'

export const COMPOSE_FILE = 'docker-compose.yml'
export const WORKFLOWS_DIR = '.github/workflows'

const REQUIRED_DRIVER = 'json-file'
const MAX_SIZE_LIMIT_BYTES = 100 * 1024 * 1024
const MAX_FILE_LIMIT = 10

const PRUNE_BLOCKERS = [
  { re: /docker\s+system\s+prune[^\n]*/g, what: 'docker system prune' },
  { re: /docker\s+image\s+prune[^\n]*(?:-a|--all)/g, what: 'docker image prune -a' },
  { re: /docker\s+volume\s+prune[^\n]*/g, what: 'docker volume prune' },
  { re: /docker\s+container\s+prune[^\n]*-a[^\n]*/g, what: 'docker container prune -a' },
]

/** Секция сервиса верхнего уровня (отступ 2) из docker-compose.yml. */
export function getServiceSection(compose, name) {
  const lines = compose.split(/\r?\n/)
  const start = lines.findIndex((l) => new RegExp(`^ {2}${name}:\\s*$`).test(l))
  if (start === -1) return ''
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => /^ {2}\S/.test(l) || /^\S/.test(l))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n')
}

/** Имена сервисов: ключи с отступом 2 внутри блока `services:`. */
export function getServiceNames(compose) {
  const lines = compose.split(/\r?\n/)
  const start = lines.findIndex((l) => /^services:\s*$/.test(l))
  if (start === -1) return []
  const names = []
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]
    if (/^\S/.test(line)) break
    const m = line.match(/^ {2}([A-Za-z0-9_.-]+):\s*$/)
    if (m) names.push(m[1])
  }
  return names
}

/**
 * Блоки-якоря верхнего уровня (`x-logging: &default-logging`) по имени якоря:
 * `{ 'default-logging': '  driver: json-file\n  options:\n ...' }`.
 */
export function getAnchors(compose) {
  const lines = compose.split(/\r?\n/)
  const anchors = {}
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^x-[A-Za-z0-9_.-]+:\s*&([A-Za-z0-9_.-]+)\s*$/)
    if (!m) continue
    const block = []
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\S/.test(lines[j])) break
      if (/^\s*#/.test(lines[j])) continue
      block.push(lines[j])
    }
    anchors[m[1]] = block.join('\n')
  }
  return anchors
}

/** Размер из строки вида `10m` / `100M` / `1g` в байтах; `null` — не разобрать. */
export function parseSize(value) {
  const m = String(value || '').trim().replace(/^["']|["']$/g, '').match(/^(\d+)\s*([kmg])?$/i)
  if (!m) return null
  const unit = (m[2] || 'b').toLowerCase()
  const mult = unit === 'g' ? 1024 ** 3 : unit === 'm' ? 1024 ** 2 : unit === 'k' ? 1024 : 1
  return Number(m[1]) * mult
}

/**
 * Действующий блок `logging:` сервиса: `{ driver, maxSize, maxFile, source }`,
 * где `source` — `inline` либо имя якоря. `null` — логи не ограничены.
 * Алиас (`logging: *default-logging`) раскрывается до блока `x-…: &default-logging`.
 */
export function getLogging(compose, name) {
  const section = getServiceSection(compose, name)
  if (!section) return null
  const alias = section.match(/^\s+logging:\s*\*([A-Za-z0-9_.-]+)\s*$/m)
  let block = ''
  let source = 'inline'
  if (alias) {
    source = alias[1]
    const anchors = getAnchors(compose)
    block = anchors[alias[1]] || ''
  } else {
    const inlineAt = section.split(/\r?\n/).findIndex((l) => /^\s+logging:\s*$/.test(l))
    if (inlineAt !== -1) {
      const lines = section.split(/\r?\n/)
      const collected = []
      for (let i = inlineAt + 1; i < lines.length; i++) {
        if (/^\s{0,4}\S/.test(lines[i])) break
        collected.push(lines[i])
      }
      block = collected.join('\n')
    }
  }
  if (!block.trim()) return null
  const driver = (block.match(/driver:\s*["']?([A-Za-z0-9_.-]+)["']?/) || [])[1] || ''
  const maxSize = (block.match(/max-size:\s*["']?([^"'\s]+)["']?/) || [])[1] || ''
  const maxFile = (block.match(/max-file:\s*["']?(\d+)["']?/) || [])[1] || ''
  return { driver, maxSize, maxFile, source }
}

/** Команда сервиса prometheus обязана ограничивать том по времени ИЛИ размеру. */
export function getPrometheusRetention(compose) {
  const section = getServiceSection(compose, 'prometheus')
  if (!section) return null
  const clean = (v) => String(v || '').replace(/['"]/g, '')
  const time = clean((section.match(/--storage\.tsdb\.retention\.time=(\S+)/) || [])[1])
  const size = clean((section.match(/--storage\.tsdb\.retention\.size=(\S+)/) || [])[1])
  if (!time && !size) return null
  return { time, size }
}

/**
 * Строки-комментарии (`# ...`) заменяются пустыми, нумерация строк сохраняется.
 * Без этого гейт падал на собственном объяснении «почему prune нельзя»: эта
 * строка сама содержит запрещённую команду и не исполняется. Обратная сторона
 * — гейт не зеленеет от упоминания команды в комментарии (см. тесты).
 */
export function stripCommentLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => (/^\s*#/.test(line) ? '' : line))
    .join('\n')
}

/** Находки по workflow-файлам: очистка, которая уносит `:rollback` и тома. */
export function findPruneCalls(root) {
  const dir = path.join(root, WORKFLOWS_DIR)
  const findings = []
  let files = []
  try {
    files = fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))
  } catch {
    return [{ file: WORKFLOWS_DIR, text: 'каталог workflow не найден — запрет prune проверить нечем' }]
  }
  for (const file of files) {
    const text = stripCommentLines(fs.readFileSync(path.join(dir, file), 'utf8'))
    for (const { re, what } of PRUNE_BLOCKERS) {
      re.lastIndex = 0
      let m
      while ((m = re.exec(text)) !== null) {
        const line = text.slice(0, m.index).split(/\r?\n/).length
        findings.push({
          file: `${WORKFLOWS_DIR}/${file}`,
          line,
          text: `${what} — удаляет неиспользуемые образы (включая ${':rollback'}, цель автоматического отката) и/или тома db_data / uploads_data; чистить диск этим нельзя (docs/AGENTS-deployment.md, «Диск и логи контейнеров»)`,
        })
      }
    }
  }
  return findings
}

export function audit(root) {
  const problems = []
  const facts = { services: [], retention: null }

  let compose = ''
  try {
    compose = fs.readFileSync(path.join(root, COMPOSE_FILE), 'utf8')
  } catch {
    problems.push(`${COMPOSE_FILE}: файл не найден — лимиты логов проверить нечем`)
    return { facts, problems }
  }

  const names = getServiceNames(compose)
  if (!names.length) {
    problems.push(`${COMPOSE_FILE}: не найдено ни одного сервиса — гейт проверяет пустое множество`)
    return { facts, problems }
  }

  for (const name of names) {
    const logging = getLogging(compose, name)
    if (!logging) {
      problems.push(`${COMPOSE_FILE}: у сервиса ${name} нет logging: — json-file пишет лог без предела, а \`docker system prune\` логи работающего контейнера не удаляет`)
      facts.services.push({ name, logging: 'нет' })
      continue
    }
    facts.services.push({ name, logging: `${logging.driver || '?'} ${logging.maxSize || '?'}×${logging.maxFile || '?'} (${logging.source})` })

    if (logging.driver !== REQUIRED_DRIVER) {
      problems.push(`${COMPOSE_FILE}: у сервиса ${name} driver «${logging.driver || 'нет'}», а нужен ${REQUIRED_DRIVER} — иначе \`docker compose logs\` теряет вывод, либо лимит не применяется вовсе`)
    }
    const bytes = parseSize(logging.maxSize)
    if (bytes === null) {
      problems.push(`${COMPOSE_FILE}: у сервиса ${name} нет max-size (или он не разбирается как размер) — один файл лога растёт без предела`)
    } else if (bytes > MAX_SIZE_LIMIT_BYTES) {
      problems.push(`${COMPOSE_FILE}: у сервиса ${name} max-size=${logging.maxSize} больше 100 МБ — это не лимит, а отложенная проблема`)
    }
    const files = Number(logging.maxFile)
    if (!logging.maxFile || !Number.isFinite(files) || files < 1) {
      problems.push(`${COMPOSE_FILE}: у сервиса ${name} нет max-file — ротации нет, предыдущие файлы не удаляются`)
    } else if (files > MAX_FILE_LIMIT) {
      problems.push(`${COMPOSE_FILE}: у сервиса ${name} max-file=${logging.maxFile} больше ${MAX_FILE_LIMIT} — ${files} файлов на контейнер снова складываются в гигабайты`)
    }
  }

  facts.retention = getPrometheusRetention(compose)
  if (!facts.retention) {
    problems.push(`${COMPOSE_FILE}: у сервиса prometheus нет --storage.tsdb.retention.time/size — том prometheus_data растёт без ограничения`)
  }

  const prunes = findPruneCalls(root)
  facts.prunes = prunes.length
  for (const p of prunes) problems.push(`${p.file}:${p.line || 1}: ${p.text}`)

  return { facts, problems }
}

function main() {
  const root = process.argv[2] || process.cwd()
  const { facts, problems } = audit(root)

  console.log(`сервисов в ${COMPOSE_FILE}: ${facts.services.length}`)
  for (const s of facts.services) console.log(`  ${s.name}: ${s.logging}`)
  console.log(`retention Prometheus: ${facts.retention ? [facts.retention.time && `time=${facts.retention.time}`, facts.retention.size && `size=${facts.retention.size}`].filter(Boolean).join(', ') : 'не задан'}`)
  console.log(`запрещённых prune в workflow: ${facts.prunes || 0}`)

  if (problems.length) {
    console.log('')
    for (const p of problems) console.log(`FAIL: ${p}`)
    console.log('\nИтог: логи контейнеров и/или том Prometheus растут без предела, либо диск чистят командой, которая уносит откат и данные.')
    process.exit(1)
  }
  console.log('\nИтог: у каждого сервиса лимит логов, у Prometheus retention, а prune-команд, уносящих :rollback и тома, в workflow нет.')
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main()
