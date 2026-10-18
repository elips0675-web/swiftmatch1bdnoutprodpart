#!/usr/bin/env node
/**
 * Backup/restore smoke — «резервная копия действительно восстанавливается» (TEST-02).
 *
 * Класс дыры. Шаг `Backup restore smoke test` в джобе `server-test` существовал, но
 * снимал дамп с `--no-data`, то есть проверял восстановление ПУСТОЙ схемы: ни одна
 * строка не сверялась, а «таблица существует» выполняется и на только что созданной
 * базе. Такой прогон зелёный на базе, из которой потеряны все данные (питфолл
 * «пустое хранилище выглядит как рабочее»). Вторая половина той же дыры —
 * самодельный разбор дампа по `;\n` и `catch {}` вокруг восстановления: строка
 * данных с `;\n` внутри ломала восстановление, а ошибка гасилась, поэтому падение
 * выглядело как успешный прогон.
 *
 * Что делает прогон (каждый шаг обязателен, любой сбой — exit 1):
 *   1. Находит `mysqldump` и клиент `mysql`. Нет инструмента — падение: «проверять
 *      нечем» не должно выглядеть как «проверка пройдена».
 *   2. Кладёт в бэкапируемую БД таблицу-канарейку `_backup_smoke_canary` со
 *      строками, на которых ломается наивный разбор: кириллица, кавычки, обратный
 *      слэш, `;` и перевод строки.
 *   3. Снимает дамп С ДАННЫМИ (`--single-transaction --quick --routines --triggers`).
 *   4. Требует, чтобы в дампе были `INSERT INTO` и `CREATE TABLE` проверяемых таблиц.
 *   5. Создаёт пустую БД `…_verify_backup` и восстанавливает дамп реальным клиентом
 *      (`mysql < dump`), а не разбором текста дампа.
 *   6. Сверяет восстановленное: все таблицы источника на месте, канарейка совпадает
 *      побайтово, число строк в ядре совпадает с источником.
 *   7. Убирает за собой: канарейку из источника, scratch-БД, файл дампа.
 *
 * Запуск: `node scripts/verify-backup.mjs` (`DB_*` из окружения или `server/.env`).
 * В CI — шаг `Backup restore smoke test` в джобе `server-test` (`deploy.yml`);
 * структуру джобы и самого смоука держит гейт `npm run check:backup-smoke`.
 */
import fs from 'fs'
import path from 'path'
import { execFileSync, spawnSync } from 'child_process'
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

const DB_HOST = process.env.DB_HOST || 'localhost'
const DB_PORT = Number(process.env.DB_PORT || 3306)
const DB_USER = process.env.DB_USER || 'root'
const DB_PASS = process.env.DB_PASSWORD || ''
const DB_NAME = process.env.DB_NAME || 'swiftmatch'
const VERIFY_DB = `${DB_NAME}_verify_backup`
const CANARY = '_backup_smoke_canary'
const SANITY_TABLES = ['users', 'user_profiles', 'matches', 'messages', 'subscriptions', 'feature_flags']
const DUMP_DIR = path.join(root, 'backups')
const DUMP_FILE = path.join(DUMP_DIR, `verify-${Date.now()}.sql`)
const MAX_BUFFER = 512 * 1024 * 1024

// Строки канарейки нарочно «неудобные»: наивный разбор дампа по `;\n` спотыкается
// именно на них, а `json`-сверка после восстановления видит любую потерю байт.
const CANARY_ROWS = [
  { id: 1, note: 'кириллица', payload: 'строка; с точкой с запятой\nи переводом строки' },
  { id: 2, note: "кавычки ' \" и слэш \\", payload: 'обратный слэш \\ и обе кавычки' },
  { id: 3, note: 'emoji', payload: '🙂🚀 и таб\tвнутри' },
]

const problems = []

function fail(message) {
  problems.push(message)
  console.error(`  [FAIL] ${message}`)
}

function ok(message) {
  console.log(`  [OK] ${message}`)
}

function firstLine(text) {
  return String(text || '').trim().split(/\r?\n/)[0] || '(пусто)'
}

function findTool(name) {
  const exe = process.platform === 'win32' ? `${name}.exe` : name
  try {
    const out = execFileSync(process.platform === 'win32' ? 'where' : 'which', [name], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const found = out
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)[0]
    if (found) return found
  } catch (err) {
    // `where`/`which` возвращает 1, когда инструмента в PATH нет, — это штатный
    // случай, ниже его ищут по известным путям установки. Всё остальное — не
    // «нет инструмента», а сломанный поиск, и молчать об этом нельзя: смоук
    // обязан падать с внятной причиной, а не выглядеть как «инструмент не найден».
    if (err && err.status !== 1) {
      console.warn(`  [warn] поиск ${name} через where/which: ${firstLine(err.message)}`)
    }
  }
  const winDirs = [
    'C:\\laragon\\bin\\mysql\\mysql-8.4.3-winx64\\bin',
    'C:\\laragon\\bin\\mysql\\mysql-8.0.30-winx64\\bin',
  ]
  for (const dir of winDirs) {
    const candidate = path.join(dir, exe)
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

function clientEnv() {
  return { ...process.env, MYSQL_PWD: DB_PASS }
}

function runClient(bin, args) {
  return spawnSync(bin, args, {
    encoding: 'buffer',
    env: clientEnv(),
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
  })
}

function restoreDump(bin, args, dump) {
  return spawnSync(bin, args, {
    input: dump,
    encoding: 'buffer',
    env: clientEnv(),
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
  })
}

async function listTables(conn, database) {
  const [rows] = await conn.query(
    `SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`,
    [database],
  )
  return rows.map((r) => r.name)
}

async function countRows(conn, database, table) {
  const [[row]] = await conn.query(`SELECT COUNT(*) AS cnt FROM \`${database}\`.\`${table}\``)
  return Number(row.cnt)
}

async function seedCanary(conn) {
  await conn.query(`DROP TABLE IF EXISTS \`${CANARY}\``)
  await conn.query(
    `CREATE TABLE \`${CANARY}\` (
      id INT NOT NULL PRIMARY KEY,
      note VARCHAR(64) NOT NULL,
      payload TEXT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  )
  for (const row of CANARY_ROWS) {
    await conn.query(`INSERT INTO \`${CANARY}\` (id, note, payload) VALUES (?, ?, ?)`, [
      row.id,
      row.note,
      row.payload,
    ])
  }
  ok(`канарейка в источнике: ${CANARY_ROWS.length} строки с «неудобными» значениями`)
}

function dumpDatabase(mysqldump) {
  const args = [
    `--host=${DB_HOST}`,
    `--port=${DB_PORT}`,
    `--user=${DB_USER}`,
    '--single-transaction',
    '--quick',
    '--routines',
    '--triggers',
    '--hex-blob',
    '--default-character-set=utf8mb4',
    DB_NAME,
  ]
  const result = runClient(mysqldump, args)
  if (result.status !== 0) {
    fail(`mysqldump упал (exit ${result.status}): ${firstLine(result.stderr)}`)
    return null
  }
  fs.mkdirSync(DUMP_DIR, { recursive: true })
  const dump = result.stdout
  fs.writeFileSync(DUMP_FILE, dump)
  return dump
}

function restoreDatabase(mysqlBin, dump) {
  return restoreDump(
    mysqlBin,
    [`--host=${DB_HOST}`, `--port=${DB_PORT}`, `--user=${DB_USER}`, VERIFY_DB],
    dump,
  )
}

async function verifyRestore(conn, sourceTables, dumpText) {
  for (const table of [...SANITY_TABLES, CANARY]) {
    if (!new RegExp(`CREATE TABLE\\s+\`?${table}\`?`, 'i').test(dumpText)) {
      fail(`в дампе нет CREATE TABLE для ${table} — таблица в бэкап не попала`)
    }
  }
  const inserts = (dumpText.match(/INSERT INTO/gi) || []).length
  if (inserts === 0) {
    fail('в дампе нет INSERT INTO — это схема без данных, восстановление пустой базы ничего не доказывает')
  } else {
    ok(`дамп с данными: ${(dumpText.length / 1024).toFixed(1)} KB, вставок INSERT: ${inserts}`)
  }

  const scratchTables = await listTables(conn, VERIFY_DB)
  const missing = sourceTables.filter((t) => !scratchTables.includes(t))
  if (missing.length) {
    fail(
      `в восстановленной БД нет ${missing.length} из ${sourceTables.length} таблиц: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ' …' : ''}`,
    )
  } else {
    ok(`все таблицы источника восстановлены: ${sourceTables.length}`)
  }

  const [rows] = await conn.query(`SELECT id, note, payload FROM \`${VERIFY_DB}\`.\`${CANARY}\` ORDER BY id`)
  const restored = rows.map((r) => ({ id: Number(r.id), note: r.note, payload: r.payload }))
  if (JSON.stringify(restored) !== JSON.stringify(CANARY_ROWS)) {
    fail(`канарейка восстановилась не побайтово: ожидали ${JSON.stringify(CANARY_ROWS)}, получили ${JSON.stringify(restored)}`)
  } else {
    ok(`канарейка после восстановления совпадает побайтово: ${restored.length} строки`)
  }

  for (const table of SANITY_TABLES) {
    const src = await countRows(conn, DB_NAME, table)
    const dst = await countRows(conn, VERIFY_DB, table)
    if (src !== dst) {
      fail(`${table}: в источнике ${src} строк, после восстановления ${dst} — данные потерялись`)
    } else {
      ok(`${table}: ${dst} строк — совпадает с источником`)
    }
  }
}

async function cleanup(conn) {
  try {
    await conn.query(`DROP TABLE IF EXISTS \`${CANARY}\``)
    await conn.query(`DROP DATABASE IF EXISTS \`${VERIFY_DB}\``)
    if (fs.existsSync(DUMP_FILE)) fs.unlinkSync(DUMP_FILE)
    ok(`убрано за собой: канарейка, ${VERIFY_DB}, файл дампа`)
  } catch (err) {
    fail(`очистка не прошла: ${err.message}`)
  }
}

function finish() {
  console.log('')
  if (problems.length) {
    console.error(`[backup-verify] FAIL: находок ${problems.length} — восстановление бэкапа не доказано`)
    process.exit(1)
  }
  console.log('[backup-verify] PASS: дамп с данными восстановлен клиентом mysql; канарейка побайтово, таблицы и число строк сверены')
}

async function main() {
  console.log(`[backup-verify] Источник: ${DB_NAME}@${DB_HOST}:${DB_PORT}; scratch: ${VERIFY_DB}`)

  const mysqldump = findTool('mysqldump')
  const mysqlBin = findTool('mysql')
  if (!mysqldump) fail('не найден mysqldump — снять дамп нечем, реальный путь бэкапа останется непроверенным')
  if (!mysqlBin) fail('не найден клиент mysql — восстановить дамп нечем')
  if (problems.length) {
    finish()
    return
  }
  console.log(`[backup-verify] Инструменты: ${mysqldump} | ${mysqlBin}`)

  let conn
  try {
    conn = await mysql.createConnection({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASS,
      database: DB_NAME,
    })
  } catch (err) {
    fail(`нет подключения к ${DB_NAME}@${DB_HOST}:${DB_PORT}: ${err.message}`)
    finish()
    return
  }

  try {
    await seedCanary(conn)
    const sourceTables = await listTables(conn, DB_NAME)
    const missingCore = SANITY_TABLES.filter((t) => !sourceTables.includes(t))
    if (!sourceTables.length) {
      fail(`в ${DB_NAME} нет ни одной таблицы — бэкапить нечего`)
    } else if (missingCore.length) {
      fail(
        `в ${DB_NAME} нет таблиц ядра (${missingCore.join(', ')}) — база не инициализирована, восстановление нечего проверять`,
      )
    } else {
      const dump = dumpDatabase(mysqldump)
      if (dump) {
        await conn.query(`DROP DATABASE IF EXISTS \`${VERIFY_DB}\``)
        await conn.query(`CREATE DATABASE \`${VERIFY_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
        const restore = restoreDatabase(mysqlBin, dump)
        if (restore.status !== 0) {
          fail(`восстановление клиентом mysql упало (exit ${restore.status}): ${firstLine(restore.stderr)}`)
        } else {
          ok(`дамп восстановлен клиентом mysql в пустую БД ${VERIFY_DB}`)
          await verifyRestore(conn, sourceTables, dump.toString('utf8'))
        }
      }
    }
  } finally {
    await cleanup(conn)
    await conn.end()
  }

  finish()
}

main().catch((err) => {
  console.error('[backup-verify] FATAL:', err.message)
  process.exit(1)
})
