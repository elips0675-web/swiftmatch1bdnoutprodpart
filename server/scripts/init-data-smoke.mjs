/**
 * Смоук полноты init-данных: свежий MySQL-контейнер против init-файлов.
 *
 * Что доказывает и чего не видит статический аудит (`scripts/schema-drift-audit.mjs`):
 * аудит ловит только то, обо что init *падает* (ERROR 1136 по арности, ERROR 1146
 * по отсутствующей таблице) — и это видно по логу контейнера. Он не видит потерь,
 * которые происходят молча после успешного `MySQL init process done`: `REPLACE`
 * на таблице-родителе в файле с включёнными FK — это DELETE + INSERT, а удаление
 * родителя каскадом уносит детей. Замер на свежем volume: `REPLACE INTO users`
 * (id 1/3/5/6) в 03-e2e-seed.sql удалял 22 сообщения и 376 refresh_tokens из
 * 02-data, оставляя 187/18 строк вместо 209/394 — init «зелёный», дамп неполный.
 *
 * Проверка: для каждой таблицы, в которую пишут init-файлы, ожидание берётся из
 * самих файлов (число кортежей, а при целочисленном первом столбце — число
 * различных значений), факт — из живой БД (`COUNT(*)`). Плюс маркеры того, что
 * 03-e2e-seed.sql доехал: bcrypt админа и кириллица вопроса (не mojibake).
 * Ожидание тут не константа в скрипте, а артефакт: правка дампа двигает и ожидание.
 *
 * Режимы (канон queue-smoke.mjs): без флага и без инфраструктуры — честный SKIP,
 * exit 0; REQUIRE_INTEGRATION=1 (CI, scripts/integration-smoke-run.mjs) — недоступная
 * БД и любое расхождение есть exit 1. Гоняется ДО смоуков с API: те регистрируют
 * юзеров и добавляют строки, после них «свежесть» БД уже не проверить.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'
import {
  INIT_DATA_FILES,
  parseReferenceKeys,
  parseReferenceSchema,
  readInitDataStatements,
  splitValueTuple,
} from '../../scripts/schema-drift-audit.mjs'

const requireIntegration =
  process.env.REQUIRE_INTEGRATION === '1' || process.argv.includes('--require')

const DB = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3308,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD ?? 'root',
  database: process.env.DB_NAME || 'swiftmatch1bd',
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const failures = []
function check(label, ok, extra = '') {
  console.log(`${ok ? 'ok' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`)
  if (!ok) failures.push(label)
}

/** Пробел вне строковых литералов не значим: дамп пишет `(1,2)`, seed — `(1, 2)`. */
function normalizeTuple(tuple) {
  let out = ''
  let quote = false
  for (let i = 0; i < tuple.length; i++) {
    const ch = tuple[i]
    if (quote) {
      out += ch
      if (ch === '\\') {
        out += tuple[++i] ?? ''
        continue
      }
      if (ch === "'") {
        if (tuple[i + 1] === "'") {
          out += tuple[++i]
          continue
        }
        quote = false
      }
      continue
    }
    if (ch === "'") {
      quote = true
      out += ch
      continue
    }
    if (/\s/.test(ch)) continue
    out += ch
  }
  return out
}

/** Ожидание по каждому стейтменту init-файлов: ключ — значения колонок PRIMARY KEY
 *  (по порядку схемы для стейтментов без списка колонок). Если PK в стейтменте не
 *  найти, падаем на множество нормализованных кортежей — как для таблиц, где
 *  REPLACE по составному PK сам схлопывает дубликаты. */
function readExpected(reference, primaryKeys) {
  const tables = new Map()
  for (const rel of INIT_DATA_FILES) {
    const file = path.join(ROOT, rel)
    if (!fs.existsSync(file)) continue
    for (const statement of readInitDataStatements(fs.readFileSync(file, 'utf8'), rel)) {
      const order = statement.columns ?? [...(reference.get(statement.table) ?? [])]
      const positions = (primaryKeys.get(statement.table) ?? []).map((column) => order.indexOf(column))
      const usableKey = positions.length > 0 && positions.every((index) => index >= 0)
      if (!tables.has(statement.table)) {
        tables.set(statement.table, { keys: new Set(), tuples: new Set(), usableKey, statements: 0 })
      }
      const entry = tables.get(statement.table)
      entry.statements++
      entry.usableKey = entry.usableKey && usableKey
      for (const tuple of statement.tuples) {
        if (!usableKey) {
          entry.tuples.add(normalizeTuple(tuple))
          continue
        }
        const values = splitValueTuple(tuple)
        entry.keys.add(positions.map((index) => values[index] ?? '').join('\u0000'))
      }
    }
  }
  return tables
}

async function main() {
  console.log(`[init-data-smoke] db=${DB.host}:${DB.port}/${DB.database}`)

  let conn
  try {
    conn = await mysql.createConnection({ ...DB, connectTimeout: 5000 })
    await conn.query('SELECT 1')
  } catch (err) {
    if (conn) await conn.end().catch(() => {})
    if (requireIntegration) {
      console.log(`FAIL  MySQL ${DB.host}:${DB.port} недоступен: ${err.message} — REQUIRE_INTEGRATION=1`)
      process.exit(1)
    }
    console.log(`SKIP  интеграционный контур не поднят (MySQL ${DB.host}:${DB.port}) — без REQUIRE_INTEGRATION смоук честно пропускается`)
    process.exit(0)
  }

  try {
    const schema = fs.readFileSync(path.join(ROOT, 'database', 'mysql_schema.sql'), 'utf8')
    const expected = readExpected(parseReferenceSchema(schema), parseReferenceKeys(schema))
    check('init-файлы прочитаны (таблиц со стейтментами данных) > 0', expected.size > 0, `таблиц ${expected.size}`)

    let compared = 0
    for (const [table, entry] of expected) {
      const [rows] = await conn.query(`SELECT COUNT(*) AS n FROM \`${table}\``)
      const actual = Number(rows[0].n)
      const want = entry.usableKey ? entry.keys.size : entry.tuples.size
      const label = `${table}: ${want} строк из init-файлов`
      check(label, actual === want, actual === want ? '' : `в БД ${actual}`)
      compared++
    }

    const [admin] = await conn.query(
      "SELECT COUNT(*) AS n FROM users WHERE id IN (1,3,5,6) AND password_hash LIKE '$2a$10$Mub8ccI8%'",
    )
    check('03-e2e-seed.sql доехал: bcrypt админа и e2e-юзеров на месте', Number(admin[0].n) === 4, `строк ${admin[0].n}`)

    const [question] = await conn.query('SELECT text_ru FROM icebreaker_questions WHERE id = 1')
    check(
      'кириллица из seed, а не mojibake дампа',
      question[0]?.text_ru === 'Что для тебя идеальное первое свидание?',
      `text_ru=${JSON.stringify(question[0]?.text_ru ?? null)}`,
    )

    console.log(`\nсверено таблиц: ${compared}; проверок упало: ${failures.length}`)
  } finally {
    await conn.end().catch(() => {})
  }

  if (failures.length) {
    console.log(`\nFAIL  init-data-smoke: ${failures.length} проверок упало (init потерял строки — смотри REPLACE на таблицах-родителях)`)
    process.exit(1)
  }
  console.log('\nOK  init-data-smoke: свежий init уложил все строки init-файлов')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error('init-data-smoke упал:', err)
    process.exit(1)
  })
}
