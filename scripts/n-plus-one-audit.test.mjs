/**
 * Тесты гейта N+1 (`npm run check:n-plus-one`).
 *
 * Зачем гейт: `scripts/n-plus-one-audit.mjs` был написан, но не был вызван ни
 * из `package.json`, ни из CI — скрипт, который никто не запускает, не защищает
 * ничего. К моменту подключения он уже был красным: 3 новых места с SQL внутри
 * цикла, одно из них (`hangouts.js`, рассылка уведомлений об отмене встречи)
 * держало два запроса на каждого участника и глотало ошибки пустым `catch {}`,
 * то есть уведомление могло пропасть молча.
 *
 * Гейт защищает от двух разных бедов, и тесты ниже фиксируют оба:
 *   1. SQL внутри цикла (`analyze`) — приоритетно самый глубокий цикл;
 *   2. протухшее оправдание `JUSTIFIED` (`collectJustificationDrift`) — список
 *      оправданий держит номера строк, а код сдвигается. Без якоря `expect`
 *      оправдание молча перестаёт работать: гейт начинает ругаться на «новый
 *      N+1» в давно намеренном месте (так отвалились `profile.js:463` и
 *      `hangouts.js:633,638`), а человек вместо проверки просто дописывает
 *      новые номера строк — и защита от N+1 тихо перестаёт существовать.
 *
 * Фикстуры намеренно содержат тот же текст, который ищет гейт, и тест
 * проверяет номер найденной строки по содержимому фикстуры, а не по
 * захардкоженному числу: иначе тест проходил бы и на сломанном `analyze`.
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  JUSTIFIED,
  analyze,
  audit,
  collectFiles,
  collectJustificationDrift,
  justifiedFor,
  report,
  stripNonCode,
} from './n-plus-one-audit.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'server', 'src')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nplus-'))
const write = (dir, rel, body) => {
  const full = path.join(dir, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, body, 'utf8')
  return full
}
const lineOf = (body, needle) => {
  const i = body.split('\n').findIndex(l => l.includes(needle))
  expect(i, `в фикстуре нет строки «${needle}»`).toBeGreaterThan(-1)
  return i + 1
}
const findingsOf = (body) => {
  const dir = tmp()
  const file = write(dir, 'routes/x.js', body)
  return analyze(file).findings
}

describe('stripNonCode — не считать SQL в строках и комментариях', () => {
  it('выжигает содержимое строк', () => {
    expect(stripNonCode("const s = 'SELECT * FROM t'")).not.toContain('SELECT')
  })

  it('обрезает строковый комментарий с конца строки', () => {
    expect(stripNonCode('const a = 1 // SELECT * FROM t')).not.toContain('SELECT')
  })

  it('не режет экранированную кавычку', () => {
    expect(stripNonCode("const s = 'it\\'s SELECT'")).not.toContain('SELECT')
  })
})

describe('analyze — SQL внутри цикла', () => {
  it('находит pool.query в теле for-of и указывает верную строку', () => {
    const body = ['async function f(rows) {', '  for (const r of rows) {', "    await pool.query('SELECT 1')", '  }', '}'].join('\n')
    const findings = findingsOf(body)
    expect(findings).toHaveLength(1)
    expect(findings[0].line).toBe(lineOf(body, 'await pool.query'))
    expect(findings[0].loopStart).toBe(2)
  })

  it('находит SQL в теле .forEach((r) => {', () => {
    const body = ['rows.forEach((r) => {', '  pool.query("SELECT 1", [r])', '})'].join('\n')
    expect(findingsOf(body)).toHaveLength(1)
  })

  it('находит SQL в теле .map((r) => {', () => {
    const body = ['const ids = rows.map((r) => {', '  return pool.query("SELECT 1")', '})'].join('\n')
    expect(findingsOf(body)).toHaveLength(1)
  })

  it('находит conn.execute и db.query (не только pool)', () => {
    expect(findingsOf(['for (const r of rows) {', '  await conn.execute("SELECT 1")', '}'].join('\n'))).toHaveLength(1)
    expect(findingsOf(['for (const r of rows) {', '  await db.query("SELECT 1")', '}'].join('\n'))).toHaveLength(1)
  })

  it('в while тоже', () => {
    expect(findingsOf(['let i = 0', 'while (i < rows.length) {', '  await pool.query("SELECT 1")', '}'].join('\n'))).toHaveLength(1)
  })

  it('не считает N+1 запросом SQL вне цикла', () => {
    expect(findingsOf(['async function f() {', "  await pool.query('SELECT 1')", '}'].join('\n'))).toHaveLength(0)
  })

  it('expression-bodied .map(r => r.id) — не цикл с запросами', () => {
    expect(findingsOf(['const ids = rows.map((r) => r.id)', "await pool.query('SELECT * FROM t WHERE id IN (?)', [ids])"].join('\n'))).toHaveLength(0)
  })

  it('.filter(...) и .some(...) — предикаты, а не тело цикла', () => {
    expect(findingsOf(['const a = rows.filter((r) => r.on)', "const b = rows.some((r) => pool.query('SELECT 1'))"].join('\n'))).toHaveLength(0)
  })

  it('выбирает самый глубокий цикл для вложенного SQL', () => {
    const body = ['for (const a of as) {', '  for (const b of bs) {', "    await pool.query('SELECT 1')", '  }', '}'].join('\n')
    const findings = findingsOf(body)
    expect(findings).toHaveLength(1)
    expect(findings[0].loopStart).toBe(2)
  })

  it('батч-запрос внутри цикла всё равно N+1 (IN (?) не спасает)', () => {
    const body = ['for (const r of rows) {', "  await pool.query('SELECT * FROM t WHERE id = ?', [r.id])", '}'].join('\n')
    expect(findingsOf(body)).toHaveLength(1)
  })
})

describe('collectFiles — границы обхода', () => {
  it('не заходит в __tests__ и node_modules', () => {
    const dir = tmp()
    write(dir, 'routes/a.js', '')
    write(dir, '__tests__/a.test.js', '')
    write(dir, 'node_modules/pkg/index.js', '')
    const rel = collectFiles(dir).map(f => f.replace(/\\/g, '/'))
    expect(rel.some(f => f.endsWith('routes/a.js'))).toBe(true)
    expect(rel.some(f => f.includes('__tests__'))).toBe(false)
    expect(rel.some(f => f.includes('node_modules'))).toBe(false)
  })

  it('берёт только js/mjs/cjs', () => {
    const dir = tmp()
    write(dir, 'a.js', '')
    write(dir, 'b.mjs', '')
    write(dir, 'c.cjs', '')
    write(dir, 'd.ts', '')
    expect(collectFiles(dir).length).toBe(3)
  })
})

describe('justifiedFor — файл + строка', () => {
  it('оправдание действует только на свой файл и свою строку', () => {
    expect(justifiedFor('server/src/seed.js', 999)).toBeTruthy()
    expect(justifiedFor('server/src/routes/push.js', 148)).toBeTruthy()
    expect(justifiedFor('server/src/routes/push.js', 149)).toBeFalsy()
    expect(justifiedFor('server/src/routes/profile.js', 148)).toBeFalsy()
  })

  it('каждое оправдание обязано нести причину', () => {
    for (const j of JUSTIFIED) {
      expect(typeof j.reason, `${j.file} без reason`).toBe('string')
      expect(j.reason.trim().length, `${j.file} с пустой причиной`).toBeGreaterThan(10)
    }
  })

  it('оправдание с номерами строк обязано иметь якорь expect (анти-рот)', () => {
    for (const j of JUSTIFIED) {
      if (!j.lines) continue
      expect(typeof j.expect, `${j.file}:${j.lines} без якоря — протухнет молча`).toBe('string')
      expect(j.expect.trim().length).toBeGreaterThan(0)
    }
  })
})

describe('collectJustificationDrift — оправдание протухло', () => {
  it('на живом дереве протухших оправданий нет', () => {
    expect(collectJustificationDrift(SRC)).toEqual([])
  })

  it('строка сдвинулась — оправдание протухло (находка, а не молчание)', () => {
    const dir = tmp()
    const line = lineOf(
      ['const a = 1', 'const b = 2', 'const c = 3', 'const d = 4', '// DELETE FROM t'].join('\n'),
      'DELETE',
    )
    write(dir, 'routes/push.js', ['const a = 1', 'const b = 2', 'const c = 3', 'const d = 4', '// DELETE FROM t'].join('\n'))
    expect(line).toBe(5)

    const drift = collectJustificationDrift(dir, [{ file: 'routes/push.js', lines: [3], expect: 'DELETE' }])
    expect(drift).toHaveLength(1)
    expect(drift[0]).toMatchObject({ file: 'routes/push.js', line: 3 })
    expect(drift[0].reason).toContain('DELETE')
  })

  it('якорь на месте — оправдание живое', () => {
    const dir = tmp()
    const body = ['const a = 1', 'await pool.query("DELETE FROM t")'].join('\n')
    write(dir, 'routes/push.js', body)
    expect(collectJustificationDrift(dir, [{ file: 'routes/push.js', lines: [2], expect: 'DELETE' }])).toEqual([])
  })

  it('файл оправдания исчез — это тоже дрейф, а не тишина', () => {
    const dir = tmp()
    write(dir, 'routes/other.js', 'await pool.query("SELECT 1")')
    const drift = collectJustificationDrift(dir, [{ file: 'routes/gone.js', lines: [1], expect: 'DELETE' }])
    expect(drift).toHaveLength(1)
    expect(drift[0].reason).toContain('не найден')
  })

  it('оправдание без expect проверяться не может — и потому обязано его иметь', () => {
    const dir = tmp()
    write(dir, 'routes/push.js', 'const a = 1')
    expect(collectJustificationDrift(dir, [{ file: 'routes/push.js', lines: [1] }])).toEqual([])
    expect(collectJustificationDrift(dir, [{ file: 'routes/push.js', lines: [1], expect: 'DELETE' }])).toHaveLength(1)
  })
})

describe('audit + report — конец в обоих направлениях', () => {
  it('текущий server/src чист: ни новых N+1, ни протухших оправданий', () => {
    const { unexpected, drift } = audit(SRC)
    expect(unexpected).toEqual([])
    expect(drift).toEqual([])
  })

  it('обход видит файлы (а не проходит по пустому каталогу)', () => {
    expect(audit(SRC).filesCount).toBeGreaterThan(50)
  })

  it('на фикстуре с N+1 гейт краснеет — «зелёный на своём дереве» не доказывает, что он ищет', () => {
    const dir = tmp()
    write(dir, 'routes/bad.js', ['export async function f(rows) {', '  for (const r of rows) {', "    await pool.query('SELECT * FROM t WHERE id = ?', [r.id])", '  }', '}'].join('\n'))
    const { unexpected } = audit(dir, [])
    expect(unexpected).toHaveLength(1)
    expect(unexpected[0].rel.endsWith('routes/bad.js')).toBe(true)
    expect(unexpected[0].line).toBe(3)
  })

  it('то же место, внесённое в JUSTIFIED, из unexpected уходит (и не попадает в drift)', () => {
    const dir = tmp()
    write(dir, 'routes/bad.js', ['export async function f(rows) {', '  for (const r of rows) {', "    await pool.query('SELECT * FROM t WHERE id = ?', [r.id])", '  }', '}'].join('\n'))
    const list = [{ file: 'routes/bad.js', lines: [3], expect: 'SELECT', reason: 'каталог фиксирован и мал' }]
    const { unexpected, accepted, drift } = audit(dir, list)
    expect(unexpected).toEqual([])
    expect(accepted).toBe(1)
    expect(drift).toEqual([])
  })

  it('оправдание с неверным якорем → drift, даже когда SQL на строке есть', () => {
    const dir = tmp()
    write(dir, 'routes/bad.js', ['const a = 1', "await pool.query('DELETE FROM t')"].join('\n'))
    const list = [{ file: 'routes/bad.js', lines: [2], expect: 'UPDATE', reason: 'якорь указывает не на то' }]
    const { drift } = audit(dir, list)
    expect(drift).toHaveLength(1)
    expect(report({ filesCount: 1, accepted: 0, unexpected: [], drift }, () => {})).toBe(1)
  })

  it('report на чистом состоянии печатает итог и возвращает 0', () => {
    const lines = []
    const code = report(audit(SRC), l => lines.push(l))
    expect(code).toBe(0)
    expect(lines.join('\n')).toContain('Новых N+1 не найдено')
  })

  it('report с находкой печатает её и возвращает 1', () => {
    const lines = []
    const code = report({ filesCount: 1, accepted: 0, drift: [], unexpected: [{ rel: 'server/src/routes/x.js', line: 3, loopStart: 2, header: 'for (const r of rows) {' }] }, l => lines.push(l))
    expect(code).toBe(1)
    expect(lines.join('\n')).toContain('server/src/routes/x.js:3')
  })

  it('report с протухшим оправданием тоже возвращает 1', () => {
    const lines = []
    const code = report({ filesCount: 1, accepted: 1, unexpected: [], drift: [{ file: 'routes/push.js', line: 46, reason: 'на строке нет «DELETE»' }] }, l => lines.push(l))
    expect(code).toBe(1)
    expect(lines.join('\n')).toContain('ОПРАВДАНИЕ ПРОТУХЛО routes/push.js:46')
  })
})