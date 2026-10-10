import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { collectConsoleNotes, CONSOLE_LOG_EXEMPT_FILES } from './check-ports.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let fixture

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-ports-'))
  fs.mkdirSync(path.join(dir, 'server/src/routes'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'server/src/seed.js'), "console.log('seed progress')\n")
  fs.writeFileSync(path.join(dir, 'server/src/routes/x.js'), "console.log('debug')\n")
  return dir
}

afterEach(() => {
  if (fixture) fs.rmSync(fixture, { recursive: true, force: true })
  fixture = null
})

describe('check:ports: console.log в server/src (L7 — решение по seed.js)', () => {
  it('логи сида не считаются отладочным мусором: console.log в seed.js исключён', () => {
    fixture = makeFixture()
    const { notes } = collectConsoleNotes(fixture)
    expect(notes.some((n) => n.includes('seed.js'))).toBe(false)
  })

  it('новый console.log в обычном файле по-прежнему ловится', () => {
    fixture = makeFixture()
    const { notes } = collectConsoleNotes(fixture)
    expect(notes.some((n) => n.includes('routes/x.js:1'))).toBe(true)
  })

  it('исключение узкое: ровно server/src/seed.js и ничего больше', () => {
    expect([...CONSOLE_LOG_EXEMPT_FILES]).toEqual(['server/src/seed.js'])
  })

  it('число пропущенных строк отдаётся, чтобы гейт не молчал про решение', () => {
    fixture = makeFixture()
    const { skipped } = collectConsoleNotes(fixture)
    expect(skipped).toBe(1)
  })

  it('в реальном репозитории seed.js не светится в [WARN]', () => {
    const seed = fs.readFileSync(path.join(REPO_ROOT, 'server/src/seed.js'), 'utf8')
    expect(seed).toContain('console.log')
    const { notes } = collectConsoleNotes(REPO_ROOT)
    expect(notes.some((n) => n.includes('seed.js'))).toBe(false)
  })
})