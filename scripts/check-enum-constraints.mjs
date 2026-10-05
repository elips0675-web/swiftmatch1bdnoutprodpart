/**
 * Гейт «ограничения схемы (CHECK/ENUM) ↔ валидаторы кода» (этап 37, N4).
 *
 * MySQL отвечает на нарушение CHECK и на значение вне ENUM не 400, а 500 —
 * ограничение живёт в схеме, а проверяет его код. Если ограничение в схеме
 * строже кода, пользователь получает «500 Internal Server Error» на ровно том
 * поле, где ожидал «заполните корректно». Класс закрывают четыре проверки:
 *
 *  1. **Границы код ↔ CHECK.** `intField(v, 'height', { min, max })` не имеет
 *     права быть шире диапазона из `CHECK (height >= 100 AND height <= 250)`:
 *     код пропустит 150 → БД вернёт ошибку, и вместо внятного 400 пользователь
 *     получит 500. Обратное (код строже схемы) — не находка: лишняя проверка в
 *     коде ничего не ломает.
 *  2. **Диапазонный CHECK обязан быть покрыт кодом.** Для каждой таблицы с
 *     диапазонным CHECK ищем файлы, которые в неё пишут (`INSERT INTO` /
 *     `UPDATE`), и требуем в них проверки обеих границ — через `intField` или
 *     вручную (`parsedRating < 1 || parsedRating > 5`). Нет проверки — заведомо
 *     достижимый 500 на пользовательском вводе.
 *  3. **Именованные списки кода ⊆ ENUM схемы.** Константа-массив строк
 *     (`const validTags = [...]`) объявляет белый список для колонки. Связка с
 *     колонкой вычисляется, а не задаётся человеком: константа проверяется
 *     против ENUM только тех таблиц, к которым этот же файл обращается по
 *     SQL. Иначе получился бы ложный класс находок: `CHANNELS = ['inApp',
 *     'push']` в `notification-prefs.js` имеет ничего общего с
 *     `campaigns.channel ENUM('push','email')`, а связать их можно было бы по
 *     одному имени колонки.
 *  4. **Литералы в INSERT/UPDATE против ENUM.** Самая прямая проверка: если код
 *     пишет в ENUM-колонку строковый литерал, которого в ENUM нет, БД отклонит
 *     запрос. Значение `'active'` в `hangouts.status` проходит, а опечатка в
 *     `'activ'` даёт 500 на каждом таком запросе.
 *
 * Чего гейт не делает (и это не «покрыто»): не анализирует поток данных от
 * `req.body` до INSERT — то есть не ловит клиентское значение без белого
 * списка. Это отдельная работа, и гейт не притворяется, что закрывает её.
 *
 * Связь «код ↔ схема» тут читается из файлов, а не из подключённой БД, поэтому
 * гейт зелёный без MySQL и одинаково работает в CI.
 */

import fs from 'node:fs'
import path from 'node:path'

const SCHEMA = 'database/mysql_schema.sql'
const SERVER_ROOT = 'server/src'
const SKIP_DIRS = new Set(['__tests__', 'node_modules'])

/** Таблицы, ограничение которых проверяем только по границам, но не ищем покрытие. */
const RANGE_KIND = /^\s*CONSTRAINT\s+\S+\s+CHECK\s*\(/i

function readRepoFile(root, rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

function listJsFiles(dir, root, acc = []) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = path.join(dir, name)
    if (fs.statSync(full).isDirectory()) listJsFiles(full, root, acc)
    else if (name.endsWith('.js')) acc.push(path.relative(root, full).replace(/\\/g, '/'))
  }
  return acc
}

/**
 * Ограничения из `mysql_schema.sql`: ENUM-колонки и диапазонные CHECK.
 *
 * Диапазонным считается только `col BETWEEN a AND b` и `col >= a AND col <= b`:
 * всё остальное (`id = 1`, условия на несколько колонок) диапазоном не
 * является, и выводить из него границы для валидатора нельзя — иначе гейт
 * требовал бы несуществующего `{ min, max }`.
 */
export function parseSchema(sql) {
  const text = sql.replace(/\r\n/g, '\n')
  const enums = new Map()
  const ranges = []
  let table = null

  for (const line of text.split('\n')) {
    const create = line.match(/^CREATE TABLE (?:IF NOT EXISTS )?`?(\w+)`?/i)
    if (create) {
      table = create[1]
      continue
    }
    if (/^\)\s*(;|ENGINE)/i.test(line) || /^\);/.test(line)) table = null
    if (!table) continue

    const e = line.match(/^\s*`?(\w+)`?\s+enum\s*\(([^)]*)\)/i)
    if (e) {
      const values = e[2].split(',').map((v) => v.trim().replace(/^'|'$/g, ''))
      enums.set(`${table}.${e[1]}`, values)
    }

    if (RANGE_KIND.test(line)) {
      const expr = line.replace(/^.*CHECK\s*\(/i, '')
      const between = /`?(\w+)`?\s+between\s+(-?\d+)\s+and\s+(-?\d+)/i.exec(expr)
      if (between) {
        ranges.push({ table, col: between[1], min: Number(between[2]), max: Number(between[3]) })
        continue
      }
      const lo = /`?(\w+)`?\s*>=\s*(-?\d+)/i.exec(expr)
      const hi = /`?(\w+)`?\s*<=\s*(-?\d+)/i.exec(expr)
      if (lo && hi && lo[1] === hi[1]) {
        ranges.push({ table, col: lo[1], min: Number(lo[2]), max: Number(hi[2]) })
      }
    }
  }

  return { enums, ranges }
}

/** Валидаторы кода: `intField(<что>, '<поле>', { min, max })` вне тестов. */
export function findCodeRangeValidators(source, rel) {
  const rows = []
  for (const m of source.matchAll(/intField\([^,]+,\s*'(\w+)'\s*,\s*\{([^}]*)\}/g)) {
    const min = /min:\s*(-?\d+)/.exec(m[2])
    const max = /max:\s*(-?\d+)/.exec(m[2])
    if (!min || !max) continue
    rows.push({
      file: rel,
      col: m[1],
      min: Number(min[1]),
      max: Number(max[1]),
      line: source.slice(0, m.index).split('\n').length,
    })
  }
  return rows
}

/**
 * Именованные списки строк: `const NAME = ['a','b']` (регистр имени любой).
 *
 * Берутся только массивы, где **все** элементы — строковые литералы: массив
 * объектов (`const TIERS = [{ id: 'plus', ... }]`) не является белым списком
 * значений, и вытаскивать из него строки бессмысленно (проба так делала и
 * получала «Plus», «5 файлов» — значения из соседних объектов).
 */
export function findNamedLists(source, rel) {
  const rows = []
  for (const m of source.matchAll(/\b(?:const|let)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(\[[^\]]*\])/g)) {
    const body = m[2].slice(1, -1).trim()
    if (!body) continue
    const items = body.split(',').map((s) => s.trim()).filter(Boolean)
    const literals = items.map((s) => /^'([^']*)'$/.exec(s))
    if (literals.some((l) => !l)) continue
    if (literals.length < 2) continue
    rows.push({
      file: rel,
      name: m[1],
      values: literals.map((l) => l[1]),
      line: source.slice(0, m.index).split('\n').length,
    })
  }
  return rows
}

/** Строковые литералы, попадающие в ENUM-колонки, плюс имена таблиц файла. */
export function findEnumLiteralMismatches(source, rel, enums) {
  const rows = []
  const tables = new Set()

  for (const m of source.matchAll(/\b(?:INSERT\s+INTO|UPDATE)\s+`?(\w+)`?\s*([\s\S]*?)(?=;|$)/gim)) {
    const table = m[1].toLowerCase()
    tables.add(table)
    const tail = m[2]

    const insert = /\(([^)]*)\)\s*VALUES\s*\(([^)]*)\)/i.exec(tail)
    if (insert) {
      const cols = insert[1].split(',').map((c) => c.trim().replace(/`/g, '').toLowerCase())
      const values = insert[2].split(',').map((v) => v.trim())
      cols.forEach((col, i) => {
        const allowed = enums.get(`${table}.${col}`)
        const lit = /^'([^']*)'$/.exec(values[i] || '')
        if (!allowed || !lit) return
        if (!allowed.includes(lit[1])) {
          rows.push({ file: rel, table, col, value: lit[1], allowed, kind: 'INSERT' })
        }
      })
    }

    for (const set of tail.matchAll(/\b(\w+)\s*=\s*'([^']*)'/g)) {
      const allowed = enums.get(`${table}.${set[1].toLowerCase()}`)
      if (!allowed || allowed.includes(set[2])) continue
      rows.push({ file: rel, table, col: set[1], value: set[2], allowed, kind: 'UPDATE' })
    }
  }

  return { rows, tables }
}

/** Есть ли в файле проверка диапазона [min, max]: через intField или вручную. */
export function hasRangeGuard(source, range) {
  const viaIntField = new RegExp(
    `intField\\([^,]+,\\s*'${range.col}'\\s*,\\s*\\{[^}]*min:\\s*${range.min}\\b[^}]*max:\\s*${range.max}\\b`,
  ).test(source)
  if (viaIntField) return 'intField'

  const inOneLine = [
    new RegExp(`<\\s*${range.min}\\b[^\\n]*>\\s*${range.max}\\b`),
    new RegExp(`>\\s*${range.max}\\b[^\\n]*<\\s*${range.min}\\b`),
  ].some((re) => re.test(source))
  return inOneLine ? 'ручная проверка' : null
}

/**
 * Проверка 1: код-валидатор не шире CHECK в схеме.
 */
export function auditValidatorBounds(validators, ranges) {
  const byBareCol = new Map()
  for (const r of ranges) {
    if (!byBareCol.has(r.col)) byBareCol.set(r.col, r)
  }

  const problems = []
  for (const v of validators) {
    const r = byBareCol.get(v.col)
    if (!r) continue
    if (v.min < r.min || v.max > r.max) {
      problems.push(
        `${v.file}:${v.line}: валидатор '${v.col}' разрешает ${v.min}..${v.max}, а схема требует ${r.min}..${r.max} ` +
          `(${r.table}.${r.col}) — клиент пройдёт код-валидацию и получит 500 от MySQL`,
      )
    }
  }
  return problems
}

/**
 * Проверка 2: диапазонный CHECK обязан быть покрыт проверкой в файле, который
 * пишет в эту таблицу.
 *
 * Ищутся именно INSERT/UPDATE, а не любые упоминания таблицы: CHECK защищает
 * запись, и файл, который только читает таблицу, клиентскому вводу ничего не
 * передаёт. Иначе гейт требовал бы валидатор в каждом читателе — например в
 * `SELECT`-ах ленты, где диапазон не проверяется и не должен.
 */
export function auditRangeCoverage(ranges, fileSources) {
  const problems = []
  for (const r of ranges) {
    const writers = [...fileSources.entries()].filter(
      ([, text]) => findTableMentionLines(text, { writesOnly: true }).has(r.table.toLowerCase()),
    )
    if (!writers.length) continue
    const guarded = writers.filter(([, text]) => hasRangeGuard(text, r))
    if (guarded.length) continue
    problems.push(
      `${r.table}.${r.col}: CHECK (${r.min}..${r.max}) не проверяется кодом — пишут ` +
        `${writers.map(([rel]) => rel).join(', ')}, и клиент может положить значение вне диапазона (500)`,
    )
  }
  return problems
}

/**
 * Слова имени: `validTags` → valid|tags|validtag, `HANGOUT_CATEGORIES` →
 * hangout|categories|category. Имя связывается с таблицей или колонкой по
 * этим словам, а не по «похожему на глаз» префиксу.
 */
export function wordsOf(name) {
  const spaced = String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
  const out = []
  for (const w of spaced.split(/[^a-z0-9]+/)) {
    if (!w) continue
    out.push(w, singular(w))
  }
  return [...new Set(out)]
}

/**
 * Совпадает ли имя константы с именем колонки: `validTags` ↔ `tag`,
 * `HANGOUT_CATEGORIES` ↔ `category`, `type` ↔ `conversion_type`. Проверяются обе
 * склонности (у имён колонок нет общего правила множественного числа:
 * `category` → `categories`, но `status` → `status`) и оба направления: имя
 * константы может быть словом внутри имени колонки (`type` внутри
 * `conversion_type` — локальная переменная в `partners.js`, которая и есть
 * белый список для этой колонки).
 */
export function colMatchesName(col, name) {
  const n = String(name).toLowerCase()
  const c = String(col).toLowerCase()
  if (n.includes(c) || n.includes(singular(c)) || n.includes(`${c}s`) || n.includes(`${c}es`)) return true
  return c.split(/[^a-z0-9]+/).some((w) => wordsOf(name).includes(w))
}

/**
 * Строки, на которых файл обращается к таблице по SQL.
 *
 * `writesOnly` оставляет только INSERT/UPDATE: список значений защищает запись,
 * поэтому проверять его нужно только против таблиц, куда файл пишет, а не
 * против тех, откуда читает. Иначе `type` в `partners.js` (белый список для
 * `partner_conversions.conversion_type`) «связался» бы с `likes.type` и
 * `subscriptions.type` — колонками, которые этот файл только читает.
 */
export function findTableMentionLines(source, { writesOnly = false } = {}) {
  const map = new Map()
  const pattern = writesOnly
    ? /\b(?:INSERT\s+INTO|UPDATE)\s+`?(\w+)`?/gi
    : /\b(?:INSERT\s+INTO|UPDATE|FROM|JOIN)\s+`?(\w+)`?/gi
  for (const m of source.matchAll(pattern)) {
    const table = m[1].toLowerCase()
    const line = source.slice(0, m.index).split('\n').length
    if (!map.has(table)) map.set(table, [])
    map.get(table).push(line)
  }
  return map
}

/**
 * Проверка 3: именованный список ⊆ ENUM.
 *
 * Связка списка с колонкой вычисляется, иначе получился бы ложный класс
 * находок: `hangouts.js` обращается к десяткам таблиц, и `HANGOUT_CATEGORIES`
 * (категории встречи) «связался» бы с `partner_offers.category` (категории
 * оффера) по одному имени файла. Колонка считается относящейся к списку, если
 * выполнено одно из двух:
 *
 *  - имя таблицы содержит слово имени списка и имя колонки совпадает со словом
 *    имени списка (`OFFER_CATEGORIES` ↔ `partner_offers.category`);
 *  - список используется в пределах PROXIMITY_LINES строк от INSERT/UPDATE в
 *    таблицу, у которой есть ENUM-колонка с подходящим именем (`validTags`
 *    рядом с `INSERT INTO hangout_reviews`, чей `tag` — ENUM). Только записи:
 *    список защищает вставку, а не чтение, а колонка, которую файл только
 *    читает, белым списком не защищается.
 *
 * Если подходящих колонок нет — список не связан с ENUM и не проверяется.
 */
const PROXIMITY_LINES = 40

export function auditNamedLists(lists, fileSources, enums) {
  const problems = []
  const linked = []
  const usage = new Map()
  for (const [rel, text] of fileSources) {
    for (const list of lists) {
      if (list.file !== rel) continue
      const hits = text.match(new RegExp(`\\b${list.name}\\b`, 'g')) || []
      usage.set(list.name, (usage.get(list.name) || 0) + hits.length)
    }
  }
  const crossFileUsage = countCrossFileUsage(lists, fileSources)

  for (const list of lists) {
    const totalUses = (usage.get(list.name) || 0) - 1 + (crossFileUsage.get(list.name) || 0)
    if (totalUses <= 0) {
      problems.push(
        `${list.file}:${list.line}: список ${list.name} объявлен, но нигде не используется — ` +
          `белый список без применения ничего не защищает`,
      )
      continue
    }

    const text = fileSources.get(list.file)
    if (!text) continue
    const nameLines = [...text.matchAll(new RegExp(`\\b${list.name}\\b`, 'g'))]
      .map((m) => text.slice(0, m.index).split('\n').length)
      .filter((n) => n !== list.line)
    const writes = findTableMentionLines(text, { writesOnly: true })
    const listWords = wordsOf(list.name)

    const allowed = new Set()
    for (const key of enums.keys()) {
      const [table, col] = key.split('.')
      if (!colMatchesName(col, list.name)) continue
      const tableWords = table.toLowerCase().split(/[^a-z0-9]+/)
      const tableHasWord = tableWords.some((w) => listWords.includes(w))
      const writeLines = writes.get(table.toLowerCase()) || []
      const near = writeLines.some((wl) => nameLines.some((nl) => Math.abs(nl - wl) <= PROXIMITY_LINES))
      if (!tableHasWord && !near) continue
      for (const v of enums.get(key)) allowed.add(v)
    }
    if (!allowed.size) continue
    linked.push(`${list.name} → ${[...allowed].length} значений ENUM`)

    const outside = [...new Set(list.values)].filter((v) => !allowed.has(v))
    if (outside.length) {
      problems.push(
        `${list.file}:${list.line}: ${list.name} разрешает значения, которых нет в ENUM (${outside.join('|')}) — ` +
          `запись в такую колонку даст 500`,
      )
    }
  }
  return { problems, linked }
}

/**
 * Использования имени в других файлах: экспорт — это тоже применение.
 * `CHANNELS` из `notification-prefs.js` объявлен для чтения из
 * `routes/notifications.js`, и без этого счёта гейт назвал бы живой список
 * мёртвым.
 */
export function countCrossFileUsage(lists, fileSources) {
  const counts = new Map()
  const own = new Map(lists.map((l) => [l.name, l.file]))
  for (const [rel, text] of fileSources) {
    for (const name of own.keys()) {
      if (own.get(name) === rel) continue
      const hits = text.match(new RegExp(`\\b${name}\\b`, 'g')) || []
      if (hits.length) counts.set(name, (counts.get(name) || 0) + hits.length)
    }
  }
  return counts
}

/**
 * Единственное число для связывания имён.
 *
 * Окончания `-us`/`-is` не трогаются: `status` → `statu` — это не «status» и
 * не «statuses», а опечатка, из-за которой связь `HANGOUT_STATUSES` ↔
 * `hangouts.status` разваливалась бы на ровном месте.
 */
export function singular(word) {
  const w = word.toLowerCase()
  if (/ies$/.test(w)) return `${w.slice(0, -3)}y`
  if (/(ss|ch|sh)es$/.test(w)) return w.slice(0, -2)
  if (/s$/.test(w) && !/(ss|us|is)$/.test(w)) return w.slice(0, -1)
  return w
}

export function audit(root) {
  const { enums, ranges } = parseSchema(readRepoFile(root, SCHEMA))
  const files = listJsFiles(path.join(root, SERVER_ROOT), root)
  const fileSources = new Map()
  const validators = []
  const lists = []
  const literalRows = []

  for (const rel of files) {
    const text = readRepoFile(root, rel)
    fileSources.set(rel, text)
    validators.push(...findCodeRangeValidators(text, rel))
    lists.push(...findNamedLists(text, rel))
    const { rows } = findEnumLiteralMismatches(text, rel, enums)
    literalRows.push(...rows)
  }

  const namedLists = auditNamedLists(lists, fileSources, enums)

  const problems = [
    ...auditValidatorBounds(validators, ranges),
    ...auditRangeCoverage(ranges, fileSources),
    ...namedLists.problems,
    ...literalRows.map(
      (r) => `${r.file}: ${r.kind} в ${r.table}.${r.col} пишет '${r.value}', которого нет в ENUM (${r.allowed.join('|')}) — 500`,
    ),
  ]

  return {
    facts: {
      enumColumns: enums.size,
      rangeChecks: ranges.length,
      files: files.length,
      validators: validators.length,
      namedLists: lists.length,
      linkedLists: namedLists.linked.length,
      literalChecks: literalRows.length,
    },
    problems,
  }
}

function main() {
  const root = process.argv[2] || process.cwd()
  const { facts, problems } = audit(root)

  console.log(`ENUM-колонок в схеме: ${facts.enumColumns}, диапазонных CHECK: ${facts.rangeChecks}`)
  console.log(`файлов сервера без тестов: ${facts.files}`)
  console.log(`код-валидаторов intField: ${facts.validators}, именованных списков: ${facts.namedLists}`)
  console.log(`списков, связанных с ENUM-колонкой: ${facts.linkedLists} из ${facts.namedLists}`)
  console.log(`найдено невалидных литералов в ENUM-колонках: ${facts.literalChecks}`)

  if (problems.length) {
    console.log('')
    for (const p of problems) console.log(`FAIL: ${p}`)
    console.log('\nИтог: код разрешает или пишет значения, которые схема не примет — пользователь получит 500.')
    process.exit(1)
  }
  console.log('\nИтог: границы CHECK совпадают с валидаторами, каждый диапазонный CHECK покрыт кодом, списки и литералы ⊆ ENUM.')
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main()