/**
 * stage:context — быстрый старт этапа (автоматизация A из «ЗАДАНИЕ АГЕНТУ.txt»).
 *
 * Одна команда печатает контекст, который агент иначе собирает вручную 10–15
 * минут: состояние git, последний Stage из журнала, счётчики тестов, открытые
 * пункты очереди, 3 последних питфолла и гейты последнего прогона. Пара к
 * `stage:preflight` (B): preflight закрывает этап, context открывает.
 *
 * Read-only: ничего не пишет и не меняет — только читает и печатает.
 * Тексты парсятся по фактическим структурам проекта (проверяются тестами),
 * а не по чужим из другого репозитория: у нас очередь — нумерованный список
 * `1. …` под заголовком `## Очередь этапов`, питфоллы — строки `N. **…**`,
 * а журнал — абзацы вида `(Stage N … , ДД.ММ.ГГГГ) — …` (не `### Этап N`).
 *
 * Exit всегда 0: отсутствующий источник печатается словами («не найден»),
 * а не падает — context не гейт, а справка для старта.
 */

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const QUEUE_HEADING = '## Очередь этапов'

/** Замыкает блок очереди: первый `## ` после заголовка или разделитель `---`/`# `. */
function isBlockEnd(line) {
  return /^##\s/.test(line) || /^#\s/.test(line) || /^\s*---\s*$/.test(line)
}

/**
 * Открытые пункты очереди из «Что доделать.txt»: нумерованный список
 * `1. **Тема:** текст` под `## Очередь этапов`, до следующего `##`/`---`.
 * Свёрнутый пункт считается открытым; первая строка обрезается до 90 символов.
 */
export function parseQueue(text) {
  const lines = String(text || '').split(/\r?\n/)
  const start = lines.findIndex((l) => l.trim().startsWith(QUEUE_HEADING))
  if (start < 0) return []
  const out = []
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]
    if (isBlockEnd(line)) break
    const m = /^(\d+)\.\s+(.*)$/.exec(line.trim())
    if (!m) continue
    const clean = m[2].replace(/\*\*/g, '').trim()
    out.push({ index: Number(m[1]), text: clean.length > 90 ? `${clean.slice(0, 90)}…` : clean })
  }
  return out
}

/**
 * Последние записи журнала «Что сделано.txt»: абзацы, начинающиеся с
 * `(Stage N … ДД.ММ.ГГГГ)`. Возвращает по убыванию появления в файле
 * (свежие записи лежат сверху). Номер Stage и дата извлекаются в поля.
 */
export function lastStageEntries(text) {
  const lines = String(text || '').split(/\r?\n/)
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^\(Stage\s+(\d+)[^\n]*?(\d{2}\.\d{2}\.\d{4})\)/.exec(lines[i])
    if (!m) continue
    const title = lines[i].replace(/^\(/, '').split(') —')[0].slice(0, 100)
    out.push({ line: i + 1, stage: Number(m[1]), date: m[2], title })
  }
  return out
}

/** Последний (наибольший) номер Stage из журнала; null, если записей нет. */
export function latestStage(text) {
  const entries = lastStageEntries(text)
  if (entries.length === 0) return null
  return entries.reduce((max, e) => (e.stage > max.stage ? e : max), entries[0])
}

/**
 * Последние `count` питфоллов по номерам из `docs/AGENTS-pitfalls.md`
 * (строки вида `N. **…**`). Сортировка по номеру, а не по появлению:
 * в файле нумерация встречается не по порядку (24, 47–54, 36…), поэтому
 * «3 последних по файлу» дало бы случайный набор.
 */
export function lastPitfalls(text, count = 3) {
  const lines = String(text || '').split(/\r?\n/)
  const all = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\d+)\.\s+\*\*(.+?)\*\*/.exec(lines[i])
    if (!m) continue
    all.push({ number: Number(m[1]), line: i + 1, title: m[2].slice(0, 90) })
  }
  all.sort((a, b) => b.number - a.number)
  return all.slice(0, count)
}

/** Строки счётчиков из `test/machine/test-inventory.json`; null при негодном файле. */
export function readInventory(json) {
  let inv
  try {
    inv = JSON.parse(json)
  } catch {
    return null
  }
  if (!inv || typeof inv !== 'object') return null
  const pick = (section) => {
    const s = inv[section]
    if (!s || typeof s !== 'object') return null
    return { files: s.files ?? 0, tests: s.tests ?? 0, failed: s.failed ?? 0 }
  }
  return {
    generated: String(inv.generated || '').slice(0, 10),
    frontend: pick('frontend'),
    server: pick('server'),
    e2e: pick('e2e'),
    total: inv.total && typeof inv.total === 'object' ? { tests: inv.total.tests ?? 0 } : null,
  }
}

/** Красные/зелёные гейты из текста блока «Гейты: …» (stage:facts-лог). */
export function parseGateLine(text) {
  const m = /(\d+)\/(\d+)\s*✅/.exec(String(text || ''))
  if (!m) return null
  const green = Number(m[1])
  const total = Number(m[2])
  if (green > total) return null
  return { green, total, red: total - green }
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trimEnd()
  } catch {
    return ''
  }
}

function readRel(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8')
  } catch {
    return null
  }
}

export function collectContext() {
  const status = git(['status', '--short'])
  const log = git(['log', '--oneline', '-3'])
  const journal = readRel('Что сделано.txt')
  const backlog = readRel('Что доделать.txt')
  const pitfalls = readRel('docs/AGENTS-pitfalls.md')
  const inventory = readRel('test/machine/test-inventory.json')
  return {
    status,
    log,
    journal,
    backlog,
    pitfalls,
    inventory,
  }
}

export function renderContext(ctx) {
  const lines = []
  lines.push('=== GIT ===')
  lines.push(ctx.status ? ctx.status : '(дерево чистое)')
  lines.push('--- последние коммиты ---')
  lines.push(ctx.log || '(git недоступен)')

  lines.push('')
  lines.push('=== ЖУРНАЛ (последний Stage) ===')
  const last = ctx.journal ? latestStage(ctx.journal) : null
  if (last) {
    lines.push(`Stage ${last.stage} (${last.date}) — строка ${last.line}: ${last.title}`)
  } else {
    lines.push('(Stage-записей в «Что сделано.txt» не найдено)')
  }

  lines.push('')
  lines.push('=== СЧЁТЧИКИ ТЕСТОВ ===')
  const inv = ctx.inventory ? readInventory(ctx.inventory) : null
  if (inv && inv.frontend && inv.server) {
    lines.push(
      `фронт ${inv.frontend.files}/${inv.frontend.tests}, сервер ${inv.server.files}/${inv.server.tests}, ` +
        `E2E ${inv.e2e ? `${inv.e2e.files}/${inv.e2e.tests}` : '—'}, итого ${inv.total ? inv.total.tests : '—'} ` +
        `(generated ${inv.generated || '—'})`
    )
  } else {
    lines.push('(инвентарь test/machine/test-inventory.json не читается)')
  }

  lines.push('')
  lines.push('=== ОТКРЫТЫЕ ПУНКТЫ ОЧЕРЕДИ ===')
  const queue = ctx.backlog ? parseQueue(ctx.backlog) : []
  if (queue.length === 0) {
    lines.push('(очередь не найдена или пуста)')
  } else {
    for (const item of queue) lines.push(`${item.index}. ${item.text}`)
  }

  lines.push('')
  lines.push('=== ПОСЛЕДНИЕ ПИТФОЛЛЫ ===')
  const falls = ctx.pitfalls ? lastPitfalls(ctx.pitfalls) : []
  if (falls.length === 0) {
    lines.push('(питфоллы не найдены)')
  } else {
    for (const p of falls) lines.push(`${p.number}. ${p.title}`)
  }

  lines.push('')
  lines.push('=== ГЕЙТЫ (последний stage:facts) ===')
  lines.push('Перезапусти `npm run stage:facts`, если сомневаешься в свежести.')
  const gates = ctx.journal ? parseGateLine(ctx.journal) : null
  if (gates) lines.push(`из журнала: зелёных ${gates.green}/${gates.total}, красных ${gates.red}`)
  else lines.push('(строки гейтов нет — прогони `npm run stage:facts`)')
  return lines.join('\n')
}

function main() {
  console.log(renderContext(collectContext()))
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
