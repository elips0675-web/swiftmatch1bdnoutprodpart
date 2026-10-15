/**
 * «Заготовка секции этапа» — рутина, P2.
 *
 * Печатает в stdout каркас записи для «Что сделано.txt»: заголовок с датой,
 * `git diff --stat HEAD`, плейсхолдеры Задача / Что сделано / Ломка / Тесты /
 * Проверки и чек-лист правки шапки «Что доделать.txt». Ничего не редактирует:
 * проза этапа пишется руками, заготовка убирает только механику (дата, diff,
 * структура записи, куда вставлять факт-блок из `stage-facts`).
 *
 * Usage: node scripts/stage-section.mjs "<Заголовок этапа>" [ДД.ММ.ГГГГ]
 */

import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const PLACEHOLDER = 'РЕДАКТИРУЙ:'

export function todayRu(now = new Date()) {
  const p = (v) => String(v).padStart(2, '0')
  return `${p(now.getDate())}.${p(now.getMonth() + 1)}.${now.getFullYear()}`
}

export function diffSummary(stat) {
  const text = String(stat || '').trim()
  if (!text) return 'изменения уже закоммичены — `git diff --stat HEAD` пуст'
  const tail = text.split(/\r?\n/).pop().trim()
  const m = text.match(/^\s*(\d+)\s+files? changed/im)
  return m ? `изменено файлов: ${m[1]} (${tail})` : tail
}

export function buildSection({ title, date, diffStat, untracked = [] }) {
  const summary = diffSummary(diffStat)
  const untrackedNote = untracked.length ? `; новых (untracked): ${untracked.length} — ${untracked.slice(0, 5).join(', ')}${untracked.length > 5 ? '…' : ''}` : ''
  const lines = []
  lines.push(`## ${title} (${date})`)
  lines.push('')
  lines.push(`**Откуда задача.** ${PLACEHOLDER} бэклог «Что доделать.txt» / этап, с file:line-цитатой`)
  lines.push('')
  lines.push(`**Задача.** ${PLACEHOLDER}`)
  lines.push('')
  lines.push(`**Что сделано.** ${PLACEHOLDER} ${summary}${untrackedNote}.`)
  lines.push('')
  lines.push(`**Ломка.** ${PLACEHOLDER} как доказана честность гейтов (или «не требовалась»).`)
  lines.push('')
  lines.push(`**Тесты (+N).** ${PLACEHOLDER} файл(ы), N/N, итого N/N.`)
  lines.push('')
  lines.push(`**Проверки.** ${PLACEHOLDER} вставь факт-блок из ` + 'node scripts/stage-facts.mjs' + '.')
  lines.push('')
  lines.push('```')
  lines.push(`git diff --stat HEAD на ${date}:`)
  lines.push(String(diffStat || '').trim() || 'рабочее дерево чистое (всё уже закоммичено)')
  lines.push('```')
  return lines.join('\n')
}

export function buildHeaderChecklist({ date }) {
  const lines = []
  lines.push(`## Чек-лист шапки «Что доделать.txt» (${date})`)
  lines.push('')
  lines.push(`1. Строка 3: «Актуально: ${date}, закрыты <список>, следующий — …» — дополнить список и «следующий».`)
  lines.push('2. Счётчики: `node scripts/test-counter-audit.mjs --fix` (перепишет 7 файлов + инвентарь и зеркала чисел).')
  lines.push('3. Зеркала: `node scripts/check-doc-mirrors.mjs --fix` (побайтово).')
  lines.push('4. Разделение ролей: закрытый пункт живёт в «Что сделано.txt»; в бэклоге — только заголовок-маркер без тела (гейт check:docs, проверки backlog-closed-body / backlog-closed-line).')
  return lines.join('\n')
}

function main() {
  const title = process.argv[2]
  if (!title) {
    console.error('Usage: node scripts/stage-section.mjs "<Заголовок этапа>" [ДД.ММ.ГГГГ]')
    process.exit(2)
  }
  const date = process.argv[3] && /^\d{2}\.\d{2}\.\d{4}$/.test(process.argv[3]) ? process.argv[3] : todayRu()
  let diffStat = ''
  let untracked = []
  try {
    diffStat = execFileSync('git', ['diff', '--stat', 'HEAD'], { cwd: ROOT, encoding: 'utf8' })
  } catch {
    diffStat = ''
  }
  try {
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' })
    untracked = String(status || '').split(/\r?\n/).filter((l) => l.startsWith('?? ')).map((l) => l.slice(3))
  } catch {
    untracked = []
  }
  console.log(buildSection({ title, date, diffStat, untracked }))
  console.log('')
  console.log(buildHeaderChecklist({ date }))
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main()