import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const SCHEMA_PATH = fileURLToPath(new URL('../../../database/mysql_schema.sql', import.meta.url))

const state = vi.hoisted(() => {
  const calls = []
  const hashCalls = []
  const connectionOptions = []
  let nextId = 1
  let failOn = null

  const conn = {
    execute: async (sql, params = []) => {
      const text = String(sql)
      calls.push({ sql: text, params })
      if (failOn && failOn.test(text)) throw new Error('boom')
      return [{ insertId: nextId++, affectedRows: 1 }, []]
    },
    end: async () => {
      calls.push({ sql: '__end__', params: [] })
    },
  }

  return {
    calls,
    hashCalls,
    connectionOptions,
    conn,
    setFailOn(re) {
      failOn = re
    },
    reset() {
      calls.length = 0
      hashCalls.length = 0
      connectionOptions.length = 0
      nextId = 1
      failOn = null
    },
  }
})

vi.mock('mysql2/promise', () => ({
  default: {
    createConnection: async (options) => {
      state.connectionOptions.push(options)
      return state.conn
    },
  },
}))

vi.mock('bcryptjs', () => ({
  default: {
    hash: async (password, rounds) => {
      state.hashCalls.push([password, rounds])
      return `hashed:${password}`
    },
  },
}))

const seed = await import('../seed.js')

const MALE_NAMES = 'Александр'
const FEMALE_NAMES = 'Мария'

function countSql(re) {
  return state.calls.filter((c) => re.test(c.sql)).length
}

function paramsOf(re) {
  return state.calls.filter((c) => re.test(c.sql)).map((c) => c.params)
}

function logs(spy) {
  return spy.mock.calls.map((args) => args[0])
}

describe('seed: генерация демо-данных', () => {
  let logSpy

  beforeEach(() => {
    state.reset()
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('создаёт 50 пользователей, 30 матчей и укладывается в лимит сообщений (мужские профили)', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    await seed.main()

    expect(state.connectionOptions[0]).toEqual({
      host: 'localhost',
      port: 3306,
      user: 'root',
      password: '',
      database: 'swiftmatch',
    })
    expect(state.hashCalls).toEqual([[seed.DEMO_PASSWORD, 10]])

    const users = paramsOf(/^INSERT INTO users /)
    expect(users).toHaveLength(seed.TOTAL_USERS)
    expect(users[0]).toEqual([seed.ADMIN_EMAIL, 'hashed:demo123456', 'admin', 1])
    expect(users[1]).toEqual(['user1@mail.ru', 'hashed:demo123456', 'user', 0])
    expect(users[2]).toEqual(['user2@mail.ru', 'hashed:demo123456', 'user', 1])
    expect(users[seed.TOTAL_USERS - 1][0]).toBe('user49@mail.ru')

    const profiles = paramsOf(/^INSERT INTO user_profiles/)
    expect(profiles).toHaveLength(seed.TOTAL_USERS)
    expect(profiles[0].slice(1, 10)).toEqual([MALE_NAMES, 18, profiles[0][3], '/demo/people/maxim.png', 'male', 'female', 'serious_relationship', 170, 'Москва'])
    expect(profiles[0][15]).toBe('lark')
    expect(profiles[1][16]).toBe(0)
    expect(profiles[2][16]).toBe(10)

    const interestRows = paramsOf(/^INSERT INTO user_interests/)
    expect(interestRows).toHaveLength(seed.TOTAL_USERS * 2)
    expect(paramsOf(/^REPLACE INTO interests/)).toHaveLength(seed.INTERESTS.length)
    expect(new Set(paramsOf(/^REPLACE INTO interests/).map((p) => p[0])).size).toBe(seed.INTERESTS.length)

    expect(countSql(/^INSERT INTO likes /)).toBe(seed.TARGET_MATCHES + seed.TARGET_MATCHES / 2)

    const matches = paramsOf(/^INSERT IGNORE INTO matches/)
    expect(matches).toHaveLength(seed.TARGET_MATCHES)
    for (const [user1, user2] of matches) {
      expect(user1).toBeLessThan(user2)
    }

    expect(countSql(/^INSERT INTO chats /)).toBe(seed.TARGET_MATCHES)
    expect(countSql(/^INSERT INTO chat_participants /)).toBe(seed.TARGET_MATCHES * 2)
    expect(countSql(/^INSERT INTO messages /)).toBe(seed.TARGET_MATCHES * 3)
    expect(countSql(/^INSERT INTO messages /)).toBeLessThanOrEqual(seed.TARGET_MESSAGES)

    expect(countSql(/^REPLACE INTO feature_flags/)).toBe(1)
    expect(countSql(/^REPLACE INTO content_config/)).toBe(1)
    expect(countSql(/^INSERT IGNORE INTO experiments/)).toBe(1)
    expect(countSql(/^INSERT IGNORE INTO partners/)).toBe(10)
    expect(countSql(/^INSERT INTO partner_offers/)).toBe(20)

    expect(logs(logSpy)).toEqual([
      'Connected to MySQL',
      'Truncating tables...',
      'Truncated all tables',
      'Inserting interests...',
      'Inserting 50 users...',
      'Inserting feature_flags and content_config...',
      'Inserting experiments and partner offers...',
      'Creating 30 matches and 200 messages...',
      'Created 30 matches, 90 messages',
      'Seed complete!',
    ])

    expect(countSql(/^__end__$/)).toBe(1)
  })

  it('очищает все таблицы, сбрасывает AUTO_INCREMENT и снова включает проверку внешних ключей', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    await seed.main()

    const deletions = state.calls.filter((c) => /^DELETE FROM/.test(c.sql)).map((c) => c.sql)
    expect(deletions).toHaveLength(seed.TABLES_TO_TRUNCATE.length)
    expect(new Set(deletions).size).toBe(seed.TABLES_TO_TRUNCATE.length)
    const deleted = deletions
    expect(deleted).toHaveLength(seed.TABLES_TO_TRUNCATE.length)
    expect(new Set(deleted).size).toBe(seed.TABLES_TO_TRUNCATE.length)

    const altered = state.calls.filter((c) => /^ALTER TABLE/.test(c.sql)).map((c) => c.sql)
    expect(altered).toHaveLength(seed.TABLES_TO_TRUNCATE.length + 3)
    expect(new Set(altered).size).toBe(altered.length)
    expect(altered).toContain('ALTER TABLE `interests` AUTO_INCREMENT = 1')
    expect(altered).toContain('ALTER TABLE `content_config` AUTO_INCREMENT = 1')
    expect(altered).toContain('ALTER TABLE `feature_flags` AUTO_INCREMENT = 1')

    const fkChecks = state.calls.filter((c) => c.sql === 'SET FOREIGN_KEY_CHECKS = 0' || c.sql === 'SET FOREIGN_KEY_CHECKS = 1')
    expect(fkChecks.map((c) => c.sql)).toEqual(['SET FOREIGN_KEY_CHECKS = 0', 'SET FOREIGN_KEY_CHECKS = 1'])
    const offIndex = state.calls.findIndex((c) => c.sql === 'SET FOREIGN_KEY_CHECKS = 0')
    const onIndex = state.calls.findIndex((c) => c.sql === 'SET FOREIGN_KEY_CHECKS = 1')
    expect(offIndex).toBeLessThan(onIndex)
  })

  it('женские профили другого диапазона и ровно 200 сообщений при верхней границе', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999)
    await seed.main()

    const profiles = paramsOf(/^INSERT INTO user_profiles/)
    expect(profiles[1][1]).toBe(FEMALE_NAMES)
    expect(profiles[1].slice(4, 9)).toEqual(['/demo/people/sophia.png', 'female', 'male', 'new_friends', 180])
    expect(profiles[0].slice(4, 9)).toEqual(['/demo/people/artem.png', 'male', 'female', 'new_friends', 195])

    expect(countSql(/^INSERT INTO messages /)).toBe(seed.TARGET_MESSAGES)
    expect(logs(logSpy)).toContain('Created 30 matches, 200 messages')
  })

  it('пробрасывает ошибку базы наружу, не дописывая сид молча', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    state.setFailOn(/^INSERT INTO users /)

    await expect(seed.main()).rejects.toThrow('boom')
    expect(countSql(/^INSERT INTO user_profiles/)).toBe(0)
    expect(countSql(/^__end__$/)).toBe(0)
  })

  it('пропускает недоступную таблицу при очистке и продолжает сид', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    state.setFailOn(/^DELETE FROM `user_stories`$|^ALTER TABLE `interests` /)

    await expect(seed.main()).resolves.toBeUndefined()
    expect(countSql(/^INSERT INTO users /)).toBe(seed.TOTAL_USERS)
    expect(countSql(/^__end__$/)).toBe(1)
  })

  it('CLI сообщает о падении сида и завершается кодом 1', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {})
    state.setFailOn(/^INSERT INTO users /)

    seed.runCli()

    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(1))
    expect(errorSpy).toHaveBeenCalledWith('Seed failed:', 'boom')
  })

  it('запущенный файлом сид стартует сам, а импортированный — нет', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)

    state.reset()
    vi.resetModules()
    await import('../seed.js')
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(countSql(/^__end__$/)).toBe(0)
    expect(countSql(/^INSERT INTO users /)).toBe(0)

    const original = process.argv[1]
    process.argv[1] = fileURLToPath(new URL('../seed.js', import.meta.url))
    try {
      state.reset()
      vi.resetModules()
      await import('../seed.js')
      await vi.waitFor(() => expect(countSql(/^__end__$/)).toBe(1))
      expect(countSql(/^INSERT INTO users /)).toBe(seed.TOTAL_USERS)
    } finally {
      process.argv[1] = original
      vi.resetModules()
    }
  })
})

describe('seed: список очистки не протухает', () => {
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8')

  function schemaTables() {
    return schema
      .split(/(?=CREATE TABLE )/)
      .map((block) => {
        const head = /^CREATE TABLE `([^`]+)` \(([\s\S]*?)\n\) ENGINE/.exec(block)
        return head ? { name: head[1], body: head[2] } : null
      })
      .filter(Boolean)
  }

  it('каждая таблица со ссылкой на users попадает в очистку', () => {
    const referencing = schemaTables().filter((t) => /REFERENCES `users`/.test(t.body)).map((t) => t.name)
    expect(referencing.length).toBeGreaterThan(40)
    expect(referencing.filter((t) => !seed.TABLES_TO_TRUNCATE.includes(t))).toEqual([])
  })

  it('в очистке нет таблиц, которых нет в схеме', () => {
    const names = new Set(schemaTables().map((t) => t.name))
    expect(seed.TABLES_TO_TRUNCATE.filter((t) => !names.has(t))).toEqual([])
  })

  it('служебная таблица миграций не вычищается', () => {
    expect(seed.TABLES_TO_TRUNCATE).not.toContain('_migrations')
  })

  it('интересы сида совпадают с каноном схемы (37 уникальных id)', () => {
    expect(seed.INTERESTS).toHaveLength(37)
    expect(new Set(seed.INTERESTS.map((row) => row[0])).size).toBe(37)
    expect(new Set(seed.INTERESTS.map((row) => row[3])).size).toBe(37)
  })
})
