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
