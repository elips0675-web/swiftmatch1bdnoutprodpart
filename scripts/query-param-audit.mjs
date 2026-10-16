#!/usr/bin/env node
/**
 * Гейт «query-параметр прочитан и не забыт» (остатки свода 15.10.2026).
 *
 * Класс: фронт шлёт `?premium=1` (или `?period=30`), бэкенд читает
 * `req.query.premium` и нигде его не использует — фильтр молча не работает,
 * и «фильтр не фильтрует» ищется глазами. Так был найден `premium` в
 * `server/src/routes/admin/users.js` (с тех пор исправлен).
 *
 * Правило намеренно узкое и без ложных срабатываний: параметр считается живым,
 * если его значение где-то используется — либо само имя встречается в файле
 * ещё раз, либо прочитанное значение связано с локальной переменной
 * (`const days = … Number(req.query.period) …`), и эта переменная используется.
 * Измерено 16.10.2026: при таком правиле находок в `server/src` — ноль;
 * единственный формальный кандидат (`admin/dashboard.js:89`, `period`) — ложный:
 * значение течёт через `const days`, и гейт это учитывает.
 *
 * Что гейт НЕ ловит (и почему): параметр, который попал в SQL как no-op
 * (`WHERE 1 = ?`), и параметр, который фронт перестал слать. Это уже контракт
 * фронт↔бэк, а не статика одного файла. Границы правила описаны здесь явно,
 * чтобы зелёный гейт не читался как «параметры проверены все».
 *
 * Мёртвый параметр закрывается пометкой `@ignored: <причина>` на строке чтения
 * либо строкой в `JUSTIFIED` с причиной и якорем `expect` (идиом
 * `n-plus-one-audit.mjs`); протухшее оправдание — отдельная находка.
 *
 * Запуск: node scripts/query-param-audit.mjs [--list]
 * Выход: exit 1 при мёртвом параметре без пометки и при протухшем оправдании.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { listJsFiles } from './schema-drift-audit.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ROUTES_DIR = path.join(ROOT, 'server', 'src')

const DIRECT_READ = /req\.query\.(\w+)/g
const DESTRUCTURE = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*req\.query\b/g
const BINDING = /(?:const|let|var)\s+(\w+)\s*=/
const IGNORE_MARKER = /@ignored\s*:\s*(\S[^\n]*)/

/** Намеренно прочитанные и не использованные параметры (пусто: таких сейчас нет). */
export const JUSTIFIED = []

export function countWord(src, name) {
  return (src.match(new RegExp(`\\b${name}\\b`, 'g')) || []).length
}

export function scan(dir = ROUTES_DIR) {
  const findings = []
  const ignored = []
  let readsCount = 0

  for (const file of listJsFiles(dir)) {
    if (file.includes('__tests__')) continue
    const src = fs.readFileSync(file, 'utf8')
    const lines = src.split(/\r?\n/)
    const rel = path.relative(dir, file).split(path.sep).join('/')

    const reads = []
    for (const m of src.matchAll(DIRECT_READ)) reads.push({ name: m[1], index: m.index })
    for (const m of src.matchAll(DESTRUCTURE)) {
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/[:=]/)[0].trim()
        if (/^\w+$/.test(name)) reads.push({ name, index: m.index, destructured: true })
      }
    }

    for (const read of reads) {
      readsCount += 1
      const line = src.slice(0, read.index).split('\n').length
      const text = lines[line - 1] || ''
      const marker = IGNORE_MARKER.exec(text)
      if (marker && marker[1].trim().length >= 4) {
        ignored.push({ rel, line, name: read.name, reason: marker[1].trim() })
        continue
      }
      const binding = BINDING.exec(text)
      const bindsSameName = Boolean(binding && binding[1] === read.name)
      if (!bindsSameName && countWord(src, read.name) >= 2) continue
      if (binding) {
        const v = binding[1]
        const total = countWord(src, v)
        if (v !== read.name && total >= 2) continue
        const paramReadsOnLine = (text.match(new RegExp(`req\\.query\\.${read.name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}`, 'g')) || []).length
        const others = total - 1 - (v === read.name ? paramReadsOnLine : 0)
        if (others >= 1) continue
        // no other uses of the bound var → dead
      }
      // no other usages → dead
      findings.push({
        rel,
        line,
        name: read.name,
        destructured: Boolean(read.destructured),
        snippet: text.trim().slice(0, 100),
      })
    }
  }
  return { findings, ignored, reads: readsCount, drift: collectDrift(dir) }
}

export function justifiedFor(rel, line, list = JUSTIFIED) {
  return list.find((j) => j.file === rel && j.lines.includes(line))
}

export function collectDrift(dir = ROUTES_DIR, list = JUSTIFIED) {
  const drift = []
  for (const j of list) {
    const full = path.join(dir, j.file)
    if (!fs.existsSync(full)) {
      drift.push({ file: j.file, line: j.lines[0], reason: 'файл не найден' })
      continue
    }
    const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/)
    for (const line of j.lines) {
      const text = lines[line - 1] ?? ''
      if (!text.includes(j.expect)) {
        drift.push({ file: j.file, line, reason: `на строке нет «${j.expect}»: ${text.trim().slice(0, 60) || '(строка вне файла)'}` })
      }
    }
  }
  return drift
}

export function audit(dir = ROUTES_DIR, list = JUSTIFIED) {
  const { findings, ignored, drift, reads } = scan(dir)
  const unexpected = findings.filter((f) => !justifiedFor(f.rel, f.line, list))
  return { unexpected, ignored, drift, reads }
}

export function report({ unexpected, ignored, drift }, log = console.log) {
  log(`query-param: мёртвых параметров — ${unexpected.length}, помечено @ignored — ${ignored.length}`)

  if (process.argv.includes('--list')) {
    for (const i of ignored) log(`  OK @ignored ${i.rel}:${i.line} req.query.${i.name} — ${i.reason}`)
  }

  for (const f of unexpected) {
    log(`  ${f.rel}:${f.line}  req.query.${f.name}${f.destructured ? ' (деструктуризация)' : ''} прочитан и нигде не использован`)
    log(`      ${f.snippet}`)
  }
  for (const d of drift) log(`  ОПРАВДАНИЕ ПРОТУХЛО ${d.file}:${d.line} — ${d.reason}`)

  if (!unexpected.length && !drift.length) {
    log('Мёртвых query-параметров нет.')
    return 0
  }

  log('')
  log('Как править:')
  log('  1) используй параметр по назначению (в SQL или в логике) либо убери чтение;')
  log('  2) если параметр читается намеренно и не используется — пометка `@ignored: <причина>`;')
  log('  3) либо строка в JUSTIFIED этого скрипта с причиной и якорем `expect`.')
  return 1
}

function main() {
  process.exit(report(audit()))
}

export { main }

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main()
