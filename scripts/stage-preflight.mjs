/**
 * Preflight — быстрые гейты ДО начала этапа (автоматизация B, P2).
 *
 * Обёртка над существующими проверками: одна команда вместо шести. Имеет
 * смысл только офлайн — без БД, живых серверов и сборки, чтобы старт этапа
 * не требовал развернутого контура. Если что-то красное — этап не начинать,
 * сначала починить (иначе каждая следующая работа уходит в 10-минутное
 * выяснение «что красное»).
 *
 * Состав (спецификация B): tsc --noEmit, eslint корня и server/, счётчики
 * тестов с --skip-e2e (E2E-прогон не нужен для быстрого старта), check:docs,
 * check:mirrors, check:env-parity. Всё остальное — в stage:facts в конце
 * этапа; живой check:console — только со стендом.
 *
 * Stage 148 (часть 3) — добавлена 9-я проверка «окно незакоммиченного до
 * старта этапа»: жёсткий порог **6 файлов / 300 строк** (те же числа, что у
 * `retent:check` без `--preflight`), считается по `git diff --name-only HEAD`,
 * `git diff --numstat HEAD` и untracked без владельческих черновиков. Смысл:
 * 8-я проверка (мягкий `--preflight`, 10/450) прощает начать этап с окном,
 * которое уже не влезает в правило «чекпойнт после каждого блока». Девятая
 * говорит прямо: сначала чекпойнт, потом этап.
 *
 * Тесты (`scripts/stage-preflight.test.mjs`) гоняют collectPreflight через
 * подменный runner и подменную пробу окна: состав, порядок, обработка
 * красных и запрет старта проверяются без реальных процессов.
 *
 * Exit: 0 — все зелёные, можно начинать; 1 — есть красные (список в отчёте).
 */

import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { collectRetention, verdictOf as retentionVerdict, LIMITS } from './retention-gate.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const TIME = {
  counters: 1_200_000,
  tsc: 180_000,
  lint: 300_000,
  gates: 300_000,
  mirrors: 60_000,
}

/** Жёсткий порог окна перед стартом этапа — те же числа, что у `retent:check`. */
export const WINDOW_LIMITS = LIMITS

export const WINDOW_CHECK_NAME = 'окно незакоммиченного до старта этапа'
export const WINDOW_CHECK_CMD =
  'git diff --name-only HEAD + git diff --numstat HEAD + untracked'
export const WINDOW_RED_MESSAGE =
  'Слишком много незакоммиченного перед стартом этапа. Сделай чекпойнт (микрокоммит+push) перед началом следующей большой правки.'

export const PREFLIGHT_CHECKS = [
  { name: 'tsc --noEmit', cmd: 'npx tsc --noEmit', timeout: TIME.tsc },
  { name: 'eslint (root)', cmd: 'npm run lint', timeout: TIME.lint },
  { name: 'eslint (server)', cmd: 'npm run lint:server', timeout: TIME.lint },
  { name: 'счётчики тестов (--skip-e2e)', cmd: 'node scripts/test-counter-audit.mjs --skip-e2e', timeout: TIME.counters },
  { name: 'check:docs', cmd: 'npm run check:docs', timeout: TIME.gates },
  { name: 'check:mirrors', cmd: 'npm run check:mirrors', timeout: TIME.mirrors },
  { name: 'check:env-parity', cmd: 'npm run check:env-parity', timeout: TIME.gates },
  { name: 'незакоммиченное окно', cmd: 'node scripts/retention-gate.mjs --preflight', timeout: TIME.mirrors },
  { name: WINDOW_CHECK_NAME, cmd: WINDOW_CHECK_CMD, timeout: TIME.mirrors, kind: 'window' },
]

export function run(cmd, { cwd = ROOT, timeout = TIME.gates } = {}) {
  try {
    const out = execFileSync('cmd', ['/c', cmd], {
      cwd,
      encoding: 'utf8',
      timeout,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { exit: 0, output: String(out || '').trim() }
  } catch (err) {
    const buf = (err.stdout || err.stderr || '').toString()
    return { exit: typeof err.status === 'number' ? err.status : 1, output: buf.trim() }
  }
}

/**
 * Проба окна перед стартом этапа. Считается тем же кодом, что и `retent:check`
 * (изменённые + untracked, владельческие черновики исключены), но по жёсткому
 * порогу, а не по мягкому `--preflight`.
 */
export function probeWindow(limits = WINDOW_LIMITS, collect = collectRetention) {
  const { summary } = collect()
  const verdict = retentionVerdict(summary, limits)
  return {
    exit: verdict.exit,
    summary,
    limits,
    message: verdict.exit === 1 ? WINDOW_RED_MESSAGE : '',
    detail: `окно: ${summary.files} файлов / ${summary.lines} строк (порог ${limits.files}/${limits.lines})`,
  }
}

export function collectPreflight(runner = run, probe = probeWindow) {
  const checks = []
  for (const c of PREFLIGHT_CHECKS) {
    if (c.kind === 'window') {
      const res = probe()
      checks.push({
        name: c.name,
        cmd: c.cmd,
        exit: res.exit,
        message: res.message || '',
        detail: res.detail || '',
      })
      continue
    }
    const res = runner(c.cmd, { timeout: c.timeout, cwd: ROOT })
    checks.push({ name: c.name, cmd: c.cmd, exit: res.exit })
  }
  return checks
}

export function verdictOf(checks) {
  const red = checks.filter((c) => c.exit !== 0).map((c) => c.name)
  return { exit: red.length ? 1 : 0, red, green: checks.length - red.length, total: checks.length }
}

export function statusOf(exit) {
  return exit === 0 ? '✅' : '❌'
}

export function renderReport(checks) {
  const v = verdictOf(checks)
  const rows = checks.map((c) => `| ${c.name} | \`${c.cmd}\` | ${c.exit} | ${statusOf(c.exit)} |`)
  const lines = []
  lines.push('=== PREFLIGHT (гейты до начала этапа) ===')
  lines.push('| проверка | команда | exit | статус |')
  lines.push('|---|---|---|---|')
  lines.push(...rows)
  lines.push('')
  for (const c of checks) {
    if (c.detail) lines.push(`  где: ${c.name} — ${c.detail}`)
  }
  for (const c of checks) {
    if (c.exit !== 0 && c.message) lines.push(c.message)
  }
  if (v.exit === 0) {
    lines.push(`Preflight зелёный: ${v.green}/${v.total} — можно начинать этап.`)
  } else {
    lines.push(`НЕ НАЧИНАЙ ЭТАП: красные ${v.red.length}/${v.total} — ${v.red.join(', ')}. Сначала почини их, потом работай над этапом.`)
  }
  return lines.join('\n')
}

function main() {
  const checks = collectPreflight()
  console.log(renderReport(checks))
  process.exit(verdictOf(checks).exit)
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main()
