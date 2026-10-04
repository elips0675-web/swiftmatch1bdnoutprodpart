#!/usr/bin/env node
// N+1 Query Audit — статически ищет SQL-запросы, выполняемые ВНУТРИ циклов по
// коллекции. Один такой цикл на 50 строк = 51 запрос вместо 2.
//
// Дополняет sql-explain-audit.mjs (проверяет сами запросы) и index-аудит
// (проверяет индексы): здесь проверяется форма ответа, а не план.
//
// Запуск: node scripts/n-plus-one-audit.mjs
// Выход: код 0 — находок нет, код 1 — есть находки (для CI).
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(root, 'server', 'src')

const DB_CALL = /\b(pool|conn|connection|client|db)\s*\.\s*(query|execute)\s*\(/
const LOOP_HEADER = /\b(for|while)\s*\(|\.\s*(forEach|map|flatMap)\s*\(/

// Места, где N+1 остаётся намеренно. Причина обязательна: при добавлении нового
// случая сюда нужно писать, почему батчинг не подходит.
//
// `expect` — якорь: текст, который ОБЯЗАН остаться на указанной строке. Без него
// оправдание молча протухает: код сдвинулся на 12 строк, номер в списке остался
// прежним, и гейт начинает ругаться на «новый N+1» в месте, которое оправдано
// уже год (замер 04.10.2026: так отвалились profile.js:463 и hangouts.js:633,638).
// С якорем протухание — самостоятельная находка `justification-drift`.
export const JUSTIFIED = [
  { file: 'seed.js', reason: 'сидинг, не рантайм' },
  {
    file: 'jobs/push.job.js',
    lines: [46],
    expect: 'DELETE',
    reason: 'удаление мёртвой push-подписки по коду 410/404 — сам delete идёт только для отваливших, их единицы',
  },
  {
    file: 'routes/push.js',
    lines: [148, 174],
    expect: 'DELETE',
    reason: 'то же: чистка подписок по 410/404, а не по каждой подписке',
  },
]

export function collectFiles(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue
      out.push(...collectFiles(full))
    } else if (/\.(js|mjs|cjs)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

export function stripNonCode(line) {
  let out = ''
  let quote = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quote) {
      if (c === '\\') { i++; continue }
      if (c === quote) quote = null
      out += ' '
      continue
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; out += ' '; continue }
    if (c === '/' && line[i + 1] === '/') break
    out += c
  }
  return out
}

export function analyze(file) {
  const raw = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  const code = raw.map(stripNonCode)

  const depth = []
  let d = 0
  for (const line of code) {
    depth.push(d)
    for (const c of line) {
      if (c === '{') d++
      else if (c === '}') d--
    }
  }

  const loops = []
  for (let i = 0; i < code.length; i++) {
    if (!LOOP_HEADER.test(code[i])) continue
    // Учитываем только циклы с телом-блоком: `for (const x of y) {` или
    // `rows.map((r) => {`. Expression-bodied `.map(r => r.id)` — это не цикл
    // с запросами, и `.filter(...)`/`.some(...)` — предикаты, а не statement body.
    if (!code[i].trimEnd().endsWith('{')) continue
    let end = code.length - 1
    for (let j = i + 1; j < code.length; j++) {
      if (depth[j] <= depth[i]) { end = j; break }
    }
    loops.push({ start: i + 1, end: end + 1, depth: depth[i], header: raw[i].trim().slice(0, 90) })
  }

  const findings = []
  for (let i = 0; i < code.length; i++) {
    if (!DB_CALL.test(code[i])) continue
    const owner = loops
      .filter((l) => i + 1 >= l.start && i + 1 <= l.end)
      .sort((a, b) => b.depth - a.depth)[0]
    if (!owner) continue
    findings.push({ line: i + 1, loopStart: owner.start, header: owner.header })
  }
  return { totalLoops: loops.length, findings }
}

export function justifiedFor(rel, line, list = JUSTIFIED) {
  return list.find((j) => {
    if (!rel.includes(j.file)) return false
    if (!j.lines) return true
    return j.lines.includes(line)
  })
}

/**
 * Оправдание протухло: строка сдвинулась и на ней больше нет того SQL,
 * ради которого её вносили. Молча оставить такое нельзя — список оправданий
 * тогда превращается в мусор, который выглядит как «всё проверили».
 */
export function collectJustificationDrift(srcDir = SRC, list = JUSTIFIED) {
  const files = collectFiles(srcDir)
  const drift = []
  for (const j of list) {
    if (!j.lines || !j.expect) continue
    const full = files.find((f) => f.replace(/\\/g, '/').includes(j.file))
    if (!full) {
      drift.push({ file: j.file, line: j.lines[0], reason: `файл не найден под ${srcDir}` })
      continue
    }
    const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/)
    for (const line of j.lines) {
      const text = lines[line - 1] ?? ''
      if (!text.includes(j.expect)) {
        drift.push({ file: j.file, line, reason: `на строке нет «${j.expect}»: ${text.trim().slice(0, 60) || '(строка вне файла)'}` })
      }
    }
  }
  return drift
}

export function audit(srcDir = SRC, list = JUSTIFIED) {
  const files = collectFiles(srcDir)
  const unexpected = []
  let accepted = 0

  for (const file of files) {
    const rel = path.relative(root, file).replace(/\\/g, '/')
    const { findings } = analyze(file)
    for (const f of findings) {
      const rule = justifiedFor(rel, f.line, list)
      if (rule) accepted++
      else unexpected.push({ rel, ...f })
    }
  }

  const drift = collectJustificationDrift(srcDir, list)
  return { filesCount: files.length, unexpected, accepted, drift }
}

export function report({ filesCount, unexpected, accepted, drift }, log = console.log) {
  log(`N+1 audit: просмотрено ${filesCount} файлов в server/src`)
  log(`Новых мест с SQL внутри цикла: ${unexpected.length} (допустимых по JUSTIFIED: ${accepted})\n`)

  for (const f of unexpected) {
    log(`  ${f.rel}:${f.line}  внутри цикла с :${f.loopStart}  ${f.header}`)
  }
  for (const d of drift) {
    log(`  ОПРАВДАНИЕ ПРОТУХЛО ${d.file}:${d.line} — ${d.reason}`)
  }
  if (!unexpected.length && !drift.length) {
    log('Новых N+1 не найдено — все оставшиеся места внесены в JUSTIFIED с причиной и якорем.')
    return 0
  }

  log('')
  log('Как править:')
  log('  1) SELECT для всех id одним запросом — mysql2 расплющивает массив в IN (?, ?, ?);')
  log('  2) или INSERT ... VALUES (?,?),(?,?) одним запросом / INSERT ... SELECT, если пишем по каждой строке;')
  log('  3) если запрос внутри цикла намеренный — внеси его в JUSTIFIED этого')
  log('     скрипта с указанием строки, причины и якоря `expect`, иначе новый N+1 пройдёт мимо;')
  log('  4) протухшее оправдание (строка сдвинулась) — обнови номер строки и якорь,')
  log('     либо почини место, если оно больше не намеренное.')
  return 1
}

function main() {
  process.exit(report(audit(SRC)))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
