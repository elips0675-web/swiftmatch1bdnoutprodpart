/**
 * Гейт «typecheck реально проверяет код» (`npm run check:typecheck`).
 *
 * P3 #37: джоба `lint` в ci.yml и шаг lint-and-typecheck в deploy.yml запускали
 * голый `npx tsc --noEmit`. Корневой tsconfig.json — solution-конфиг со
 * ссылками на проекты и `"files": []`: компилятор без `-p` проверял ноль
 * файлов, а гейт был зелёным на любом коде (93 ошибки в src не замечались).
 * Теперь типчек идёт по обоим проектам (`npm run typecheck` = `tsc -p
 * tsconfig.app.json --noEmit && tsc -p tsconfig.node.json --noEmit`), а этот
 * аудит доказывает структуру, чтобы гейт не протух повторно:
 *   1. npm-скрипт `typecheck` вызывает tsc по обоим проектам с `-p` и
 *      `--noEmit` (не голый `tsc --noEmit`);
 *   2. ни одна run-строка в workflows не вызывает tsc без `-p`, а в ci.yml и
 *      в deploy.yml типчек подключён как `npm run typecheck`;
 *   3. `include` проектов (tsconfig.app.json, tsconfig.node.json) покрывает
 *      реальные файлы на диске — не `files: []` и не пустой include.
 *
 * Зависимости не нужны: гейт читает файлы, импортов не делает.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const TYPECHECK_SCRIPT = 'typecheck'
export const REQUIRED_PROJECT_FLAGS = ['-p tsconfig.app.json', '-p tsconfig.node.json']
export const GATED_WORKFLOWS = ['ci.yml', 'deploy.yml']

/**
 * Парсит JSONC: tsconfig'и содержат комментарии в стиле // и в стиле
 * блоков, которые JSON.parse не принимает. Строки (путь "@/*" в paths)
 * не трогаются.
 * @param {string} text
 * @returns {unknown}
 */
export function parseJsonc(text) {
  let out = ''
  let inString = false
  let inLineComment = false
  let inBlockComment = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    const n = text[i + 1]
    if (inLineComment) {
      if (c === '\n') {
        inLineComment = false
        out += c
      }
      continue
    }
    if (inBlockComment) {
      if (c === '*' && n === '/') {
        inBlockComment = false
        i++
      }
      continue
    }
    if (inString) {
      out += c
      if (c === '\\') {
        out += n ?? ''
        i++
      } else if (c === '"') {
        inString = false
      }
      continue
    }
    if (c === '"') {
      inString = true
      out += c
      continue
    }
    if (c === '/' && n === '/') {
      inLineComment = true
      i++
      continue
    }
    if (c === '/' && n === '*') {
      inBlockComment = true
      i++
      continue
    }
    out += c
  }
  return JSON.parse(out)
}

/**
 * Проверяет npm-скрипт `typecheck`: обязан собирать оба проекта с `-p` и
 * `--noEmit`. Голый `tsc --noEmit` (по корню с `files: []`) — это и есть баг
 * P3 #37, который гейт не должен пропустить обратно.
 * @param {string} command значение scripts.typecheck из package.json
 * @returns {{ok: boolean, problems: string[]}}
 */
export function checkTypecheckScript(command) {
  const problems = []
  const script = String(command || '').trim()
  if (!script) {
    problems.push(`scripts.${TYPECHECK_SCRIPT} отсутствует или пуст — реальная проверка обоих проектов не подключена`)
    return { ok: false, problems }
  }
  if (!/\btsc\b/.test(script)) problems.push(`scripts.${TYPECHECK_SCRIPT} не вызывает tsc`)
  for (const flag of REQUIRED_PROJECT_FLAGS) {
    if (!script.includes(flag)) {
      problems.push(`scripts.${TYPECHECK_SCRIPT} не содержит «${flag}» — голый tsc без -p падает на корневом tsconfig.json с "files": [] и проверяет ноль файлов`)
    }
  }
  if (!script.includes('--noEmit')) problems.push(`scripts.${TYPECHECK_SCRIPT} не содержит --noEmit`)
  return { ok: problems.length === 0, problems }
}

/**
 * Собирает run-строки workflow, упоминающие tsc или typecheck.
 * @param {string} text содержимое .github/workflows/*.yml
 * @returns {Array<{line: number, cmd: string}>}
 */
export function findTscRunLines(text) {
  const runLines = []
  text.split(/\r?\n/).forEach((line, i) => {
    const m = line.match(/^\s*-\s+run:\s*(.+)$/)
    if (!m) return
    const cmd = m[1].trim()
    if (/\btsc\b/.test(cmd) || /\btypecheck\b/.test(cmd)) runLines.push({ line: i + 1, cmd })
  })
  return runLines
}

/**
 * Проверяет workflow: (1) ни одной run-строки с tsc без `-p`; (2) типчек
 * подключён как `npm run typecheck` (не только «какой-то tsc»).
 * @param {string} text содержимое workflow
 * @param {string} name имя workflow для сообщений
 * @returns {{ok: boolean, problems: string[]}}
 */
export function checkWorkflow(text, name) {
  const problems = []
  const runLines = findTscRunLines(text)
  if (runLines.length === 0) {
    problems.push(`${name}: типчек не вызывается вовсе — нет ни одной run-строки с tsc/typecheck`)
    return { ok: false, problems }
  }
  const hasTypecheckRun = runLines.some(({ cmd }) => /npm run typecheck/.test(cmd))
  if (!hasTypecheckRun) {
    problems.push(`${name}: нет «npm run typecheck» — реальная проверка обоих проектов не подключена`)
  }
  for (const { line, cmd } of runLines) {
    if (/\btsc\b/.test(cmd) && !/-p\s+tsconfig\.(app|node)\.json/.test(cmd)) {
      problems.push(`${name}:${line} — «${cmd}» вызывает tsc без -p; без проекта компилятор читает корневой tsconfig.json с "files": [] и проверяет ноль файлов`)
    }
  }
  return { ok: problems.length === 0, problems }
}

/**
 * Проверяет конфиг проекта: include покрывает реальные файлы на диске (не
 * `files: []` и не пустой include) — иначе typecheck проверяет пустое
 * множество и зелёный гейт ничего не доказывает.
 * @param {string} projectPath абсолютный путь к tsconfig.*.json
 * @param {object} config распарсенный JSON
 * @param {string} root корень репозитория
 * @returns {{ok: boolean, problems: string[]}}
 */
export function checkProjectConfig(projectPath, config, root) {
  const problems = []
  const name = path.basename(projectPath)
  const files = Array.isArray(config.files) ? config.files : null
  if (files && files.length === 0) {
    problems.push(`${name}: "files": [] — компилятору нечего проверять (это и был баг P3 #37)`)
  }
  const include = Array.isArray(config.include) ? config.include : []
  if (include.length === 0) {
    problems.push(`${name}: include пуст — нечего проверять`)
  } else {
    const missing = []
    let matched = 0
    for (const entry of include) {
      const abs = path.resolve(root, entry)
      if (!fs.existsSync(abs)) missing.push(entry)
      else matched += countFiles(abs)
    }
    if (missing.length) problems.push(`${name}: include указывает на несуществующие пути: ${missing.join(', ')}`)
    if (matched === 0) problems.push(`${name}: include не покрывает ни одного файла — typecheck проверяет пустое множество`)
  }
  return { ok: problems.length === 0, problems }
}

function countFiles(entry) {
  const stat = fs.statSync(entry)
  if (stat.isFile()) return 1
  if (!stat.isDirectory()) return 0
  let n = 0
  for (const child of fs.readdirSync(entry)) {
    const p = path.join(entry, child)
    const s = fs.statSync(p)
    if (s.isDirectory()) n += countFiles(p)
    else if (/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(child)) n += 1
  }
  return n
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const failures = []

  const pkg = parseJsonc(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const verdict = checkTypecheckScript(pkg.scripts && pkg.scripts[TYPECHECK_SCRIPT])
  for (const problem of verdict.problems) {
    console.error(`[ERR] ${problem}`)
    failures.push(problem)
  }

  const workflowsDir = path.join(root, '.github', 'workflows')
  const workflowNames = fs.existsSync(workflowsDir)
    ? fs.readdirSync(workflowsDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    : []
  if (workflowNames.length === 0) {
    console.error('[ERR] .github/workflows не найден — проверять нечего')
    process.exit(1)
  }
  for (const name of workflowNames) {
    const text = fs.readFileSync(path.join(workflowsDir, name), 'utf8')
    if (!GATED_WORKFLOWS.includes(name)) {
      for (const { line, cmd } of findTscRunLines(text)) {
        if (/\btsc\b/.test(cmd) && !/-p\s+tsconfig\.(app|node)\.json/.test(cmd)) {
          console.error(`[ERR] ${name}:${line} — «${cmd}» вызывает tsc без -p`)
          failures.push(`${name}:${line} bare tsc`)
        }
      }
      continue
    }
    const wv = checkWorkflow(text, name)
    for (const problem of wv.problems) {
      console.error(`[ERR] ${problem}`)
      failures.push(problem)
    }
  }

  for (const configName of ['tsconfig.app.json', 'tsconfig.node.json']) {
    const configPath = path.join(root, configName)
    if (!fs.existsSync(configPath)) {
      console.error(`[ERR] ${configName} не найден — проект не включается в typecheck`)
      failures.push(`${configName} missing`)
      continue
    }
    const config = parseJsonc(fs.readFileSync(configPath, 'utf8'))
    const cv = checkProjectConfig(configPath, config, root)
    for (const problem of cv.problems) {
      console.error(`[ERR] ${problem}`)
      failures.push(problem)
    }
  }

  if (failures.length) {
    console.error(`\ntypecheck-гейт не защищает код (${failures.length} проблем). Чинить: вернуть scripts.typecheck и workflow-строки к реальной проверке обоих проектов.`)
    process.exit(1)
  }
  console.log('typecheck подключён честно: scripts.typecheck собирает оба проекта с -p и --noEmit, workflow не вызывают голый tsc, include проектов покрывают реальные файлы.')
  process.exit(0)
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main()