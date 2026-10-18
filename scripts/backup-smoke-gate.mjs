/**
 * Гейт «backup/restore smoke действительно восстанавливает ДАННЫЕ» (TEST-02).
 *
 * Класс дыры. Шаг `Backup restore smoke test` в джобе `server-test` был заведён,
 * но `scripts/verify-backup.mjs` снимал дамп с `--no-data` и восстанавливал
 * ПУСТУЮ СХЕМУ: ни одна строка не сверялась, «таблица существует» выполняется
 * на любой свежесозданной базе, а самодельный разбор дампа по `;\n` и `catch {}`
 * вокруг восстановления гасили ошибку. Такой прогон зелёный ровно тогда, когда
 * он ничего не проверяет (питфолл «пустое хранилище выглядит как рабочее»):
 * «резервная копия восстанавливается» год числилось проверенным и не проверялось.
 *
 * Пропуск тут — недопустимое поведение (в отличие от живого MySQL-теста):
 * смоук обязан либо доказать восстановление, либо упасть. Поэтому условие
 * должно быть явным и проверяемым:
 *
 *  1. В `server-test` (`deploy.yml`) есть шаг `node scripts/verify-backup.mjs`
 *     с `DB_HOST`/`DB_USER`/`DB_PASSWORD`/`DB_NAME`: без `DB_NAME` смоук уйдёт в
 *     дефолтную базу и «зелёный» будет относиться не к той БД, которую собрали.
 *  2. В джобе создаётся схема (`database/mysql_schema.sql`) — иначе восстанавливать
 *     нечего, а смоук обязан падать на неинициализированной БД, а не молчать.
 *  3. Джоба не может зеленеть при провале шага: `continue-on-error` и `|| true`
 *     делают все пункты выше декларацией.
 *  4. Сам смоук: дамп С данными (в исходнике нет `--no-data`), таблица-канарейка
 *     со «сложными» значениями и сверка числа строк, `process.exit(1)` на любую
 *     находку, нет разбора дампа по `;\n` (восстановление идёт реальным клиентом
 *     `mysql`, как восстанавливают бэкап) и нет пустых `catch` (иначе падение
 *     восстановления выглядит как успешный прогон).
 *  5. Гейт запускается: npm-скрипт `check:backup-smoke`, джоба `backup-smoke` в
 *     `ci.yml` и шаг в `lint-and-typecheck` (`deploy.yml`).
 *
 * Гейт проверяет структуру, а не соединение: он зелёный на машине без MySQL —
 * это правильно, потому что в CI база гарантирована пунктами 1–2.
 */

import fs from 'node:fs'
import path from 'node:path'

import { getJobSection, getSteps, jobCode } from './e2e-gate-audit.mjs'

export const NPM_SCRIPT = 'check:backup-smoke'
export const GATE_FILE = 'scripts/backup-smoke-gate.mjs'
export const SMOKE_FILE = 'scripts/verify-backup.mjs'
export const CI_WORKFLOW = '.github/workflows/ci.yml'
export const DEPLOY_WORKFLOW = '.github/workflows/deploy.yml'
export const RUN_JOB = 'server-test'
export const GATE_JOB = 'backup-smoke'
export const LINT_JOB = 'lint-and-typecheck'
export const PACKAGE_JSON = 'package.json'
export const SCHEMA_FILE = 'database/mysql_schema.sql'
export const CANARY_TABLE = '_backup_smoke_canary'

function readRepoFile(root, relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8')
}

/**
 * Код JS без комментариев — блочных и целых строк `//`. Номера строк сохраняются:
 * вырезанный комментарий становится пустыми строками, иначе находка «пустой catch
 * в строке N» указывала бы не туда (номер считался бы по тексту без комментариев).
 *
 * Инлайновые `//` не режутся: строка с `https://` внутри считается мёртвой
 * половиной проверки, если порезать её по `//` (та же причина, что в
 * `mysql-race-gate.mjs`). Блочные комментарии вырезаются целиком: класс дыры
 * этого гейта описывается в шапке смоука теми же словами (`--no-data`), и по
 * сырому тексту гейт краснел бы на собственном объяснении.
 */
export function stripJsComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ''))
    .split(/\r?\n/)
    .map((line) => (line.trim().startsWith('//') ? '' : line))
    .join('\n')
}

/** Пустые `catch` — их номера строк. Комментарий внутри признаётся за пустоту. */
export function findSilentCatches(source) {
  const code = stripJsComments(source)
  const hits = []
  const re = /catch\s*(?:\([^)]*\))?\s*\{([^{}]*)\}/g
  let match = re.exec(code)
  while (match) {
    if (!match[1].trim()) hits.push(code.slice(0, match.index).split('\n').length)
    match = re.exec(code)
  }
  return hits
}

/** Шаг джобы, запускающий смоук восстановления. */
export function findSmokeStep(jobSection) {
  return getSteps(jobCode(jobSection)).find((step) => /node scripts\/verify-backup\.mjs/.test(step)) || null
}

/** Проверки шага смоука: он обязан ходить в ту БД, которую собрала джоба. */
export function auditSmokeStep(step) {
  const problems = []
  for (const key of ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']) {
    if (!new RegExp(`^\\s+${key}:\\s*\\S`, 'm').test(step)) {
      problems.push(
        `${RUN_JOB}: шаг ${SMOKE_FILE} без ${key} — смоук уйдёт в дефолтную базу (localhost/${key === 'DB_NAME' ? 'swiftmatch' : '…'}) и «зелёный» будет не про собранную БД`,
      )
    }
  }
  return problems
}

/** Проверки джобы `server-test`: смоук заведён, схема собрана, провал не гасится. */
export function auditRunJob(jobSection) {
  const code = jobCode(jobSection)
  const problems = []
  const step = findSmokeStep(jobSection)

  if (!step) {
    problems.push(
      `${RUN_JOB}: нет шага 'node ${SMOKE_FILE}' — прогон «restore → smoke» не заведён, дамп никто не восстанавливает`,
    )
  } else {
    problems.push(...auditSmokeStep(step))
  }

  if (!code.includes(SCHEMA_FILE)) {
    problems.push(`${RUN_JOB}: нет шага, создающего схему (${SCHEMA_FILE}) — восстанавливать нечего, а смоук обязан падать, а не молчать`)
  }

  if (/continue-on-error:\s*true/.test(code)) {
    problems.push(`${RUN_JOB}: continue-on-error: true — джоба зеленеет при красном прогоне, и пункты 1–2 снова ничего не значат`)
  }
  if (/^\s*(?:- )?run:.*\|\|\s*true/m.test(code)) {
    problems.push(`${RUN_JOB}: шаг прогна допускает провал через '|| true' — джоба зеленеет при красном прогоне`)
  }

  return problems
}

/** Проверки самого смоука: он должен доказывать данные, а не схему. */
export function auditSmokeSource(source) {
  const code = stripJsComments(source)
  const problems = []

  if (/--no-data/.test(code)) {
    problems.push(`${SMOKE_FILE}: дамп снимается с --no-data — восстанавливается пустая схема, потеря данных остаётся незамеченной`)
  }
  if (!/mysqldump/.test(code)) {
    problems.push(`${SMOKE_FILE}: нет mysqldump — дамп нечем снять, «проверка» станет самодельной сборкой SQL`)
  }
  if (!code.includes(CANARY_TABLE)) {
    problems.push(`${SMOKE_FILE}: нет таблицы-канарейки ${CANARY_TABLE} — восстановленные данные ни с чем не сверяются`)
  }
  if (!/COUNT\(\*\)/.test(code)) {
    problems.push(`${SMOKE_FILE}: нет сверки числа строк с источником — потеря части данных между дампом и восстановлением невидима`)
  }
  if (/split\(\/;\\s\*\\n\/\)/.test(code)) {
    problems.push(`${SMOKE_FILE}: дамп разбирается по ';\\n' — строка данных с ';\\n' внутри ломает восстановление, а бэкап восстанавливают клиентом mysql`)
  }
  if (!/process\.exit\(1\)/.test(code)) {
    problems.push(`${SMOKE_FILE}: нет process.exit(1) — найденная проблема не делает прогон красным`)
  }
  const silent = findSilentCatches(source)
  if (silent.length) {
    problems.push(`${SMOKE_FILE}: пустые catch в строках ${silent.join(', ')} — ошибка восстановления гасится, прогон выглядит успешным`)
  }
  if (!/DROP DATABASE IF EXISTS/.test(code)) {
    problems.push(`${SMOKE_FILE}: нет удаления scratch-БД — восстановление оставляет за собой базу, следующий прогон проверяет её остатки`)
  }

  return problems
}

/**
 * Джоба/шаг запускает гейт — либо через npm-скрипт, либо напрямую файлом.
 * Оба вызова равнозначны (`ci.yml` у остальных гейтов зовёт файл напрямую,
 * `deploy.yml` — npm-скрипт), важно лишь, чтобы гейт был запущен.
 */
export function runsGate(code) {
  return code.includes(`npm run ${NPM_SCRIPT}`) || code.includes(`node ${GATE_FILE}`)
}

/** Проверки запуска самого гейта: npm-скрипт, джоба CI, шаг в deploy. */
export function auditWiring(root) {
  const problems = []
  const pkg = JSON.parse(readRepoFile(root, PACKAGE_JSON))
  const script = pkg.scripts ? pkg.scripts[NPM_SCRIPT] : ''
  if (!script) {
    problems.push(`${PACKAGE_JSON}: нет скрипта ${NPM_SCRIPT} — гейт нечем запустить`)
  } else if (!script.includes(path.basename(GATE_FILE))) {
    problems.push(`${PACKAGE_JSON}: ${NPM_SCRIPT} запускает '${script}', а не ${GATE_FILE}`)
  }

  const ciCode = jobCode(getJobSection(readRepoFile(root, CI_WORKFLOW), GATE_JOB))
  if (!runsGate(ciCode)) {
    problems.push(`${CI_WORKFLOW}: джоба ${GATE_JOB} не запускает ${NPM_SCRIPT} — гейт живёт только локально`)
  }

  const deployCode = jobCode(getJobSection(readRepoFile(root, DEPLOY_WORKFLOW), LINT_JOB))
  if (!runsGate(deployCode)) {
    problems.push(`${DEPLOY_WORKFLOW}: шаг ${NPM_SCRIPT} в ${LINT_JOB} отсутствует — гейт не блокирует деплой`)
  }

  return problems
}

export function audit(root) {
  const deploy = readRepoFile(root, DEPLOY_WORKFLOW)
  const jobSection = getJobSection(deploy, RUN_JOB)
  const facts = {
    jobFound: Boolean(jobSection),
    smokeStepFound: jobSection ? Boolean(findSmokeStep(jobSection)) : false,
  }

  const problems = []
  if (!jobSection) {
    problems.push(`${RUN_JOB}: джобы нет в ${DEPLOY_WORKFLOW} — restore-смоук не запускается в CI`)
  } else {
    problems.push(...auditRunJob(jobSection))
  }
  problems.push(...auditSmokeSource(readRepoFile(root, SMOKE_FILE)))
  problems.push(...auditWiring(root))

  return { facts, problems }
}

function main() {
  const root = process.argv[2] || process.cwd()
  const { facts, problems } = audit(root)

  console.log(`джоба ${RUN_JOB} в ${DEPLOY_WORKFLOW}: ${facts.jobFound ? 'найдена' : 'НЕ НАЙДЕНА'}`)
  console.log(`шаг restore-смоука: ${facts.smokeStepFound ? 'найден' : 'НЕ НАЙДЕН'}`)
  console.log(`смоук: ${SMOKE_FILE}`)

  if (problems.length) {
    console.log('')
    for (const problem of problems) console.log(`FAIL: ${problem}`)
    console.log('\nИтог: прогон может быть зелёным, не восстановив ни одной строки данных.')
    process.exit(1)
  }
  console.log('\nИтог: дамп снимается с данными, восстанавливается клиентом mysql, канарейка и число строк сверяются, провал — падение.')
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main()
