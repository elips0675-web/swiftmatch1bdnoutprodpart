import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PAIRS, sha256Of, syncMirrors } from './check-doc-mirrors.mjs'

const roots = []
function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrors-test-'))
  roots.push(root)
  return root
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}

afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true })
})

describe('syncMirrors', () => {
  it('совпадающие файлы — ok и ничего не пишет', () => {
    const root = makeRoot()
    write(path.join(root, 'a.txt'), 'x')
    write(path.join(root, 'test/a.txt'), 'x')
    expect(syncMirrors(root, { pairs: [['a.txt', 'test/a.txt']] })).toEqual([
      { src: 'a.txt', dst: 'test/a.txt', status: 'ok' },
    ])
  })

  it('расхождение без --fix — diverged, зеркало не тронуто', () => {
    const root = makeRoot()
    write(path.join(root, 'a.txt'), 'new')
    write(path.join(root, 'test/a.txt'), 'old')
    const [res] = syncMirrors(root, { pairs: [['a.txt', 'test/a.txt']] })
    expect(res.status).toBe('diverged')
    expect(fs.readFileSync(path.join(root, 'test/a.txt'), 'utf8')).toBe('old')
  })

  it('--fix переписывает зеркало байт в байт (включая CRLF)', () => {
    const root = makeRoot()
    write(path.join(root, 'a.txt'), 'new\r\nстрока')
    write(path.join(root, 'test/a.txt'), 'old')
    const [res] = syncMirrors(root, { fix: true, pairs: [['a.txt', 'test/a.txt']] })
    expect(res.status).toBe('synced')
    expect(sha256Of(path.join(root, 'a.txt'))).toBe(sha256Of(path.join(root, 'test/a.txt')))
  })

  it('нет зеркала: missing без --fix, created с --fix (каталог создаётся)', () => {
    const root = makeRoot()
    write(path.join(root, 'deep/a.txt'), 'x')
    const pairs = [['deep/a.txt', 'test/deep/a.txt']]
    expect(syncMirrors(root, { pairs })[0].status).toBe('missing')
    expect(syncMirrors(root, { fix: true, pairs })[0].status).toBe('created')
    expect(fs.readFileSync(path.join(root, 'test/deep/a.txt'), 'utf8')).toBe('x')
  })

  it('нет исходника — source-missing (skip), не ошибка', () => {
    const root = makeRoot()
    expect(syncMirrors(root, { pairs: [['nope.txt', 'test/nope.txt']] })[0].status).toBe('source-missing')
  })
})

describe('PAIRS', () => {
  it('покрывает журналы, правила и зеркала, без дублей', () => {
    const dsts = PAIRS.map(([, dst]) => dst)
    expect(new Set(dsts).size).toBe(dsts.length)
    expect(dsts).toContain('test/Что сделано.txt')
    expect(dsts).toContain('test/Что доделать.txt')
    expect(dsts).toContain('test/AGENTS-pitfalls.md')
  })
})
