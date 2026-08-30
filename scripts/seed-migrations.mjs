#!/usr/bin/env node
// Seed _migrations so migrate.js skips migrations already present in mysql_schema.sql.
//
// Контекст (этап 79): с этапа 77 mysql_schema.sql регенерирован из живой (полностью
// мигрированной) БД — включает ВСЕ таблицы/колонки/индексы финального состояния.
// При импорте schema.sql в чистую БД (CI Init, fresh deploy) _migrations пуст, но
// структура уже содержит результат миграций 001+. Повторный прогон migrate.js
// падал бы на уже существующих колонках/индексах (Duplicate key name 'idx_user_id'
// в 002). Этот скрипт помечает все текущие миграции как applied (INSERT IGNORE),
// чтобы migrate.js применял только новые (044+). Идемпотентен.
//
// Запуск: node scripts/seed-migrations.mjs  (DB_* из окружения или server/.env)
import fs from 'fs'
import path from 'path'
import { readdir } from 'fs/promises'
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

async function main() {
  const migrationsDir = path.join(root, 'database', 'migrations')
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort()

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'swiftmatch',
  })

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `)

  let skipped = 0
  for (const file of files) {
    const [r] = await conn.execute('INSERT IGNORE INTO _migrations (name) VALUES (?)', [file])
    if (r.affectedRows === 1) skipped++
  }

  const [rows] = await conn.execute('SELECT COUNT(*) c FROM _migrations')
  await conn.end()
  console.log(`[seed-migrations] marked ${skipped} migration(s) as applied (total ${rows[0].c}); migrate.js will apply only new ones`)
}

main().catch((e) => { console.error('[seed-migrations] ERROR:', e.message); process.exit(1) })
