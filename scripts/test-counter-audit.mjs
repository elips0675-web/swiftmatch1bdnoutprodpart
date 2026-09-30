/**
 * Гейт «счётчики тестов в документации совпадают с прогоном».
 *
 * Счётчики дублируются в пяти файлах (`README.md`, `project-context.md` и три
 * копии в `test/`), и расходились все пять: на 30.09.2026 в репозитории было
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
 *     «Прогон», заголовки секций, команды прогона). Сверяются все числа,
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
]

const DOCS = new Map([
  ['README.md', README_CLAIMS],
  ['project-context.md', SNAPSHOT_CLAIMS],
  ['test/README.md', README_CLAIMS],
  ['test/project-context.md', SNAPSHOT_CLAIMS],
  ['test/ИНВЕНТАРЬ-ТЕСТОВ.md', INVENTORY_CLAIMS],
])

const INVENTORY_FILE = 'test/ИНВЕНТАРЬ-ТЕСТОВ.md'
const ROW_RE = /^\| `([^`]+)` \|[^|]*\| (\d+) \|$/gm
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

/** Строки таблиц инвентаря: путь тест-файла → заявленное число тестов. */
export function parseInventoryRows(text) {
  const rows = new Map()
  for (const m of text.matchAll(ROW_RE)) {
    if (!TEST_PATH_RE.test(m[1])) continue
    rows.set(m[1], { claimed: Number(m[2]), index: m.index, text: m[0] })
  }
  return rows
}

export function checkInventoryRows(relPath, text, perFile, options = {}) {
  const problems = []
  const rows = parseInventoryRows(text)
  for (const [file, row] of rows) {
    if (options.skipE2E && file.startsWith('e2e/')) continue
    if (!perFile.has(file)) {
      problems.push({ file: relPath, claim: 'inventory-row', line: lineOf(text, row.index), message: `${file} — в прогоне такого тест-файла нет` })
      continue
    }
    const actual = perFile.get(file)
    if (row.claimed !== actual) {
      problems.push({ file: relPath, claim: 'inventory-row', line: lineOf(text, row.index), message: `${file}: в прогоне ${actual}, в инвентаре ${row.claimed}` })
    }
  }
  for (const [file, actual] of perFile) {
    if (!rows.has(file)) {
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
  let out = text
  for (const section of INVENTORY_TABLES) {
    const range = sectionRange(out, section.re)
    if (!range) continue
    const block = out.slice(range.start, range.end)
    const lines = block.split('\n')
    let lastRow = -1
    for (let i = 0; i < lines.length; i += 1) {
      if (/^\| `[^`]+` \|[^|]*\| \d+ \|$/.test(lines[i])) lastRow = i
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'swiftmatch-counters-'))
  try {
    const frontReport = options.reports ? readJson(options.reports[0]) : runVitest(root, '', path.join(tmp, 'front.json'))
    const serverReport = options.reports ? readJson(options.reports[1]) : runVitest(root, 'server', path.join(tmp, 'server.json'))
    const front = countsFromVitestReport(frontReport, root)
    const server = countsFromVitestReport(serverReport, root)
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

  if (counts.front.failed || counts.server.failed) {
    problems.push({
      file: 'прогон',
      claim: 'failures',
      line: 0,
      message: `зелёных не всё: фронт ${counts.front.passed}/${counts.front.tests}, сервер ${counts.server.passed}/${counts.server.tests} — «0 failures» в документации становится ложью`,
    })
  }

  return { problems, changed }
}

function main() {
  const args = process.argv.slice(2)
  const root = process.cwd()
  const reportsArg = args.find((a) => a.startsWith('--reports'))
  const options = {
    fix: args.includes('--fix'),
    skipE2E: args.includes('--skip-e2e'),
    skipPerFile: args.includes('--no-per-file'),
    reports: reportsArg
      ? reportsArg
          .slice('--reports'.length)
          .split(',')
          .filter(Boolean)
          .map((p) => path.resolve(root, p))
      : null,
  }
  if (options.reports && options.reports.length !== 2) {
    console.log('FAIL: --reports ждёт два пути: <front.json>,<server.json>')
    process.exit(2)
  }

  const counts = measure(root, options)
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
