#!/usr/bin/env node
/**
 * Тесты гейта дрейфа схемы (`node scripts/schema-drift-audit.mjs [--offline]`).
 *
 * Гейт ловит колонку, которую код читает/пишет, но которой нет ни в
 * database/mysql_schema.sql, ни в живой БД (такое расхождение = живой 500).
 * Тесты фиксируют слепые пятна п.13 «Что доделать»:
 *   (а) SQL не в бэктик-литералах (одинарные/двойные кавычки);
 *   (б) неквалифицированные колонки (WHERE колонка = ? при единственной таблице)
 * и фильтры ложных срабатываний: AS-алиасы, производные таблицы,
 * INSERT ... SELECT ... ON DUPLICATE KEY UPDATE, датные единицы INTERVAL ? DAY.
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  SQL_KEYWORDS,
  parseReferenceSchema,
  extractSqlLiterals,
  extractColumnRefs,
  readCodeRefs,
} from './schema-drift-audit.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCHEMA_FILE = path.join(ROOT, 'database', 'mysql_schema.sql')
const IAP_ROUTE = path.join(ROOT, 'server', 'src', 'routes', 'iap.js')

const cols = (refs, table) => refs.get(table) ?? new Set()

describe('extractSqlLiterals — (а) кавычки', () => {
  it('находит SQL в бэктиках', () => {
    expect(extractSqlLiterals('const q = `SELECT id FROM users WHERE id = ?`')).toHaveLength(1)
  })

  it('находит SQL в одинарных кавычках', () => {
    expect(extractSqlLiterals("const q = 'SELECT id FROM users WHERE id = ?'")).toHaveLength(1)
  })

  it('находит SQL в двойных кавычках (стиль iap.js:144)', () => {
    const lit = 'await pool.query("SELECT tier, status FROM subscriptions WHERE user_id = ?")'
    expect(extractSqlLiterals(lit)).toHaveLength(1)
  })

  it('не цепляет не-SQL строки', () => {
    expect(extractSqlLiterals("const provider = 'revenuecat'")).toHaveLength(0)
  })

  it('цепляет SQL-фрагмент в бэктиках (склейка шаблонной строки)', () => {
    expect(extractSqlLiterals('const q = `SELECT id FROM users` + `AND deleted = 0`')).toHaveLength(2)
  })

  it('вложенный литерал строки внутри SQL не даёт второго кандидата', () => {
    const src = "await pool.query(\"SELECT id FROM subscriptions WHERE provider = 'revenuecat'\")"
    expect(extractSqlLiterals(src)).toHaveLength(1)
  })
})

describe('extractColumnRefs — (б) неквалифицированные колонки', () => {
  it('квалифицированные алиасы маппятся в таблицы', () => {
    const { refs } = extractColumnRefs('SELECT up.display_name FROM user_profiles up WHERE up.id = ?')
    expect(cols(refs, 'user_profiles')).toEqual(new Set(['display_name', 'id']))
  })

  it('колонки INSERT-списка относятся к целевой таблице', () => {
    const { refs } = extractColumnRefs('INSERT INTO user_photos (user_id, url) VALUES (?, ?)')
    expect(cols(refs, 'user_photos')).toEqual(new Set(['user_id', 'url']))
  })

  it('колонка UPDATE ... SET относится к целевой таблице', () => {
    const { refs } = extractColumnRefs('UPDATE users SET bio = ? WHERE id = ?')
    expect(cols(refs, 'users').has('bio')).toBe(true)
  })

  it('неквалифицированная колонки в WHERE при единственной таблице в FROM', () => {
    const { refs } = extractColumnRefs('SELECT * FROM purchases WHERE product_id = ? AND state = ?')
    expect(cols(refs, 'purchases')).toEqual(new Set(['product_id', 'state']))
  })

  it('пример п.13: двойные кавычки без бэктитов дают полный набор колонок', () => {
    const sql = "SELECT tier, status, current_period_end FROM subscriptions WHERE user_id = ? AND provider = 'revenuecat' ORDER BY started_at DESC, id DESC LIMIT 1"
    const { refs } = extractColumnRefs(sql)
    expect(cols(refs, 'subscriptions')).toEqual(new Set([
      'tier', 'status', 'current_period_end', 'user_id', 'provider', 'started_at', 'id',
    ]))
  })

  it('реальный server/src/routes/iap.js: SQL в двойных кавычках попадает в refs', () => {
    const src = fs.readFileSync(IAP_ROUTE, 'utf8')
    const sub = extractSqlLiterals(src).find((l) => /FROM\s+subscriptions\b/i.test(l))
    expect(sub, 'в iap.js нет SQL-литерала по subscriptions').toBeTruthy()
    const { refs } = extractColumnRefs(sub)
    expect([...cols(refs, 'subscriptions')]).toContain('current_period_end')
  })

  it('детект не умер: голая колонка в SELECT-списке ловится', () => {
    const { refs } = extractColumnRefs('SELECT secret_col FROM users')
    expect(cols(refs, 'users').has('secret_col')).toBe(true)
  })

  it('детект не умер: квалифицированная колонка в WHERE ловится', () => {
    const { refs } = extractColumnRefs('SELECT u.id FROM users u WHERE u.missing_col = 1')
    expect(cols(refs, 'users').has('missing_col')).toBe(true)
  })
})

describe('фильтры ложных срабатываний', () => {
  it('AS-алиас day (DATE(...) as day, ORDER BY day) не считается колонкой (admin/analytics.js)', () => {
    const sql = 'SELECT DATE(created_at) as day, COUNT(*) as users FROM users WHERE created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY) GROUP BY DATE(created_at) ORDER BY day'
    const { refs } = extractColumnRefs(sql)
    expect(cols(refs, 'users').has('day')).toBe(false)
    expect(cols(refs, 'users').has('created_at')).toBe(true)
  })

  it('AS-алиас month (DATE_FORMAT(...) as month, ORDER BY month) не считается колонкой (admin/dashboard.js)', () => {
    const sql = "SELECT DATE_FORMAT(started_at, '%Y-%m') as month, SUM(price) as revenue FROM subscriptions WHERE is_active = 1 GROUP BY DATE_FORMAT(started_at, '%Y-%m') ORDER BY month LIMIT 12"
    const { refs } = extractColumnRefs(sql)
    expect(cols(refs, 'subscriptions').has('month')).toBe(false)
    expect(cols(refs, 'subscriptions').has('is_active')).toBe(true)
  })

  it('датная единица INTERVAL ? DAY не считается колонкой', () => {
    const { refs } = extractColumnRefs('SELECT id FROM users WHERE created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)')
    expect(cols(refs, 'users').has('day')).toBe(false)
    expect(cols(refs, 'users').has('created_at')).toBe(true)
  })

  it('ключевое слово не может стать колонкой (день/месяц/дубликат)', () => {
    for (const w of ['day', 'month', 'duplicate', 'interval']) {
      expect(SQL_KEYWORDS.has(w), `${w} должен быть в SQL_KEYWORDS`).toBe(true)
    }
  })

  it('производная таблица (FROM (...) t) и AS rn не попадают в refs (social.js)', () => {
    const sql = 'SELECT t.id, ROW_NUMBER() OVER (PARTITION BY gpc.post_id ORDER BY gpc.created_at ASC) AS rn FROM (SELECT gpc.id, gpc.post_id, gpc.created_at FROM group_post_comments gpc) t WHERE t.rn <= 20'
    const { refs, tables } = extractColumnRefs(sql)
    expect(refs.has('t')).toBe(false)
    expect(tables.has('t')).toBe(false)
    expect(cols(refs, 'group_post_comments').has('post_id')).toBe(true)
  })

  it('INSERT ... SELECT ... ON DUPLICATE KEY UPDATE не приписывает колонку таблице из FROM (social.js)', () => {
    const sql = 'INSERT INTO chat_participants (chat_id, user_id) SELECT ?, gm.user_id FROM group_members gm WHERE gm.group_id = ? ON DUPLICATE KEY UPDATE chat_id = chat_id'
    const { refs } = extractColumnRefs(sql)
    expect(cols(refs, 'group_members').has('chat_id')).toBe(false)
    expect(cols(refs, 'chat_participants').has('chat_id')).toBe(true)
    expect(cols(refs, 'group_members').has('group_id')).toBe(true)
  })
})

describe('parseReferenceSchema', () => {
  it('парсит таблицу и её колонки, игнорируя ключи', () => {
    const src = [
      'CREATE TABLE `users` (',
      '  `id` INT NOT NULL AUTO_INCREMENT,',
      '  `email` VARCHAR(255) NOT NULL,',
      '  PRIMARY KEY (`id`),',
      '  KEY `idx_email` (`email`)',
      ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;',
    ].join('\n')
    expect(parseReferenceSchema(src).get('users')).toEqual(new Set(['id', 'email']))
  })
})

describe('живой server/src против mysql_schema.sql', () => {
  it('каждая таблица и колонка из кода есть в схеме (офлайн-инвариант гейта)', () => {
    const reference = parseReferenceSchema(fs.readFileSync(SCHEMA_FILE, 'utf8'))
    const { perTable, tables } = readCodeRefs()
    expect(perTable.size).toBeGreaterThan(10)
    const known = (t) => reference.has(t) || SQL_KEYWORDS.has(t)
    for (const t of tables) {
      expect(known(t), `таблица ${t} из кода нет в mysql_schema.sql`).toBe(true)
    }
    for (const [table, colSet] of perTable) {
      expect(known(table), `таблица ${table} из кода нет в mysql_schema.sql`).toBe(true)
      for (const c of colSet) {
        expect(reference.get(table).has(c), `${table}.${c} из кода нет в mysql_schema.sql`).toBe(true)
      }
    }
  })
})
