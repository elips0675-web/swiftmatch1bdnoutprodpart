// Этап 12 (P0 #2): проверка гонок на настоящем MySQL, а не на фейке.
//
// Фейк в race.test.js моделирует UNIQUE-индексы, но модель — это всё же модель.
// Этот файл подтверждает на живом движке три утверждения, на которых держится фикс
// POST /api/likes:
//   1) два параллельных INSERT IGNORE INTO likes → одна строка, affectedRows 1 и 0
//      (affectedRows = 0 и есть сигнал «лайк не новый» для блока уведомления);
//   2) два параллельных обычных INSERT INTO matches → ER_DUP_ENTRY, то есть
//      прежний код (SELECT, затем INSERT) при гонке давал 500;
//   3) два параллельных INSERT IGNORE INTO matches → обе в норме, строка одна.
//
// Этап 40 (остаток N1): база гонок строится ИМЕННОТОЙ схемой, которая едет в прод —
// `database/mysql_schema.sql`, — а не переписанной в тесте копией трёх таблиц.
// Копия доказывала саму себя: Unique-ключи в ней были выписаны руками «как в
// mysql_schema.sql», поэтому правка боевой схемы (переименование uk_likes_pair,
// смена ENUM, состав колонок) оставила бы тест зелёным — он проверял бы не то, что
// едет в прод. Два теста в конце сверяют базу гонок с файлом: число таблиц и
// множество уникальных индексов у `likes`/`matches`.
//
// Работает в отдельной базе `swiftmatch_race_test` и удаляет её в afterAll;
// продовую `swiftmatch` не трогает.
//
// Если MySQL недоступен, поведение зависит от REQUIRE_MYSQL:
//   - флаг не задан (локальная машина без БД) — файл пропускается, чтобы
//     `npm test` у разработчика оставался зелёным;
//   - REQUIRE_MYSQL=1 (CI, джоба test-server) — пропуск становится ПАДЕНИЕМ.
// Именно этим был плох прежний вариант (этап 35, N1): `describe.skipIf(!admin)`
// зеленил джобу CI, в которой сервиса БД нет вообще, то есть «гонки на живом
// MySQL» в CI не выполнялись никогда, а джоба была зелёная. Сейчас структуру
// джобы проверяет гейт `scripts/mysql-race-gate.mjs`, а сам факт падения при
// отсутствии БД доказан прогоном с `REQUIRE_MYSQL=1 DB_PORT=1`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'

const DB_NAME = 'swiftmatch_race_test'
const SCHEMA_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'database', 'mysql_schema.sql')

const schemaSql = fs.existsSync(SCHEMA_PATH) ? fs.readFileSync(SCHEMA_PATH, 'utf8') : ''
const schemaTableCount = (schemaSql.match(/CREATE TABLE /g) || []).length

function uniqueKeysFromSchema(table) {
  const start = schemaSql.indexOf('CREATE TABLE `' + table + '` (')
  if (start === -1) return null
  const end = schemaSql.indexOf('\n) ENGINE', start)
  if (end === -1) return null
  const keys = new Map()
  for (const m of schemaSql.slice(start, end).matchAll(/UNIQUE KEY `([^`]+)` \(([^)]+)\)/g)) {
    keys.set(m[1], m[2].split(',').map((col) => col.trim().replace(/`/g, '')).join(','))
  }
  return keys
}

const config = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  connectTimeout: 3000,
}

async function probe() {
  let conn
  try {
    conn = await mysql.createConnection(config)
    await conn.query('SELECT 1')
    return conn
  } catch {
    if (conn) await conn.end().catch(() => {})
    return null
  }
}

const admin = await probe()
const requireMysql = process.env.REQUIRE_MYSQL === '1'

// Локально (REQUIRE_MYSQL не задан) — пропуск; в CI — файл выполняется, и
// первый тест падает, если БД всё-таки недоступна. Без него `beforeAll` упал бы
// на `admin.query` с невнятным «Cannot read properties of null».
describe.skipIf(!admin && !requireMysql)('гонки на живом MySQL (P0 #2)', () => {
  let pool

  it('живой MySQL доступен там, где он обязателен (REQUIRE_MYSQL=1)', () => {
    expect(admin).not.toBeNull()
  })

  beforeAll(async () => {
    // Без этого падение выглядит как «Cannot read properties of null (reading
    // 'query')» в beforeAll, и вывод не говорит ни про БД, ни про REQUIRE_MYSQL:
    // догадаться, что джоба CI осталась зелёной без единого живого теста, по
    // такому сообщению нельзя.
    if (!admin) {
      throw new Error(
        `MySQL недоступен по ${config.host}:${config.port}` +
          (requireMysql ? ' (REQUIRE_MYSQL=1 — в CI это падение, а не пропуск)' : ''),
      )
    }
    if (!schemaSql) {
      throw new Error(`Схема не найдена: ${SCHEMA_PATH} — тест гонок обязан работать на боевой схеме, а не на копии`)
    }
    await admin.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``)
    await admin.query(`CREATE DATABASE \`${DB_NAME}\``)
    pool = mysql.createPool({ ...config, database: DB_NAME, connectionLimit: 4, multipleStatements: true })

    await pool.query(schemaSql)
    await pool.query(
      'INSERT INTO users (id, email, password_hash) VALUES (1, ?, ?), (2, ?, ?)',
      ['race-1@test.local', 'x', 'race-2@test.local', 'x'],
    )
  })

  afterAll(async () => {
    if (pool) await pool.end().catch(() => {})
    // admin бывает null, когда БД недоступна: vitest выполняет afterAll даже после
    // падения beforeAll, и без этой проверки поверх внятной ошибки «MySQL
    // недоступен» наезжает вторая, уже невнятная — TypeError на null.query.
    if (!admin) return
    await admin.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``).catch(() => {})
    await admin.end().catch(() => {})
  })

  it('два параллельных INSERT IGNORE INTO likes дают одну строку и affectedRows 1/0', async () => {
    const insert = (from, to) =>
      pool.query('INSERT IGNORE INTO likes (from_user_id, to_user_id, type) VALUES (?, ?, ?)', [from, to, 'like'])

    const [first, second] = await Promise.all([insert(1, 2), insert(1, 2)])

    expect(first[0].affectedRows).toBe(1)
    expect(second[0].affectedRows).toBe(0)
    const [rows] = await pool.query('SELECT COUNT(*) AS cnt FROM likes')
    expect(Number(rows[0].cnt)).toBe(1)
  })

  it('два параллельных обычных INSERT INTO matches: второй падает ER_DUP_ENTRY (прежний код → 500)', async () => {
    const insert = () => pool.query('INSERT INTO matches (user1_id, user2_id, matched) VALUES (?, ?, 1)', [1, 2])

    const results = await Promise.allSettled([insert(), insert()])

    const rejected = results.filter((r) => r.status === 'rejected')

    expect(rejected).toHaveLength(1)
    expect(rejected[0].reason.code).toBe('ER_DUP_ENTRY')
    const [rows] = await pool.query('SELECT COUNT(*) AS cnt FROM matches')
    expect(Number(rows[0].cnt)).toBe(1)
  })

  it('два параллельных INSERT IGNORE INTO matches: обе в норме, строка одна (новый код)', async () => {
    await pool.query('DELETE FROM matches')

    const insert = () => pool.query('INSERT IGNORE INTO matches (user1_id, user2_id, matched) VALUES (?, ?, 1)', [1, 2])
    const results = await Promise.allSettled([insert(), insert()])

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true)
    expect(results.filter((r) => r.status === 'fulfilled' && r.value[0].affectedRows === 1)).toHaveLength(1)
    const [rows] = await pool.query('SELECT COUNT(*) AS cnt FROM matches')
    expect(Number(rows[0].cnt)).toBe(1)
  })

  it('база гонок поднята из database/mysql_schema.sql, а не из копии в тесте', async () => {
    const [rows] = await pool.query('SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = ?', [DB_NAME])
    expect(Number(rows[0].cnt)).toBe(schemaTableCount)
  })

  it('уникальные индексы, на которых держатся гонки, совпадают с файлом схемы', async () => {
    for (const table of ['likes', 'matches']) {
      const expected = uniqueKeysFromSchema(table)
      expect(expected, `${table}: в ${SCHEMA_PATH} нет CREATE TABLE`).not.toBeNull()
      expect(expected.size, `${table}: в файле схемы нет UNIQUE KEY`).toBeGreaterThan(0)
      const [rows] = await pool.query(
        "SELECT INDEX_NAME AS name, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols"
        + " FROM information_schema.STATISTICS"
        + " WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND NON_UNIQUE = 0 AND INDEX_NAME <> 'PRIMARY'"
        + ' GROUP BY INDEX_NAME',
        [DB_NAME, table],
      )
      const actual = new Map(rows.map((r) => [r.name, r.cols]))
      expect([...actual.entries()].sort()).toEqual([...expected.entries()].sort())
    }
  })
})
