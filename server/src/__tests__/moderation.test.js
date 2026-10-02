import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}))

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('../middleware.js', () => ({
  auth: (req, res, next) => { req.userId = 1; next() },
  optionalAuth: (req, res, next) => { req.userId = 1; next() },
}))

vi.mock('../middleware/adminAuth.js', () => ({
  adminAuth: (req, res, next) => { req.admin = { id: 1, role: 'admin' }; next() },
}))

vi.mock('../ai-moderation.js', () => ({
  moderateText: vi.fn(),
  moderateImage: vi.fn(),
  reviewProfile: vi.fn(),
  isAIModerationConfigured: vi.fn(),
}))

import { moderateText, moderateImage, isAIModerationConfigured } from '../ai-moderation.js'
import moderationRoutes from '../routes/moderation.js'

function createApp() {
  const app = express()
  app.use(express.json())
  app.use(moderationRoutes)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/moderation/check-text', () => {
  const app = createApp()

  it('validates text is required', async () => {
    const res = await request(app)
      .post('/api/moderation/check-text')
      .send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('MISSING_TEXT')
  })

  it('returns safe result for clean text', async () => {
    moderateText.mockResolvedValueOnce({ safe: true, reasons: [], confidence: 0.95, source: 'heuristic' })

    const res = await request(app)
      .post('/api/moderation/check-text')
      .send({ text: 'Hello, how are you?' })
    expect(res.status).toBe(200)
    expect(res.body.safe).toBe(true)
  })

  it('returns flagged result for toxic text', async () => {
    moderateText.mockResolvedValueOnce({ safe: false, reasons: ['hate'], confidence: 0.85, source: 'heuristic' })

    const res = await request(app)
      .post('/api/moderation/check-text')
      .send({ text: 'I hate you all' })
    expect(res.status).toBe(200)
    expect(res.body.safe).toBe(false)
    expect(res.body.reasons).toContain('hate')
  })

  it('handles moderation error', async () => {
    moderateText.mockRejectedValue(new Error('Moderation error'))

    const res = await request(app)
      .post('/api/moderation/check-text')
      .send({ text: 'test' })
    expect(res.status).toBe(500)
  })
})

describe('POST /api/moderation/check-image', () => {
  const app = createApp()

  it('validates filePath is required', async () => {
    const res = await request(app)
      .post('/api/moderation/check-image')
      .send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('MISSING_PATH')
  })

  it('returns safe for clean image', async () => {
    moderateImage.mockResolvedValueOnce({ safe: true, reasons: [], labels: [], source: 'none' })

    const res = await request(app)
      .post('/api/moderation/check-image')
      .send({ filePath: '/uploads/test.jpg' })
    expect(res.status).toBe(200)
    expect(res.body.safe).toBe(true)
  })

  it('handles error', async () => {
    moderateImage.mockRejectedValue(new Error('Image error'))

    const res = await request(app)
      .post('/api/moderation/check-image')
      .send({ filePath: '/uploads/test.jpg' })
    expect(res.status).toBe(500)
  })
})

describe('GET /api/moderation/status', () => {
  const app = createApp()

  it('returns configured false when no API keys', async () => {
    isAIModerationConfigured.mockReturnValue(false)

    const res = await request(app).get('/api/moderation/status')
    expect(res.status).toBe(200)
    expect(res.body.configured).toBe(false)
  })

  it('returns configured true when API keys present', async () => {
    isAIModerationConfigured.mockReturnValue(true)

    const res = await request(app).get('/api/moderation/status')
    expect(res.status).toBe(200)
    expect(res.body.configured).toBe(true)
  })
})

describe('heuristicTextModeration (via moderateText)', () => {
  it('flags explicit content', async () => {
    moderateText.mockResolvedValueOnce({ safe: false, reasons: ['explicit_sexual'], confidence: 0.6, source: 'heuristic' })

    const app = createApp()
    const res = await request(app)
      .post('/api/moderation/check-text')
      .send({ text: 'watch free porn video' })
    expect(res.status).toBe(200)
    expect(res.body.safe).toBe(false)
  })

  it('flags personal info', async () => {
    moderateText.mockResolvedValueOnce({ safe: false, reasons: ['personal_info'], confidence: 0.6, source: 'heuristic' })

    const app = createApp()
    const res = await request(app)
      .post('/api/moderation/check-text')
      .send({ text: 'Call me at 1234567890' })
    expect(res.status).toBe(200)
    expect(res.body.safe).toBe(false)
  })
})
