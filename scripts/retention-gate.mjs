/**
 * Гейт незакоммиченного окна (правило «не терять работу», Stage 146).
 *
 * Инцидент 21.10.2026 показал класс потерь, который git сам не ловит: работа
 * велась долгими этапами, коммит ставился в самый конец, а между этапами
 * дерево подолгу держало сломанное состояние (обратная подстановка оставляет
 * фикс отключённым) и десятки незакоммиченных файлов. Если сессия обрывается
 * (лимит, краш, `git checkout --` по совету из интернета) — потеряно всё, что
 * после последнего push, включая прод-фиксы.
 *
 * Правило: работа дробится на части и коммитится часто; после каждого коммита —
 * push. Порог ниже — не «красота ради красоты», а сигнал, что этап пора
 * резать: каждая часть — своя запись Stage N, свой коммит, свой push.
 *
 * Гейт офлайн (только git): вызывается из `npm run stage:preflight` перед
 * стартом этапа и из `npm run retent:check` сколько угодно раз в процессе.
 *
 * Флаги:
 *   (без флагов)  — строгий режим для рутинных вызовов в конце/середине этапа
 *   --preflight   — мягкий режим для старта этапа (порог +4 файла/+200 строк)
 *   --json        — машинный вывод вместо таблицы
 *
 * Exit: 0 — окно в норме; 1 — окно слишком большое (список файлов в отчёте).
 */

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const LIMITS = {
  files: 8,
  lines: 400,
}

export const PREFLIGHT_LIMITS = {
  files: 12,
  lines: 600,
}

export const IGNORED_UNTRACKED = ['Анализ задание агенту.txt', 'Анализ тестов.txt']

const NOT_A_REGRESSION = ['задача владельца', 'черновик владельца', 'не коммитить']

export function parsePorcelain(text) {
  const entries = []
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (!line.trim()) continue
    const status = line.slice(0, 2)
    let file = line.slice(3)
    if (file.includes(' -> ')) file = file.split(' -> ').pop()
    file = file.replace(/^"|"$/g, '')
    entries.push({ status, file, untracked: status === '??' })
  }
  return entries
}

export function parseNumstat(text) {
  let added = 0
  let removed = 0
  const perFile = new Map()
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (!line.trim()) continue
    const [a, r, ...rest] = line.split('\t')
    const file = rest.join('\t')
    const add = a === '-' ? 0 : Number(a) || 0
    const del = r === '-' ? 0 : Number(r) || 0
    added += add
    removed += del
    perFile.set(file, { added: add, removed: del })
  }
  return { added, removed, perFile }
}

export function countLines(file) {
  try {
    const stat = file.trim()
    if (!stat) return 0
    const buf = fs.readFileSync(path.join(ROOT, stat), 'utf8')
    if (buf === '') return 0
    return buf.split('\n').length
  } catch {
    return 0
  }
}

export function classify(entries, numstat, lineCounter = countLines) {
  const tracked = []
  const untracked = []
  for (const entry of entries) {
    if (entry.untracked) {
      const lines = lineCounter(entry.file)
      untracked.push({ ...entry, lines, ignored: IGNORED_UNTRACKED.includes(entry.file) })
    } else {
      const stat = numstat.perFile.get(entry.file) || { added: 0, removed: 0 }
      tracked.push({ ...entry, ...stat, lines: stat.added + stat.removed })
    }
  }
  return { tracked, untracked }
}

export function summarize(tracked, untracked) {
  const countedUntracked = untracked.filter((u) => !u.ignored)
  const files = tracked.length + countedUntracked.length
  const lines =
    tracked.reduce((sum, t) => sum + t.lines, 0) +
    countedUntracked.reduce((sum, u) => sum + u.lines, 0)
  return {
    files,
    lines,
    trackedFiles: tracked.length,
    untrackedFiles: countedUntracked.length,
    ignoredFiles: untracked.length - countedUntracked.length,
  }
}

export function verdictOf(summary, limits = LIMITS) {
  const red = []
  if (summary.files > limits.files) red.push(`файлов ${summary.files} > ${limits.files}`)
  if (summary.lines > limits.lines) red.push(`строк ${summary.lines} > ${limits.lines}`)
  return { exit: red.length ? 1 : 0, red, limits }
}

export function renderReport(summary, verdict, tracked, untracked) {
  const lines = []
  lines.push('=== RETENTION (незакоммиченное окно) ===')
  lines.push(
    `Изменено: ${summary.trackedFiles} файлов, untracked: ${summary.untrackedFiles} ` +
      `(игнорируется владельческих: ${summary.ignoredFiles}) — всего ${summary.files} файлов / ${summary.lines} строк.`
  )
  lines.push(`Порог: ${verdict.limits.files} файлов / ${verdict.limits.lines} строк.`)
  const top = [...tracked, ...untracked.filter((u) => !u.ignored)]
    .sort((a, b) => b.lines - a.lines)
    .slice(0, 10)
  if (top.length) {
    lines.push('Крупнейшие:')
    for (const item of top) lines.push(`  ${item.file} (+${item.lines})`)
  }
  if (verdict.exit === 0) {
    lines.push('Окно в норме: работа не рискует потеряться сильнее порога.')
  } else {
    lines.push(`ОКНО СЛИШКОМ БОЛЬШОЕ: ${verdict.red.join(', ')}.`)
    lines.push(
      'Разбей этап на части: каждая часть — запись Stage N в «Что сделано.txt», коммит (`git commit --no-verify -F`) и `git push`. Работа сверх порога теряется при обрыве сессии.'
    )
  }
  if (untracked.some((u) => u.ignored)) {
    lines.push(
      `Не считается (задача/черновик владельца, не коммитить): ${untracked
        .filter((u) => u.ignored)
        .map((u) => u.file)
        .join(', ')}`
    )
  }
  return lines.join('\n')
}

export function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

export function collectRetention() {
  const porcelain = git(['status', '--porcelain'])
  const numstat = git(['diff', '--numstat', 'HEAD'])
  const entries = parsePorcelain(porcelain)
  const { tracked, untracked } = classify(entries, parseNumstat(numstat))
  const summary = summarize(tracked, untracked)
  return { entries, tracked, untracked, summary }
}

function main() {
  const preflight = process.argv.includes('--preflight')
  const asJson = process.argv.includes('--json')
  const limits = preflight ? PREFLIGHT_LIMITS : LIMITS
  const { tracked, untracked, summary } = collectRetention()
  const verdict = verdictOf(summary, limits)
  if (asJson) {
    console.log(JSON.stringify({ ...verdict, ...summary }, null, 2))
  } else {
    console.log(renderReport(summary, verdict, tracked, untracked))
  }
  process.exit(verdict.exit)
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main()
