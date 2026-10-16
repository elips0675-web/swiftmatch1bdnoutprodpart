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
  console.log(`TOTAL: ${problems.length} mismatch(es). Every COLUMN_MISSING_IN_CODE is a live 500.`)
  process.exit(1)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(e.message)
    process.exit(2)
  })
}
