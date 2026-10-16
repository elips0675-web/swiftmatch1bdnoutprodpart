/**
 * Гейт «смоук очередей на живом Redis действительно выполняется».
 *
 * Смоук `server/scripts/queue-smoke.mjs` подтверждает на настоящем Redis то, что
 * юнит-тесты `queue-monitor.test.js` держат на фейке: джоба дошла, упавшая видна
 * с причиной, `retry` вернул её в работу. Без сервиса Redis в CI джоба
 * `test-server` запускала бы его вхолостую (пропуск), и зелёный прогон ничего не
 * доказывал бы — ровно та же дыра, что была у `race.mysql.test.js` (см.
 * `scripts/mysql-race-gate.mjs`). Поэтому условие должно быть явным и проверяемым:
 *
 *  1. В `test-server` объявлен сервис `redis` с health-check — без health-check
 *     смоук стартует раньше Redis и падает (или, что хуже, выглядит как «Redis
 *     недоступен» → пропуск).
 *  2. В `test-server` задано `REQUIRE_REDIS: '1'` плюс `REDIS_URL`. Ноль и другое
 *     имя флага не считаются: переменная в коде читается как `=== '1'`.
 *  3. `queue-smoke.mjs` превращает отсутствие Redis в падение при этом флаге
 *     (`process.exit(1)`), а не в тихий `process.exit(0)`.
 *
 * Гейт проверяет структуру, а не наличие соединения: он зелёный на машине без
 * Redis — это нормально, потому что в CI соединение гарантировано пунктами 1–3.
 */

import fs from 'node:fs'
import path from 'node:path'

import { getJobSection, jobCode } from './e2e-gate-audit.mjs'

const CI_WORKFLOW = '.github/workflows/ci.yml'
const SMOKE_SCRIPT = 'server/scripts/queue-smoke.mjs'
const JOB = 'test-server'

function readRepoFile(root, relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8')
}

/**
 * Проверки джобы `test-server`. Комментарии вырезаны: упомянуть в комментарии
 * `redis:` и `REQUIRE_REDIS: '1'` ничего не стоит, а гейт обязан считать джобу
 * готовой только по исполняемым строкам.
 */
export function auditTestServerJob(jobSection) {
  const code = jobCode(jobSection)
  const problems = []
  const hasRedis = /^\s{6}redis:\s*$/m.test(code)

  if (!hasRedis) {
    problems.push(`${JOB}: нет сервиса redis — смоук очередей пропустится, а джоба останется зелёной`)
  } else if (!/image:\s*redis:/m.test(code)) {
    problems.push(`${JOB}: сервис redis объявлен без образа`)
  }

  if (hasRedis && !/redis-cli\s+ping/m.test(code)) {
    problems.push(`${JOB}: у сервиса redis нет health-check (redis-cli ping) — гонка старта выглядит как «Redis недоступен», то есть как пропуск`)
  }

  if (!/^\s+REQUIRE_REDIS:\s*['"]?1['"]?\s*$/m.test(code)) {
    problems.push(`${JOB}: не задано REQUIRE_REDIS: '1' — отсутствие Redis останется пропуском, ключ в коде читается строго как === '1'`)
  }

  if (!/^\s+REDIS_URL:\s*\S/m.test(code)) {
    problems.push(`${JOB}: не задан REDIS_URL — смоук пойдёт к дефолтному адресу и не отличит это от «сервис не поднялся»`)
  }

  if (!/^\s*(?:- )?run:\s*node scripts\/queue-smoke\.mjs\s*$/m.test(code)) {
    problems.push(`${JOB}: нет шага 'node scripts/queue-smoke.mjs' — сервис объявлен, но смоук никто не запускает`)
  }

  if (/continue-on-error:\s*true/.test(code)) {
    problems.push(`${JOB}: continue-on-error: true — джоба зеленеет при провале смоука`)
  }

  return problems
}

function stripJsLineComments(source) {
  return source
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n')
}

/**
 * Проверки смоука: флаг обязан менять пропуск на падение, иначе пункт 2 — декларация.
 */
export function auditSmokeSource(source) {
  const code = stripJsLineComments(source)
  const problems = []

  if (!/process\.env\.REQUIRE_REDIS === '1'/.test(code)) {
    problems.push(`${SMOKE_SCRIPT}: REQUIRE_REDIS не читается строго как '1' — переменная в workflow не влияет на поведение файла`)
  }

  if (!/process\.exit\(1\)/.test(code)) {
    problems.push(`${SMOKE_SCRIPT}: нет выхода с кодом 1 — отсутствие Redis не станет падением`)
  }

  return problems
}

export function audit(root) {
  const ci = readRepoFile(root, CI_WORKFLOW)
  const jobSection = getJobSection(ci, JOB)
  const facts = { jobFound: Boolean(jobSection) }
  if (!jobSection) {
    return { facts, problems: [`${JOB}: джобы нет в ${CI_WORKFLOW} — смоук очередей не запускается в CI`] }
  }
  return { facts, problems: [...auditTestServerJob(jobSection), ...auditSmokeSource(readRepoFile(root, SMOKE_SCRIPT))] }
}

function main() {
  const root = process.argv[2] || process.cwd()
  const { facts, problems } = audit(root)

  console.log(`джоба ${JOB} в ${CI_WORKFLOW}: ${facts.jobFound ? 'найдена' : 'НЕ НАЙДЕНА'}`)
  console.log(`смоук очередей: ${SMOKE_SCRIPT}`)

  if (problems.length) {
    console.log('')
    for (const p of problems) console.log(`FAIL: ${p}`)
    console.log('\nИтог: сервис redis объявлен? REQUIRE_REDIS=1? отсутствие Redis — падение, а не пропуск?')
    process.exit(1)
  }
  console.log('\nИтог: сервис redis объявлен, REQUIRE_REDIS=1 задан, отсутствие Redis — падение; смоук очередей выполняется на живом движке.')
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main()
