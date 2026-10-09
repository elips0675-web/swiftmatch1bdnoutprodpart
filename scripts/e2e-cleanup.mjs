/**
 * Очистка E2E-хвостов (N10).
 *
 * Playwright удаляет тестовых юзеров через `globalTeardown`
 * (`e2e/teardown/global-teardown.ts`), но делает это внутри своего процесса:
 * если прогон убит таймаутом/SIGKILL или сам teardown упал, `e2e_*`-юзеры
 * остаются в БД, и следующий прогон получает мусор. Транзакция с ROLLBACK не
 * подходит: API и фронт — отдельные процессы, соединений много, Playwright
 * ходит по HTTP.
 *
 * Поэтому очистка вынесена в независимый скрипт, который джоба E2E гоняет
 * отдельным шагом с `if: always()`. Скрипт не только удаляет, но и честно
 * перечитывает таблицу: если хвосты остались — exit 1.
 *
 * Флаги:
 *   `--verify` — ничего не удалять, только проверить (для ручного прогона
 *                против живого стенда: `node scripts/e2e-cleanup.mjs --verify`).
 */
import mysql from 'mysql2/promise'
import path from 'node:path'

export const E2E_USER_PREDICATE = "email LIKE 'e2e\\_%' OR email LIKE 'layout\\_%'"

export function parseArgs(argv) {
  return { verify: argv.includes('--verify') }
}

export function connectionOptions(env = process.env) {
  return {
    host: env.DB_HOST || 'localhost',
    port: Number(env.DB_PORT) || 3306,
    user: env.DB_USER || 'root',
    password: env.DB_PASSWORD || '',
    database: env.DB_NAME || 'swiftmatch',
  }
}

export async function selectE2eIds(conn) {
  const [rows] = await conn.execute(`SELECT id FROM users WHERE ${E2E_USER_PREDICATE}`)
  return rows.map((r) => r.id)
}

export async function deleteUsersByIds(conn, ids) {
  if (ids.length === 0) return 0
  const placeholders = ids.map(() => '?').join(',')
  const [result] = await conn.execute(`DELETE FROM users WHERE id IN (${placeholders})`, ids)
  return result.affectedRows
}

export async function cleanupE2eData(conn, options = {}) {
  const verify = Boolean(options.verify)
  const found = await selectE2eIds(conn)
  const deleted = verify ? 0 : await deleteUsersByIds(conn, found)
  const remaining = verify ? found.length : (await selectE2eIds(conn)).length
  return { found: found.length, deleted, remaining }
}

export async function run(options = {}) {
  const { env = process.env, verify = false, log = console.log, connect = mysql.createConnection } = options
  const conn = await connect(connectionOptions(env))
  try {
    const result = await cleanupE2eData(conn, { verify })
    log(
      verify
        ? `🔎 E2E cleanup (проверка): E2E-пользователей в БД: ${result.remaining}`
        : `🧹 E2E cleanup: удалено ${result.deleted} из ${result.found}, осталось ${result.remaining}`,
    )
    return result
  } finally {
    await conn.end()
  }
}

function main() {
  const { verify } = parseArgs(process.argv.slice(2))
  run({ verify })
    .then((result) => {
      if (result.remaining > 0) {
        console.error(`FAIL: в БД осталось ${result.remaining} E2E-пользователей (${E2E_USER_PREDICATE})`)
        process.exit(1)
      }
      process.exit(0)
    })
    .catch((err) => {
      console.error(`FAIL: очистка E2E не выполнена: ${err.message}`)
      process.exit(1)
    })
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main()
