/**
 * Чекпойнт после логического блока — автоматизация правила (Stage 148, часть 4).
 *
 * Правило «чекпойнт после каждого этапного блока» (docs/AGENTS-workflow.md)
 * требует шесть шагов: сверить окно → убедиться, что гейт окна зелёный →
 * зафиксировать `Stage N.Y` в «Что сделано.txt» → закоммитить поимённо →
 * запушить → быстро провалидировать. Скрипт делает механику (шаги 1–5);
 * решение — какой блок завершён и каким текстом его описать — остаётся
 * за человеком.
 *
 * Скрипт НИЧЕГО не трогает, если окно больше порога: сначала разбей работу
 * на меньшие блоки и закоммить их, потом приходи снова. Проверка окна —
 * та же, что у `npm run retent:check` (жёсткий порог 6 файлов / 300 строк,
 * владельческие черновики исключены), поэтому «красный retent:check» и
 * «красный чекпойнт» — одно и то же.
 *
 * Usage:
 *   node scripts/stage-checkpoint.mjs --stage 149.1 --note "суть блока" \
 *     --file scripts/stage-checkpoint.mjs --file "Что сделано.txt" \
 *     [--message-file msg.txt] [--dry-run] [--no-push]
 *
 * Exit: 0 — чекпойнт сделан (или делать нечего); 1 — окно красное или git
 * отказался; 2 — неверные аргументы.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectRetention, renderReport, verdictOf, LIMITS, git } from './retention-gate.mjs'
import { todayRu } from './stage-section.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const JOURNAL_FILE = 'Что сделано.txt'
export const JOURNAL_HEADER = '# Что сделано'
export const MSG_FILE = path.join('.git', 'SM_CHECKPOINT_MSG.txt')

export function parseArgs(argv) {
  const args = {
    stage: '',
    note: '',
    files: [],
    messageFile: '',
    dryRun: false,
    push: true,
    help: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--stage') args.stage = argv[(i += 1)] || ''
    else if (arg === '--note') args.note = argv[(i += 1)] || ''
    else if (arg === '--file') args.files.push(argv[(i += 1)] || '')
    else if (arg === '--message-file') args.messageFile = argv[(i += 1)] || ''
    else if (arg === '--dry-run') args.dryRun = true
    else if (arg === '--no-push') args.push = false
    else if (arg === '--help' || arg === '-h') args.help = true
    else throw new Error(`неизвестный аргумент: ${arg}`)
  }
  return args
}

export function buildJournalLine({ stage, note, date }) {
  const head = `(Stage ${stage} — ${date})`
  return note ? `${head} — ${note}` : `${head}.`
}

export function hasStage(text, stage) {
  const escaped = String(stage).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b${escaped}\\b`).test(String(text || ''))
}

export function insertJournalLine(text, line) {
  const source = String(text || '')
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  const lines = source.split(/\r?\n/)
  const head = lines.findIndex((l) => l.trim() === JOURNAL_HEADER)
  if (head === -1) throw new Error(`в «${JOURNAL_FILE}» нет шапки «${JOURNAL_HEADER}»`)
  let at = head + 1
  if (lines[at] !== undefined && lines[at].trim() === '') at += 1
  lines.splice(at, 0, line, '')
  return lines.join(eol)
}

export function defaultMessage({ stage, note, files }) {
  const body = note || `чекпойнт: ${files.join(', ')}`
  return `chore(checkpoint): Stage ${stage} — ${body}\n`
}

export function runCheckpoint({ args, deps = {} }) {
  const {
    collect = collectRetention,
    readFile = (p) => fs.readFileSync(p, 'utf8'),
    writeFile = (p, content) => fs.writeFileSync(p, content, 'utf8'),
    exists = (p) => fs.existsSync(p),
    run = (gitArgs) => git(gitArgs),
    now = new Date(),
  } = deps

  const log = []
  const steps = []

  const { summary, tracked, untracked } = collect()
  const verdict = verdictOf(summary, LIMITS)
  if (verdict.exit !== 0) {
    log.push(renderReport(summary, verdict, tracked, untracked))
    log.push(
      'Чекпойнт остановлен: окно больше порога. Сначала сделай микрокоммит меньшего блока — потом вернись.'
    )
    return { exit: 1, log, steps }
  }
  log.push(
    `Окно в норме: ${summary.files} файлов / ${summary.lines} строк (порог ${verdict.limits.files}/${verdict.limits.lines}).`
  )

  const journalPath = path.join(ROOT, JOURNAL_FILE)
  const journalBefore = readFile(journalPath)
  let journalAfter = journalBefore
  if (!hasStage(journalBefore, args.stage)) {
    journalAfter = insertJournalLine(
      journalBefore,
      buildJournalLine({ stage: args.stage, note: args.note, date: todayRu(now) })
    )
    log.push(`Журнал: вставлена строка «Stage ${args.stage}» в «${JOURNAL_FILE}».`)
  } else {
    log.push(`Журнал: строка «Stage ${args.stage}» уже есть — не дублирую.`)
  }

  const files = [...new Set([...args.files, JOURNAL_FILE])]
  for (const file of files) {
    if (!exists(path.join(ROOT, file))) {
      log.push(`Файл не найден: ${file} — ничего не коммичу.`)
      return { exit: 1, log, steps }
    }
  }

  const message = args.messageFile
    ? readFile(path.isAbsolute(args.messageFile) ? args.messageFile : path.join(ROOT, args.messageFile))
    : defaultMessage({ stage: args.stage, note: args.note, files: args.files })

  const plan = [
    { id: 'add', args: ['add', '-f', '--', ...files] },
    { id: 'commit', args: ['commit', '--no-verify', '-F', MSG_FILE] },
  ]
  if (args.push) plan.push({ id: 'push', args: ['push', 'origin', 'main'] })

  if (args.dryRun) {
    log.push('dry-run: ничего не меняю. План:')
    for (const step of plan) log.push(`  git ${step.args.join(' ')}`)
    return { exit: 0, log, steps: plan }
  }

  if (journalAfter !== journalBefore) writeFile(journalPath, journalAfter)
  writeFile(path.join(ROOT, MSG_FILE), message)

  for (const step of plan) {
    steps.push(step)
    try {
      run(step.args)
    } catch (err) {
      const detail = (err.stderr || err.stdout || err.message || '').toString().trim()
      if (step.id === 'commit' && /nothing to commit/i.test(detail)) {
        log.push('Коммитить нечего: дерево уже чистое — чекпойнт не требуется.')
        return { exit: 0, log, steps }
      }
      log.push(`git ${step.args.join(' ')} — ошибка: ${detail}`)
      return { exit: 1, log, steps }
    }
    log.push(`git ${step.args.join(' ')} — ок`)
  }

  log.push(`Чекпойнт сделан: Stage ${args.stage}.`)
  return { exit: 0, log, steps }
}

function usage() {
  console.log(
    [
      'Usage: node scripts/stage-checkpoint.mjs --stage <N.Y> [--note "суть"]',
      '         --file <путь> [--file <путь> …] [--message-file <путь>]',
      '         [--dry-run] [--no-push]',
      '',
      'Правило: чекпойнт после каждого логического блока (docs/AGENTS-workflow.md).',
      'Если окно больше порога (6 файлов / 300 строк) — скрипт ничего не трогает.',
    ].join('\n')
  )
}

function main() {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(err.message)
    usage()
    process.exit(2)
  }
  if (args.help) {
    usage()
    process.exit(0)
  }
  if (!args.stage) {
    console.error('нужен --stage <N.Y>')
    usage()
    process.exit(2)
  }
  if (!args.files.length) {
    console.error('нужен хотя бы один --file <путь>')
    usage()
    process.exit(2)
  }
  const res = runCheckpoint({ args })
  for (const line of res.log) console.log(line)
  process.exit(res.exit)
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main()
