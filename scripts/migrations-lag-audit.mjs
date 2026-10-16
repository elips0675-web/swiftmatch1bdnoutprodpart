#!/usr/bin/env node
/**
 * Гейт «БД, отставшая от миграций, действительно видна дрейф-аудиту» (остатки свода 15.10.2026, питфолл 99).
 *
 * Питфолл 99: локальный запуск не применял миграции, живая БД стояла на `052`,
 * код ждал `060` — `GET /api/admin/features` отвечал 200 (`SELECT *` + `?? true`),
 * а `PUT` падал `ER_BAD_FIELD_ERROR: Unknown column 'profile_activity_enabled'`.
 * Оффлайн-аудит схемы при этом был зелёный: он сверяет код со
 * `database/mysql_schema.sql`, а не с тем, догнала ли БД миграции.
 *
 * Буквальный рецепт бэклога («применять миграции по одной на пустой БД») здесь
 * невыполним, и это измерено, а не предположено: миграции — это `ALTER` поверх
 * полной схемы, на пустой БД падают 58 из 68 (`ER_NO_SUCH_TABLE`: `001` ждёт
 * `user_photos`, `004` — `users`). Штатный bootstrap другой: `seed-migrations.mjs`
 * + BASELINE в `database/migrations/migrate.js:38-50` сначала грузят
 * `mysql_schema.sql`, затем «запечатывают» миграции как применённые.
 *
 * Поэтому шаг миграции проверяется в обратную сторону, на живой БД:
 *   1. собрать чистую БД из `database/mysql_schema.sql` (состояние «всё применено»);
 *   2. снять столбцы, которые добавляет очередная миграция, и прогнать
 *      `scripts/schema-drift-audit.mjs` против этой БД — «БД отстала на миграцию»;
 *   3. потребовать, чтобы аудит покраснел И назвал снятый столбец (иначе он слеп
 *      к отставшей БД, и питфолл 99 повторится молча);
 *   4. пересобрать БД из `database/mysql_schema.sql` и потребовать зелёный аудит —
 *      краснота причинная, а не шум. Возврат столбцов повтором файла миграции
 *      для этого не годится: не все миграции идемпотентны (`008_add_iap.sql` —
 *      обычный `ALTER TABLE … ADD COLUMN`, повтор даёт `ER_DUP_FIELDNAME`),
 *      а пересборка из эталона возвращает ровно то состояние, с которого начали.
 *
 * Требуется живой MySQL (`DB_*`). Джоба `migrations-lag` (`ci.yml`) объявляет
 * сервис `mysql`, ставит КОРНЕВЫЕ зависимости (нужен `mysql2`) и `REQUIRE_MYSQL=1`:
 * без БД шаг падает, а не пропускается. Джоба отдельная, потому что `test-server`
 * работает в `server/` и корневые `node_modules` не ставит.
 * Структуру шага и логику решения проверяет `scripts/migrations-lag-audit.test.mjs`.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { readCodeRefs } from './schema-drift-audit.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MIGRATIONS_DIR = path.join(ROOT, 'database', 'migrations')
const SCHEMA_FILE = path.join(ROOT, 'database', 'mysql_schema.sql')
const DRIFT_AUDIT = path.join(ROOT, 'scripts', 'schema-drift-audit.mjs')
const SCRATCH_DB = 'swiftmatch_mig_lag'

/**
 * Столбцы, которые добавляет миграция. Миграции идемпотентны и прячут DDL в
 * строке внутри `IF(@p = 0, 'ALTER TABLE … ADD COLUMN …', 'SELECT 1')`, поэтому
 * проверяется текст целиком, а не исполняемая ветка.
 */
export function parseMigrationColumns(sqlText) {
  const out = []
  const re = /ALTER\s+TABLE\s+`?(\w+)`?/gi
  let current = null
  let lastIndex = 0
  for (const m of sqlText.matchAll(re)) {
    if (current) {
      for (const c of sqlText.slice(lastIndex, m.index).matchAll(/ADD\s+COLUMN\s+`?(\w+)`?/gi)) {
        out.push({ table: current, column: c[1] })
      }
    }
    current = m[1]
    lastIndex = m.index + m[0].length
  }
  if (current) {
    for (const c of sqlText.slice(lastIndex).matchAll(/ADD\s+COLUMN\s+`?(\w+)`?/gi)) {
      out.push({ table: current, column: c[1] })
    }
  }
  return out
}

/** Шаги гейта: только миграции, добавляющие столбцы, в порядке применения. */
export function migrationSteps(dir = MIGRATIONS_DIR) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => ({ file, columns: parseMigrationColumns(fs.readFileSync(path.join(dir, file), 'utf8')) }))
    .filter((s) => s.columns.length > 0)
}

function firstLine(text) {
  return String(text || '').split(/\r?\n/).find((l) => l.trim()) || '(пусто)'
}

/** Строка отчёта дрейф-аудита о столбце, который читает код: это и есть живой 500. */
function codeReadFinding(out, column) {
  return new RegExp(`\\[COLUMN_MISSING_IN_CODE\\]\\s+${column}\\b`).test(out)
}

/**
 * Решение гейта по наблюдаемым результатам. MySQL не нужен: `runAudit`,
 * `dropColumns` и `rebuild` инжектируются, поэтому логику — включая
 * обязательное «код читает пропавший столбец» — проверяет обычный vitest-тест
 * на фейках.
 *
 * Шаги идут в обратном порядке применения, отставание накапливается: на каждом
 * шаге снимаются столбцы очередной миграции и аудит сверяется заново. Гейт
 * красный, если ни на одном шаге не нашлось столбца, который читает код и
 * которого в БД уже нет (`COLUMN_MISSING_IN_CODE`) — тогда дрейф-аудит слеп
 * ровно к тому классу, из которого вырос питфолл 99.
 */
export async function decide({ baseline, steps, codeReads, runAudit, dropColumns, rebuild }) {
  const problems = []
  const facts = { redStep: null, skipped: [], checked: 0, droppedSteps: 0 }

  if (baseline.rc !== 0) {
    problems.push(
      `базовая БД собрана из database/mysql_schema.sql, но дрейф-аудит красный (rc=${baseline.rc}) — сверять не с чем: ${firstLine(baseline.out)}`,
    )
  }

  const dropped = []
  for (const step of [...steps].reverse()) {
    const gone = await dropColumns(step)
    if (!gone.length) {
      facts.skipped.push(
        `${step.file}: снять столбцы не удалось (${step.columns.map((c) => `${c.table}.${c.column}`).join(', ')})`,
      )
      continue
    }
    dropped.push({ step, gone })
    facts.checked += 1

    const lagging = await runAudit()
    const codeRead = gone.filter(({ table, column }) => codeReads.get(table)?.has(column))
    if (!codeRead.length) continue

    const named = codeRead.filter(({ column }) => codeReadFinding(lagging.out, column))
    if (lagging.rc === 0) {
      problems.push(
        `${step.file}: БД отстала на эту миграцию, код читает ${codeRead.map((c) => c.column).join(', ')}, а дрейф-аудит зелёный — живой 500 был бы невидим`,
      )
      continue
    }
    if (!named.length) {
      problems.push(
        `${step.file}: аудит покраснел, но не назвал читаемый кодом столбец (${codeRead.map((c) => c.column).join(', ')}) как COLUMN_MISSING_IN_CODE — краснота не про код`,
      )
      continue
    }
    if (!facts.redStep) {
      facts.redStep = `${step.file} (код читает: ${named.map((c) => `${c.table}.${c.column}`).join(', ')})`
    }
  }
  facts.droppedSteps = dropped.length

  if (dropped.length) {
    await rebuild()
    const back = await runAudit()
    if (back.rc !== 0) {
      problems.push(
        `после пересборки БД из database/mysql_schema.sql аудит остался красным (rc=${back.rc}) — краснота не причинная: ${firstLine(back.out)}`,
      )
    }
  }

  if (baseline.rc === 0 && !facts.redStep) {
    problems.push(
      `ни на одном из ${facts.checked} проверенных шагов БД-без-миграции не поймана как COLUMN_MISSING_IN_CODE: дрейф-аудит не видит отставшую БД — питфолл 99 (живой 500) повторится молча`,
    )
  }
  if (baseline.rc === 0 && facts.checked === 0) {
    problems.push('ни один шаг не проверен: снять столбцы не удалось ни у одной миграции — гейт зелёный по построению')
  }

  return { problems, facts }
}

async function main() {
  const requireMysql = process.env.REQUIRE_MYSQL === '1'
  let mysql
  try {
    mysql = (await import('mysql2/promise')).default
  } catch {
    console.log('SKIP: mysql2 недоступен (нужен `npm ci` в корне)')
    return requireMysql ? 1 : 0
  }

  const connectionOptions = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  }

  let conn
  try {
    conn = await mysql.createConnection(connectionOptions)
  } catch (e) {
    if (requireMysql) {
      console.error(`FAIL: REQUIRE_MYSQL=1, но подключение к MySQL не удалось: ${e.code || e.message}`)
      return 1
    }
    console.log(`SKIP: MySQL недоступен без REQUIRE_MYSQL (${e.code || e.message})`)
    return 0
  }

  const steps = migrationSteps()
  const schema = fs.readFileSync(SCHEMA_FILE, 'utf8')

  const runAudit = () => {
    const r = spawnSync(process.execPath, [DRIFT_AUDIT], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, DB_NAME: SCRATCH_DB },
    })
    return { rc: r.status ?? 1, out: `${r.stdout || ''}${r.stderr || ''}` }
  }

  try {
    const buildDatabase = async () => {
      await conn.query(`DROP DATABASE IF EXISTS \`${SCRATCH_DB}\``)
      await conn.query(`CREATE DATABASE \`${SCRATCH_DB}\``)
      await conn.query(`USE \`${SCRATCH_DB}\``)
      await conn.query(schema)
    }

    await buildDatabase()
    const baseline = runAudit()

    const dropColumns = async (step) => {
      const dropped = []
      for (const { table, column } of step.columns) {
        try {
          await conn.query(`ALTER TABLE \`${table}\` DROP COLUMN \`${column}\``)
          dropped.push({ table, column })
        } catch {
          // Столбец держит индекс или FK — снять нельзя, шаг пропускается.
        }
      }
      return dropped
    }

    const { problems, facts } = await decide({
      baseline,
      steps,
      codeReads: readCodeRefs().perTable,
      runAudit,
      dropColumns,
      rebuild: buildDatabase,
    })

    console.log(`миграций со столбцами: ${steps.length}; проверено шагов: ${facts.checked}`)
    console.log(`красный шаг: ${facts.redStep || 'НЕТ'}`)
    if (facts.skipped.length) console.log(`пропущено шагов: ${facts.skipped.length}`)

    if (problems.length) {
      console.log('')
      for (const p of problems) console.log(`FAIL: ${p}`)
      console.log('\nИтог: дрейф-аудит не доказывает, что БД догнала миграции (питфолл 99).')
      return 1
    }
    console.log('\nИтог: БД, отставшая на миграцию, краснит дрейф-аудит и называется им по столбцу; полная схема — зелёная.')
    return 0
  } finally {
    try {
      await conn.query(`DROP DATABASE IF EXISTS \`${SCRATCH_DB}\``)
    } catch {}
    await conn.end()
  }
}

export { main }

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(e)
      process.exit(2)
    })
}
