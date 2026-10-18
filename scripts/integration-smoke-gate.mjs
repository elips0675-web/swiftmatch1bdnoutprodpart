/**
 * Гейт «интеграционный прогон TEST-03 / INT-01 действительно выполняется в CI».
 *
 * Смоук server/scripts/integration-smoke.mjs доказывает цепочку, которую не
 * проверяет ни один мок: HTTP → MySQL (INSERT users) → Bull/Redis → nodemailer
 * → реальный SMTP-сервер → письмо в maildev → login → /auth/me. Смоук
 * server/scripts/s3-contract-smoke.mjs доказывает S3-контракт: upload кладёт
 * оригинал и 4 варианта в бакет, DELETE уносит их все. Но смоуки без контура
 * честно пропускаются (exit 0, канон queue-smoke.mjs), и без явного вызова в CI
 * джоба integration-smoke осталась бы зелёной вакансией — ровно та же дыра, что
 * была у race.mysql.test.js и queue-smoke. Гейт держит структуру, а не
 * соединение:
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
 *  4. Override-контур: сервис maildev с healthcheck, сервис s3 (zenko/
 *     cloudserver по digest) с healthcheck на 19001, порты db/redis перекрыты
 *     `!override` (3308/6380) — без него merge ports конкатенирует списки и
 *     конфликт с портами Laragon/основного compose вернётся.
 *  5. Второй смоук INT-01 (server/scripts/s3-contract-smoke.mjs) вызывается тем
 *     же раннером, бежит даже при падении первого и держит контракт S3: креды
 *     контура, ListObjectsV2/HeadObject/CreateBucket, DELETE оригинала и
 *     вариантов, уборку тест-юзера.
 *  6. Третий смоук (server/scripts/init-data-smoke.mjs) доказывает, что свежий
 *     init уложил ВСЕ строки init-файлов: ожидание считается из самих файлов
 *     (число кортежей и значения колонок PRIMARY KEY), факт — COUNT(*) в живой
 *     БД. Он бежит ПЕРВЫМ: смоуки с API регистрируют юзеров и добавляют строки,
 *     после них «свежесть» БД уже не проверить. Без него класс потерь, который
 *     не роняет init (REPLACE на таблице-родителе = DELETE+INSERT, при
 *     включённых FK каскад уносит детей), остаётся невидимым.
 *  7. Шаг check:integration-smoke есть в deploy.yml и в package.json —
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
const SMOKE_S3 = 'server/scripts/s3-contract-smoke.mjs'
const SMOKE_INIT_DATA = 'server/scripts/init-data-smoke.mjs'
const COMPOSE_OVERRIDE = 'docker-compose.integration.yml'
const JOB = 'integration-smoke'

function readRepoFile(root, relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8')
}

/** Удаляет комментарии — строчные и блочные: упомянуть REQUIRE_INTEGRATION в
 *  комментарии ничего не стоит, и проверка на подстроку иначе зеленеет на
 *  докблоке файла (питфолл «гейт доволен упоминанием в комментарии»).
 *  Инлайновые `// …` не трогаем: в коде есть url с `http://`. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
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
  const code = stripComments(source)
  const problems = []

  if (!/'-f',\s*'docker-compose\.yml'/.test(code) || !/'-f',\s*COMPOSE_FILE/.test(code)) {
    problems.push(`${RUNNER}: контур не собирается из основного docker-compose.yml + override — сервисы/схема разойдутся с тем, что поедет на VPS`)
  }

  if (!/REQUIRE_INTEGRATION:\s*'1'/.test(code)) {
    problems.push(`${RUNNER}: смоуку не передаётся REQUIRE_INTEGRATION: '1' — прогон может зеленеть пропуском`)
  }

  if (!/up',\s*'-d',\s*'--wait',\s*'db',\s*'redis',\s*'maildev',\s*'s3'/.test(code)) {
    problems.push(`${RUNNER}: сервис s3 не в списке 'up --wait' — S3-контракт (INT-01) нечем проверять`)
  }

  if (
    !/const initDataCode\s*=\s*await run\(/.test(code) ||
    !/const mailCode\s*=\s*await run\(/.test(code) ||
    !/const s3Code\s*=\s*await run\(/.test(code)
  ) {
    problems.push(
      `${RUNNER}: смоуки не запускаются через "const initDataCode/mailCode/s3Code = await run(" — один из прогонов молча потерян`,
    )
  }

  if (!code.includes(SMOKE_S3)) {
    problems.push(`${RUNNER}: второй смоук ${SMOKE_S3} не вызывается — контракт S3 остаётся локальной командой`)
  }

  if (!code.includes(SMOKE_INIT_DATA)) {
    problems.push(`${RUNNER}: смоук полноты init-данных ${SMOKE_INIT_DATA} не вызывается — потеря строк свежим init (REPLACE на таблице-родителе с включёнными FK) снова станет невидимой`)
  } else if (code.indexOf(SMOKE_INIT_DATA) > code.indexOf(SMOKE)) {
    problems.push(`${RUNNER}: смоук полноты init-данных бежит после смоуков с API — те регистрируют юзеров и добавляют строки, «свежесть» БД проверить уже нельзя`)
  }

  if (!/code\s*=\s*\[\s*initDataCode\s*,\s*mailCode\s*,\s*s3Code\s*\]\.find\(/.test(code)) {
    problems.push(`${RUNNER}: итог не сводит три прогона (code = [initDataCode, mailCode, s3Code].find(...)) — падение любого смоука может затереться`)
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
  const code = stripComments(source)
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

/** Проверки S3-смоука INT-01: флаг = падение, реальный сервер, контракт S3. */
export function auditS3Smoke(source) {
  const code = stripComments(source)
  const problems = []

  if (!/process\.env\.REQUIRE_INTEGRATION === '1'/.test(code)) {
    problems.push(`${SMOKE_S3}: REQUIRE_INTEGRATION не читается строго как '1' — переменная в workflow/раннере не влияет на поведение файла`)
  }

  if (!/process\.exit\(1\)/.test(code)) {
    problems.push(`${SMOKE_S3}: нет выхода с кодом 1 — недоступная инфраструктура не станет падением`)
  }

  if (!/spawn\(\s*process\.execPath,\s*\['src\/index\.js'\]/.test(code)) {
    problems.push(`${SMOKE_S3}: сервер не спавнится как ['src/index.js'] — смоук должен поднимать реальный server/src/index.js, а не заглушку`)
  }

  if (!code.includes('CreateBucketCommand')) {
    problems.push(`${SMOKE_S3}: бакет не создаётся (CreateBucketCommand) — прогон несамодостаточен и зависит от внешней подготовки хранилища`)
  }

  if (!code.includes('HeadObjectCommand')) {
    problems.push(`${SMOKE_S3}: нет HeadObjectCommand — физическое наличие оригинала в бакете ничем не подтверждается`)
  }

  if (!code.includes('ListObjectsV2Command')) {
    problems.push(`${SMOKE_S3}: нет ListObjectsV2Command — варианты ресайза и их удаление не перечисляются`)
  }

  if (!code.includes('VARIANT_SUFFIXES')) {
    problems.push(`${SMOKE_S3}: суффиксы 4 вариантов не перечислены — ресайз-сироты могли бы остаться незамеченными`)
  }

  if (!/method:\s*'DELETE'/.test(code)) {
    problems.push(`${SMOKE_S3}: нет DELETE через API — удаление фото не проверяется по-настоящему`)
  }

  if (!/AWS_ENDPOINT_URL_REKOGNITION/.test(code)) {
    problems.push(`${SMOKE_S3}: Rekognition не уведён в контур (AWS_ENDPOINT_URL_REKOGNITION) — при AWS-кредах SDK уйдёт в настоящий AWS`)
  }

  if (!/ALLOW_UNMODERATED_PHOTOS/.test(code)) {
    problems.push(`${SMOKE_S3}: не задан ALLOW_UNMODERATED_PHOTOS — фото останется 'pending' и GET /api/photos отдаст пусто`)
  }

  if (!/DELETE FROM users WHERE email/.test(code)) {
    problems.push(`${SMOKE_S3}: тест-юзер не убирается (DELETE FROM users) — после прогона останется мусор`)
  }

  return problems
}

/** Проверки смоука полноты init-данных: флаг = падение, ожидание из файлов, а не
 *  из константы в скрипте (иначе гейт сверял бы реальность с собственной
 *  константой и зеленел на любой правке дампа). */
export function auditInitDataSmoke(source) {
  const code = stripComments(source)
  const problems = []

  if (!/process\.env\.REQUIRE_INTEGRATION === '1'/.test(code)) {
    problems.push(`${SMOKE_INIT_DATA}: REQUIRE_INTEGRATION не читается строго как '1' — переменная в workflow/раннере не влияет на поведение файла`)
  }

  if (!/process\.exit\(1\)/.test(code)) {
    problems.push(`${SMOKE_INIT_DATA}: нет выхода с кодом 1 — расхождение по строкам не станет падением`)
  }

  if (!/readInitDataStatements\(/.test(code) || !/INIT_DATA_FILES/.test(code)) {
    problems.push(
      `${SMOKE_INIT_DATA}: ожидание не берётся из init-файлов (INIT_DATA_FILES + readInitDataStatements) — число строк, вписанное константой, разъедется с дампом на первой же правке`,
    )
  }

  if (!/parseReferenceKeys\(/.test(code)) {
    problems.push(
      `${SMOKE_INIT_DATA}: PRIMARY KEY из mysql_schema.sql не читается — у chat_participants/user_interests ключ составной, и сравнение по первому столбцу даёт заниженное ожидание (55 вместо 110, 50 вместо 179)`,
    )
  }

  if (!/COUNT\(\*\)/.test(code)) {
    problems.push(`${SMOKE_INIT_DATA}: в БД не считается COUNT(*) — сверять число кортежей не с чем`)
  }

  if (!/password_hash LIKE/.test(code)) {
    problems.push(`${SMOKE_INIT_DATA}: нет маркера «03-e2e-seed.sql доехал» (bcrypt админа) — init мог проглотить seed и остаться «зелёным» по листьям`)
  }

  return problems
}

/** Проверки override-контура: maildev, s3 и `!override`-порты мимо занятых. */
export function auditComposeOverride(source) {
  const code = source
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('#'))
    .join('\n')
  const problems = []

  if (!/^ {2}maildev:\s*$/m.test(code)) {
    problems.push(`${COMPOSE_OVERRIDE}: нет сервиса maildev — SMTP-ловушки нет, письмо уйдёт в несуществующий сервер`)
  }

  if (!/^ {2}s3:\s*$/m.test(code)) {
    problems.push(`${COMPOSE_OVERRIDE}: нет сервиса s3 — S3-контракт (INT-01) нечем проверять`)
  }

  if (!/zenko\/cloudserver@sha256:[0-9a-f]{64}/.test(code)) {
    problems.push(`${COMPOSE_OVERRIDE}: образ s3 не закреплён digest'ом — тег уплывёт и прогон перестанет быть воспроизводимым (MinIO-образы сняты с реестров)`)
  }

  if (!/S3BACKEND:\s*mem\b/.test(code)) {
    problems.push(`${COMPOSE_OVERRIDE}: S3BACKEND не 'mem' — бэкенд cloudserver без явного значения роняет первый CreateBucket`)
  }

  if (!/"19001:8000"/.test(code)) {
    problems.push(`${COMPOSE_OVERRIDE}: s3 не на 19001 — хост-порт конфликтует с занятыми (канон портов — docs/AGENTS-startup.md)`)
  }

  if ((code.match(/healthcheck:/g) || []).length < 2) {
    problems.push(`${COMPOSE_OVERRIDE}: у maildev/s3 нет healthcheck — 'up --wait' вернётся до готовности сервиса и первый проб смоука упадёт`)
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
      ...auditS3Smoke(readRepoFile(root, SMOKE_S3)),
      ...auditInitDataSmoke(readRepoFile(root, SMOKE_INIT_DATA)),
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
  console.log(`раннер: ${RUNNER}, смоуки: ${SMOKE_INIT_DATA}, ${SMOKE}, ${SMOKE_S3}, контур: ${COMPOSE_OVERRIDE}`)

  if (problems.length) {
    console.log('')
    for (const p of problems) console.log(`FAIL: ${p}`)
    console.log('\nИтог: джоба есть? REQUIRE_INTEGRATION=1? runner делает down -v в finally? три смоука запускаются и итог сводится? смоуки спавнят src/index.js? порты !override, s3 по digest? deploy блокирует?')
    process.exit(1)
  }
  console.log('\nИтог: джоба выполняет runner с REQUIRE_INTEGRATION=1, runner убирает контейнеры и volume в finally, три смоука поднимают реальный src/index.js (полнота init-данных, почта, S3-контракт), деплой блокируется гейтом.')
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main()
