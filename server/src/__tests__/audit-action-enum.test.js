import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..', '..', '..')
const SERVER_SRC = path.join(ROOT, 'server', 'src')
const SCHEMA = path.join(ROOT, 'database', 'mysql_schema.sql')

function listJsFiles(dir, acc = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__') continue
    const full = path.join(dir, name)
    if (fs.statSync(full).isDirectory()) listJsFiles(full, acc)
    else if (name.endsWith('.js')) acc.push(full)
  }
  return acc
}

function auditActionEnum() {
  const sql = fs.readFileSync(SCHEMA, 'utf8')
  const table = /CREATE TABLE `audit_log` \(([\s\S]*?)\n\)/i.exec(sql)
  if (!table) throw new Error('audit_log не найден в mysql_schema.sql')
  const m = /`action`\s+enum\(([^)]*)\)/i.exec(table[1])
  if (!m) throw new Error('audit_log.action ENUM не найден')
  return m[1].split(',').map((v) => v.trim().replace(/^'|'$/g, ''))
}

function auditActionLiterals() {
  const found = []
  for (const file of listJsFiles(SERVER_SRC)) {
    const src = fs.readFileSync(file, 'utf8')
    const rel = path.relative(ROOT, file).replace(/\\/g, '/')
    for (const call of src.matchAll(/(?:auditLog|auditUpdate)\s*\(\s*\{([\s\S]*?)\}\s*\)/g)) {
      const action = /action:\s*'([^']+)'/.exec(call[1])
      if (action) found.push({ file: rel, action: action[1] })
    }
  }
  return found
}

describe('ENUM audit_log.action вмещает все значения, что пишет код', () => {
  const allowed = auditActionEnum()

  it('схема объявляет action с delete_bulk и impersonate', () => {
    expect(allowed).toContain('delete_bulk')
    expect(allowed).toContain('impersonate')
    expect(allowed).toContain('delete')
    expect(allowed).toContain('update')
  })

  it('сканер не пуст — иначе проверка зелёная по построению', () => {
    const found = auditActionLiterals()
    expect(found.length).toBeGreaterThanOrEqual(4)
    const values = new Set(found.map((f) => f.action))
    expect(values).toContain('delete_bulk')
    expect(values).toContain('impersonate')
  })

  it('каждый литерал action лежит внутри ENUM (иначе MySQL отклонит INSERT)', () => {
    const outside = auditActionLiterals().filter((f) => !allowed.includes(f.action))
    expect(outside, outside.map((o) => `${o.file}: action='${o.action}'`).join(', ')).toEqual([])
  })
})

function auditLogRecordIdNullable() {
  const sql = fs.readFileSync(SCHEMA, 'utf8')
  const table = /CREATE TABLE `audit_log` \(([\s\S]*?)\n\)/i.exec(sql)
  if (!table) throw new Error('audit_log не найден в mysql_schema.sql')
  const m = /`record_id`\s+int unsigned\s+(NOT NULL|DEFAULT NULL)/i.exec(table[1])
  if (!m) throw new Error('audit_log.record_id не найден')
  return m[1].toUpperCase() !== 'NOT NULL'
}

function auditNullRecordIdCallSites() {
  const found = []
  for (const file of listJsFiles(SERVER_SRC)) {
    const src = fs.readFileSync(file, 'utf8')
    const rel = path.relative(ROOT, file).replace(/\\/g, '/')
    const lines = src.split(/\r?\n/)
    lines.forEach((line, i) => {
      if (/recordId:\s*null/.test(line)) found.push({ file: rel, line: i + 1 })
    })
  }
  return found
}

// Питфолл 98 закрыл ENUM-часть отказа на пути массового удаления
// ('delete_bulk' был вне ENUM -> 1265). Вторая причина отказа на ТОМ ЖЕ пути
// (record_id NOT NULL + recordId: null -> 1048, аудит молча терялся) осталась:
// её не видит ни ENUM-тест, ни мок БД — только сверка кода со схемой.
describe('audit_log.record_id вмещает NULL, если код так пишет', () => {
  it('сканер находит хотя бы один `recordId: null` — иначе проверка зелёная по построению', () => {
    const sites = auditNullRecordIdCallSites()
    expect(sites.length, 'ни одного recordId: null в коде — проверка бессмысленна').toBeGreaterThanOrEqual(1)
  })

  it('`recordId: null` в коде требует NULL-допустимой колонки', () => {
    const sites = auditNullRecordIdCallSites()
    const nullable = auditLogRecordIdNullable()
    expect(
      nullable,
      `код пишет recordId: null (${sites.map((s) => `${s.file}:${s.line}`).join(', ')}), а audit_log.record_id объявлен NOT NULL — в strict-режиме MySQL INSERT упадёт с 1048, auditLog проглотит ошибку`,
    ).toBe(true)
  })
})

describe('soft-delete: удалить можно, вернуть — нет', () => {
  it('production-код пишет deleted_at = NOW(), а не сбрасывает в NULL', () => {
    const writers = []
    const resets = []
    for (const file of listJsFiles(SERVER_SRC)) {
      const src = fs.readFileSync(file, 'utf8')
      const rel = path.relative(ROOT, file).replace(/\\/g, '/')
      if (/SET\s+deleted_at\s*=\s*NOW\(\)/i.test(src)) writers.push(rel)
      if (/deleted_at\s*=\s*NULL/i.test(src)) resets.push(rel)
    }
    expect(writers.length, 'ни одного soft-delete в коде — проверка бессмысленна').toBeGreaterThanOrEqual(1)
    expect(resets, `восстановление (deleted_at = NULL) в ${resets.join(', ')}`).toEqual([])
  })
})
