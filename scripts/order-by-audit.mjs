/**
 * @openapi
 * order-by-audit:
 *   Находит SQL-запросы с пагинацией, у которых ORDER BY не заканчивается
 *   уникальным столбцом. Такая сортировка недетерминирована: при совпадении
 *   значений MySQL вправе вернуть строки в любом порядке, поэтому на странице 2
 *   (LIMIT 20 OFFSET 20) запись может оказаться снова на странице 1 или
 *   пропасть вовсе. Для списков без LIMIT (обычные выдачи фида) это лишь
 *   «дёргание» порядка между двумя запросами, поэтому гейт ругается только на
 *   запросы, где есть OFFSET/LIMIT, — но печатает и безлимитные как заметку.
 *
 * Запуск:
 *   node scripts/order-by-audit.mjs            # только пагинируемые (гейт)
 *   node scripts/order-by-audit.mjs --all      # + все безлимитные как заметка
 *   node scripts/order-by-audit.mjs --json     # машинный вывод (для тестов)
 *
 * Правила, чтобы не было ложных срабатываний:
 *   - агрегат в конце ORDER BY (COUNT/SUM/…) — пропуск: там сортируют группы,
 *     а не строки, и добавление PK сломало бы SQL;
 *   - последний термин — ключ GROUP BY (без префикса таблицы) — пропуск: это
 *     идентичность группы, а не строки;
 *   - динамическая сортировка (`ORDER BY ${sortCol}`) разбирается по
 *     интерполяциям: если после них остаётся уникальный столбец — считается
 *     закрытой, иначе попадает в отчёт (не «зелёное молчание»).
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'server', 'src')
const SCHEMA = path.join(ROOT, 'database', 'mysql_schema.sql')

const AGGREGATE = /\b(COUNT|SUM|AVG|MIN|MAX|GROUP_CONCAT|JSON_ARRAYAGG|JSON_OBJECTAGG)\s*\(/i

export function parseUniqueIndex(schema) {
  const pk = new Map()
  const unique = new Map()
  const all = new Map()
  const tables = new Set()
  const globalUnique = new Set()
  for (const m of schema.matchAll(/CREATE TABLE `([^`]+)` \(([\s\S]*?)\n\) ENGINE=/g)) {
    const [, table, body] = m
    tables.add(table)
    all.set(table, [...body.matchAll(/^\s*`([^`]+)`/gm)].map(c => c[1]))
    const p = /PRIMARY KEY \(([^)]+)\)/.exec(body)
    if (p) {
      const cols = p[1].replace(/[`\s]/g, '').split(',')
      pk.set(table, cols)
      for (const c of cols) globalUnique.add(c)
    }
    const list = []
    for (const u of body.matchAll(/UNIQUE KEY `[^`]+` \(([^)]+)\)/g)) {
      const cols = u[1].replace(/[`\s]/g, '').split(',')
      if (cols.length === 1) {
        list.push(cols[0])
        globalUnique.add(cols[0])
      }
    }
    unique.set(table, list)
  }
  return { pk, unique, all, tables, globalUnique }
}

function lastWord(expr) {
  const parts = expr.split(/\s+/).filter(Boolean)
  return (parts[parts.length - 1] || '').replace(/^\w+\./, '').toLowerCase()
}

export function collectJsFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue
      collectJsFiles(p, out)
    } else if (entry.name.endsWith('.js')) {
      out.push(p)
    }
  }
  return out
}

function sqlLiterals(src) {
  const out = []
  const re = /(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g
  for (const m of src.matchAll(re)) {
    // Только связные SQL-выражения. Иначе литерал вроде /[<>"'`;\\]/ —
    // это regex, а не запрос, и склейка соседних литералов даст
    // «запрос» из несвязанных кусков.
    if (!/^\s*(--[^\n]*\n\s*)*(SELECT|WITH)\b/i.test(m[2])) continue
    if (!/\bSELECT\b/i.test(m[2])) continue
    out.push({ text: m[2], index: m.index })
  }
  return out
}

const SQL_KEYWORDS = new Set([
  'where', 'on', 'and', 'or', 'left', 'right', 'inner', 'outer', 'join', 'group', 'order',
  'limit', 'offset', 'having', 'set', 'using', 'cross', 'straight_join', 'union', 'select',
  'from', 'as', 'is', 'not', 'null', 'asc', 'desc', 'distinct', 'for', 'into', 'values',
])

/**
 * Затирает содержимое сбалансированных скобок пробелами, сохраняя длину.
 * Всё, что внутри `(...)` — другой scope: скалярный подзапрос
 * `(SELECT s.tier FROM subscriptions s ...)`, CTE, IN (SELECT ...).
 * Ему нельзя ни разъяснять неоднозначность `id` во внешнем запросе, ни
 * считать его таблицей, определяющей строку результата.
 */
function maskParens(sql) {
  let out = ''
  let depth = 0
  for (const ch of sql) {
    if (ch === '(') {
      depth++
      out += ' '
      continue
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1)
      out += ' '
      continue
    }
    out += depth > 0 ? ' ' : ch
  }
  return out
}

/**
 * Таблицы из FROM/JOIN вместе с алиасами: [[table, alias|null]].
 * Алиас бывает и без AS (`FROM user_photos p`), поэтому после имени таблицы
 * проверяем и следующий токен — если это не ключевое слово, это алиас.
 * Подзапросы отброшены, поэтому tables[0] — именно главная таблица запроса.
 */
function tablesOf(sql) {
  const out = []
  const re = /(?:^|\s)(?:FROM|JOIN)\s+`?([a-z_][a-z0-9_]*)`?(\s+([a-z_][a-z0-9_]*))?/gi
  for (const m of maskParens(sql).matchAll(re)) {
    const table = m[1]
    let alias = m[3] ? m[3].toLowerCase() : null
    if (alias && SQL_KEYWORDS.has(alias)) alias = null
    out.push([table, alias])
  }
  return out
}

function splitTopLevel(clause) {
  const parts = []
  let depth = 0
  let buf = ''
  for (const ch of clause) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      parts.push(buf.trim())
      buf = ''
      continue
    }
    buf += ch
  }
  if (buf.trim()) parts.push(buf.trim())
  return parts
}

/** Убирает интерполяции и направление, оставляя выражение столбца. */
function columnOf(term) {
  return term
    .replace(/\$\{[^}]*\}/g, ' ')
    .replace(/\b(ASC|DESC)\b/gi, ' ')
    .replace(/[()`"']/g, ' ')
    .trim()
}

function groupKeys(sql) {
  const m = /GROUP\s+BY\s+([\s\S]+?)(?=\bORDER\b|\bLIMIT\b|$)/i.exec(maskParens(sql))
  if (!m) return []
  return splitTopLevel(m[1]).map(s => columnOf(s).toLowerCase()).filter(Boolean)
}

/** Алиасы из списка SELECT: «DATE(created_at) as day» → { day: 'DATE(created_at)' } */
function selectAliases(sql) {
  const m = /SELECT\s+([\s\S]+?)\s+FROM\s/i.exec(sql)
  if (!m) return []
  const out = new Map()
  for (const part of splitTopLevel(m[1])) {
    const a = /\bAS\s+`?([a-z_][a-z0-9_]*)`?\s*$/i.exec(part)
    if (a) out.set(a[1].toLowerCase(), part.replace(/\bAS\s+`?[a-z_][a-z0-9_]*`?\s*$/i, '').trim())
  }
  return out
}

/**
 * Замыкатель обязан быть уникальным в пределах СТРОКИ РЕЗУЛЬТАТА, а не любой
 * присоединённой таблицы. `ORDER BY h.created_at DESC, up.id DESC` в запросе
 * `FROM hangouts h JOIN user_profiles up` формально замыкается на PK профиля,
 * но две строки hangouts одного пользователя дадут одинаковый `up.id` — то
 * есть ровно тот баг, ради которого гейт написан. Поэтому проверяем только
 * главную таблицу (первую в FROM), а префикс термина обязан указывать на неё.
 */
function isUniqueColumn(expr, scope, tables) {
  const idents = expr.split(/\s+/).filter(Boolean)
  const last = (idents[idents.length - 1] || '').replace(/^\w+\./, '').toLowerCase()
  if (!last) return false
  // FROM может быть собран интерполяцией (`${fromClause}`), тогда таблицы из
  // литерала не резолвятся. Откатываемся на имя столбца по всей схеме: сузить
  // проверку нечем, но и пропустить явный `up.id` тоже нельзя.
  if (!tables.length) return scope.globalUnique.has(last)
  const [mainTable, mainAlias] = tables[0]
  const cols = [...(scope.pk.get(mainTable) || []), ...(scope.unique.get(mainTable) || [])]
  if (!cols.includes(last)) return false
  const qualified = idents[0].includes('.')
  if (!qualified) return true
  if (!mainAlias) return false
  return idents[0].toLowerCase().startsWith(`${mainAlias}.`)
}

/**
 * Простая ссылка на столбец главной таблицы: `id` или `alias.id`.
 * Возвращает null для выражений (CASE, IFNULL, агрегат) — там гарантию
 * уникальности даёт не последнее слово, а сам факт вычисления.
 */
function columnRef(term, alias) {
  const expr = columnOf(term)
  if (!expr || /\s/.test(expr)) return null
  const qualified = /^(\w+)\.(\w+)$/.exec(expr)
  if (qualified) {
    if (alias && qualified[1].toLowerCase() === alias) return qualified[2].toLowerCase()
    return null
  }
  return /^\w+$/.test(expr) ? expr.toLowerCase() : null
}

/**
 * Покрывают ли последние термины ORDER BY уникальный ключ главной таблицы.
 * Составной PK одним столбцом не закрывается: `hangout_chats` имеет
 * (hangout_id, response_id), и `ORDER BY h.created_at DESC, h.id DESC` тут
 * не детерминирован — нужен хвост из обоих столбцов PK.
 */
function tiebreakCovers(terms, scope, tables) {
  const lastRaw = terms[terms.length - 1]
  const last = columnOf(lastRaw)
  if (!tables.length) return isUniqueColumn(last, scope, tables)
  const [mainTable, mainAlias] = tables[0]
  const pk = scope.pk.get(mainTable) || []
  if (pk.length !== 1) {
    if ((scope.unique.get(mainTable) || []).length) return isUniqueColumn(last, scope, tables)
    const covered = new Set()
    for (let i = terms.length - 1; i >= 0; i--) {
      const col = columnRef(terms[i], mainAlias)
      if (!col || !pk.includes(col)) break
      covered.add(col)
      if (covered.size === pk.length) return true
    }
    return false
  }
  return isUniqueColumn(last, scope, tables)
}

export function findOrderByIssues(schema, files) {
  const scope = parseUniqueIndex(schema)
  const issues = []
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8')
    for (const lit of sqlLiterals(src)) {
      const sql = lit.text
      const limitMatch = /\bLIMIT\s+(\?|:\w+|\d+)/i.exec(sql)
      if (!limitMatch) continue
      const orderMatch = /ORDER\s+BY\s+([\s\S]+?)(?=\bLIMIT\b|$)/i.exec(sql)
      if (!orderMatch) continue
      const terms = splitTopLevel(orderMatch[1])
      if (!terms.length) continue
      const last = terms[terms.length - 1]
      const expr = columnOf(last)
      const line = src.slice(0, lit.index).split('\n').length
      const rel = path.relative(ROOT, file).replace(/\\/g, '/')
      const base = { file: rel, line, orderBy: orderMatch[1].replace(/\s+/g, ' ').trim().slice(0, 120) }
      if (AGGREGATE.test(last)) continue
      const keys = groupKeys(sql)
      if (keys.length) {
        // В GROUP BY-запросе замыкатель не нужен и невозможен: строки тут нет,
        // есть группы. Алиас из SELECT (ORDER BY day / ORDER BY value) — это
        // ключ группы или агрегат по группам, а не идентичность строки.
        if (!expr.includes('.') && keys.includes(expr.toLowerCase())) continue
        if (!expr.includes('.') && selectAliases(sql).has(expr.toLowerCase())) continue
      }
      const tables = tablesOf(sql)
      if (expr && tiebreakCovers(terms, scope, tables)) {
        // Замыкатель есть, но без префикса он может быть неоднозначен: у
        // нескольких таблиц в FROM есть колонка `id`, и MySQL отдаст
        // ER_NON_UNIQ_ERROR — то есть 500 на живом запросе. Проверяем и это.
        if (!tables.length && !expr.includes('.')) {
          issues.push({
            ...base,
            reason: 'FROM собран интерполяцией — столбец без префикса нельзя проверить на неоднозначность',
          })
          continue
        }
        if (tables.length > 1 && !expr.includes('.')) {
          const owners = tables.filter(([t]) => (scope.all.get(t) || []).includes(lastWord(expr)))
          if (owners.length > 1) {
            issues.push({
              ...base,
              reason: `неоднозначный столбец «${lastWord(expr)}» — есть в ${owners.map(([t]) => t).join(', ')}`,
            })
            continue
          }
        }
        continue
      }
      issues.push({ ...base, reason: expr ? 'нет уникального замыкателя' : 'ORDER BY целиком динамический — замыкатель не виден' })
    }
  }
  return issues
}

function main() {
  const args = process.argv.slice(2)
  const asJson = args.includes('--json')
  const all = args.includes('--all')
  const schema = fs.readFileSync(SCHEMA, 'utf8')
  const issues = findOrderByIssues(schema, collectJsFiles(SRC))
  if (asJson) {
    console.log(JSON.stringify({ issues }, null, 2))
    return issues.length ? 1 : 0
  }
  if (!issues.length) {
    console.log('OK: каждый пагинируемый ORDER BY заканчивается уникальным столбцом')
    console.log('    (строки не «прыгают» между страницами, дубли и пропуски невозможны)')
    return 0
  }
  console.log(`ORDER BY без уникального замыкателя: ${issues.length}\n`)
  for (const i of issues.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
    console.log(`  ${i.file}:${i.line}  [${i.reason}]`)
    console.log(`      ORDER BY ${i.orderBy}`)
  }
  console.log('\nИтог: пагинация недетерминирована — строки могут дублироваться между страницами и пропадать.')
  console.log(all ? '' : 'Подсказка: --all покажет и безлимитные списки (там только «дёргание» порядка).')
  return 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main())
}
