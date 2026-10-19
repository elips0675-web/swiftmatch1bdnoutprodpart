import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }))

import pool from '../db.js'

// Модуль держит кэш слов на уровне модуля с TTL 30 c, поэтому каждому тесту
// нужен собственный экземпляр (иначе первый тест прогревает кэш для всех).
async function freshBannedWords() {
  vi.resetModules()
  return import('../banned-words.js')
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getBannedWords: кэш и варианты ответа БД', () => {
  it('строку JSON парсит в список слов', async () => {
    pool.query.mockResolvedValueOnce([[{ banned_words: JSON.stringify(['дурак', 'спам']) }]])
    const { getBannedWords } = await freshBannedWords()
    await expect(getBannedWords()).resolves.toEqual(['дурак', 'спам'])
  })

  it('готовый массив отдаётся без парсинга', async () => {
    pool.query.mockResolvedValueOnce([[{ banned_words: ['мат', 'флуд'] }]])
    const { getBannedWords } = await freshBannedWords()
    await expect(getBannedWords()).resolves.toEqual(['мат', 'флуд'])
  })

  it('пустое значение колонки даёт пустой список', async () => {
    pool.query.mockResolvedValueOnce([[{ banned_words: null }]])
    const { getBannedWords } = await freshBannedWords()
    await expect(getBannedWords()).resolves.toEqual([])
  })

  it('отсутствие строки конфига даёт пустой список', async () => {
    pool.query.mockResolvedValueOnce([[]])
    const { getBannedWords } = await freshBannedWords()
    await expect(getBannedWords()).resolves.toEqual([])
  })

  it('не-массив после парсинга тоже превращается в пустой список', async () => {
    pool.query.mockResolvedValueOnce([[{ banned_words: JSON.stringify({ a: 1 }) }]])
    const { getBannedWords } = await freshBannedWords()
    await expect(getBannedWords()).resolves.toEqual([])
  })

  it('падение БД глушится и даёт пустой список', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const { getBannedWords } = await freshBannedWords()
    await expect(getBannedWords()).resolves.toEqual([])
  })

  it('битый JSON глушится попыткой-обёрткой и даёт пустой список', async () => {
    pool.query.mockResolvedValueOnce([[{ banned_words: '{not json' }]])
    const { getBannedWords } = await freshBannedWords()
    await expect(getBannedWords()).resolves.toEqual([])
  })

  it('в пределах TTL кэш отдаётся без повторного запроса к БД', async () => {
    pool.query.mockResolvedValue([[{ banned_words: ['дурак'] }]])
    const { getBannedWords } = await freshBannedWords()
    await getBannedWords()
    await getBannedWords()
    expect(pool.query).toHaveBeenCalledTimes(1)
  })

  it('по истечении TTL список перезапрашивается', async () => {
    vi.useFakeTimers()
    try {
      pool.query.mockResolvedValue([[{ banned_words: ['дурак'] }]])
      const { getBannedWords } = await freshBannedWords()
      await getBannedWords()
      await vi.advanceTimersByTimeAsync(31000)
      pool.query.mockResolvedValueOnce([[{ banned_words: ['обновлённый'] }]])
      await expect(getBannedWords()).resolves.toEqual(['обновлённый'])
      expect(pool.query).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('containsBannedWord', () => {
  let containsBannedWord

  beforeEach(async () => {
    ;({ containsBannedWord } = await freshBannedWords())
  })

  it('пустой список запретов — всегда false', () => {
    expect(containsBannedWord('любой текст', [])).toBe(false)
    expect(containsBannedWord('любой текст', undefined)).toBe(false)
  })

  it('находит слово без учёта регистра', () => {
    expect(containsBannedWord('Ты Дурак', ['дурак'])).toBe(true)
  })

  it('подстрока внутри слова тоже считается совпадением', () => {
    expect(containsBannedWord('спамеры атакуют', ['спам'])).toBe(true)
  })

  it('чистый текст даёт false', () => {
    expect(containsBannedWord('привет, как дела', ['дурак', 'спам'])).toBe(false)
  })

  it('пустые и нестроковые элементы списка игнорируются', () => {
    expect(containsBannedWord('привет', ['', null, undefined])).toBe(false)
  })
})
