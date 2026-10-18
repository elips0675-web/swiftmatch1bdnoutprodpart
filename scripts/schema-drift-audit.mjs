import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCHEMA_FILE = path.join(ROOT, 'database', 'mysql_schema.sql')
const ROUTES_DIR = path.join(ROOT, 'server', 'src')

export function parseReferenceSchema(src) {
  const tables = new Map()
  const re = /CREATE TABLE(?: IF NOT EXISTS)?\s+`?(\w+)`?\s*\(([\s\S]*?)\n\)\s*ENGINE=/g
  for (const m of src.matchAll(re)) {
    const [, table, body] = m
    const columns = new Set()
    for (const line of body.split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('PRIMARY KEY') || t.startsWith('UNIQUE KEY') || t.startsWith('KEY ')) continue
      if (t.startsWith('CONSTRAINT') || t.startsWith('FOREIGN KEY') || t.startsWith('CHECK')) continue
      const c = t.match(/^`(\w+)`\s+/)
      if (c) columns.add(c[1])
    }
    tables.set(table, columns)
  }
  return tables
}

export const INIT_DATA_FILES = ['database/demo_data.sql', 'database/03-e2e-seed.sql']

/** PRIMARY KEY по таблицам: нужен смоуку полноты init-данных, чтобы считать
 *  ожидание по настоящему ключу, а не по первому столбцу (у chat_participants и
 *  user_interests PK составной — сравнение по первому столбцу даёт 55 и 50
 *  вместо 110 и 179 строк). */
export function parseReferenceKeys(src) {
  const keys = new Map()
  const re = /CREATE TABLE(?: IF NOT EXISTS)?\s+`?(\w+)`?\s*\(([\s\S]*?)\n\)\s*ENGINE=/g
  for (const m of src.matchAll(re)) {
    const pk = m[2].match(/^\s*PRIMARY KEY\s*\(([^)]*)\)/m)
    keys.set(
      m[1],
      pk
        ? pk[1]
            .split(',')
            .map((c) => c.trim().replace(/^`|`$/g, ''))
            .filter(Boolean)
        : [],
    )
  }
  return keys
}

export function splitValueTuple(tuple) {
  const parts = []
  let depth = 0
  let quote = false
  let buf = ''
  for (let i = 0; i < tuple.length; i++) {
    const ch = tuple[i]
    if (quote) {
      buf += ch
      if (ch === '\\') {
        buf += tuple[++i] ?? ''
        continue
      }
      if (ch === "'") {
        if (tuple[i + 1] === "'") {
          buf += tuple[++i]
          continue
        }
        quote = false
      }
      continue
    }
    if (ch === "'") {
      quote = true
      buf += ch
      continue
    }
    if (ch === '(') depth++
    if (ch === ')') depth = Math.max(0, depth - 1)
    if (ch === ',' && depth === 0) {
      parts.push(buf.trim())
      buf = ''
      continue
    }
    buf += ch
  }
  if (buf.trim()) parts.push(buf.trim())
  return parts
}

function readValueTuples(sql, from) {
  const tuples = []
  let i = from
  while (i < sql.length) {
    while (i < sql.length && /\s/.test(sql[i])) i++
    if (sql[i] !== '(') break
    let depth = 0
    let quote = false
    const start = i
    for (; i < sql.length; i++) {
      const ch = sql[i]
      if (quote) {
        if (ch === '\\') i++
        else if (ch === "'") {
          if (sql[i + 1] === "'") i++
          else quote = false
        }
        continue
      }
      if (ch === "'") quote = true
      else if (ch === '(') depth++
      else if (ch === ')') {
        depth--
        if (depth === 0) break
      }
    }
    tuples.push(sql.slice(start + 1, i))
    i++
    while (i < sql.length && /\s/.test(sql[i])) i++
    if (sql[i] === ',') {
      i++
      continue
    }
    break
  }
  return tuples
}

function lineAt(src, index) {
  return src.slice(0, index).split('\n').length
}

/** Сканер стейтментов данных init-файлов. Один на два потребителя: статический
 *  аудит (арность, ссылки на таблицы/колонки) и смоук полноты
 *  (`server/scripts/init-data-smoke.mjs` сверяет число кортежей с живой БД после
 *  свежего init). `INSERT IGNORE` — тоже стейтмент данных: без его учёта
 *  `user_interests` (03-e2e-seed.sql) тихо выпадала бы из обеих проверок. */
export function readInitDataStatements(sql, label) {
  const statements = []
  const re = /\b(INSERT\s+(?:IGNORE\s+|LOW_PRIORITY\s+|HIGH_PRIORITY\s+)?INTO|REPLACE\s+(?:LOW_PRIORITY\s+|HIGH_PRIORITY\s+)?INTO)\s+`?(\w+)`?\s*(\([^)]*\))?\s*VALUES\b/gi
  for (const m of sql.matchAll(re)) {
    statements.push({
      label,
      line: lineAt(sql, m.index),
      keyword: m[1].replace(/\s+/g, ' ').toUpperCase(),
      table: m[2].toLowerCase(),
      columns: m[3]
        ? m[3]
            .slice(1, -1)
            .split(',')
            .map((c) => c.trim().replace(/^`|`$/g, ''))
        : null,
      tuples: readValueTuples(sql, m.index + m[0].length),
    })
  }
  return statements
}

/** Init-скрипты (`01-schema` → `02-data` → `03-e2e-seed`) выполняет entrypoint
 *  MySQL: INSERT/REPLACE без списка колонок сверяется по позициям. Если значений
 *  меньше/больше, чем колонок в mysql_schema.sql, сервер отвечает ERROR 1136,
 *  entrypoint обрывает init (остальные файлы и миграции не применяются), а
 *  контейнер уходит в перезапуск - свежий деплой получает половину данных.
 *  Схема и данные лежат в разных файлах, поэтому расхождение видно только
 *  статически - здесь. Явный список колонок делает стейтмент к этому невосприимчивым. */
export function auditInitDataValueCount(sql, reference, label) {
  const problems = []
  for (const statement of readInitDataStatements(sql, label)) {
    const at = `${label}:${statement.line}`
    if (statement.columns) continue
    const columns = reference.get(statement.table)
    if (!columns) {
      problems.push({
        kind: 'TABLE_MISSING',
        table: statement.table,
        detail: `${at} - ${statement.keyword} в таблицу, которой нет в mysql_schema.sql`,
      })
      continue
    }
    if (statement.tuples.length === 0) {
      problems.push({
        kind: 'VALUE_COUNT',
        table: statement.table,
        detail: `${at} - у VALUES не разобран ни один кортеж`,
      })
      continue
    }
    const counts = new Map()
    for (const tuple of statement.tuples) {
      const values = splitValueTuple(tuple).length
      counts.set(values, (counts.get(values) ?? 0) + 1)
    }
    for (const [values, rows] of counts) {
      if (values !== columns.size) {
        problems.push({
          kind: 'VALUE_COUNT',
          table: statement.table,
          detail: `${at} - кортежей ${rows}: значений ${values}, колонок в mysql_schema.sql ${columns.size}`,
        })
      }
    }
  }
  return problems
}

const INIT_TABLE_RE =
  /(?:INSERT\s+(?:IGNORE\s+|LOW_PRIORITY\s+|HIGH_PRIORITY\s+)?INTO|REPLACE\s+(?:LOW_PRIORITY\s+|HIGH_PRIORITY\s+)?INTO|DELETE\s+FROM|(?<!\bKEY\s)UPDATE\b(?!\s+OF\b)|TRUNCATE\s+TABLE|ALTER\s+TABLE|CREATE\s+TABLE)\s+`?(\w+)`?/gi

const INIT_LOCK_TABLES_RE = /\bLOCK\s+TABLES\s+([\s\S]*?);/gi

/** Вторая половина того же класса: дамп ссылается на таблицу, которой нет в
 *  mysql_schema.sql. `LOCK TABLES user_sessions WRITE` для удалённой миграцией
 *  053 таблицы валит init с ERROR 1146 - и это не видно ни по числу значений,
 *  ни в живой БД (таблицы нет и там). Плюс явный список колонок сверяется со
 *  схемой: он защищает от ERROR 1136, но сам может назвать несуществующую
 *  колонку. */
export function auditInitDataTableRefs(sql, reference, label) {
  const problems = []
  const refs = new Map()
  const add = (table, index, kind) => {
    const t = table.toLowerCase()
    if (!refs.has(t)) refs.set(t, { line: lineAt(sql, index), kinds: new Set() })
    refs.get(t).kinds.add(kind)
  }
  for (const m of sql.matchAll(INIT_TABLE_RE)) {
    const keyword = m[0].trim().split(/\s+/).slice(0, 2).join(' ').toUpperCase()
    add(m[1], m.index + m[0].lastIndexOf(m[1]), keyword)
  }
  for (const m of sql.matchAll(INIT_LOCK_TABLES_RE)) {
    for (const item of splitTopLevel(m[1])) {
      const table = item.trim().match(/^`?(\w+)`?/)
      if (table) add(table[1], m.index, 'LOCK TABLES')
    }
  }
  for (const [table, info] of refs) {
    if (reference.has(table)) continue
    problems.push({
      kind: 'TABLE_MISSING',
      table,
      detail: `${label}:${info.line} - ${[...info.kinds].sort().join('+')} для таблицы, которой нет в mysql_schema.sql`,
    })
  }

  for (const statement of readInitDataStatements(sql, label)) {
    if (!statement.columns) continue
    const columns = reference.get(statement.table)
    if (!columns) continue
    for (const column of statement.columns) {
      if (!column || columns.has(column)) continue
      problems.push({
        kind: 'COLUMN_MISSING',
        table: statement.table,
        detail: `${label}:${statement.line} - колонка \`${column}\` не объявлена в mysql_schema.sql`,
      })
    }
  }
  return problems
}

export function readInitDataProblems(reference) {
  const problems = []
  for (const rel of INIT_DATA_FILES) {
    const file = path.join(ROOT, rel)
    if (!fs.existsSync(file)) continue
    const sql = fs.readFileSync(file, 'utf8')
    problems.push(...auditInitDataValueCount(sql, reference, rel))
    problems.push(...auditInitDataTableRefs(sql, reference, rel))
  }
  return problems
}

export function listJsFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) listJsFiles(full, out)
    else if (entry.name.endsWith('.js')) out.push(full)
  }
  return out
}

const SQL_TABLE = /\b(?:FROM|JOIN|INTO|UPDATE)\s+`?([a-z_][a-z0-9_]*)`?/gi

export const SQL_KEYWORDS = new Set([
  'select', 'where', 'and', 'or', 'not', 'on', 'set', 'values', 'dual', 'order', 'group',
  'by', 'having', 'limit', 'offset', 'union', 'all', 'distinct', 'as', 'join', 'left',
  'right', 'inner', 'outer', 'cross', 'from', 'update', 'into', 'insert', 'delete', 'table',
  'using', 'partition', 'with', 'recursive', 'lateral', 'natural', 'for', 'if', 'case',
  'when', 'then', 'else', 'end', 'exists', 'in', 'is', 'null', 'between', 'like', 'asc',
  'desc', 'force', 'ignore', 'index', 'key', 'straight_join', 'of', 'window',
  'duplicate', 'interval', 'value', 'true', 'false', 'current_timestamp', 'current_date',
  'current_time', 'localtime', 'localtimestamp', 'nulls', 'first', 'last', 'over', 'rows',
  'range', 'preceding', 'following', 'unbounded', 'current', 'binary', 'collate',
  'separator', 'unsigned', 'signed', 'replace',
  'day', 'days', 'week', 'weeks', 'quarter', 'quarters', 'month', 'months',
  'year', 'years', 'hour', 'hours', 'minute', 'minutes', 'second', 'seconds',
  'microsecond', 'microseconds', 'weekday', 'weekofyear', 'dayofweek',
  'dayofmonth', 'dayofyear', 'dayname', 'monthname', 'datediff', 'adddate',
  'subdate', 'date', 'time', 'timestamp', 'datetime', 'yearweek', 'week_day'
])

function stripStrings(sql) {
  return sql.replace(/'(?:\\.|[^'\\])*'/g, ' ')
}

function blankParens(sql) {
  let out = ''
  let depth = 0
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]
    if (ch === '(') {
      depth++
      out += ' '
      continue
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1)
      out += ' '
      continue
    }
    out += depth > 0 ? ' ' : ch
  }
  return out
}

function splitTopLevel(clause) {
  const parts = []
  let depth = 0
  let buf = ''
  for (let i = 0; i < clause.length; i++) {
    const ch = clause[i]
    if (ch === '(') depth++
    if (ch === ')') depth = Math.max(0, depth - 1)
    if (ch === ',' && depth === 0) {
      parts.push(buf.trim())
      buf = ''
      continue
    }
    buf += ch
  }
  if (buf.trim()) parts.push(buf.trim())
  return parts
}

export function extractColumnRefs(src) {
  const refs = new Map()
  const aliasToTable = new Map()
  const add = (table, column) => {
    if (!table || !column) return
    const t = String(table).toLowerCase()
    const c = String(column).toLowerCase()
    if (SQL_KEYWORDS.has(c)) return
    if (!refs.has(t)) refs.set(t, new Set())
    refs.get(t).add(c)
  }

  const noStrings = stripStrings(src)
  const masked = blankParens(noStrings)

  const reAlias = /\b(?:FROM|JOIN)\s+`?(\w+)`?\s+(?:AS\s+)?(\w+)/gi
  for (const m of src.matchAll(reAlias)) {
    const alias = m[2].toLowerCase()
    if (SQL_KEYWORDS.has(alias)) continue
    aliasToTable.set(alias, m[1].toLowerCase())
  }
  for (const m of src.matchAll(/`?(\w+)`?\s*\.\s*`?(\w+)`?/g)) {
    const alias = m[1].toLowerCase()
    const column = m[2].toLowerCase()
    if (!aliasToTable.has(alias)) continue
    add(aliasToTable.get(alias), column)
  }

  const tables = new Set()
  for (const m of src.matchAll(SQL_TABLE)) {
    const name = m[1].toLowerCase()
    if (SQL_KEYWORDS.has(name)) continue
    const after = src.slice(m.index + m[0].length)
    if (/^\s*=|^\s*VALUES\s*\(/i.test(after)) continue
    tables.add(name)
  }

  const funcNames = new Set()
  for (const m of noStrings.matchAll(/([a-z_][a-z0-9_]*)\s*\(/gi)) {
    funcNames.add(m[1].toLowerCase())
  }

  for (const m of src.matchAll(/\bINSERT\s+INTO\s+`?([a-z_][a-z0-9_]*)`?\s*\(([^)]*)\)/gi)) {
    const table = m[1].toLowerCase()
    if (SQL_KEYWORDS.has(table)) continue
    for (const raw of m[2].split(',')) {
      const c = raw.trim().replace(/^`|`$/g, '').toLowerCase()
      if (/^[a-z_][a-z0-9_]*$/.test(c) && !SQL_KEYWORDS.has(c)) add(table, c)
    }
  }

  for (const m of masked.matchAll(/\bUPDATE\s+`?([a-z_][a-z0-9_]*)`?\s+SET\s+([\s\S]*?)(?=\bWHERE\b|\bORDER\b|\bLIMIT\b|$)/gi)) {
    const table = m[1].toLowerCase()
    if (SQL_KEYWORDS.has(table)) continue
    for (const a of m[2].matchAll(/(?:^|,)\s*`?(\w+)`?\s*=/g)) {
      const c = a[1].toLowerCase()
      if (!SQL_KEYWORDS.has(c)) add(table, c)
    }
  }

  const hasInsert = /\bINSERT\b/i.test(src)
  const hasDerived = /\b(?:FROM|JOIN)\s*\(/i.test(noStrings)
  const asAliases = new Set()
  for (const m of masked.matchAll(/\bAS\s+`?([a-z_][a-z0-9_]*)`?/gi)) {
    const a = m[1].toLowerCase()
    if (!SQL_KEYWORDS.has(a)) asAliases.add(a)
  }

  const topTables = new Set()
  for (const m of masked.matchAll(/\b(?:FROM|JOIN)\s+`?([a-z_][a-z0-9_]*)`?/gi)) {
    const n = m[1].toLowerCase()
    if (!SQL_KEYWORDS.has(n)) topTables.add(n)
  }
  const topAliases = new Set()
  for (const m of masked.matchAll(/\b(?:FROM|JOIN)\s+`?([a-z_][a-z0-9_]*)`?\s+(?:AS\s+)?([a-z_][a-z0-9_]*)/gi)) {
    const a = m[2].toLowerCase()
    if (!SQL_KEYWORDS.has(a)) topAliases.add(a)
  }

  if (topTables.size === 1) {
    const table = [...topTables][0]
    const isColumn = (w) => {
      if (!w) return false
      if (SQL_KEYWORDS.has(w)) return false
      if (w === table) return false
      if (topAliases.has(w)) return false
      if (asAliases.has(w)) return false
      if (funcNames.has(w)) return false
      return true
    }
    const sel = /\bSELECT\s+([\s\S]*?)\s+\bFROM\b/i.exec(masked)
    if (sel) {
      const list = sel[1].replace(/^\s*(?:DISTINCT|ALL)\b/i, '')
      for (const part of splitTopLevel(list)) {
        const c = part.trim().match(/^`?([a-z_][a-z0-9_]*)`?$/)
        if (c && isColumn(c[1].toLowerCase())) add(table, c[1].toLowerCase())
      }
    }
    const where = /\bWHERE\b([\s\S]*?)(?=\bORDER\b|\bGROUP\b|\bLIMIT\b|\bOFFSET\b|\bHAVING\b|\bFOR\b|$)/i.exec(masked)
    if (where && !hasInsert && !hasDerived) {
      for (const m of where[1].matchAll(/\b([a-z_][a-z0-9_]*)\b\s*(?:\bNOT\s+)?(?:=|<>|!=|<=|>=|<|>|\bIN\b|\bIS\b|\bLIKE\b|\bBETWEEN\b)/gi)) {
        const c = m[1].toLowerCase()
        if (isColumn(c)) add(table, c)
      }
    }
    for (const kw of ['ORDER BY', 'GROUP BY']) {
      const re = new RegExp('\\b' + kw.replace(' ', '\\s+') + '\\s+([\\s\\S]*?)(?=\\bLIMIT\\b|\\bOFFSET\\b|\\bORDER\\b|\\bHAVING\\b|\\bFOR\\b|$)', 'i')
      const mm = re.exec(masked)
      if (!mm) continue
      for (const part of splitTopLevel(mm[1])) {
        const t = part.replace(/\b(?:ASC|DESC)\b/gi, '').trim()
        const c = t.match(/^`?([a-z_][a-z0-9_]*)`?$/)
        if (c && isColumn(c[1].toLowerCase())) add(table, c[1].toLowerCase())
      }
    }
  }

  return { refs, tables }
}

export function readCodeRefs() {
  const perTable = new Map()
  const tables = new Set()
  for (const file of listJsFiles(ROUTES_DIR)) {
    const src = fs.readFileSync(file, 'utf8')
    for (const literal of extractSqlLiterals(src)) {
      const { refs, tables: t } = extractColumnRefs(literal)
      for (const [table, cols] of refs) {
        if (!perTable.has(table)) perTable.set(table, new Set())
        for (const c of cols) perTable.get(table).add(c)
      }
      for (const tb of t) tables.add(tb)
    }
  }
  return { perTable, tables }
}

const SQL_START = /^\s*`?\s*(SELECT|INSERT|UPDATE|DELETE|WITH|REPLACE|CREATE|ALTER|VALUES)\b/i
const SQL_FRAGMENT = /^\s*`?\s*(AND|OR|LEFT|RIGHT|INNER|OUTER|CROSS|JOIN|WHERE|SET|ON|GROUP|ORDER|HAVING|LIMIT|FROM|SELECT)\b|^\s*`?,\s*/i

export function extractSqlLiterals(src) {
  const out = []
  for (const m of src.matchAll(/`([\s\S]*?)`/g)) {
    const body = m[1]
    if (!SQL_START.test(body) && !SQL_FRAGMENT.test(body)) continue
    out.push(body)
  }
  for (const m of src.matchAll(/'((?:\\.|[^'\\])*)'/g)) {
    const body = m[1]
    if (!SQL_START.test(body)) continue
    out.push(body)
  }
  for (const m of src.matchAll(/"((?:\\.|[^"\\])*)"/g)) {
    const body = m[1]
    if (!SQL_START.test(body)) continue
    out.push(body)
  }
  return out
}

async function main() {
  const offline = process.argv.includes('--offline')
  const reference = parseReferenceSchema(fs.readFileSync(SCHEMA_FILE, 'utf8'))
  const { perTable, tables } = readCodeRefs()

  let live = new Map()

  if (offline) {
    live = new Map([...reference].map(([t, cols]) => [t, new Set(cols)]))
    console.log('mode: OFFLINE (code vs database/mysql_schema.sql, no MySQL needed)')
  } else {
    const mysql = (await import('mysql2/promise')).default
    const dbName = process.env.DB_NAME || 'swiftmatch'
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '3306', 10),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: dbName,
    })
    try {
      const [rows] = await connection.query(
        'SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION',
      )
      live = new Map()
      for (const { TABLE_NAME: table, COLUMN_NAME: column } of rows) {
        if (!live.has(table)) live.set(table, new Set())
        live.get(table).add(column)
      }
    } finally {
      await connection.end()
    }
    console.log(`mode: LIVE (code + mysql_schema.sql vs DB "${dbName}")`)
  }

  const dbLabel = offline ? 'mysql_schema.sql' : 'live DB'
  const problems = []

  for (const [table, cols] of reference) {
    if (!live.has(table)) {
      problems.push({ kind: 'TABLE_MISSING_IN_DB', table, detail: `нет таблицы, а mysql_schema.sql её объявляет (${cols.size} колонок)` })
      continue
    }
    for (const col of cols) {
      if (!live.get(table).has(col)) {
        problems.push({ kind: 'COLUMN_MISSING_IN_DB', table, detail: col })
      }
    }
  }

  for (const [table, cols] of perTable) {
    if (!live.has(table)) {
      problems.push({ kind: 'TABLE_MISSING_IN_DB', table, detail: `нет таблицы, а код её использует (${[...cols].slice(0, 8).join(', ')}${cols.size > 8 ? ', ...' : ''})` })
      continue
    }
    for (const col of cols) {
      if (!live.get(table).has(col)) {
        problems.push({ kind: 'COLUMN_MISSING_IN_CODE', table, detail: col })
      }
    }
  }

  for (const p of readInitDataProblems(reference)) {
    problems.push({ kind: `INIT_DATA_${p.kind}`, table: p.table, detail: p.detail })
  }

  const schemaOnly = [...reference.keys()].filter((t) => !live.has(t))
  const dbOnly = [...live.keys()].filter((t) => !reference.has(t))
  const codeTablesMissing = [...new Set([...tables, ...perTable.keys()])].filter((t) => !live.has(t) && !SQL_KEYWORDS.has(t))

  console.log(`tables in mysql_schema.sql: ${reference.size}`)
  if (!offline) console.log(`tables in live DB: ${live.size}`)
  console.log(`tables referenced in code: ${tables.size}`)
  if (schemaOnly.length) console.log(`in schema but NOT in ${dbLabel}: ${schemaOnly.join(', ')}`)
  if (dbOnly.length) console.log(`in ${dbLabel} but NOT in schema: ${dbOnly.join(', ')}`)
  if (codeTablesMissing.length) console.log(`used in code but NOT in ${dbLabel}: ${codeTablesMissing.join(', ')}`)

  const byTable = new Map()
  for (const p of problems) {
    if (!byTable.has(p.table)) byTable.set(p.table, [])
    byTable.get(p.table).push(p)
  }

  if (problems.length === 0) {
    console.log(`OK: schema, ${dbLabel} and code agree.`)
    return
  }

  console.log('')
  for (const [table, list] of [...byTable].sort()) {
    console.log(`TABLE ${table}`)
    for (const p of list) console.log(`  [${p.kind}] ${p.detail}`)
  }
  console.log('')
  console.log(`TOTAL: ${problems.length} mismatch(es). Every COLUMN_MISSING_IN_CODE is a live 500, every INIT_DATA_* breaks the DB init.`)
  process.exit(1)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(e.message)
    process.exit(2)
  })
}
