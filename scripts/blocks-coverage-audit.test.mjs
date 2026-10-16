#!/usr/bin/env node
/**
 * Тесты гейта блок-покрытия (`npm run check:blocks-coverage`).
 *
 * Проверяет: выборка профиля/фото по id обязана быть либо под блок-предикатом
 * (`notBlocked`/`blockFilter`), либо помечена `@public: <причина>` в SQL, либо
 * внесена в `JUSTIFIED` с причиной и якорем `expect`. Якорь предотвращает
 * «протухание» оправдания при сдвиге строки (идиом n-plus-one-аудита).
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  sqlLiterals,
  aliasTables,
  candidates,
  justifiedFor,
  collectDrift,
  audit,
  report,
  JUSTIFIED,
} from './blocks-coverage-audit.mjs'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'blocks-'))
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

describe('sqlLiterals', () => {
  it('находит SQL в бэктиках', () => {
    const src = "const sql = `SELECT * FROM user_profiles WHERE id = ?`"
    expect(sqlLiterals(src)).toHaveLength(1)
  })

  it('находит SQL в одинарных кавычках', () => {
    const src = "const sql = 'SELECT * FROM user_profiles WHERE id = ?'"
    expect(sqlLiterals(src)).toHaveLength(1)
  })

  it('не цепляет не-SQL строки', () => {
    const src = "const s = 'hello world'; const n = 5"
    expect(sqlLiterals(src)).toHaveLength(0)
  })
})

describe('aliasTables', () => {
  it('мапит алиасы для FROM и JOIN', () => {
    const m = aliasTables('SELECT * FROM user_profiles up JOIN users u ON up.id = u.id')
    expect(m.get('up')).toBe('user_profiles')
    expect(m.get('u')).toBe('users')
  })

  it('игнорирует ключевые слова как алиасы', () => {
    const m = aliasTables('FROM user_profiles WHERE id = ?')
    expect(m.has('where')).toBeFalsy()
  })
})

describe('candidates — определение претендентов', () => {
  it('флагирует user_profiles по up.id = ?', () => {
    const dir = tmp()
    const body = "const sql = `SELECT up.display_name FROM user_profiles up WHERE up.id = ?`"
    write(dir, 'routes/h.js', body)
    const c = candidates(dir)
    expect(c.length).toBeGreaterThan(0)
    expect(c[0].table).toBe('user_profiles')
  })

  it('флагирует одинарными кавычками', () => {
    const dir = tmp()
    const body = "const sql = 'SELECT display_name FROM user_profiles WHERE id = ?'"
    write(dir, 'routes/h.js', body)
    const c = candidates(dir)
    expect(c.length).toBe(1)
  })

  it('НЕ флагирует u.id (алиас users) при наличии user_profiles в JOIN', () => {
    const dir = tmp()
    const body = "const sql = `SELECT u.id FROM users u JOIN user_profiles up ON u.id = up.id WHERE u.id = ?`"
    write(dir, 'routes/admin.js', body)
    const c = candidates(dir)
    expect(c.length).toBe(0)
  })

  it('НЕ флагирует SELECT без фильтра по id', () => {
    const dir = tmp()
    const body = "const sql = `SELECT * FROM user_profiles`"
    write(dir, 'routes/x.js', body)
    const c = candidates(dir)
    expect(c.length).toBe(0)
  })

  it('флагирует user_photos по user_id = ?', () => {
    const dir = tmp()
    const body = "const sql = 'SELECT id,url FROM user_photos WHERE user_id = ?'"
    write(dir, 'routes/up.js', body)
    const c = candidates(dir)
    expect(c.length).toBe(1)
    expect(c[0].table).toBe('user_photos')
  })

  it('НЕ флагирует user_photos по id = ? (photo id) — не цель гейта', () => {
    const dir = tmp()
    const body = "const sql = 'SELECT * FROM user_photos WHERE id = ?'"
    write(dir, 'routes/up.js', body)
    const c = candidates(dir)
    expect(c.length).toBe(0)
  })

  it('не сканирует __tests__', () => {
    const dir = tmp()
    write(dir, '__tests__/t.js', "const sql = 'SELECT display_name FROM user_profiles WHERE id = ?'")
    const c = candidates(dir)
    expect(c.length).toBe(0)
  })
})

describe('exemptions', () => {
  it('блок-предикат → не кандидат в unexpected', () => {
    const dir = tmp()
    const body = "const sql = `SELECT up.name FROM user_profiles up WHERE up.id = ? AND ${notBlocked('up', req.userId).sql}`"
    write(dir, 'routes/h.js', body)
    const { unexpected, withPredicate } = audit(dir, [])
    expect(unexpected.some(u => u.rel.endsWith('h.js'))).toBe(false)
    expect(withPredicate).toBeGreaterThan(0)
  })

  it('@public: <причина длинная> → annotated, не unexpected', () => {
    const dir = tmp()
    const body = "const sql = 'SELECT display_name FROM user_profiles WHERE id = ? /* @public: свой профиль */'"
    write(dir, 'routes/p.js', body)
    const { unexpected, annotated } = audit(dir, [])
    expect(unexpected.length).toBe(0)
    expect(annotated.length).toBe(1)
  })

  it('@public без причины → unexpected', () => {
    const dir = tmp()
    const body = "const sql = 'SELECT display_name FROM user_profiles WHERE id = ? /* @public: ok */'"
    write(dir, 'routes/p.js', body)
    const { unexpected } = audit(dir, [])
    expect(unexpected.length).toBe(1)
  })
})

describe('JUSTIFIED', () => {
  it('каждое оправдание имеет причину длиной > 10', () => {
    for (const j of JUSTIFIED) {
      expect(typeof j.reason).toBe('string')
      expect(j.reason.trim().length).toBeGreaterThan(10)
    }
  })

  it('оправдание с lines имеет непустой expect (анти-рот)', () => {
    for (const j of JUSTIFIED) {
      if (j.lines) {
        expect(typeof j.expect).toBe('string')
        expect(j.expect.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('justifiedFor работает по паре файл+строка', () => {
    const dir = tmp()
    write(dir, 'routes/h.js', ['a','b','c'].join('\n')) // lines 1-3
    expect(justifiedFor('routes/h.js', 5, [{ file: 'routes/h.js', lines: [5], expect: 'c', reason: 'r'.repeat(12) }])).toBeTruthy()
    expect(justifiedFor('routes/other.js', 5, [{ file: 'routes/h.js', lines: [5], expect: 'c', reason: 'r'.repeat(12) }])).toBeFalsy()
  })
})

describe('drift', () => {
  it('collectDrift на живом server/src → пусто (без оправданий)', () => {
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    const SRC = path.join(ROOT, 'server', 'src')
    expect(collectDrift(SRC, [])).toEqual([])
  })

  it('неверный якорь → drift', () => {
    const dir = tmp()
    write(dir, 'routes/x.js', 'SELECT display_name FROM user_profiles WHERE id = ?')
    const drift = collectDrift(dir, [{ file: 'routes/x.js', lines: [1], expect: 'WTF', reason: 'r'.repeat(12) }])
    expect(drift.length).toBe(1)
  })

  it('файл не найден → drift', () => {
    const dir = tmp()
    const drift = collectDrift(dir, [{ file: 'routes/nope.js', lines: [10], expect: 'x', reason: 'r'.repeat(12) }])
    expect(drift.length).toBe(1)
    expect(drift[0].reason).toContain('не найден')
  })
})

describe('audit/report на фикстурах', () => {
  it('новая выборка без защиты → unexpected', () => {
    const dir = tmp()
    const body = "const sql = 'SELECT display_name FROM user_profiles WHERE id = ?'"
    write(dir, 'routes/bad.js', body)
    const line = lineOf(body, 'SELECT')
    const { unexpected } = audit(dir, [])
    expect(unexpected.length).toBe(1)
    expect(unexpected[0].rel.endsWith('routes/bad.js')).toBe(true)
    expect(unexpected[0].line).toBe(line)
  })

  it('то же место в JUSTIFIED → уходит из unexpected', () => {
    const dir = tmp()
    const body = "const sql = 'SELECT display_name FROM user_profiles WHERE id = ?'"
    write(dir, 'routes/bad.js', body)
    const line = lineOf(body, 'SELECT')
    const list = [{ file: 'routes/bad.js', lines: [line], expect: 'display_name', reason: 'r'.repeat(12) }]
    const { unexpected, justified } = audit(dir, list)
    expect(unexpected.length).toBe(0)
    expect(justified).toBe(1)
  })

  it('report 0 на чистом', () => {
    const code = report({ unexpected:[], annotated:[], justified:0, withPredicate:1, drift:[] }, () => {})
    expect(code).toBe(0)
  })

  it('report 1 на unexpected и 1 на drift', () => {
    const code1 = report({ unexpected:[{rel:'r',line:1,table:'t',why:'x'}], annotated:[], justified:0, withPredicate:0, drift:[] }, () => {})
    expect(code1).toBe(1)
    const code2 = report({ unexpected:[], annotated:[], justified:0, withPredicate:0, drift:[{file:'f',line:1,reason:'x'}] }, () => {})
    expect(code2).toBe(1)
  })
})

describe('текущий server/src — чист', () => {
  it('audit чист: нет unexpected и нет drift; есть withPredicate или justified', () => {
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    const SRC = path.join(ROOT, 'server', 'src')
    const { unexpected, drift, withPredicate, justified } = audit(SRC)
    expect(unexpected).toEqual([])
    expect(drift).toEqual([])
    expect(withPredicate + justified).toBeGreaterThan(0) // защита от пустого прохода
  })
})
