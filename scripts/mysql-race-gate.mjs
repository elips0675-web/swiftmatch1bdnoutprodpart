/**
 * Гейт «живой тест на MySQL действительно выполняется» (этап 36, N1).
 *
 * В репозитории есть единственный тест на настоящем движке —
 * `server/src/__tests__/race.mysql.test.js`, он подтверждает три утверждения, на
 * которых держится фикс гонок в `POST /api/likes` и `POST /api/matches`
 * (affectedRows у `INSERT IGNORE`, `ER_DUP_ENTRY` вместо 500). Он был написан
 * как `describe.skipIf(!admin)`, где `admin` — результат пробного подключения к
 * MySQL. Джоба `test-server` в `ci.yml` сервиса БД не объявляла, поэтому
 * подключения не было, файл молча пропускался, а джоба была зелёная: год целиком
 * «проверка гонок на настоящем MySQL» не выполнялась ни разу.
 *
 * Пропуск — нормальное поведение для разработчика без локального MySQL, и
 * ломать его нельзя. Поэтому условие должно быть явным и проверяемым:
 *
 *  1. В `test-server` объявлен сервис `mysql` с health-check — без health-check
 *     тест стартует раньше БД и падает (или, что хуже, выглядит как «MySQL
 *     недоступен» → skip).
 *  2. В `test-server` задано `REQUIRE_MYSQL: '1'` плюс `DB_HOST`/`DB_USER`/
 *     `DB_PASSWORD`. Ноль и другое имя флага не считаются: переменная
 *     `REQUIRE_MYSQL: 'true'` в коде читается как `=== '1'` → false → пропуск.
 *  3. `race.mysql.test.js` превращает отсутствие БД в падение при этом флаге и
 *     содержит тест, который падает на `admin === null`. Иначе флаг в workflow
 *     ничего не меняет: тест выполнится, но упадёт в `beforeAll` с
 *     «Cannot read properties of null» — то есть проверка пункта 2 формальная.
 *
 * Джоба не должна иметь права зеленеть при провале шага: `continue-on-error`
 * или `npm test || true` возвращают джобу в зелёные при красном прогоне, и все
 * три пункта выше снова перестают что-либо значить.
 *
 * Гейт проверяет структуру, а не наличие соединения: он зелёный на машине без
 * MySQL — это правильно, потому что в CI соединение гарантировано пунктами 1–3.
 */

import fs from 'node:fs'
import path from 'node:path'

import { getJobSection, jobCode } from './e2e-gate-audit.mjs'

const CI_WORKFLOW = '.github/workflows/ci.yml'
const RACE_TEST = 'server/src/__tests__/race.mysql.test.js'
const JOB = 'test-server'

function readRepoFile(root, relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8')
}

/**
 * Проверки джобы `test-server`. Комментарии вырезаны: упомянуть в комментарии
 * `services:` и `REQUIRE_MYSQL: '1'` ничего не стоит, а гейт обязан считать
 * джобу готовой только по исполняемым строкам.
 */
export function auditTestServerJob(jobSection) {
  const code = jobCode(jobSection)
  const problems = []

  if (!/^\s+services:\s*$/m.test(code) || !/^\s{6}mysql:\s*$/m.test(code)) {
    problems.push(`${JOB}: нет сервиса mysql — единственный живой тест репозитория будет пропущен, а джоба зелёная`)
  } else if (!/image:\s*mysql:/m.test(code)) {
    problems.push(`${JOB}: сервис mysql объявлен без образа`)
  }

  if (/^\s{6}mysql:\s*$/m.test(code) && !/--health-cmd=/m.test(code)) {
    problems.push(`${JOB}: у сервиса mysql нет health-check — гонка старта (тест раньше БД) выглядит как «MySQL недоступен», то есть как пропуск`)
  }

  if (!/^\s+REQUIRE_MYSQL:\s*['"]?1['"]?\s*$/m.test(code)) {
    problems.push(`${JOB}: не задано REQUIRE_MYSQL: '1' — пропуск живого теста останется пропуском, ключ в коде читается строго как === '1'`)
  }

  for (const key of ['DB_HOST', 'DB_USER', 'DB_PASSWORD']) {
    if (!new RegExp(`^\\s+${key}:\\s*\\S`, 'm').test(code)) {
      problems.push(`${JOB}: не задан ${key} — тест пойдёт к localhost с пустым паролем и не отличит это от «сервис не поднялся»`)
    }
  }

  if (/continue-on-error:\s*true/.test(code)) {
    problems.push(`${JOB}: continue-on-error: true — джоба зеленеет при красном прогоне серверных тестов`)
  }
  if (/^\s*(?:- )?run:.*\|\|\s*true/m.test(code)) {
    problems.push(`${JOB}: шаг прогна допускает провал через '|| true' — джоба зеленеет при красном прогоне серверных тестов`)
  }

  if (!/^\s*(?:- )?run:\s*npm test\s*$/m.test(code)) {
    problems.push(`${JOB}: нет шага 'npm test' — живой тест объявлять некому`)
  }

  return problems
}

/**
 * Код JS-файла без строк-комментариев.
 *
 * `jobCode` из e2e-гейта вырезает `#`-комментарии — это YAML-хелпер, и в
 * `.js` он бесполезен: упоминание `skipIf(!admin)` в `//`-комментарии считалось бы
 * за живую конструкцию. Режутся только целые строки, чей trim начинается с `//`:
 * инлайновые комментарии не трогаются, чтобы не порезать строковый литерал с
 * `https://` внутри — в этом файле таких нет, но гейт не должен зависеть от
 * того, что их нет.
 */
function stripJsLineComments(source) {
  return source
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n')
}

/**
 * Проверки самого теста: флаг обязан менять пропуск на падение, иначе пункт 2
 * гейта — декларация. Комментарии вырезаны по той же причине, что и в джобе.
 */
export function auditRaceTestSource(source) {
  const code = stripJsLineComments(source)
  const problems = []

  if (!/const requireMysql = process\.env\.REQUIRE_MYSQL === '1'/.test(code)) {
    problems.push(`${RACE_TEST}: REQUIRE_MYSQL не читается строго как '1' — переменная в workflow не влияет на поведение файла`)
  }

  if (!/skipIf\(!admin && !requireMysql\)/.test(code)) {
    problems.push(`${RACE_TEST}: условие пропуска не учитывает REQUIRE_MYSQL — при флаге файл всё равно молча пропустится`)
  }

  if (/skipIf\(!admin\)/.test(code)) {
    problems.push(`${RACE_TEST}: остался безусловный skipIf(!admin) — флаг не влияет на пропуск`)
  }

  if (!/expect\(admin\)\.not\.toBeNull\(\)/.test(code)) {
    problems.push(`${RACE_TEST}: нет теста, который падает при admin === null — падение будет невнятным (beforeAll упадёт на admin.query), а не «MySQL обязателен»`)
  }

  return problems
}

export function audit(root) {
  const ci = readRepoFile(root, CI_WORKFLOW)
  const jobSection = getJobSection(ci, JOB)
  const facts = { jobFound: Boolean(jobSection) }
  if (!jobSection) {
    return { facts, problems: [`${JOB}: джобы нет в ${CI_WORKFLOW} — живой тест не запускается в CI`] }
  }
  return { facts, problems: [...auditTestServerJob(jobSection), ...auditRaceTestSource(readRepoFile(root, RACE_TEST))] }
}

function main() {
  const root = process.argv[2] || process.cwd()
  const { facts, problems } = audit(root)

  console.log(`джоба ${JOB} в ${CI_WORKFLOW}: ${facts.jobFound ? 'найдена' : 'НЕ НАЙДЕНА'}`)
  console.log(`файл живого теста: ${RACE_TEST}`)

  if (problems.length) {
    console.log('')
    for (const p of problems) console.log(`FAIL: ${p}`)
    console.log('\nИтог: джоба может стать зелёной, не выполнив ни одного теста на живом MySQL.')
    process.exit(1)
  }
  console.log('\nИтог: сервис БД объявлен, REQUIRE_MYSQL=1 задан, отсутствие БД — падение, джоба не может зеленеть при провале.')
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main()