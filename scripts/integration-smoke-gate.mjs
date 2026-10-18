/**
 * Гейт «интеграционный прогон TEST-03 действительно выполняется в CI».
 *
 * Смоук server/scripts/integration-smoke.mjs доказывает цепочку, которую не
 * проверяет ни один мок: HTTP → MySQL (INSERT users) → Bull/Redis → nodemailer
 * → реальный SMTP-сервер → письмо в maildev → login → /auth/me. Но смоук без
 * контура честно пропускается (exit 0, канон queue-smoke.mjs), и без явного
 * вызова в CI джоба integration-smoke осталась бы зелёной вакансией — ровно
 * та же дыра, что была у race.mysql.test.js и queue-smoke. Гейт держит
 * структуру, а не соединение:
 *
 *  1. В ci.yml есть джоба `integration-smoke`: npm ci --prefix server (смоук
 *     импортирует mysql2/promise из server/node_modules), запуск
 *     scripts/integration-smoke-run.mjs, REQUIRE_INTEGRATION: '1' (ключ в
 *     коде читается строго как === '1'), без continue-on-error.
 *  2. Раннер поднимает контур обоими compose-файлами (основной +
 *     docker-compose.integration.yml), передаёт смоуку REQUIRE_INTEGRATION=1
 *     и убирает `down -v` в finally — уборка не побочный эффект (требование
 *     «после тестов ничего не остаётся»).
 *  3. Смоук превращает недоступную инфраструктуру в падение при флаге,
 *     спавнит реальный src/index.js (не заглушку) и проверяет письмо через
 *     maildev API, а не по логам.
 *  4. Override-контур: сервис maildev с healthcheck, порты db/redis перекрыты
 *     `!override` (3308/6380) — без него merge ports конкатенирует списки и
 *     конфликт с портами Laragon/основного compose вернётся.
 *  5. Шаг check:integration-smoke есть в deploy.yml и в package.json —
 *     блокирует деплой той же структурой.
 *
 * Гейт зелёный на машине без Docker — это нормально: он проверяет структуру,
 * а контур в CI поднимает сам runner.
 */

import fs from 'node:fs'
import path from 'node:path'

import { getJobSection, jobCode } from './e2e-gate-audit.mjs'

const CI_WORKFLOW = '.github/workflows/ci.yml'
const DEPLOY_WORKFLOW = '.github/workflows/deploy.yml'
const RUNNER = 'scripts/integration-smoke-run.mjs'
const SMOKE = 'server/scripts/integration-smoke.mjs'
const COMPOSE_OVERRIDE = 'docker-compose.integration.yml'
const JOB = 'integration-smoke'

function readRepoFile(root, relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8')
}

function stripJsLineComments(source) {
  return source
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n')
}

/** Проверки джобы `integration-smoke`. Комментарии вырезаны: упомянуть
 *  REQUIRE_INTEGRATION в комментарии ничего не стоит. */
export function auditCiJob(jobSection) {
  const code = jobCode(jobSection)
  const problems = []

  if (!/^\s+REQUIRE_INTEGRATION:\s*['"]?1['"]?\s*$/m.test(code)) {
    problems.push(`${JOB}: не задано REQUIRE_INTEGRATION: '1' — недоступная инфраструктура останется пропуском, ключ в коде читается строго как === '1'`)
  }

  if (!/^\s*(?:- )?run:\s*npm ci --prefix server\s*$/m.test(code)) {
    problems.push(`${JOB}: нет 'npm ci --prefix server' — смоук импортирует mysql2/promise из server/node_modules, без установки джоба упадёт на ENOENT`)
  }

  if (!/^\s*(?:- )?run:\s*node scripts\/integration-smoke-run\.mjs\s*$/m.test(code)) {
    problems.push(`${JOB}: нет шага 'node scripts/integration-smoke-run.mjs' — контур не поднимается и смоук не выполняется в CI`)
  }

  if (/continue-on-error:\s*true/.test(code)) {
    problems.push(`${JOB}: continue-on-error: true — джоба зеленеет при провале прогона`)
  }

  return problems
}

/** Проверки раннера: оба compose-файла, флаг смоуку, уборка в finally. */
export function auditRunner(source) {
  const code = stripJsLineComments(source)
  const problems = []

  if (!/'-f',\s*'docker-compose\.yml'/.test(code) || !/'-f',\s*COMPOSE_FILE/.test(code)) {
    problems.push(`${RUNNER}: контур не собирается из основного docker-compose.yml + override — сервисы/схема разойдутся с тем, что поедет на VPS`)
  }

  if (!/REQUIRE_INTEGRATION:\s*'1'/.test(code)) {
    problems.push(`${RUNNER}: смоуку не передаётся REQUIRE_INTEGRATION: '1' — прогон может зеленеть пропуском`)
  }

  if (!/finally\s*\{/.test(code)) {
    problems.push(`${RUNNER}: нет finally — уборка контейнеров станет побочным эффектом и не случится при падении`)
  }

  if (!/'down',\s*'-v'/.test(code)) {
    problems.push(`${RUNNER}: нет 'down -v' — контейнеры и volume с тестовыми данными останутся после прогона`)
  }

  return problems
}

/** Проверки смоука: флаг = падение, спавн реального сервера, письмо через API. */
export function auditSmoke(source) {
  const code = stripJsLineComments(source)
  const problems = []

  if (!/process\.env\.REQUIRE_INTEGRATION === '1'/.test(code)) {
    problems.push(`${SMOKE}: REQUIRE_INTEGRATION не читается строго как '1' — переменная в workflow/раннере не влияет на поведение файла`)
  }

  if (!/process\.exit\(1\)/.test(code)) {
    problems.push(`${SMOKE}: нет выхода с кодом 1 — недоступная инфраструктура не станет падением`)
  }

  if (!/spawn\(\s*process\.execPath,\s*\['src\/index\.js'\]/.test(code)) {
    problems.push(`${SMOKE}: сервер не спавнится как ['src/index.js'] — смоук должен поднимать реальный server/src/index.js, а не заглушку`)
  }

  if (!code.includes('MAILDEV_URL}/email')) {
    problems.push(`${SMOKE}: письмо не проверяется через maildev API (${'${MAILDEV_URL}'}/email) — доставка SMTP ничем не подтверждается`)
  }

  return problems
}

/** Проверки override-контура: maildev и `!override`-порты мимо занятых. */
export function auditComposeOverride(source) {
  const code = source
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('#'))
    .join('\n')
  const problems = []

  if (!/^ {2}maildev:\s*$/m.test(code)) {
    problems.push(`${COMPOSE_OVERRIDE}: нет сервиса maildev — SMTP-ловушки нет, письмо уйдёт в несуществующий сервер`)
  }

  if (!/^ {4}ports:\s*!override\s*$/m.test(code)) {
    problems.push(`${COMPOSE_OVERRIDE}: порты db/redis перекрыты не через !override — merge ports конкатенирует списки и вернёт конфликт с портами Laragon/основного compose`)
  }

  if (!/"3308:3306"/.test(code)) {
    problems.push(`${COMPOSE_OVERRIDE}: db не на 3308 — хост-порт конфликтует с mysqld Laragon (3306) или основным compose (3307)`)
  }

  if (!/"6380:6379"/.test(code)) {
    problems.push(`${COMPOSE_OVERRIDE}: redis не на 6380 — хост-порт конфликтует с redis Laragon (6379)`)
  }

  if (!/healthcheck:/.test(code)) {
    problems.push(`${COMPOSE_OVERRIDE}: у maildev нет healthcheck — 'up --wait' вернётся до готовности SMTP-ловушки и первый проб смоука упадёт`)
  }

  return problems
}

/** Шаг check:integration-smoke в deploy.yml (зона lint-and-typecheck). */
export function auditDeploy(deployYaml) {
  const jobSection = getJobSection(deployYaml, 'lint-and-typecheck')
  const problems = []

  if (!jobSection) {
    return [`${DEPLOY_WORKFLOW}: джобы lint-and-typecheck нет — шаг гейта некуда положить`]
  }

  if (!/npm run check:integration-smoke/.test(jobCode(jobSection))) {
    problems.push(`${DEPLOY_WORKFLOW}: в lint-and-typecheck нет 'npm run check:integration-smoke' — структура прогона не блокирует деплой`)
  }

  return problems
}

/** Скрипт гейта обязан быть вызываем: npm run check:integration-smoke. */
export function auditPackageJson(root) {
  const pkg = JSON.parse(readRepoFile(root, 'package.json'))
  const problems = []

  if (!pkg.scripts || !pkg.scripts['check:integration-smoke']) {
    problems.push('package.json: нет скрипта check:integration-smoke — deploy-шаг и CI не смогут вызвать гейт')
  }

  return problems
}

export function audit(root) {
  const ci = readRepoFile(root, CI_WORKFLOW)
  const jobSection = getJobSection(ci, JOB)
  const facts = { jobFound: Boolean(jobSection) }
  if (!jobSection) {
    return {
      facts,
      problems: [`${JOB}: джобы нет в ${CI_WORKFLOW} — интеграционный прогон не выполняется в CI, смоук остаётся локальной командой`],
    }
  }
  return {
    facts,
    problems: [
      ...auditCiJob(jobSection),
      ...auditRunner(readRepoFile(root, RUNNER)),
      ...auditSmoke(readRepoFile(root, SMOKE)),
      ...auditComposeOverride(readRepoFile(root, COMPOSE_OVERRIDE)),
      ...auditDeploy(readRepoFile(root, DEPLOY_WORKFLOW)),
      ...auditPackageJson(root),
    ],
  }
}

function main() {
  const root = process.argv[2] || process.cwd()
  const { facts, problems } = audit(root)

  console.log(`джоба ${JOB} в ${CI_WORKFLOW}: ${facts.jobFound ? 'найдена' : 'НЕ НАЙДЕНА'}`)
  console.log(`раннер: ${RUNNER}, смоук: ${SMOKE}, контур: ${COMPOSE_OVERRIDE}`)

  if (problems.length) {
    console.log('')
    for (const p of problems) console.log(`FAIL: ${p}`)
    console.log('\nИтог: джоба есть? REQUIRE_INTEGRATION=1? runner делает down -v в finally? смоук спавнит src/index.js? порты !override? deploy блокирует?')
    process.exit(1)
  }
  console.log('\nИтог: джоба выполняет runner с REQUIRE_INTEGRATION=1, runner убирает контейнеры и volume в finally, смоук поднимает реальный src/index.js и проверяет письмо через maildev, деплой блокируется гейтом.')
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main()
