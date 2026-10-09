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

const SQL_KEYWORDS = new Set([
  'select', 'where', 'and', 'or', 'not', 'on', 'set', 'values', 'dual', 'order', 'group',
  'by', 'having', 'limit', 'offset', 'union', 'all', 'distinct', 'as', 'join', 'left',
  'right', 'inner', 'outer', 'cross', 'from', 'update', 'into', 'insert', 'delete', 'table',
  'using', 'partition', 'with', 'recursive', 'lateral', 'natural', 'for', 'if', 'case',
  'when', 'then', 'else', 'end', 'exists', 'in', 'is', 'null', 'between', 'like', 'asc',
  'desc', 'force', 'ignore', 'index', 'key', 'straight_join', 'for', 'of', 'window'
])

export function extractColumnRefs(src) {
  const refs = new Map()
  const aliasToTable = new Map()
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
    const table = aliasToTable.get(alias)
    if (!refs.has(table)) refs.set(table, new Set())
    refs.get(table).add(column)
  }
  const tables = new Set()
  for (const m of src.matchAll(SQL_TABLE)) {
    const name = m[1].toLowerCase()
    if (SQL_KEYWORDS.has(name)) continue
    const after = src.slice(m.index + m[0].length)
    if (/^\s*=|^\s*VALUES\s*\(/i.test(after)) continue
    tables.add(name)
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
