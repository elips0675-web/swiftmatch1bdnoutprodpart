#!/usr/bin/env node
/**
 * Тесты гейта query-параметров (`npm run check:query-param`).
 *
 * Защищает от случая, когда фронт шлёт `?premium=1`, бэкенд читает
 * `req.query.premium` и нигде не использует — фильтр молча не работает
 * (питфолл «мёртвый query-параметр»).
 *
 * Правило консервативное: параметр жив, если его имя встречается в файле >=2 раз,
 * либо связанная локальная переменная используется. Границы явно описаны в шапке
 * скрипта. Тесты ниже фиксируют как позитивные, так и негативные случаи.
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { countWord, scan, audit, report, justifiedFor, collectDrift } from './query-param-audit.mjs'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qp-'))
const write = (dir, rel, body) => {
  const full = path.join(dir, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, body, 'utf8')
  return full
}
const lineOf = (body, needle) => {
  const lines = body.split('\n')
  const i = lines.findIndex(l => l.includes(needle))
  expect(i, `в фикстуре нет строки «${needle}»`).toBeGreaterThan(-1)
  return i + 1
}

describe('countWord', () => {
  it('считает точные вхождения по границам слов', () => {
    expect(countWord('const days = 1; if (days>0) return days', 'days')).toBe(3)
    expect(countWord('premium', 'prem')).toBe(0)
    expect(countWord('req.query.period', 'period')).toBe(1)
  })
})

describe('scan — прямое чтение req.query.X', () => {
  it('параметр прочитан один раз и не используется → находка', () => {
    const dir = tmp()
    const body = "const premium = req.query.premium\nres.json({ ok: true })"
    write(dir, 'routes/x.js', body)
    const { findings, reads } = scan(dir)
    expect(reads).toBe(1)
    expect(findings).toHaveLength(1)
    expect(findings[0].name).toBe('premium')
    expect(findings[0].line).toBe(lineOf(body, 'req.query.premium'))
  })

  it('параметр прочитан и используется ещё раз → жив', () => {
    const dir = tmp()
    const body = "const p = req.query.premium\nif (p) return res.json({ premium: p })"
    write(dir, 'routes/x.js', body)
    const { findings } = scan(dir)
    expect(findings).toHaveLength(0)
  })

  it('значение связано с локальной переменной, переменная используется → жив (dashboard.js:89)', () => {
    const dir = tmp()
    const body = [
      "const days = Math.min(Math.max(Number(req.query.period) || 7, 1), 90)",
      "const start = new Date(Date.now() - days*86400000)",
      "res.json({ days, start })"
    ].join('\n')
    write(dir, 'routes/dash.js', body)
    const { findings } = scan(dir)
    expect(findings).toHaveLength(0)
  })
})

describe('scan — деструктуризация req.query', () => {
  it('деструктурированный параметр нигде не используется → находка', () => {
    const dir = tmp()
    const body = "const { gender, age_min } = req.query\nres.json({ ok: true })"
    write(dir, 'routes/x.js', body)
    const { findings } = scan(dir)
    expect(findings.some(f => f.name === 'gender')).toBe(true)
    expect(findings.some(f => f.name === 'age_min')).toBe(true)
  })

  it('деструктурированный параметр используется → жив', () => {
    const dir = tmp()
    const body = "const { gender } = req.query\nconst q = `gender=${gender}`\nres.json({ q })"
    write(dir, 'routes/x.js', body)
    const { findings } = scan(dir)
    expect(findings).toHaveLength(0)
  })
})

describe('scan — @ignored', () => {
  it('строка с @ignored: причина (длинная) — исключает находку', () => {
    const dir = tmp()
    const body = "const p = req.query.premium // @ignored: временный параметр совместимости\nres.json({})"
    write(dir, 'routes/x.js', body)
    const { findings, ignored } = scan(dir)
    expect(findings).toHaveLength(0)
    expect(ignored).toHaveLength(1)
    expect(ignored[0].name).toBe('premium')
  })

  it('@ignored без причины (короткая) не исключает', () => {
    const dir = tmp()
    const body = "const p = req.query.premium // @ignored: ok\nres.json({})" // <4? reason after @ignored: is 'ok' (length 2) — marker requires >=4
    write(dir, 'routes/x.js', body)
    const { findings, ignored } = scan(dir)
    // reason 'ok' length 2 < 4 → falls through to dead check
    expect(ignored).toHaveLength(0)
    expect(findings).toHaveLength(1)
  })
})

describe('audit/report на фикстурах', () => {
  it('мёртвый параметр → unexpected', () => {
    const dir = tmp()
    write(dir, 'routes/bad.js', "const x = req.query.dead\nres.end()")
    const { unexpected } = audit(dir, [])
    expect(unexpected).toHaveLength(1)
    expect(unexpected[0].rel.endsWith('routes/bad.js')).toBe(true)
    expect(unexpected[0].name).toBe('dead')
  })

  it('unexpected + report → exit code 1', () => {
    const lines = []
    const code = report({ unexpected: [{ rel: 'routes/x.js', line: 1, name: 'x' }], ignored: [], drift: [] }, l => lines.push(l))
    expect(code).toBe(1)
    expect(lines.join('\n')).toContain('routes/x.js:1')
  })

  it('clean → exit code 0', () => {
    const code = report({ unexpected: [], ignored: [], drift: [] }, () => {})
    expect(code).toBe(0)
  })
})

describe('justifiedFor/collectDrift', () => {
  it('justifiedFor пустого списка → false', () => {
    expect(justifiedFor('routes/x.js', 1, [])).toBeFalsy()
  })

  it('collectDrift с неверным якорем → drift', () => {
    const dir = tmp()
    write(dir, 'routes/x.js', 'const a = 1')
    const drift = collectDrift(dir, [{ file: 'routes/x.js', lines: [1], expect: 'NOPE', reason: 'test' }])
    expect(drift).toHaveLength(1)
  })

  it('collectDrift с файлом, которого нет → drift', () => {
    const dir = tmp()
    const drift = collectDrift(dir, [{ file: 'routes/gone.js', lines: [1], expect: 'x', reason: 'test' }])
    expect(drift).toHaveLength(1)
    expect(drift[0].reason).toContain('не найден')
  })
})

describe('текущий server/src — чист', () => {
  it('audit не находит мёртвых параметров и протухших оправданий', () => {
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    const SRC = path.join(ROOT, 'server', 'src')
    const { unexpected, drift, reads } = audit(SRC)
    expect(unexpected).toEqual([])
    expect(drift).toEqual([])
    expect(reads).toBeGreaterThan(0) // обход видит чтения
  })
})
