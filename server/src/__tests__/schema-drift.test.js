import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  parseReferenceSchema,
  extractColumnRefs,
  extractSqlLiterals,
  readCodeRefs,
} from '../../../scripts/schema-drift-audit.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const SCHEMA_FILE = path.join(ROOT, 'database', 'mysql_schema.sql')
const MIGRATIONS_DIR = path.join(ROOT, 'database', 'migrations')

const reference = parseReferenceSchema(fs.readFileSync(SCHEMA_FILE, 'utf8'))

describe('schema-drift-audit: эталон разбирается корректно', () => {
  it('находит все CREATE TABLE и их колонки', () => {
    expect(reference.size).toBeGreaterThan(50)
    const userProfiles = reference.get('user_profiles')
    expect(userProfiles).toBeDefined()
    expect(userProfiles.has('id')).toBe(true)
    expect(userProfiles.has('display_name')).toBe(true)
    expect(userProfiles.has('deleted_at')).toBe(true)
  })

  it('не считает индексы и внешние ключи колонками', () => {
    const userPhotos = reference.get('user_photos')
    expect(userPhotos.has('id')).toBe(true)
    expect(userPhotos.has('moderation_status')).toBe(true)
    expect([...userPhotos].some((c) => /^idx_/.test(c))).toBe(false)
    expect([...userPhotos].some((c) => /^PRIMARY$/.test(c))).toBe(false)
  })
})

describe('schema-drift-audit: алиасы резолвятся внутри одного SQL', () => {
  it('один и тот же алиас в разных запросах не смешивает таблицы', () => {
    const src = [
      'SELECT m.id, m.user_id FROM messages m',
      'SELECT h.id, h.view_count FROM hangouts h',
    ].join(';')
    const { refs } = extractColumnRefs(src)
    expect([...refs.get('messages')].sort()).toEqual(['id', 'user_id'])
    expect([...refs.get('hangouts')].sort()).toEqual(['id', 'view_count'])
  })

  it('FROM без алиаса (WHERE) не становится алиасом', () => {
    const src = 'SELECT up.display_name FROM user_profiles up WHERE up.id = ?'
    const { refs } = extractColumnRefs(src)
    expect([...refs.get('user_profiles')].sort()).toEqual(['display_name', 'id'])
    expect(refs.has('WHERE')).toBe(false)
  })

  it('невалидный SQL без алиаса не роняет скан и не приписывает колонки', () => {
    const src = 'SELECT up.display_name FROM user_profiles WHERE up.id = ?'
    const { refs, tables } = extractColumnRefs(src)
    expect(refs.size).toBe(0)
    expect([...tables]).toEqual(['user_profiles'])
    expect(refs.has('WHERE')).toBe(false)
  })

  it('FROM без алиаса не добавляет колонки', () => {
    const src = 'SELECT display_name, age FROM user_profiles'
    const { refs } = extractColumnRefs(src)
    expect(refs.has('user_profiles')).toBe(false)
  })

  it('INSERT ... ON DUPLICATE KEY UPDATE не читается как имя таблицы', () => {
    const src = 'INSERT INTO prefs (user_id, prefs) VALUES (?, ?) ON DUPLICATE KEY UPDATE prefs = VALUES(prefs)'
    const { tables } = extractColumnRefs(src)
    expect([...tables]).toEqual(['prefs'])
  })

  it('фрагменты запроса собираются (AND / JOIN) и JS-код отбрасывается', () => {
    const src = [
      "const profile = { name: 'x' }",
      '`SELECT up.id FROM user_profiles up`',
      '` AND up.deleted_at IS NULL`',
    ].join('\n')
    const literals = extractSqlLiterals(src)
    expect(literals).toHaveLength(2)
    expect(literals[1].trim().startsWith('AND')).toBe(true)
  })
})

describe('schema-drift-audit: гейт код vs эталон схемы', () => {
  it('каждая колонка, которую читает код, есть в database/mysql_schema.sql', () => {
    const { perTable } = readCodeRefs()
    const missing = []
    for (const [table, cols] of perTable) {
      const known = reference.get(table)
      if (!known) {
        missing.push(`${table} (таблицы нет в эталоне)`)
        continue
      }
      for (const col of cols) {
        if (!known.has(col)) missing.push(`${table}.${col}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('код ссылается хотя бы на 20 таблиц (иначе скан молча ничего не нашёл)', () => {
    const { tables } = readCodeRefs()
    expect(tables.size).toBeGreaterThan(20)
  })
})

describe('миграции против кода (регрессия user_profiles.birth_date)', () => {
  it('birth_date есть в эталоне и в миграциях, иначе PUT /api/profile/:id даёт 500', () => {
    expect(reference.get('user_profiles').has('birth_date')).toBe(true)

    const migrations = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'))
      .join('\n')

    expect(migrations).toMatch(/ALTER TABLE\s+user_profiles\s+ADD COLUMN\s+`?birth_date`?/i)
  })

  it('новые миграции (049+) идемпотентны: IF NOT EXISTS или проверка information_schema', () => {
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'))
    for (const file of files) {
      if (Number(file.slice(0, 3)) < 49) continue
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
      const addsColumn = /ALTER TABLE[\s\S]*?ADD COLUMN/i.test(sql)
      const createsTable = /CREATE TABLE/i.test(sql)
      if (!addsColumn && !createsTable) continue
      expect(
        /IF NOT EXISTS/i.test(sql) || /information_schema/i.test(sql),
        `${file}: DDL без идемпотентности (повторный запуск упадёт)`,
      ).toBe(true)
    }
  })

  it('старые миграции (001-048) не идемпотентны — это известный долг, migrate.js их не перезапускает', () => {
    const file = '007_add_referral.sql'
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
    expect(sql).toMatch(/ALTER TABLE users ADD COLUMN referral_code/i)
    expect(/IF NOT EXISTS/i.test(sql)).toBe(false)
  })
})
