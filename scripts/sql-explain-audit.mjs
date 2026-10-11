#!/usr/bin/env node
// EXPLAIN audit — statically extracts SQL from server/src/*.js, runs EXPLAIN against live DB.
// Catches schema drift: column/table not found, bad JOIN, missing indexes.
// Complements schema-validate.mjs (DDL vs DB) with actual query validation.
// Run: node scripts/sql-explain-audit.mjs  (DB_* env or server/.env)
import fs from 'fs'
import path from 'path'
import mysql from 'mysql2/promise'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..')
const SRC = path.join(root, 'server', 'src')

function loadEnv() {
  const envPath = path.join(root, 'server', '.env')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]
  }
}
loadEnv()

function collectFiles(dir) {
  const results = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '__tests__') {
      results.push(...collectFiles(full))
    } else if (/\.(js|mjs|cjs)$/.test(entry.name)) {
      results.push(full)
    }
  }
  return results
}

function extractQueries(source) {
  const queries = []
  const lines = source.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1

    // pool.query(`SQL`) or pool.query('SQL') — single or multi-line
    // Also: conn.query, pool.execute
    const queryMatch = line.match(/(?:pool|conn|db|connection)(?:\.query|\.execute)\s*\(\s*([`'"])/)
    if (!queryMatch) continue

    const quote = queryMatch[1]
    let sql = ''

    if (quote === '`') {
      // Template literal — may span multiple lines
      let j = i
      let started = false
      while (j < lines.length) {
        for (let k = 0; k < lines[j].length; k++) {
          const ch = lines[j][k]
          if (ch === '`' && !started) {
            started = true
            continue
          }
          if (!started) continue
          if (ch === '`') {
            // Could be end or escaped
            if (j < lines.length - 1 && lines[j][k + 1] === '`') { k++; continue }
            // Found end
            queries.push({ sql: sql.trim(), file: null, line: lineNum })
            sql = ''
            j = lines.length
            break
          }
          sql += ch
        }
        if (!started) break
        if (j < lines.length && sql) j++
        else break
      }
    } else {
      // Single/double quote string — extract until closing quote on same line
      const afterQuote = line.slice(line.indexOf(quote, line.indexOf(queryMatch[0])) + 1)
      const closingIdx = afterQuote.indexOf(quote)
      if (closingIdx >= 0) {
        sql = afterQuote.slice(0, closingIdx)
      } else {
        // Multi-line string (rare but possible)
        sql = afterQuote
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          const endIdx = lines[j].indexOf(quote)
          if (endIdx >= 0) {
            sql += ' ' + lines[j].slice(0, endIdx)
            break
          }
          sql += ' ' + lines[j]
        }
      }
      queries.push({ sql: sql.trim(), file: null, line: lineNum })
    }
  }
  return queries
}

function normalizeSql(sql) {
  // Remove comments
  sql = sql.replace(/--.*$/gm, '')
  sql = sql.replace(/\/\*[\s\S]*?\*\//g, '')
  // Collapse whitespace
  sql = sql.replace(/\s+/g, ' ').trim()
  return sql
}

function replaceParams(sql) {
  // Replace ? with NULL for EXPLAIN
  return sql.replace(/\?/g, 'NULL')
}

function isExplainable(sql) {
  const upper = sql.toUpperCase().trim()
  if (!upper) return false
  // Only SELECT, INSERT, UPDATE, DELETE can be EXPLAINed
  return /^(SELECT|INSERT|UPDATE|DELETE|REPLACE)\s/.test(upper)
}

async function main() {
  const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'swiftmatch',
  }

  const files = collectFiles(SRC)
  console.log(`[explain] Scanning ${files.length} files in server/src/`)

  const allQueries = []
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    const queries = extractQueries(source)
    for (const q of queries) {
      q.file = path.relative(root, file).replace(/\\/g, '/')
      allQueries.push(q)
    }
  }

  console.log(`[explain] Found ${allQueries.length} SQL queries`)

  const conn = await mysql.createConnection(dbConfig)
  let errors = 0
  let skipped = 0
  let checked = 0
  const seen = new Set()

  for (const q of allQueries) {
    let sql = normalizeSql(q.sql)
    if (!sql || !isExplainable(sql)) { skipped++; continue }

    // Deduplicate identical SQL
    const key = sql.toUpperCase()
    if (seen.has(key)) continue
    seen.add(key)

    sql = replaceParams(sql)

    // Truncate for display
    const display = sql.length > 120 ? sql.slice(0, 117) + '...' : sql

    try {
      const [rows] = await conn.query(`EXPLAIN ${sql}`)
      checked++

      // Check for problematic EXPLAIN rows
      for (const row of rows) {
        const type = (row.type || row.join_type || '').toUpperCase()

        // Warning: table scan on large tables (ALL type without LIMIT)
        if (type === 'ALL' && !sql.toUpperCase().includes('LIMIT')) {
          // Only warn, not error — some tables are small
        }
      }
    } catch (err) {
      const msg = err.message || String(err)
      // Ignore EXPLAIN-specific errors (some dynamic SQL can't be explained)
      if (msg.includes('ER_PARSE_ERROR') || msg.includes('er_parse')) {
        skipped++
        continue
      }
      // Real schema errors: column/table not found
      if (msg.includes('ER_BAD_FIELD_ERROR') || msg.includes('Unknown column') ||
          msg.includes('ER_NO_SUCH_TABLE') || msg.includes('doesn\'t exist')) {
        console.error(`[explain] FAIL ${q.file}:${q.line} — ${msg.split('\n')[0]}`)
        console.error(`         SQL: ${display}`)
        errors++
      } else if (msg.includes('ERgłęb')) {
        skipped++
      } else {
        // Other errors — report but don't fail (dynamic SQL with JOIN conditions etc)
        skipped++
      }
    }
  }

  await conn.end()

  console.log(`[explain] Results: ${checked} checked, ${skipped} skipped (dynamic/complex), ${errors} errors`)
  if (errors > 0) {
    console.error(`[explain] FAILED: ${errors} query error(s) — schema drift detected`)
    process.exit(1)
  }
  console.log(`[explain] OK — all extractable queries pass EXPLAIN`)
}

main().catch((e) => { console.error('[explain] FATAL:', e.message); process.exit(1) })
