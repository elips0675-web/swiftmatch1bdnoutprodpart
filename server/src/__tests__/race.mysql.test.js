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
import mysql from 'mysql2/promise'

const DB_NAME = 'swiftmatch_race_test'

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
    await admin.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``)
    await admin.query(`CREATE DATABASE \`${DB_NAME}\``)
    pool = mysql.createPool({ ...config, database: DB_NAME, connectionLimit: 4 })

    await pool.query(`
      CREATE TABLE users (
        id int unsigned NOT NULL AUTO_INCREMENT,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB`)

    // Ключи — ровно как в database/mysql_schema.sql
    await pool.query(`
      CREATE TABLE likes (
        id int unsigned NOT NULL AUTO_INCREMENT,
        from_user_id int unsigned NOT NULL,
        to_user_id int unsigned NOT NULL,
        type enum('like','super_like') NOT NULL DEFAULT 'like',
        PRIMARY KEY (id),
        UNIQUE KEY uk_likes_pair (from_user_id, to_user_id)
      ) ENGINE=InnoDB`)

    await pool.query(`
      CREATE TABLE matches (
        id int unsigned NOT NULL AUTO_INCREMENT,
        user1_id int unsigned NOT NULL,
        user2_id int unsigned NOT NULL,
        matched tinyint(1) NOT NULL DEFAULT 1,
        PRIMARY KEY (id),
        UNIQUE KEY uk_matches_pair (user1_id, user2_id)
      ) ENGINE=InnoDB`)

    await pool.query('INSERT INTO users (id) VALUES (1), (2)')
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
})
