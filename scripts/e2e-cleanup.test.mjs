/**
 * Тесты скрипта очистки E2E-хвостов (`scripts/e2e-cleanup.mjs`, N10).
 *
 * Соединение подменяется фейком, поэтому ни MySQL, ни стенд не нужны: проверяем
 * именно логику «удалить → перечитать → exit 1, если осталось», а также то, что
 * `--verify` не удаляет и что предикат не разъехался с Playwright-teardown.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import {
  E2E_USER_PREDICATE,
  cleanupE2eData,
  connectionOptions,
  deleteUsersByIds,
  parseArgs,
  run,
  selectE2eIds,
} from './e2e-cleanup.mjs'

class FakeConn {
  constructor(ids) {
    this.ids = [...ids]
    this.deletes = []
    this.queries = []
    this.ended = false
  }

  async execute(sql, params) {
    this.queries.push(sql)
    if (/^SELECT/i.test(sql.trim())) return [this.ids.map((id) => ({ id }))]
    if (/^DELETE/i.test(sql.trim())) {
      this.deletes.push(params)
      const set = new Set(params)
      const before = this.ids.length
      this.ids = this.ids.filter((id) => !set.has(id))
      return [{ affectedRows: before - this.ids.length }]
    }
    throw new Error(`unexpected SQL: ${sql}`)
  }

  async end() {
    this.ended = true
  }
}

describe('parseArgs', () => {
  it('по умолчанию удаляет, --verify переключает в режим проверки', () => {
    expect(parseArgs([])).toEqual({ verify: false })
    expect(parseArgs(['--verify'])).toEqual({ verify: true })
    expect(parseArgs(['--other'])).toEqual({ verify: false })
  })
})

describe('connectionOptions', () => {
  it('читает DB_* с теми же дефолтами, что Playwright-teardown', () => {
    expect(connectionOptions({})).toEqual({
      host: 'localhost',
      port: 3306,
      user: 'root',
      password: '',
      database: 'swiftmatch',
    })
  })

  it('уважает переменные окружения', () => {
    const opts = connectionOptions({ DB_HOST: '127.0.0.1', DB_PORT: '3307', DB_USER: 'u', DB_PASSWORD: 'p', DB_NAME: 'db' })
    expect(opts).toEqual({ host: '127.0.0.1', port: 3307, user: 'u', password: 'p', database: 'db' })
  })
})

describe('предикат', () => {
  it('чистит оба тестовых префикса и не трогает остальных', () => {
    expect(E2E_USER_PREDICATE).toContain("e2e\\_%")
    expect(E2E_USER_PREDICATE).toContain("layout\\_%")
    const conn = new FakeConn([1])
    return selectE2eIds(conn).then(() => {
      expect(conn.queries[0]).toContain('FROM users WHERE')
      expect(conn.queries[0]).toContain(E2E_USER_PREDICATE)
    })
  })

  it('не разъехался с Playwright-teardown (единый набор префиксов)', () => {
    const teardown = fs.readFileSync(path.resolve('e2e/teardown/global-teardown.ts'), 'utf8')
    const sql = teardown.replace(/\\/g, '')
    expect(sql).toContain('e2e_%')
    expect(sql).toContain('layout_%')
    const predicate = E2E_USER_PREDICATE.replace(/\\/g, '')
    expect(predicate).toContain('e2e_%')
    expect(predicate).toContain('layout_%')
  })
})

describe('cleanupE2eData', () => {
  it('удаляет найденных и подтверждает, что хвостов не осталось', async () => {
    const conn = new FakeConn([1, 2, 3])
    const result = await cleanupE2eData(conn)
    expect(result).toEqual({ found: 3, deleted: 3, remaining: 0 })
    expect(conn.deletes).toEqual([[1, 2, 3]])
    expect(conn.ids).toEqual([])
  })

  it('на пустой БД не делает DELETE', async () => {
    const conn = new FakeConn([])
    const result = await cleanupE2eData(conn)
    expect(result).toEqual({ found: 0, deleted: 0, remaining: 0 })
    expect(conn.deletes).toEqual([])
  })

  it('--verify ничего не удаляет и возвращает остаток', async () => {
    const conn = new FakeConn([7, 8])
    const result = await cleanupE2eData(conn, { verify: true })
    expect(result).toEqual({ found: 2, deleted: 0, remaining: 2 })
    expect(conn.deletes).toEqual([])
    expect(conn.ids).toEqual([7, 8])
  })

  it('deleteUsersByIds возвращает affectedRows и не ходит в БД на пустом списке', async () => {
    const conn = new FakeConn([1, 2])
    expect(await deleteUsersByIds(conn, [])).toBe(0)
    expect(await deleteUsersByIds(conn, [1])).toBe(1)
  })
})

describe('run', () => {
  it('создаёт соединение из env, логирует и закрывает его', async () => {
    const logs = []
    let passedOptions = null
    const conn = new FakeConn([1, 2])
    const connect = async (options) => {
      passedOptions = options
      return conn
    }
    const result = await run({ env: { DB_HOST: 'h', DB_NAME: 'd' }, log: (m) => logs.push(m), connect })
    expect(passedOptions).toEqual({ host: 'h', port: 3306, user: 'root', password: '', database: 'd' })
    expect(result).toEqual({ found: 2, deleted: 2, remaining: 0 })
    expect(conn.ended).toBe(true)
    expect(logs.join('\n')).toContain('удалено 2')
  })

  it('в режиме --verify сообщает остаток и тоже закрывает соединение', async () => {
    const logs = []
    const conn = new FakeConn([5])
    const result = await run({ verify: true, log: (m) => logs.push(m), connect: async () => conn })
    expect(result.remaining).toBe(1)
    expect(conn.ended).toBe(true)
    expect(logs.join('\n')).toContain('проверка')
  })
})
