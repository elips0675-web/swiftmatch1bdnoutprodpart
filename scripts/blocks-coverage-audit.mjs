#!/usr/bin/env node
/**
 * Гейт «выборка чужого профиля/фото фильтруется блок-листом» (остатки свода 15.10.2026, питфолл 46).
 *
 * Правило есть, гейта не было. Блок-лист (`server/src/user-blocks.js`,
 * `notBlocked(alias, viewerId)`) закрывает ленту и чат, но запрос вроде
 * `SELECT display_name FROM user_profiles WHERE id = ?` отдаёт имя заблокированного
 * пользователя: фильтра в самом запросе нет, а механизм блокировки — это SQL-предикат,
 * а не проверка в JS. Такие места находились руками.
 *
 * Гейт ищет выборку одного профиля по `id` (или фото по `user_id`) и требует
 * одно из трёх:
 *   1. блок-предикат в самом запросе — `notBlocked(...)` / `${blockFilter.sql}`;
 *   2. пометку `@public: <причина>` внутри SQL — когда фильтр не нужен по месту
 *      (свой профиль, админ-модерация, проверка владения);
 *   3. строку в `JUSTIFIED` этого скрипта с причиной и якорем `expect` — идиом
 *      `n-plus-one-audit.mjs`: якорь обязателен, иначе оправдание молча протухает
 *      при сдвиге строки. Протухание — отдельная находка `justification-drift`.
 *
 * Кто именно «чужой», статически не решишь (алиас, `req.params`, `req.userId`),
 * поэтому намеренные исключения перечислены явно, а не угаданы по эвристике:
 * эвристика «в аргументах есть req.userId → свой» пропустила бы запрос вида
 * `WHERE up.id = ?` с аргументами `[req.userId, targetId]`.
 *
 * Запуск: node scripts/blocks-coverage-audit.mjs [--list]
 * Выход: exit 1 при новой выборке без фильтра/пометки/оправдания и при протухшем оправдании.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { listJsFiles } from './schema-drift-audit.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ROUTES_DIR = path.join(ROOT, 'server', 'src')

const SQL_START = /^\s*(SELECT|INSERT|UPDATE|DELETE|WITH|REPLACE)\b/i
const SQL_FRAGMENT = /^\s*(AND|OR|LEFT|RIGHT|INNER|OUTER|CROSS|JOIN|WHERE|SET|ON|GROUP|ORDER|HAVING|LIMIT|FROM)\b/i
const IDENTITY_FILTER = /(?:^|[\s(.`])(?:`?(\w+)`?\.)?`?id`?\s*=\s*\?/i
const OWNER_FILTER = /(?:^|[\s(.`])(?:`?(\w+)`?\.)?`?user_id`?\s*=\s*\?/i
const BLOCK_PREDICATE = /notBlocked|blockFilter/
const PUBLIC_MARKER = /@public\s*:\s*(\S[^\n]*)/
const ALIAS_KEYWORDS = new Set([
  'where', 'on', 'and', 'or', 'set', 'left', 'right', 'inner', 'outer', 'cross', 'join', 'group', 'order',
  'limit', 'having', 'using', 'as', 'select', 'from', 'union',
])

/**
 * Намеренные выборки по id без блок-фильтра. `expect` — якорь: текст, который
 * ОБЯЗАН остаться на указанной строке, иначе оправдание протухло и гейт краснеет.
 */
export const JUSTIFIED = [
  {
    file: 'gdpr-export.js',
    lines: [30, 32],
    expect: 'db.query(',
    reason: 'GDPR-экспорт: userId — сам запросивший, отдаём его же профиль и фото',
  },
  {
    file: 'routes/hangouts.js',
    lines: [1013, 1230, 1532],
    expect: '[req.userId]',
    reason: 'своё имя автора действия для уведомления/push получателю (req.userId)',
  },
  {
    file: 'routes/hangouts.js',
    lines: [1379],
    expect: "activeUser('up')",
    reason: 'имя получателя push о взаимном лайке: получатель сам и есть этот профиль',
  },
  {
    file: 'routes/hangouts.js',
    lines: [1940],
    expect: 'dating_goal',
    reason: 'собственный профиль (req.userId) для персональных подсказок',
  },
  {
    file: 'routes/location.js',
    lines: [63],
    expect: 'last_location_update',
    reason: 'своя геолокация (req.userId)',
  },
  {
    file: 'routes/moderation.js',
    lines: [81],
    expect: 'display_name, bio, city',
    reason: 'adminAuth-модерация: целевой профиль из req.body.userId, зритель здесь модератор',
  },
  {
    file: 'routes/profile.js',
    lines: [129],
    expect: 'up.birth_date',
    reason: '/api/profile/me — собственный профиль',
  },
  {
    file: 'routes/profile.js',
    lines: [181],
    expect: 'p.display_name, p.bio, p.city',
    reason: '/api/profile/score — собственный профиль',
  },
  {
    file: 'routes/profile.js',
    lines: [189],
    expect: 'FROM user_photos',
    reason: 'счётчик собственных фото',
  },
  {
    file: 'routes/profile.js',
    lines: [252, 297],
    expect: 'FROM user_profiles',
    reason: 'свои настройки приватности (req.userId)',
  },
  {
    file: 'routes/schedule.js',
    lines: [84],
    expect: 'partner_name',
    reason: 'свой профиль как partner_name в своей же встрече',
  },
  {
    file: 'routes/social.js',
    lines: [162],
    expect: 'attachment_style',
    reason: 'свои настройки для поиска (req.userId)',
  },
  {
    file: 'routes/social.js',
    lines: [307],
    expect: 'liker',
    reason: 'своё имя в push о своём лайке',
  },
  {
    file: 'routes/social.js',
    lines: [1025],
    expect: 'sender',
    reason: 'своё имя как отправителя в push получателю',
  },
]

/**
 * SQL-литералы обоих видов: шаблонные (бэктики) и одинарные кавычки.
 * `extractSqlLiterals` из дрейф-аудита видит только бэктики, поэтому запросы в
 * одинарных кавычках (`'SELECT display_name FROM user_profiles WHERE id = ?'`)
 * проходили мимо гейта.
 */
export function sqlLiterals(src) {
  const out = []
  for (const m of src.matchAll(/`((?:\\.|[^`\\])*)`/g)) {
    if (SQL_START.test(m[1]) || SQL_FRAGMENT.test(m[1])) out.push({ text: m[1], index: m.index })
  }
  for (const m of src.matchAll(/'((?:\\.|[^'\\])*)'/g)) {
    if (SQL_START.test(m[1])) out.push({ text: m[1], index: m.index })
  }
  return out.sort((a, b) => a.index - b.index)
}

/** Алиас → таблица внутри одного литерала: без этого `u.id = ?` (`users`) ловится как профиль. */
export function aliasTables(literal) {
  const map = new Map()
  for (const m of literal.matchAll(/\b(?:FROM|JOIN)\s+`?(\w+)`?(?:\s+(?:AS\s+)?`?(\w+)`?)?/gi)) {
    const table = m[1].toLowerCase()
    const alias = m[2]?.toLowerCase()
    if (alias && !ALIAS_KEYWORDS.has(alias)) map.set(alias, table)
  }
  return map
}

function identityTarget(literal, table) {
  const filter = table === 'user_profiles' ? IDENTITY_FILTER : OWNER_FILTER
  const m = filter.exec(literal)
  if (!m) return null
  const alias = m[1]?.toLowerCase()
  if (alias) return aliasTables(literal).get(alias) === table ? table : null
  const first = /^\s*`?\s*SELECT\b[\s\S]*?\bFROM\s+`?(\w+)`?/i.exec(literal)?.[1]?.toLowerCase()
  return first === table ? table : null
}

export function candidates(dir = ROUTES_DIR) {
  const out = []
  for (const file of listJsFiles(dir)) {
    if (file.includes('__tests__')) continue
    const src = fs.readFileSync(file, 'utf8')
    const rel = path.relative(dir, file).split(path.sep).join('/')
    for (const { text: literal, index } of sqlLiterals(src)) {
      if (!/^\s*(?:`?\s*)?SELECT\b/i.test(literal)) continue
      const table = /(?:FROM|JOIN)\s+`?(user_profiles|user_photos)\b/i.exec(literal)?.[1]?.toLowerCase()
      if (!table) continue
      if (identityTarget(literal, table) !== table) continue
      const line = src.slice(0, index).split('\n').length
      out.push({ rel, line, table, literal, snippet: literal.replace(/\s+/g, ' ').trim().slice(0, 120) })
    }
  }
  return out
}

export function justifiedFor(rel, line, list = JUSTIFIED) {
  return list.find((j) => j.file === rel && j.lines.includes(line))
}

/** Оправдание протухло: строка сдвинулась и на ней больше нет того SQL, ради которого её внесли. */
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
  const unexpected = []
  const annotated = []
  let justified = 0
  let withPredicate = 0

  for (const c of candidates(dir)) {
    if (BLOCK_PREDICATE.test(c.literal)) {
      withPredicate += 1
      continue
    }
    const marker = PUBLIC_MARKER.exec(c.literal)
    const reason = marker ? marker[1].replace(/\*\/[\s]*$/, '').trim() : ''
    if (marker && reason.length >= 4) {
      annotated.push({ ...c, reason })
      continue
    }
    if (marker) {
      unexpected.push({ ...c, why: '`@public` без причины: причина обязана быть непустой' })
      continue
    }
    if (justifiedFor(c.rel, c.line, list)) {
      justified += 1
      continue
    }
    unexpected.push({ ...c, why: 'нет ни блок-предиката, ни `@public: <причина>`, ни строки в JUSTIFIED' })
  }

  return { unexpected, annotated, justified, withPredicate, drift: collectDrift(dir, list) }
}

export function report({ unexpected, annotated, justified, withPredicate, drift }, log = console.log) {
  log(`blocks-coverage: выборок профиля/фото по id — под блок-предикатом ${withPredicate}, с @public ${annotated.length}, по JUSTIFIED ${justified}`)

  if (process.argv.includes('--list')) {
    for (const a of annotated) log(`  OK @public ${a.rel}:${a.line} — ${a.reason}`)
  }

  for (const f of unexpected) log(`  ${f.rel}:${f.line}  [${f.table}] ${f.why}\n      ${f.snippet}`)
  for (const d of drift) log(`  ОПРАВДАНИЕ ПРОТУХЛО ${d.file}:${d.line} — ${d.reason}`)

  if (!unexpected.length && !drift.length) {
    log('Нарушений нет: каждая выборка по id либо под блок-предикатом, либо помечена явно.')
    return 0
  }

  log('')
  log('Как править:')
  log('  1) добавь в запрос блок-предикат: const b = notBlocked(alias, req.userId) → AND ${b.sql} (+ b.params);')
  log('  2) если выборка намеренная (свой профиль, админ-модерация, проверка владения) —')
  log('     поставь в SQL пометку `@public: <причина>`;')
  log('  3) либо внеси место в JUSTIFIED этого скрипта с причиной и якорем `expect`;')
  log('  4) протухшее оправдание (строка сдвинулась) — обнови номер строки и якорь.')
  return 1
}

function main() {
  process.exit(report(audit()))
}

export { main }

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main()
