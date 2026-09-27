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
// продовую `swiftmatch` не трогает. Если MySQL недоступен (в CI у джобы
// test-server сервиса БД нет) — файл пропускается, а не падает.

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

describe.skipIf(!admin)('гонки на живом MySQL (P0 #2)', () => {
  let pool

  beforeAll(async () => {
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
