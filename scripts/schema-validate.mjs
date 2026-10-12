#!/usr/bin/env node
// Schema validation (этап 35, аудит kimi/qwen): сравнение mysql_schema.sql с живой БД.
// Дрейф колонок ловился трижды в проде-коде (invites, iap.js, location.js) и не ловился тестами.
// Запуск: node scripts/schema-validate.mjs   (DB_* из окружения или server/.env)
// Выход: exit 1, если таблица/колонка из схемы отсутствует в БД.
import fs from 'fs'
import path from 'path'
import mysql from 'mysql2/promise'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..')

function loadEnv() {
  const envPath = path.join(root, 'server', '.env')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]
  }
}
loadEnv()

const SKIP_TABLES = new Set(['_migrations'])
const CONSTRAINT_KEYWORDS = new Set(['PRIMARY', 'UNIQUE', 'KEY', 'INDEX', 'CONSTRAINT', 'FULLTEXT', 'SPATIAL', 'FOREIGN', 'CHECK'])

function parseSchema(sqlText) {
  const tables = new Map()
  const re = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?`?(\w+)`?\s*\(([\s\S]*?)\)\s*(?:ENGINE|DEFAULT CHARSET|=)/gi
  let m
  while ((m = re.exec(sqlText))) {
    const cols = []
    for (let line of m[2].split(/\r?\n/)) {
      line = line.trim().replace(/,$/, '')
      if (!line || line.startsWith('--')) continue
      const name = line.split(/[\s(]/)[0].replace(/`/g, '')
      if (!name || CONSTRAINT_KEYWORDS.has(name.toUpperCase())) continue
      cols.push(name.toLowerCase())
    }
    tables.set(m[1].toLowerCase(), cols)
  }
  return tables
}

function mergeExpected(base, extra) {
  // extra: Map<table, string[]> — мерджим недостающие таблицы и колонки в base
  for (const [table, cols] of extra) {
    if (!base.has(table)) {
      base.set(table, cols)
      continue
    }
    const cur = new Set(base.get(table))
    for (const c of cols) cur.add(c)
    base.set(table, [...cur])
  }
  return base
}

async function main() {
  const schemaPath = path.join(root, 'database', 'mysql_schema.sql')
  const expected = parseSchema(fs.readFileSync(schemaPath, 'utf8'))
  // Учитываем таблицы, создаваемые миграциями (этап 77): иначе дрейф миграционных
  // таблиц (напр. hangouts/partners/experiments/refresh_tokens, см. этап 77) не ловится,
  // т.к. schema-validate сверял только schema.sql (самосверка «62 vs 62»).
  const migrationsDir = path.join(root, 'database', 'migrations')
  if (fs.existsSync(migrationsDir)) {
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
    for (const f of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf8')
      mergeExpected(expected, parseSchema(sql))
    }
  }
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'swiftmatch',
  })
  const [rows] = await conn.query(
    `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?`,
    [process.env.DB_NAME || 'swiftmatch'],
  )
  await conn.end()

  const actual = new Map()
  for (const r of rows) {
    const t = r.TABLE_NAME.toLowerCase()
    if (SKIP_TABLES.has(t)) continue
    if (!actual.has(t)) actual.set(t, [])
    actual.get(t).push(r.COLUMN_NAME.toLowerCase())
  }

  let errors = 0
  for (const [table, cols] of expected) {
    if (SKIP_TABLES.has(table)) continue
    if (!actual.has(table)) {
      console.error(`[schema] MISSING TABLE: ${table}`)
      errors++
      continue
    }
    const have = new Set(actual.get(table))
    for (const c of cols) {
      if (!have.has(c)) {
        console.error(`[schema] ${table}: MISSING COLUMN: ${c}`)
        errors++
      }
    }
  }
  // Информационно: таблицы/колонки в БД, которых нет в схеме (обратный дрейф)
  let extraTables = 0
  for (const [table, cols] of actual) {
    if (!expected.has(table)) { console.warn(`[schema] EXTRA TABLE in DB (info only): ${table}`); extraTables++; continue }
    const exp = new Set(expected.get(table))
    for (const c of cols) if (!exp.has(c)) console.warn(`[schema] ${table}: extra column in DB (info only): ${c}`)
  }

  if (errors > 0) {
    console.error(`[schema] FAILED: ${errors} mismatch(es)`)
    process.exit(1)
  }
  console.log(`[schema] OK: ${expected.size} tables validated against live DB (${extraTables} extra tables, info only)`)
}

main().catch((e) => { console.error('[schema] ERROR:', e.message); process.exit(1) })
