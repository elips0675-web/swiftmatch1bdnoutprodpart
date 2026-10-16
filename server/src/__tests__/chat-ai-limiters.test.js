import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
  process.env.CHAT_MESSAGE_RATE_MAX = '3'
  process.env.ICEBREAKER_RATE_MAX = '2'
  delete process.env.OPENAI_API_KEY
  delete process.env.REDIS_URL
})

const { dbQuery, rootLog } = vi.hoisted(() => ({
  dbQuery: vi.fn(),
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

vi.mock('../ws.js', () => ({
  getIO: vi.fn(() => ({ to: vi.fn(() => ({ emit: vi.fn() })) })),
}))

vi.mock('../banned-words.js', () => ({
  getBannedWords: vi.fn(() => []),
  containsBannedWord: vi.fn(() => false),
}))

vi.mock('../routes/push.js', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  sendPushToUser: vi.fn(),
  sendPushToAll: vi.fn(),
}))

vi.mock('../circuit-breaker.js', () => ({
  createBreaker: (fn) => ({ fire: (args) => fn(args) }),
}))

import socialRoutes from '../routes/social.js'
import icebreakersRoutes from '../routes/icebreakers.js'

function createApp(routes) {
  const app = express()
  app.use(express.json())
  app.use(routes)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  dbQuery.mockReset()
  dbQuery.mockResolvedValue([[], []])
})

describe('выделенные лимитеры чата и AI', () => {
  it('POST /api/chats/:chatId/messages: 4-й запрос -> 429 (лимит 3)', async () => {
    const app = createApp(socialRoutes)
    const statuses = []
    for (let i = 0; i < 4; i++) {
      const res = await request(app).post('/api/chats/1/messages').send({ text: 'hi' })
      statuses.push(res.status)
    }
    expect(statuses.slice(0, 3).every((s) => s !== 429)).toBe(true)
    expect(statuses[3]).toBe(429)
  })

  it('POST /api/icebreakers/suggest: 3-й запрос -> 429 (лимит 2)', async () => {
    const app = createApp(icebreakersRoutes)
    const first = await request(app).post('/api/icebreakers/suggest').send({ chat_user_id: 5 })
    const second = await request(app).post('/api/icebreakers/suggest').send({ chat_user_id: 5 })
    const third = await request(app).post('/api/icebreakers/suggest').send({ chat_user_id: 5 })
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(third.status).toBe(429)
  })
})
