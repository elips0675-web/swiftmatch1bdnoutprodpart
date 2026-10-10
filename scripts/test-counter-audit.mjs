/**
 * Гейт «счётчики тестов в документации совпадают с прогоном».
 *
 * Счётчики дублируются в семи файлах (`README.md`, `project-context.md`, три
 * копии в `test/` и шапки `Что сделано.txt` / `Что доделать.txt` — журналы
 * добавлены 08.10 по питфоллу 93: шапка истории держала 1009 при факте 1245),
 * и расходились: на 30.09.2026 в репозитории было
 * 867 тестов (сервер 715 в 52 файлах, фронт 152 в 24, E2E 150 в 19 спеках), а
 * в документации стояло 779 / 807 / 849 в зависимости от файла. Оценка проекта
 * от 30.09 это воспроизвела («ИНВЕНТАРЬ-ТЕСТОВ.md — 807») и построила на этом
 * свои выводы.
 *
 * Причина не в невнимательности: пересчёт чисел в пяти местах — ручная работа
 * в конце каждого этапа, и она отваливается первым же забытым файлом. Гейт
 * убирает ручную работу: числа **измеряются** прогоном (`vitest run
 * --reporter=json`, `playwright test --list --reporter=json`) и сверяются с
 * написанным в документации.
 *
 * Два слоя проверки:
 *
 *  1. Заголовки счётчиков: `README.md` (фронт/сервер/E2E), `project-context.md`
 *     (блок «Актуальный срез»), `test/ИНВЕНТАРЬ-ТЕСТОВ.md` (шапка, блок
 *     «Прогон», заголовки секций, команды прогона), шапки `Что сделано.txt`
 *     («Актуально на … Все тесты») и `Что доделать.txt` («Счётчики: …»).
 *     Сверяются все числа,
 *     включая «0 failures» — падение тестов тоже делает документацию ложью.
 *  2. Построчные таблицы `test/ИНВЕНТАРЬ-ТЕСТОВ.md`: у каждого тест-файла
 *     обязана быть строка с **точным** числом тестов. Отсутствующая строка —
 *     это ровно тот случай «файл есть в репозитории, а в снимке его нет»,
 *     из-за которого инвентарь разошёлся с прогоном (3 серверных файла и 16
 *     тестов `blocks.test.js` не попали в таблицу после этапа 22).
 *
 * `--fix` переписывает числа сам (включая русские окончания: `49 файла` →
 * `52 файлов`), дописывает недостающие строки с пометкой «требует описания» и
 * обновляет дату среза. Молчаливых мест не остаётся: цифра, которую гейт не
 * умеет проверять, не должна и попадать в документы.
 *
 * Флаги: `--fix`, `--skip-e2e`, `--no-per-file`, `--reports <front.json>,<server.json>`.
 * Быстрая итерация: `--skip-e2e` (E2E-числа не сверяются) и `--reports` с готовыми
 * JSON прогона — без него гейт сам запускает vitest и идёт минуты; шаги `[1/3]…[3/3]`
 * печатаются, чтобы долгая пауза не выглядела зависанием.
 *
 * ⚠️ Русские слова в шаблонах пишутся классом `[а-яё]+`, а не `\w+`: в JS
 * `\w` без флага `u` — это только [A-Za-z0-9_], и `тест\w+` не находит
 * «тестов». На этом гейт молчал бы «строка со счётчиками не найдена».
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const NOUNS = {
  frontTests: ['тест', 'теста', 'тестов'],
  frontFiles: ['файл', 'файла', 'файлов'],
  serverTests: ['тест', 'теста', 'тестов'],
  serverFiles: ['файл', 'файла', 'файлов'],
  e2eTests: ['тест', 'теста', 'тестов'],
  e2eFiles: ['spec-файл', 'spec-файла', 'spec-файлов'],
  totalTests: ['тест', 'теста', 'тестов'],
  serverTableTests: ['тест', 'теста', 'тестов'],
  serverTableFiles: ['файл', 'файла', 'файлов'],
  frontTableTests: ['тест', 'теста', 'тестов'],
  frontTableFiles: ['файл', 'файла', 'файлов'],
  e2eTableTests: ['тест', 'теста', 'тестов'],
  e2eTableFiles: ['spec-файл', 'spec-файла', 'spec-файлов'],
  scriptsTableTests: ['тест', 'теста', 'тестов'],
  scriptsTableFiles: ['файл', 'файла', 'файлов'],
}

const slot = (kind, group, isWord) => ({ kind, group, word: isWord, checked: true })
const dateSlot = (group) => ({ kind: 'date', group, word: false, checked: false })

/** Строка README вида «- **Сервер (Vitest):** 632 теста, 48 файлов — **0 failures**». */
const readmeSuite = (id, label, runner, tests, files) => ({
  id,
  suite: runner === 'Playwright' ? 'e2e' : 'unit',
  re: new RegExp(`^(- \\*\\*${label} \\(${runner}\\):\\*\\* )(\\d+)( )([\\wа-яё-]+)(, )(\\d+)( )([\\wа-яё-]+)`, 'm'),
  slots: [
    slot(tests, 2),
    slot(tests, 4, true),
    slot(files, 6),
    slot(files, 8, true),
  ],
})

const README_FRONTS = readmeSuite('readme-front', 'Фронтенд', 'Vitest', 'frontTests', 'frontFiles')
const README_SERVER = readmeSuite('readme-server', 'Сервер', 'Vitest', 'serverTests', 'serverFiles')
const README_E2E = readmeSuite('readme-e2e', 'E2E', 'Playwright', 'e2eTests', 'e2eFiles')

/**
 * Блок «Актуальный срез» разбит на три однострочных claim'а. Многострочный
 * шаблон с `\n` — источник тихих «строка не найдена»: сломанный блок выключает
 * сразу все его числа, и потери не видно (одна потерянная `\)` в шаблоне
 * погасила блок целиком, пока соседние строки README продолжали проверяться).
 */
const SNAPSHOT_TOTAL = {
  id: 'project-context-total',
  suite: 'all',
  re: /Актуальный срез на \d{2}\.\d{2}\.\d{4}: \*\*(\d+)\/(\d+)\*\* ([\wа-яё-]+)/m,
  slots: [slot('totalTests', 1), slot('totalTests', 2), slot('totalTests', 3, true)],
}

const SNAPSHOT_SUITES = {
  id: 'project-context-suites',
  suite: 'all',
  re: /^> \(сервер (\d+)\/(\d+) в (\d+) файл[а-яё]*, фронт (\d+)\/(\d+) в (\d+) файл[а-яё]*\), E2E (\d+) спек[а-яё]* \/ (\d+) /m,
  slots: [
    slot('serverTests', 1),
    slot('serverTests', 2),
    slot('serverFiles', 3),
    slot('frontTests', 4),
    slot('frontTests', 5),
    slot('frontFiles', 6),
    slot('e2eFiles', 7),
    slot('e2eTests', 8),
  ],
}

const SNAPSHOT_DATE = {
  id: 'project-context-date',
  suite: 'all',
  re: /Актуальный срез на (\d{2}\.\d{2}\.\d{4}):/m,
  slots: [dateSlot(1)],
}

const INVENTORY = {
  id: 'inventory-header',
  suite: 'unit',
  re: /^> \(`vitest run --reporter=json`\): сервер \*\*(\d+)\*\*, фронт \*\*(\d+)\*\*\./m,
  slots: [slot('serverTests', 1), slot('frontTests', 2)],
}

const INVENTORY_RUN = {
  id: 'inventory-run',
  suite: 'all',
  re: /^\*\*Прогон (\d{2}\.\d{2}\.\d{4}):\*\* сервер \*\*(\d+)\/(\d+)\*\* \((\d+) файл[а-яё]*\) \+ фронт \*\*(\d+)\/(\d+)\*\* \((\d+) файл[а-яё]*\) = \*\*(\d+)\/(\d+)\*\*\./m,
  slots: [
    dateSlot(1),
    slot('serverTests', 2),
    slot('serverTests', 3),
    slot('serverFiles', 4),
    slot('frontTests', 5),
    slot('frontTests', 6),
    slot('frontFiles', 7),
    slot('totalTests', 8),
    slot('totalTests', 9),
  ],
}

const INVENTORY_RUN_E2E = {
  id: 'inventory-run-e2e',
  suite: 'e2e',
  re: /^E2E — (\d+) спеков \/ (\d+) /m,
  slots: [slot('e2eFiles', 1), slot('e2eTests', 2)],
}

/**
 * Секции инвентаря. У каждой — свой префикс путей, и её заголовок сверяется с
 * числами **по этому префиксу**, а не по прогону целиком: корневой `vitest run`
 * считает и `src/**`, и `scripts/**` (тесты самих гейтов), так что заголовок
 * «Фронт — 24 файла» нельзя сверять с 25 файлами прогона.
 */
const INVENTORY_TABLES = [
  {
    re: /^## Сервер — /m,
    headingRe: /^## Сервер — (\d+) файл[а-яё]*, (\d+) тест[а-яё]*/m,
    prefix: 'server/src/__tests__/',
    id: 'inventory-server-section',
    suite: 'unit',
    files: 'serverTableFiles',
    tests: 'serverTableTests',
  },
  {
    re: /^## Фронт — /m,
    headingRe: /^## Фронт — (\d+) файл[а-яё]*, (\d+) тест[а-яё]*/m,
    prefix: 'src/',
    id: 'inventory-front-section',
    suite: 'unit',
    files: 'frontTableFiles',
    tests: 'frontTableTests',
  },
  {
    re: /^## E2E \(Playwright\) — /m,
    headingRe: /^## E2E \(Playwright\) — (\d+) спек[а-яё]*, (\d+) `test\(\)`/m,
    prefix: 'e2e/',
    id: 'inventory-e2e-section',
    suite: 'e2e',
    files: 'e2eTableFiles',
    tests: 'e2eTableTests',
  },
  {
    re: /^## Скрипты гейтов — /m,
    headingRe: /^## Скрипты гейтов — (\d+) файл[а-яё]*, (\d+) тест[а-яё]*/m,
    prefix: 'scripts/',
    id: 'inventory-scripts-section',
    suite: 'unit',
    files: 'scriptsTableFiles',
    tests: 'scriptsTableTests',
  },
]

const INVENTORY_SECTION_CLAIMS = INVENTORY_TABLES.map((t) => ({
  id: t.id,
  suite: t.suite,
  re: t.headingRe,
  slots: [slot(t.files, 1), slot(t.tests, 2)],
}))

/**
 * Разбивка тестов на продуктовые и гейтовые.
 *
 * У фронта граница — каталог: `scripts/**` тестирует сами гейты, `src/**` — продукт.
 * У сервера всё лежит в `server/src/__tests__/`, поэтому граница только явным
 * списком (`SERVER_GATE_TESTS`). `SERVER_GATE_RE` ловит новичка по имени — без
 * него список протухает молча: добавили `*-audit.test.js`, он посчитался
 * продуктовым, и вывеска завысила покрытие.
 */
export const SERVER_GATE_TESTS = [
  'server/src/__tests__/deploy-persistence-audit.test.js',
  'server/src/__tests__/order-by-audit.test.js',
  'server/src/__tests__/prod-mock-payments.test.js',
  'server/src/__tests__/schema-drift.test.js',
  'server/src/__tests__/secrets-leak-audit.test.js',
]
const SERVER_GATE_RE = /(?:-audit|schema-drift|prod-mock)[^/]*\.test\.js$/

export function testKind(file) {
  if (file.startsWith('scripts/')) return 'gate'
  if (SERVER_GATE_TESTS.includes(file)) return 'gate'
  return 'product'
}

function kindCounts(countData) {
  let gateFiles = 0
  let gateTests = 0
  let productFiles = 0
  let productTests = 0
  for (const [file, tests] of countData.perFile) {
    if (testKind(file) === 'gate') {
      gateFiles += 1
      gateTests += tests
    } else {
      productFiles += 1
      productTests += tests
    }
  }
  return {
    gate: { files: gateFiles, tests: gateTests },
    product: { files: productFiles, tests: productTests },
  }
}

export function gateClassificationProblems(counts) {
  const problems = []
  for (const [file] of counts.server.perFile) {
    if (!SERVER_GATE_RE.test(file)) continue
    if (!SERVER_GATE_TESTS.includes(file)) {
      problems.push({
        file: 'server/src/__tests__',
        claim: 'gate-classification',
        line: 0,
        message: `${file} похож на тест гейта, но его нет в SERVER_GATE_TESTS — добавь или переименуй`,
      })
    }
  }
  for (const file of SERVER_GATE_TESTS) {
    if (!counts.server.perFile.has(file)) {
      problems.push({
        file: 'server/src/__tests__',
        claim: 'gate-classification',
        line: 0,
        message: `SERVER_GATE_TESTS: ${file} нет в прогоне — убери из списка`,
      })
    }
  }
  return problems
}

const CMD_SERVER = {
  id: 'inventory-cmd-server',
  suite: 'unit',
  re: /^cd server && npm run test\s+# (\d+) тест[а-яё]*, (\d+) файл[а-яё]*$/m,
  slots: [slot('serverTests', 1), slot('serverFiles', 2)],
}

const CMD_FRONT = {
  id: 'inventory-cmd-front',
  suite: 'unit',
  re: /^npm run test\s+# (\d+) тест[а-яё]*, (\d+) файл[а-яё]* \(фронт\)$/m,
  slots: [slot('frontTests', 1), slot('frontFiles', 2)],
}

const CMD_E2E = {
  id: 'inventory-cmd-e2e',
  suite: 'e2e',
  re: /^npm run test:e2e\s+# (\d+) спек[а-яё]*/m,
  slots: [slot('e2eFiles', 1)],
}

const INVENTORY_KINDS = {
  id: 'inventory-kinds',
  suite: 'unit',
  re: /^> Продукт\/гейты: фронт \*\*(\d+)\*\* продукт \/ \*\*(\d+)\*\* гейты, сервер \*\*(\d+)\*\* продукт \/ \*\*(\d+)\*\* гейты/m,
  slots: [
    slot('frontProductTests', 1),
    slot('frontGateTests', 2),
    slot('serverProductTests', 3),
    slot('serverGateTests', 4),
  ],
}

const README_CLAIMS = [README_FRONTS, README_SERVER, README_E2E]
const SNAPSHOT_CLAIMS = [SNAPSHOT_TOTAL, SNAPSHOT_SUITES, SNAPSHOT_DATE]
const INVENTORY_CLAIMS = [
  INVENTORY,
  INVENTORY_RUN,
  INVENTORY_RUN_E2E,
  ...INVENTORY_SECTION_CLAIMS,
  CMD_SERVER,
  CMD_FRONT,
  CMD_E2E,
  INVENTORY_KINDS,
]

/**
 * Шапки журналов. Анкор «^> Актуально на … Все тесты:» обязателен: свободное
 * «Все тесты: **» встречается в теле `Что сделано.txt` 12 раз, и `--fix`
 * переписал бы хронику. Дата в шапке истории — `dateSlot` (как «Актуальный срез»
 * в project-context: в обычной проверке не сверяется, `--fix` обновляет на
 * сегодня). В `Что доделать.txt` даты нет намеренно: «Актуально: <дата>» там
 * описывает состояние бэклога и правится владельцем, а не прогоном.
 */
const JOURNAL_DONE_TOTAL = {
  id: 'journal-sdelano-total',
  suite: 'all',
  re: /^> Актуально на (\d{2}\.\d{2}\.\d{4})\. Все тесты: \*\*(\d+)\/(\d+)\*\* — сервер (\d+)\/(\d+) ✅ \((\d+) файл[а-яё]*\), фронт (\d+)\/(\d+) ✅ \((\d+) файл[а-яё]*\)\. E2E: (\d+) (тест[а-яё]*) в (\d+) спек/m,
  slots: [
    dateSlot(1),
    slot('totalTests', 2),
    slot('totalTests', 3),
    slot('serverTests', 4),
    slot('serverTests', 5),
    slot('serverFiles', 6),
    slot('frontTests', 7),
    slot('frontTests', 8),
    slot('frontFiles', 9),
    slot('e2eTests', 10),
    slot('e2eTests', 11, true),
    slot('e2eFiles', 12),
  ],
}

const JOURNAL_TODO_COUNTERS = {
  id: 'journal-dodelat-counters',
  suite: 'all',
  re: /Счётчики: \*\*(\d+)\/(\d+)\*\* — сервер \*\*(\d+)\/(\d+)\*\* ✅ \((\d+) файл[а-яё]*\), фронт \*\*(\d+)\/(\d+)\*\* ✅ \((\d+) файл[а-яё]*\)\. E2E: (\d+)\/(\d+)/m,
  slots: [
    slot('totalTests', 1),
    slot('totalTests', 2),
    slot('serverTests', 3),
    slot('serverTests', 4),
    slot('serverFiles', 5),
    slot('frontTests', 6),
    slot('frontTests', 7),
    slot('frontFiles', 8),
    slot('e2eTests', 9),
    slot('e2eTests', 10),
  ],
}

const JOURNAL_DONE_CLAIMS = [JOURNAL_DONE_TOTAL]
const JOURNAL_TODO_CLAIMS = [JOURNAL_TODO_COUNTERS]

const DOCS = new Map([
  ['README.md', README_CLAIMS],
  ['project-context.md', SNAPSHOT_CLAIMS],
  ['test/README.md', README_CLAIMS],
  ['test/project-context.md', SNAPSHOT_CLAIMS],
  ['test/ИНВЕНТАРЬ-ТЕСТОВ.md', INVENTORY_CLAIMS],
  ['Что сделано.txt', JOURNAL_DONE_CLAIMS],
  ['Что доделать.txt', JOURNAL_TODO_CLAIMS],
])

const INVENTORY_FILE = 'test/ИНВЕНТАРЬ-ТЕСТОВ.md'
/**
 * Машинный инвентарь (кандидат 1 из «перенять у Service Desk»): JSON и
 * пофайловые `.txt` — только вывод этого же прогона, не рукописные числа.
 * Гейт сверяет их с прогоном наравне с таблицей `ИНВЕНТАРЬ-ТЕСТОВ.md`, а `--fix`
 * перегенерирует. В `--skip-e2e`/`--no-per-file` артефакты не трогаются:
 * частичный прогон записал бы нули вместо E2E.
 */
const INVENTORY_JSON = 'test/test-inventory.json'
const INVENTORY_TXT = [
  { id: 'front', file: 'test/frontend-tests.txt', title: 'Фронт (Vitest)', runner: 'vitest --reporter=json' },
  { id: 'server', file: 'test/server-tests.txt', title: 'Сервер (Vitest)', runner: 'vitest --reporter=json' },
  { id: 'e2e', file: 'test/e2e-tests.txt', title: 'E2E (Playwright)', runner: 'playwright test --list' },
]
/**
 * Средняя ячейка — `(?:\\\||[^|])*`, а не `[^|]*`: описание вида
 * «команда `npm test \|\| true`» (экранированная черта — валидный markdown)
 * старым шаблоном не парсилось, и гейт сообщал ложное «нет строки в инвентаре»,
 * а `--fix` дописывал вторую строку на тот же файл.
 */
const ROW_RE = /^\| `([^`]+)` \|(?:\\\||[^|])*\| (\d+) \|$/gm
const ROW_LINE_RE = /^\| `([^`]+)` \|(?:\\\||[^|])*\| (\d+) \|$/
/**
 * `m?[jt]sx?`, а не `[jt]sx?`: расширение `.mjs` — это `m` + `j` + `s`, и без
 * `m?` тест-файлы гейтов (`scripts/*.test.mjs`) молча выпадали из инвентаря —
 * гейт писал бы «нет строки в инвентаре» про файл, который в этом же файле
 * инвентаря перечислен.
 */
const TEST_PATH_RE = /^(?:server\/src\/__tests__\/|src\/|e2e\/|scripts\/).+\.(?:test|spec)\.m?[jt]sx?$/

/**
 * Окончание в шаблоне — `[а-яё]*`, а не `[а-яё]+`: при числе 1 `plural()`
 * возвращает «1 файл» / «1 тест» без суффикса, и `файл[а-яё]+` такую строку
 * не находит — гейт писал бы «строка со счётчиками не найдена» ровно на
 * правильном числе.
 */

/** Русские окончания по числу: 1 тест / 2 теста / 5 тестов, 21 тест / 22 теста. */
export function plural(n, forms) {
  const n10 = n % 10
  const n100 = n % 100
  if (n10 === 1 && n100 !== 11) return forms[0]
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return forms[1]
  return forms[2]
}

function todayRu() {
  const d = new Date()
  const p = (v) => String(v).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`
}

function lineOf(text, index) {
  let line = 1
  for (let i = 0; i < index; i += 1) {
    if (text[i] === '\n') line += 1
  }
  return line
}

function slotValue(s, counts, today) {
  if (s.kind === 'date') return today
  const value = counts[s.kind]
  if (value === undefined) return null
  return s.word ? plural(value, NOUNS[s.kind]) : String(value)
}

/**
 * Подставляет новые значения в capture-группы, не трогая остальной текст.
 *
 * ⚠️ `m.indices[g]` — **абсолютные** смещения во всём тексте, а не смещения
 * внутри совпадения. Подстановка по `m[0]` их как относительные не портила бы
 * текст, а молча дописывала новые значения в конец строки: «24 файла» →
 * «24 файлафайла24теста152». Сплит идёт по убыванию группы, чтобы правые
 * смещения не «поехали» после замены левых.
 */
function renderMatch(m, slots, counts, today) {
  let out = m[0]
  for (const s of [...slots].sort((a, b) => b.group - a.group)) {
    const span = m.indices[s.group]
    const rendered = slotValue(s, counts, today)
    if (!span || rendered === null) return null
    const [absStart, absEnd] = span
    const localStart = absStart - m.index
    const localEnd = absEnd - m.index
    if (localStart < 0 || localEnd > out.length) return null
    out = out.slice(0, localStart) + rendered + out.slice(localEnd)
  }
  return out
}

export function checkClaims(relPath, text, claims, counts) {
  const problems = []
  for (const claim of claims) {
    const m = text.match(claim.re)
    if (!m) {
      problems.push({ file: relPath, claim: claim.id, line: 0, message: 'строка со счётчиками не найдена — обнови CLAIMS в scripts/test-counter-audit.mjs' })
      continue
    }
    const line = lineOf(text, m.index)
    for (const s of claim.slots) {
      if (!s.checked) continue
      const value = counts[s.kind]
      if (value === undefined) continue
      if (s.word) {
        const expected = plural(value, NOUNS[s.kind])
        if (m[s.group] !== expected) {
          problems.push({ file: relPath, claim: claim.id, line, message: `«${m[s.group]}» → «${expected}» (${value})` })
        }
        continue
      }
      const found = Number(m[s.group])
      if (found !== value) {
        problems.push({ file: relPath, claim: claim.id, line, message: `${value} → ${found}` })
      }
    }
  }
  return problems
}

export function fixClaims(text, claims, counts, today = todayRu()) {
  let out = text
  for (const claim of claims) {
    const re = new RegExp(claim.re.source, `${claim.re.flags.replace(/[gy]/g, '')}dg`)
    const matches = [...out.matchAll(re)]
    for (let i = matches.length - 1; i >= 0; i -= 1) {
      const m = matches[i]
      const rendered = renderMatch(m, claim.slots, counts, today)
      if (rendered === null) continue
      const [start, end] = m.indices[0]
      out = out.slice(0, start) + rendered + out.slice(end)
    }
  }
  return out
}

/** Все строки таблиц инвентаря по порядку (нужны для поиска дублей). */
export function listInventoryRows(text) {
  const rows = []
  for (const m of text.matchAll(ROW_RE)) {
    if (!TEST_PATH_RE.test(m[1])) continue
    rows.push({ file: m[1], claimed: Number(m[2]), index: m.index, text: m[0] })
  }
  return rows
}

/** Строки таблиц инвентаря: путь тест-файла → заявленное число тестов. */
export function parseInventoryRows(text) {
  const rows = new Map()
  for (const row of listInventoryRows(text)) {
    rows.set(row.file, { claimed: row.claimed, index: row.index, text: row.text })
  }
  return rows
}

export function checkInventoryRows(relPath, text, perFile, options = {}) {
  const problems = []
  const seen = new Set()
  for (const row of listInventoryRows(text)) {
    if (options.skipE2E && row.file.startsWith('e2e/')) continue
    if (seen.has(row.file)) {
      problems.push({ file: relPath, claim: 'inventory-row', line: lineOf(text, row.index), message: `${row.file}: две строки в инвентаре` })
      continue
    }
    seen.add(row.file)
    if (!perFile.has(row.file)) {
      problems.push({ file: relPath, claim: 'inventory-row', line: lineOf(text, row.index), message: `${row.file} — в прогоне такого тест-файла нет` })
      continue
    }
    const actual = perFile.get(row.file)
    if (row.claimed !== actual) {
      problems.push({ file: relPath, claim: 'inventory-row', line: lineOf(text, row.index), message: `${row.file}: в прогоне ${actual}, в инвентаре ${row.claimed}` })
    }
  }
  for (const [file, actual] of perFile) {
    if (options.skipE2E && file.startsWith('e2e/')) continue
    if (!seen.has(file)) {
      problems.push({ file: relPath, claim: 'inventory-row', line: 0, message: `${file} (${actual} тестов) — нет строки в инвентаре` })
    }
  }
  return problems
}

function sectionRange(text, headingRe) {
  const m = text.match(headingRe)
  if (!m) return null
  const start = m.index + m[0].length
  const rest = text.slice(start)
  const next = rest.search(/\n## /)
  return { start, end: next === -1 ? text.length : start + next }
}

export function fixInventoryRows(text, perFile) {
  let out = dedupeInventoryRows(text)
  for (const section of INVENTORY_TABLES) {
    const range = sectionRange(out, section.re)
    if (!range) continue
    const block = out.slice(range.start, range.end)
    const lines = block.split('\n')
    let lastRow = -1
    for (let i = 0; i < lines.length; i += 1) {
      if (ROW_LINE_RE.test(lines[i])) lastRow = i
    }
    const present = parseInventoryRows(out)
    const missing = []
    for (const [file, count] of perFile) {
      if (!file.startsWith(section.prefix)) continue
      if (present.has(file)) continue
      missing.push(`| \`${file}\` | ⚠️ требует описания | ${count} |`)
    }
    if (missing.length && lastRow !== -1) {
      missing.sort()
      lines.splice(lastRow + 1, 0, ...missing)
      out = out.slice(0, range.start) + lines.join('\n') + out.slice(range.end)
    }
  }
  /**
   * Числа в строках таблицы правятся справа налево: смещения из одного
   * `parseInventoryRows` устаревают после первой же замены (длина строки
   * меняется), и следующая правка попала бы в соседнюю строку.
   */
  const edits = []
  for (const [file, row] of parseInventoryRows(out)) {
    const actual = perFile.get(file)
    if (actual === undefined || actual === row.claimed) continue
    edits.push({ index: row.index, length: row.text.length, replacement: row.text.replace(/\| \d+ \|$/, `| ${actual} |`) })
  }
  edits.sort((a, b) => b.index - a.index)
  for (const e of edits) out = out.slice(0, e.index) + e.replacement + out.slice(e.index + e.length)
  return out
}

/**
 * Дубли строк инвентаря (один файл — две строки) лечатся удалением всех, кроме
 * первой: именно их и порождал старый `--fix`, а `parseInventoryRows` через `Map`
 * молча схлопывал их в одну — гейт не замечал, что инвентарь испорчен.
 */
function dedupeInventoryRows(text) {
  const seen = new Set()
  const dups = []
  for (const row of listInventoryRows(text)) {
    if (seen.has(row.file)) dups.push(row)
    else seen.add(row.file)
  }
  let out = text
  for (const row of dups.reverse()) {
    const after = row.index + row.text.length
    if (out[after] === '\n') {
      out = out.slice(0, row.index) + out.slice(after + 1)
    } else if (out[row.index - 1] === '\n') {
      out = out.slice(0, row.index - 1) + out.slice(after)
    } else {
      out = out.slice(0, row.index) + out.slice(after)
    }
  }
  return out
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function toPosix(p) {
  return p.split(path.sep).join('/')
}

/**
 * Документы в репозитории смешанные: часть в CRLF, `test/ИНВЕНТАРЬ-ТЕСТОВ.md`
 * — в LF. Многострочные шаблоны с `\n` не находят блок в CRLF-файле, поэтому
 * чтение нормализует окончания, а запись возвращает исходный стиль — иначе
 * фикс превратил бы весь файл в дифф из 400 строк.
 */
export function normalizeEol(raw) {
  return raw.includes('\r\n') ? { eol: '\r\n', text: raw.replace(/\r\n/g, '\n') } : { eol: '\n', text: raw }
}

export function countsFromVitestReport(report, root) {
  return {
    tests: report.numTotalTests,
    files: report.testResults.length,
    passed: report.numPassedTests,
    failed: report.numFailedTests,
    perFile: new Map(
      report.testResults.map((r) => [toPosix(path.relative(root, path.resolve(r.name))), r.assertionResults.length])
    ),
  }
}

export function countsFromPlaywrightList(suites) {
  const perFile = new Map()
  const countSpecs = (node) => {
    let n = 0
    for (const spec of node.specs || []) n += (spec.tests || []).length
    for (const child of node.suites || []) n += countSpecs(child)
    return n
  }
  for (const suite of suites) {
    const raw = suite.file || ''
    const rel = raw.replace(/^.*[\\/]/, '')
    const count = countSpecs(suite)
    const key = `e2e/${rel}`
    if (perFile.has(key)) {
      throw new Error(`два спека с одинаковым именем (${rel}) — сверка по имени неоднозначна`)
    }
    perFile.set(key, count)
  }
  const total = [...perFile.values()].reduce((a, b) => a + b, 0)
  return { tests: total, files: perFile.size, perFile }
}

function compareByFile(a, b) {
  return a.file < b.file ? -1 : a.file > b.file ? 1 : 0
}

function perFileList(map) {
  return [...map].map(([file, tests]) => ({ file, tests })).sort(compareByFile)
}

export function buildInventory(counts, generated) {
  const suite = (c) => ({
    files: c.files,
    tests: c.tests,
    passed: c.passed,
    failed: c.failed,
    ...kindCounts(c),
    perFile: perFileList(c.perFile),
  })
  return {
    generated,
    tool: 'node scripts/test-counter-audit.mjs (vitest --reporter=json, actual execution)',
    verified_by: 'vitest run (actual execution)',
    frontend: suite(counts.front),
    server: suite(counts.server),
    e2e: {
      files: counts.e2e.files,
      tests: counts.e2e.tests,
      ...kindCounts(counts.e2e),
      perFile: perFileList(counts.e2e.perFile),
    },
    total: {
      files: counts.front.files + counts.server.files,
      tests: counts.front.tests + counts.server.tests,
    },
  }
}

function withoutGenerated(inv) {
  const { generated, ...rest } = inv
  return rest
}

export function renderInventoryJson(inv) {
  return `${JSON.stringify(inv, null, 2)}\n`
}

function pushSuiteDiff(problems, relPath, label, expected, actual) {
  if (!actual || typeof actual !== 'object') {
    problems.push({ file: relPath, claim: 'inventory-json', line: 0, message: `${label}: нет в инвентаре` })
    return
  }
  for (const field of ['files', 'tests', 'passed', 'failed']) {
    if (expected[field] === undefined) continue
    if (actual[field] !== expected[field]) {
      problems.push({ file: relPath, claim: 'inventory-json', line: 0, message: `${label}.${field}: в прогоне ${expected[field]}, в инвентаре ${actual[field]}` })
    }
  }
  for (const kind of ['gate', 'product']) {
    const exp = expected[kind] || { files: 0, tests: 0 }
    const act = actual[kind] || {}
    for (const field of ['files', 'tests']) {
      if (act[field] !== exp[field]) {
        problems.push({ file: relPath, claim: 'inventory-json', line: 0, message: `${label}.${kind}.${field}: в прогоне ${exp[field]}, в инвентаре ${act[field]}` })
      }
    }
  }
  if (JSON.stringify(actual.perFile) !== JSON.stringify(expected.perFile)) {
    const exp = new Map((expected.perFile || []).map((r) => [r.file, r.tests]))
    const act = new Map((actual.perFile || []).map((r) => [r.file, r.tests]))
    const diff = []
    for (const [file, tests] of exp) if (act.get(file) !== tests) diff.push(`${file}: ${act.get(file) ?? 'нет'} вместо ${tests}`)
    for (const file of act.keys()) if (!exp.has(file)) diff.push(`${file} — лишний`)
    problems.push({
      file: relPath,
      claim: 'inventory-json',
      line: 0,
      message: `${label}.perFile: ${diff.slice(0, 3).join('; ')}${diff.length > 3 ? ` … ещё ${diff.length - 3}` : ''}`,
    })
  }
}

export function checkInventoryJson(relPath, text, counts) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return [{ file: relPath, claim: 'inventory-json', line: 0, message: 'не парсится как JSON' }]
  }
  const expected = withoutGenerated(buildInventory(counts, ''))
  const problems = []
  pushSuiteDiff(problems, relPath, 'frontend', expected.frontend, parsed.frontend)
  pushSuiteDiff(problems, relPath, 'server', expected.server, parsed.server)
  for (const field of ['files', 'tests']) {
    const act = parsed.e2e && parsed.e2e[field]
    if (act !== expected.e2e[field]) {
      problems.push({ file: relPath, claim: 'inventory-json', line: 0, message: `e2e.${field}: в прогоне ${expected.e2e[field]}, в инвентаре ${act}` })
    }
  }
  if (JSON.stringify(parsed.e2e && parsed.e2e.perFile) !== JSON.stringify(expected.e2e.perFile)) {
    problems.push({ file: relPath, claim: 'inventory-json', line: 0, message: 'e2e.perFile: расходится с прогоном' })
  }
  for (const kind of ['gate', 'product']) {
    const exp = expected.e2e[kind] || { files: 0, tests: 0 }
    const act = (parsed.e2e && parsed.e2e[kind]) || {}
    for (const field of ['files', 'tests']) {
      if (act[field] !== exp[field]) {
        problems.push({ file: relPath, claim: 'inventory-json', line: 0, message: `e2e.${kind}.${field}: в прогоне ${exp[field]}, в инвентаре ${act[field]}` })
      }
    }
  }
  for (const field of ['files', 'tests']) {
    const act = parsed.total && parsed.total[field]
    if (act !== expected.total[field]) {
      problems.push({ file: relPath, claim: 'inventory-json', line: 0, message: `total.${field}: в прогоне ${expected.total[field]}, в инвентаре ${act}` })
    }
  }
  return problems
}

export function renderPerFileTxt(spec, countData) {
  const green = countData.passed === undefined ? '' : ` (зелёных ${countData.passed})`
  const lines = [
    `===== ${spec.title} =====`,
    `${countData.tests} тестов в ${countData.files} файлах${green} (${spec.runner})`,
    '',
    '# файл | тестов',
  ]
  for (const { file, tests } of perFileList(countData.perFile)) lines.push(`${file} | ${tests}`)
  return `${lines.join('\n')}\n`
}

export function checkPerFileTxt(relPath, spec, text, countData) {
  const problems = []
  const head = /^(\d+) тестов в (\d+) файлах/m.exec(text)
  if (!head) return [{ file: relPath, claim: 'inventory-txt', line: 0, message: 'нет строки с числом тестов' }]
  if (Number(head[1]) !== countData.tests) {
    problems.push({ file: relPath, claim: 'inventory-txt', line: 0, message: `тестов: в прогоне ${countData.tests}, в файле ${head[1]}` })
  }
  if (Number(head[2]) !== countData.files) {
    problems.push({ file: relPath, claim: 'inventory-txt', line: 0, message: `файлов: в прогоне ${countData.files}, в файле ${head[2]}` })
  }
  const parsed = new Map()
  for (const m of text.matchAll(/^(\S+) \| (\d+)$/gm)) parsed.set(m[1], Number(m[2]))
  const expected = new Map(perFileList(countData.perFile).map((r) => [r.file, r.tests]))
  for (const [file, tests] of expected) {
    if (parsed.get(file) !== tests) {
      problems.push({ file: relPath, claim: 'inventory-txt', line: 0, message: `${file}: в прогоне ${tests}, в файле ${parsed.get(file) ?? 'нет'}` })
    }
  }
  for (const file of parsed.keys()) {
    if (!expected.has(file)) {
      problems.push({ file: relPath, claim: 'inventory-txt', line: 0, message: `${file} — в прогоне такого тест-файла нет` })
    }
  }
  return problems
}

export function writeInventoryArtifacts(root, counts, generated) {
  const changed = []
  const jsonAbs = path.join(root, INVENTORY_JSON)
  const inventory = buildInventory(counts, generated)
  let keep = false
  if (fs.existsSync(jsonAbs)) {
    try {
      keep = JSON.stringify(withoutGenerated(JSON.parse(fs.readFileSync(jsonAbs, 'utf8')))) === JSON.stringify(withoutGenerated(inventory))
    } catch {
      keep = false
    }
  }
  if (!keep) {
    fs.writeFileSync(jsonAbs, renderInventoryJson(inventory))
    changed.push(INVENTORY_JSON)
  }
  for (const spec of INVENTORY_TXT) {
    const abs = path.join(root, spec.file)
    const next = renderPerFileTxt(spec, counts[spec.id])
    if (fs.existsSync(abs) && fs.readFileSync(abs, 'utf8') === next) continue
    fs.writeFileSync(abs, next)
    changed.push(spec.file)
  }
  return changed
}

function runVitest(root, sub, outFile) {
  const bin = path.join(root, sub, 'node_modules', 'vitest', 'vitest.mjs')
  if (!fs.existsSync(bin)) throw new Error(`не найден vitest: ${bin} — выполни npm ci (${sub || '.'})`)
  try {
    execFileSync(process.execPath, [bin, 'run', '--reporter=json', `--outputFile=${outFile}`], {
      cwd: path.join(root, sub),
      stdio: 'pipe',
      encoding: 'utf8',
    })
  } catch (err) {
    if (!fs.existsSync(outFile)) throw err
  }
  return readJson(outFile)
}

function runPlaywrightList(root) {
  const cli = path.join(root, 'node_modules', '@playwright', 'test', 'cli.js')
  if (!fs.existsSync(cli)) throw new Error(`не найден @playwright/test: ${cli} — выполни npm ci`)
  const out = execFileSync(process.execPath, [cli, 'test', '--list', '--reporter=json'], {
    cwd: root,
    stdio: 'pipe',
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return JSON.parse(out)
}

export function measure(root, options = {}) {
  const onPhase = options.onPhase || (() => {})
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'swiftmatch-counters-'))
  try {
    onPhase(options.reports ? '[1/3] читаю отчёт фронта (--reports)' : '[1/3] фронт: vitest run --reporter=json — до конца прогона тишина нормальна')
    const frontReport = options.reports ? readJson(options.reports[0]) : runVitest(root, '', path.join(tmp, 'front.json'))
    const front = countsFromVitestReport(frontReport, root)
    onPhase(`      фронт посчитан: ${front.tests} тестов в ${front.files} файлах`)
    onPhase(options.reports ? '[2/3] читаю отчёт сервера (--reports)' : '[2/3] сервер: vitest run --reporter=json')
    const serverReport = options.reports ? readJson(options.reports[1]) : runVitest(root, 'server', path.join(tmp, 'server.json'))
    const server = countsFromVitestReport(serverReport, root)
    onPhase(`      сервер посчитан: ${server.tests} тестов в ${server.files} файлах`)
    onPhase(options.skipE2E ? '[3/3] E2E: пропущен (--skip-e2e)' : '[3/3] E2E: playwright test --list')
    const e2e = options.skipE2E
      ? { tests: 0, files: 0, perFile: new Map() }
      : countsFromPlaywrightList(runPlaywrightList(root).suites)
    return { front, server, e2e, total: front.tests + server.tests }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

export function totalsOf(counts) {
  const perFile = new Map([...counts.server.perFile, ...counts.front.perFile, ...counts.e2e.perFile])
  const flat = {
    frontTests: counts.front.tests,
    frontFiles: counts.front.files,
    serverTests: counts.server.tests,
    serverFiles: counts.server.files,
    e2eTests: counts.e2e.tests,
    e2eFiles: counts.e2e.files,
    totalTests: counts.total,
  }
  for (const table of INVENTORY_TABLES) {
    let files = 0
    let tests = 0
    for (const [file, count] of perFile) {
      if (!file.startsWith(table.prefix)) continue
      files += 1
      tests += count
    }
    flat[table.files] = files
    flat[table.tests] = tests
  }
  for (const [label, countData] of [['front', counts.front], ['server', counts.server], ['e2e', counts.e2e]]) {
    const { gate, product } = kindCounts(countData)
    flat[`${label}GateFiles`] = gate.files
    flat[`${label}GateTests`] = gate.tests
    flat[`${label}ProductFiles`] = product.files
    flat[`${label}ProductTests`] = product.tests
  }
  return flat
}

/**
 * Claim'ы, применимые при текущих флагах.
 *
 * `--skip-e2e` выключает не только claim'ы с `suite: 'e2e'`, но и их слоты
 * внутри claim'ов с `suite: 'all'`: в «Актуальном срезе» и «Прогоне» E2E-числа
 * живут в одной строке с серверными, и без фильтра слотов гейт на выключенном
 * E2E писал «0 → 19» на каждой строке, которую он же и только что отрендерил.
 */
export function activeClaims(claims, options = {}) {
  if (!options.skipE2E) return claims
  return claims
    .filter((c) => c.suite !== 'e2e')
    .map((c) => (c.suite === 'all' && c.slots.some((s) => s.kind.startsWith('e2e'))
      ? { ...c, slots: c.slots.filter((s) => !s.kind.startsWith('e2e')) }
      : c))
}

export function audit(root, counts, options = {}) {
  const problems = []
  const changed = []
  const flat = totalsOf(counts)

  for (const [rel, claims] of DOCS) {
    const abs = path.join(root, rel)
    if (!fs.existsSync(abs)) continue
    const active = activeClaims(claims, options)
    const { eol, text } = normalizeEol(fs.readFileSync(abs, 'utf8'))
    problems.push(...checkClaims(rel, text, active, flat))
    if (options.fix) {
      const fixed = fixClaims(text, active, flat)
      if (fixed !== text) {
        fs.writeFileSync(abs, eol === '\r\n' ? fixed.replace(/\n/g, '\r\n') : fixed)
        changed.push(rel)
      }
    }
  }

  if (!options.skipPerFile) {
    const abs = path.join(root, INVENTORY_FILE)
    if (fs.existsSync(abs)) {
      const perFile = new Map([...counts.server.perFile, ...counts.front.perFile, ...counts.e2e.perFile])
      const { eol, text } = normalizeEol(fs.readFileSync(abs, 'utf8'))
      problems.push(...checkInventoryRows(INVENTORY_FILE, text, perFile, options))
      if (options.fix) {
        const fixed = fixInventoryRows(text, perFile)
        if (fixed !== text) {
          fs.writeFileSync(abs, eol === '\r\n' ? fixed.replace(/\n/g, '\r\n') : fixed)
          if (!changed.includes(INVENTORY_FILE)) changed.push(INVENTORY_FILE)
        }
      }
    }
  }

  if (!options.skipPerFile && !options.skipE2E) {
    const jsonAbs = path.join(root, INVENTORY_JSON)
    if (fs.existsSync(jsonAbs)) {
      problems.push(...checkInventoryJson(INVENTORY_JSON, fs.readFileSync(jsonAbs, 'utf8'), counts))
    }
    for (const spec of INVENTORY_TXT) {
      const abs = path.join(root, spec.file)
      if (fs.existsSync(abs)) {
        problems.push(...checkPerFileTxt(spec.file, spec, fs.readFileSync(abs, 'utf8'), counts[spec.id]))
      }
    }
    if (options.fix) {
      for (const rel of writeInventoryArtifacts(root, counts, new Date().toISOString())) {
        if (!changed.includes(rel)) changed.push(rel)
      }
    }
  }

  if (counts.front.failed || counts.server.failed) {
    problems.push({
      file: 'прогон',
      claim: 'failures',
      line: 0,
      message: `зелёных не всё: фронт ${counts.front.passed}/${counts.front.tests}, сервер ${counts.server.passed}/${counts.server.tests} — «0 failures» в документации становится ложью`,
    })
  }

  problems.push(...gateClassificationProblems(counts))

  return { problems, changed }
}

function main() {
  const args = process.argv.slice(2)
  const root = process.cwd()
  const reportsIdx = args.findIndex((a) => a.startsWith('--reports'))
  const reportsSpec = reportsIdx === -1
    ? ''
    : (args[reportsIdx].slice('--reports'.length).replace(/^=/, '') || args[reportsIdx + 1] || '')
  const options = {
    fix: args.includes('--fix'),
    skipE2E: args.includes('--skip-e2e'),
    skipPerFile: args.includes('--no-per-file'),
    reports: reportsSpec
      ? reportsSpec
          .split(',')
          .filter(Boolean)
          .map((p) => path.resolve(root, p))
      : null,
  }
  if (options.reports && options.reports.length !== 2) {
    console.log('FAIL: --reports ждёт два пути: <front.json>,<server.json>')
    process.exit(2)
  }

  console.log('Гейт счётчиков: измеряю прогоном; итерации — с --skip-e2e, полный прогон один раз в конце')
  const counts = measure(root, { ...options, onPhase: (m) => console.log(m) })
  const { problems, changed } = audit(root, counts, options)

  console.log(`фронт:  ${counts.front.tests} тестов в ${counts.front.files} файлах (зелёных ${counts.front.passed})`)
  console.log(`сервер: ${counts.server.tests} тестов в ${counts.server.files} файлах (зелёных ${counts.server.passed})`)
  console.log(`E2E:    ${counts.e2e.tests} тестов в ${counts.e2e.files} спеках`)
  console.log(`итого:  ${counts.total}`)

  if (options.fix && changed.length) {
    console.log('')
    console.log(`исправлено: ${changed.join(', ')}`)
    console.log('повторный прогон обязателен: счётчики в документации менялись')
  }

  if (problems.length) {
    console.log('')
    for (const p of problems) {
      const where = p.line ? `${p.file}:${p.line}` : p.file
      console.log(`FAIL: ${where} [${p.claim}] ${p.message}`)
    }
    console.log(`\nИтог: документация разошлась с прогоном (${problems.length} расхождений). Починить: node scripts/test-counter-audit.mjs --fix`)
    process.exit(1)
  }
  console.log('\nИтог: счётчики в документации совпадают с прогоном.')
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main()
