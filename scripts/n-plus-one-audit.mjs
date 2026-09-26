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

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..')
const SRC = path.join(root, 'server', 'src')

const DB_CALL = /\b(pool|conn|connection|client|db)\s*\.\s*(query|execute)\s*\(/
const LOOP_HEADER = /\b(for|while)\s*\(|\.\s*(forEach|map|flatMap)\s*\(/

// Места, где N+1 остаётся намеренно. Причина обязательна: при добавлении нового
// случая сюда нужно писать, почему батчинг не подходит.
const JUSTIFIED = [
  { file: 'seed.js', reason: 'сидинг, не рантайм' },
  { file: 'jobs/push.job.js', lines: [46], reason: 'удаление мёртвой push-подписки по коду 410/404 — сам delete идёт только для отваливших, их единицы' },
  { file: 'routes/push.js', lines: [148, 174], reason: 'то же: чистка подписок по 410/404, а не по каждой подписке' },
  { file: 'routes/profile.js', lines: [463], reason: 'user_interests — фиксированный каталог из 28 interest_id, потолок известен и мал' },
  { file: 'routes/hangouts.js', lines: [633, 638], reason: 'рассылка уведомлений об отмене встречи: цикл даёт изоляцию ошибок на пользователя (один сбойный INSERT не срывает остальных)' },
]

function collectFiles(dir) {
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

function stripNonCode(line) {
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

function analyze(file) {
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

function justifiedFor(rel, line) {
  return JUSTIFIED.find((j) => {
    if (!rel.includes(j.file)) return false
    if (!j.lines) return true
    return j.lines.includes(line)
  })
}

function main() {
  const files = collectFiles(SRC)
  const unexpected = []
  let accepted = 0

  for (const file of files) {
    const rel = path.relative(root, file).replace(/\\/g, '/')
    const { findings } = analyze(file)
    for (const f of findings) {
      const rule = justifiedFor(rel, f.line)
      if (rule) accepted++
      else unexpected.push({ rel, ...f })
    }
  }

  console.log(`N+1 audit: просмотрено ${files.length} файлов в server/src`)
  console.log(`Новых мест с SQL внутри цикла: ${unexpected.length} (допустимых по JUSTIFIED: ${accepted})\n`)

  if (!unexpected.length) {
    console.log('Новых N+1 не найдено — все оставшиеся места внесены в JUSTIFIED с причиной.')
    process.exit(0)
  }

  for (const f of unexpected) {
    console.log(`  ${f.rel}:${f.line}  внутри цикла с :${f.loopStart}  ${f.header}`)
  }
  console.log('')
  console.log('Как править:')
  console.log('  1) SELECT для всех id одним запросом — mysql2 расплющивает массив в IN (?, ?, ?);')
  console.log('  2) или INSERT ... SELECT / LEFT JOIN + GROUP BY, если пишем по каждой строке;')
  console.log('  3) если запрос внутри цикла намеренный — внеси его в JUSTIFIED этого')
  console.log('     скрипта с указанием строки и причины, иначе новый N+1 пройдёт мимо.')
  process.exit(1)
}

main()
