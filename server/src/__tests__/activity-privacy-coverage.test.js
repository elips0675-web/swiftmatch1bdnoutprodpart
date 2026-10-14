import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const routesDir = path.resolve(here, '../routes')

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return entry.name.endsWith('.js') ? [full] : []
  })
}

const allFiles = walk(routesDir)
const adminFiles = allFiles.filter((file) => path.relative(routesDir, file).startsWith(`admin${path.sep}`))
const publicFiles = allFiles.filter((file) => !adminFiles.includes(file))

function templateLiterals(src) {
  const out = []
  const re = /`([^`]*)`/g
  let match
  while ((match = re.exec(src)) !== null) out.push(match[1])
  return out
}

describe('гейт приватности активности: чтение без маскировки не проходит', () => {
  it('набор файлов не пустой (гейт не может быть зелёным «по построению»)', () => {
    expect(publicFiles.length).toBeGreaterThan(0)
    expect(adminFiles.length).toBeGreaterThan(0)
    const withPresence = publicFiles.filter((file) => /\bup\.online\b/.test(fs.readFileSync(file, 'utf8')))
    expect(withPresence.map((file) => path.relative(routesDir, file)).sort()).toEqual([
      'hangouts.js',
      'profile.js',
      'social.js',
    ])
  })

  it('каждый SQL с up.online содержит up.show_online в том же шаблоне', () => {
    const offenders = []
    const checked = []
    for (const file of publicFiles) {
      const src = fs.readFileSync(file, 'utf8')
      for (const body of templateLiterals(src)) {
        if (!/\bup\.online\b/.test(body)) continue
        checked.push(path.relative(routesDir, file))
        if (!/\bup\.show_online\b/.test(body)) {
          offenders.push(`${path.relative(routesDir, file)}: ${body.trim().replace(/\s+/g, ' ').slice(0, 100)}`)
        }
      }
    }
    expect(checked.length).toBeGreaterThanOrEqual(4)
    expect(offenders).toEqual([])
  })

  it('файлы, читающие up.show_online, обязаны импортировать и вызывать applyActivityPrivacy', () => {
    const offenders = []
    for (const file of publicFiles) {
      const src = fs.readFileSync(file, 'utf8')
      if (!/\bup\.show_online\b/.test(src)) continue
      if (!src.includes("from '../presence.js'")) offenders.push(`${path.relative(routesDir, file)}: нет импорта presence.js`)
      if (!src.includes('applyActivityPrivacy(')) offenders.push(`${path.relative(routesDir, file)}: нет вызова applyActivityPrivacy`)
    }
    expect(offenders).toEqual([])
  })

  it('модуль presence.js экспортирует маскировку и учёт сокетов', () => {
    const src = fs.readFileSync(path.resolve(here, '../presence.js'), 'utf8')
    for (const name of ['applyActivityPrivacy', 'registerSocket', 'unregisterSocket', 'markOnline', 'markOffline', 'touchLastSeen', 'resetPresence']) {
      expect(new RegExp(`export (async )?function ${name}\\b`).test(src)).toBe(true)
    }
  })
})
