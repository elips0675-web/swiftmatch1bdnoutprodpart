// Этап 76 (circuit breaker OpenAI): icebreakers breaker + DB fallback unit
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
  process.env.OPENAI_API_KEY = 'sk-test-dummy'
})

const { dbQuery, openaiCreate, rootLog } = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  openaiCreate: vi.fn(),
  rootLog: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('../db.js', () => ({
  default: { query: (...args) => dbQuery(...args) },
}))

vi.mock('../logger.js', () => ({
  default: rootLog,
  createLogger: () => rootLog,
  rootLogger: rootLog,
}))

vi.mock('../middleware.js', () => ({
  auth: (req, _res, next) => { req.userId = 1; next() },
}))

// createBreaker: fire вызывает переданную fn напрямую (без opossum в юнит-тесте)
vi.mock('../circuit-breaker.js', () => ({
  createBreaker: (fn) => ({ fire: (args) => fn(args) }),
}))

vi.mock('openai', () => ({
  default: class {
    constructor() {}
    get chat() {
      return { completions: { create: (...args) => openaiCreate(...args) } }
    }
  },
}))

import icebreakersRoutes from '../routes/icebreakers.js'

function createApp() {
  const app = express()
  app.use(express.json())
  app.use(icebreakersRoutes)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/icebreakers/suggest — OpenAI breaker + DB fallback', () => {
  it('OpenAI успех -> source=openai, suggestions из ответа (обрезаны до 3)', async () => {
    openaiCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(['Привет!', 'Как дела?', 'Любишь кино?', 'лишнее']) } }],
    })

    dbQuery.mockResolvedValueOnce([[]])

    const res = await request(createApp())
      .post('/api/icebreakers/suggest')
      .send({ chat_user_id: 5 })

    expect(res.status).toBe(200)
    expect(res.body.source).toBe('openai')
    expect(res.body.suggestions).toEqual(['Привет!', 'Как дела?', 'Любишь кино?'])
  })

  it('OpenAI падает -> fallback на БД (source=db, выборка из icebreaker_questions)', async () => {
    openaiCreate.mockRejectedValue(new Error('ECONNREFUSED openai'))

    // profile, themes, questions
    dbQuery
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[
        { id: 1, key_id: 'k1', icon: 'x' },
        { id: 2, key_id: 'k2', icon: 'y' },
      ]])
      .mockResolvedValueOnce([[
        { id: 10, theme_id: 1, text_ru: 'Какой твой любимый город?', text_en: 'Favorite city?' },
        { id: 11, theme_id: 2, text_ru: 'Какой фильм недавно смотрел?', text_en: 'Recent movie?' },
        { id: 12, theme_id: 1, text_ru: 'Любишь путешествия?', text_en: 'Love travel?' },
      ]])

    const res = await request(createApp())
      .post('/api/icebreakers/suggest')
      .send({ chat_user_id: 5 })

    expect(res.status).toBe(200)
    expect(res.body.source).toBe('db')
    expect(res.body.suggestions.length).toBeGreaterThanOrEqual(1)
    expect(res.body.suggestions.every(s => typeof s === 'string' && s.length > 0)).toBe(true)
  })

  it('OpenAI вернул пустой/невалидный массив -> fallback на БД', async () => {
    openaiCreate.mockResolvedValue({
      choices: [{ message: { content: '[]' } }],
    })

    dbQuery
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[
        { id: 1, key_id: 'k1', icon: 'x' },
      ]])
      .mockResolvedValueOnce([[
        { id: 10, theme_id: 1, text_ru: 'Хобби?', text_en: 'Hobby?' },
        { id: 11, theme_id: 1, text_ru: 'Музыка?', text_en: 'Music?' },
        { id: 12, theme_id: 1, text_ru: 'Еда?', text_en: 'Food?' },
      ]])

    const res = await request(createApp())
      .post('/api/icebreakers/suggest')
      .send({ chat_user_id: 5 })

    expect(res.status).toBe(200)
    expect(res.body.source).toBe('db')
  })

  it('нечисловой chat_user_id -> 400 MISSING_CHAT_USER_ID', async () => {
    const res = await request(createApp())
      .post('/api/icebreakers/suggest')
      .send({})

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('MISSING_CHAT_USER_ID')
    expect(dbQuery).not.toHaveBeenCalled()
  })

  it('темы есть, а вопросов нет -> source=db с пустым списком', async () => {
    openaiCreate.mockRejectedValue(new Error('down'))

    dbQuery
      .mockResolvedValueOnce([[{ display_name: 'Аня', age: 25, bio: 'био', city: 'Москва', dating_goal: 'serious', zodiac: 'Лев' }]])
      .mockResolvedValueOnce([[{ id: 1, key_id: 'k1', icon: 'x' }]])
      .mockResolvedValueOnce([[]])

    const res = await request(createApp())
      .post('/api/icebreakers/suggest')
      .send({ chat_user_id: 5 })

    expect(res.status).toBe(200)
    expect(res.body.source).toBe('db')
    expect(res.body.suggestions).toEqual([])
    expect(openaiCreate).toHaveBeenCalledTimes(1)
  })

  it('темы пусты -> статический набор из трёх фраз', async () => {
    openaiCreate.mockRejectedValue(new Error('down'))

    dbQuery
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])

    const res = await request(createApp())
      .post('/api/icebreakers/suggest')
      .send({ chat_user_id: 5 })

    expect(res.status).toBe(200)
    expect(res.body.source).toBe('static')
    expect(res.body.suggestions).toHaveLength(3)
  })

  it('language=en -> берётся text_en', async () => {
    openaiCreate.mockRejectedValue(new Error('down'))

    dbQuery
      .mockResolvedValueOnce([[{ display_name: 'Ann', age: 30, bio: '', city: '', dating_goal: '', zodiac: '' }]])
      .mockResolvedValueOnce([[{ id: 1, key_id: 'k1', icon: 'x' }]])
      .mockResolvedValueOnce([[
        { id: 10, theme_id: 1, text_ru: 'Хобби?', text_en: 'Hobby?' },
      ]])

    const res = await request(createApp())
      .post('/api/icebreakers/suggest')
      .send({ chat_user_id: 5, language: 'en' })

    expect(res.status).toBe(200)
    expect(res.body.source).toBe('db')
    expect(res.body.suggestions).toEqual(['Hobby?'])
  })

  it('неизвестный язык трактуется как ru (text_ru)', async () => {
    openaiCreate.mockRejectedValue(new Error('down'))

    dbQuery
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ id: 1, key_id: 'k1', icon: 'x' }]])
      .mockResolvedValueOnce([[
        { id: 10, theme_id: 1, text_ru: 'Хобби?', text_en: 'Hobby?' },
      ]])

    const res = await request(createApp())
      .post('/api/icebreakers/suggest')
      .send({ chat_user_id: 5, language: 'de' })

    expect(res.status).toBe(200)
    expect(res.body.suggestions).toEqual(['Хобби?'])
  })

  it('без OPENAI_API_KEY OpenAI не вызывается', async () => {
    vi.resetModules()
    const savedKey = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY
    try {
      const fresh = await import('../routes/icebreakers.js')
      const app = express()
      app.use(express.json())
      app.use(fresh.default)
      dbQuery
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[]])
      const res = await request(app)
        .post('/api/icebreakers/suggest')
        .send({ chat_user_id: 5 })
      expect(res.status).toBe(200)
      expect(res.body.source).toBe('static')
      expect(openaiCreate).not.toHaveBeenCalled()
    } finally {
      process.env.OPENAI_API_KEY = savedKey
      vi.resetModules()
    }
  })

  it('пустой ответ модели -> JSON.parse даёт []', async () => {
    openaiCreate.mockResolvedValue({ choices: [] })

    dbQuery
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ id: 1, key_id: 'k1', icon: 'x' }]])
      .mockResolvedValueOnce([[
        { id: 10, theme_id: 1, text_ru: 'Хобби?', text_en: 'Hobby?' },
      ]])

    const res = await request(createApp())
      .post('/api/icebreakers/suggest')
      .send({ chat_user_id: 5 })

    expect(res.status).toBe(200)
    expect(res.body.source).toBe('db')
    expect(res.body.suggestions).toEqual(['Хобби?'])
  })

  it('сбой запроса профиля -> 500 SERVER_ERROR и запись в лог', async () => {
    dbQuery.mockRejectedValue(new Error('db down'))

    const res = await request(createApp())
      .post('/api/icebreakers/suggest')
      .send({ chat_user_id: 5 })

    expect(res.status).toBe(500)
    expect(res.body.error).toBe('SERVER_ERROR')
    expect(rootLog.error).toHaveBeenCalledWith('Icebreakers suggest error:', expect.any(Error))
  })
})
