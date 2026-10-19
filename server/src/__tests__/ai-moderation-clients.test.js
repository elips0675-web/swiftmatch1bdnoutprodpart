vi.hoisted(() => {
  delete process.env.OPENAI_API_KEY
  delete process.env.AWS_ACCESS_KEY_ID
  delete process.env.AWS_REGION
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const { openaiCreate, rekSend, openaiCtor, flags, rootLog } = vi.hoisted(() => ({
  openaiCreate: vi.fn(),
  rekSend: vi.fn(),
  openaiCtor: vi.fn(),
  flags: { openaiCtorFails: false, rekCtorFails: false },
  rootLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../logger.js', () => ({
  default: rootLog,
  createLogger: () => rootLog,
  rootLogger: rootLog,
}))

vi.mock('openai', () => ({
  default: class {
    constructor(opts) {
      openaiCtor(opts)
      if (flags.openaiCtorFails) throw new Error('bad api key')
      this.moderations = { create: (...args) => openaiCreate(...args) }
    }
  },
}))

vi.mock('@aws-sdk/client-rekognition', () => ({
  RekognitionClient: class {
    constructor(cfg) {
      if (flags.rekCtorFails) throw new Error('bad region')
      this.cfg = cfg
    }
    send(cmd) {
      return rekSend(cmd)
    }
  },
  DetectModerationLabelsCommand: class {
    constructor(input) {
      this.input = input
    }
  },
}))

let savedEnv = {}
const tempFiles = []

async function freshModeration(env = {}) {
  vi.resetModules()
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  return import('../ai-moderation.js')
}

function tempImage() {
  const file = path.join(os.tmpdir(), `ai-mod-test-${Date.now()}-${Math.random()}.jpg`)
  fs.writeFileSync(file, Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
  tempFiles.push(file)
  return file
}

beforeEach(() => {
  vi.clearAllMocks()
  savedEnv = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_REGION: process.env.AWS_REGION,
  }
  delete process.env.OPENAI_API_KEY
  delete process.env.AWS_ACCESS_KEY_ID
  delete process.env.AWS_REGION
  flags.openaiCtorFails = false
  flags.rekCtorFails = false
  openaiCreate.mockResolvedValue({
    results: [{ flagged: false, categories: {}, category_scores: {} }],
  })
  rekSend.mockResolvedValue({ ModerationLabels: [] })
})

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  while (tempFiles.length) {
    try { fs.unlinkSync(tempFiles.pop()) } catch { /* файл уже удалён */ }
  }
})

describe('moderateText — через OpenAI', () => {
  it('flagged: safe=false, reasons из категорий, confidence из category_scores', async () => {
    openaiCreate.mockResolvedValue({
      results: [{
        flagged: true,
        categories: { hate: true, violence: false, sexual: true },
        category_scores: { hate: 0.97 },
      }],
    })
    const { moderateText } = await freshModeration({ OPENAI_API_KEY: 'sk-test' })
    const res = await moderateText('текст')
    expect(res).toEqual({
      safe: false,
      reasons: ['hate', 'sexual'],
      confidence: 0.97,
      source: 'openai',
    })
    expect(openaiCreate).toHaveBeenCalledWith({ input: 'текст' })
    expect(rootLog.warn).not.toHaveBeenCalled()
  })

  it('чистый ответ: safe=true, пустые reasons', async () => {
    openaiCreate.mockResolvedValue({
      results: [{
        flagged: false,
        categories: { hate: false, sexual: false },
        category_scores: { hate: 0.01 },
      }],
    })
    const { moderateText } = await freshModeration({ OPENAI_API_KEY: 'sk-test' })
    const res = await moderateText('привет')
    expect(res.safe).toBe(true)
    expect(res.reasons).toEqual([])
    expect(res.source).toBe('openai')
  })

  it('без category_scores в ответе — confidence 0, а не падение', async () => {
    openaiCreate.mockResolvedValue({
      results: [{ flagged: true, categories: { spam: true } }],
    })
    const { moderateText } = await freshModeration({ OPENAI_API_KEY: 'sk-test' })
    const res = await moderateText('text')
    expect(res.confidence).toBe(0)
    expect(res.reasons).toEqual(['spam'])
  })

  it('ошибка API: warn и падение на эвристику', async () => {
    openaiCreate.mockRejectedValue(new Error('rate limit'))
    const { moderateText } = await freshModeration({ OPENAI_API_KEY: 'sk-test' })
    const res = await moderateText('click here')
    expect(res.source).toBe('heuristic')
    expect(res.reasons).toContain('spam')
    expect(rootLog.warn).toHaveBeenCalledWith('AI moderation: OpenAI API error:', 'rate limit')
  })

  it('конструктор OpenAI падает: warn и эвристика, клиент кэшируется как false', async () => {
    flags.openaiCtorFails = true
    const { moderateText } = await freshModeration({ OPENAI_API_KEY: 'sk-test' })
    const res = await moderateText('kill all people')
    expect(res.source).toBe('heuristic')
    expect(res.reasons).toContain('hate_speech')
    expect(rootLog.warn).toHaveBeenCalledWith('AI moderation: OpenAI init failed:', 'bad api key')
    expect(openaiCtor).toHaveBeenCalledTimes(1)
    await moderateText('ещё раз')
    expect(openaiCtor).toHaveBeenCalledTimes(1)
    expect(openaiCreate).not.toHaveBeenCalled()
  })
})

describe('moderateText — эвристика без OPENAI_API_KEY', () => {
  it('каждый паттерн распознаётся со своим ключом причин', async () => {
    const { moderateText } = await freshModeration()
    const cases = [
      ['watch this porn now', 'explicit_sexual'],
      ['kill all people', 'hate_speech'],
      ['click here for free money', 'spam'],
      ['напиши на ivan@mail.ru или +791612345678901', 'personal_info'],
      ['i will stab you tomorrow', 'violence'],
    ]
    for (const [text, reason] of cases) {
      const res = await moderateText(text)
      expect(res.source).toBe('heuristic')
      expect(res.reasons).toContain(reason)
    }
  })

  it('несколько причин в одном тексте → все паттерны сходятся', async () => {
    const { moderateText } = await freshModeration()
    const res = await moderateText('porn: click here, kill all')
    expect(res.reasons).toEqual(expect.arrayContaining(['explicit_sexual', 'hate_speech', 'spam']))
    expect(res.safe).toBe(false)
    expect(res.confidence).toBe(0.6)
  })

  it('безопасный текст: safe=true, confidence 0.95', async () => {
    const { moderateText } = await freshModeration()
    const res = await moderateText('привет, как дела?')
    expect(res).toEqual({ safe: true, reasons: [], confidence: 0.95, source: 'heuristic' })
  })

  it('клиент OpenAI не создаётся вообще без ключа', async () => {
    const { moderateText } = await freshModeration()
    await moderateText('текст')
    expect(openaiCtor).not.toHaveBeenCalled()
    expect(openaiCreate).not.toHaveBeenCalled()
  })
})

describe('moderateImage — Rekognition', () => {
  it('unsafe-лейблы (не Safe/Neutral): safe=false, labels с процентами', async () => {
    rekSend.mockResolvedValue({
      ModerationLabels: [
        { Name: 'Explicit Nudity', ParentName: 'Explicit', Confidence: 96.4 },
        { Name: 'Benign', ParentName: 'Safe', Confidence: 99 },
      ],
    })
    const { moderateImage } = await freshModeration({ AWS_ACCESS_KEY_ID: 'AKIA' })
    const res = await moderateImage(tempImage())
    expect(res.safe).toBe(false)
    expect(res.reasons).toEqual(['Explicit Nudity'])
    expect(res.labels).toEqual(['Explicit Nudity (96%)', 'Benign (99%)'])
    expect(res.source).toBe('rekognition')
    const command = rekSend.mock.calls[0][0]
    expect(command.input.MinConfidence).toBe(70)
    expect(command.input.Image.Bytes).toBeInstanceOf(Buffer)
  })

  it('только Safe/Neutral-лейблы: safe=true', async () => {
    rekSend.mockResolvedValue({
      ModerationLabels: [{ Name: 'Benign', ParentName: 'Safe', Confidence: 90 }],
    })
    const { moderateImage } = await freshModeration({ AWS_ACCESS_KEY_ID: 'AKIA' })
    const res = await moderateImage(tempImage())
    expect(res.safe).toBe(true)
    expect(res.reasons).toEqual([])
  })

  it('пустой ответ Rekognition: safe=true (нет непрошедших лейблов)', async () => {
    rekSend.mockResolvedValue({})
    const { moderateImage } = await freshModeration({ AWS_ACCESS_KEY_ID: 'AKIA' })
    const res = await moderateImage(tempImage())
    expect(res.safe).toBe(true)
    expect(res.labels).toEqual([])
  })

  it('send падает: warn и fail-closed fallback (safe=null)', async () => {
    rekSend.mockRejectedValue(new Error('throttling'))
    const { moderateImage } = await freshModeration({ AWS_ACCESS_KEY_ID: 'AKIA' })
    const res = await moderateImage(tempImage())
    expect(res.safe).toBeNull()
    expect(res.source).toBe('none')
    expect(rootLog.warn).toHaveBeenCalledWith('AI moderation: Rekognition error:', 'throttling')
  })

  it('файл не читается: тот же catch → fallback, а не исключение', async () => {
    const { moderateImage } = await freshModeration({ AWS_ACCESS_KEY_ID: 'AKIA' })
    const res = await moderateImage(path.join(os.tmpdir(), 'no-such-file.jpg'))
    expect(res.safe).toBeNull()
    expect(res.source).toBe('none')
  })

  it('конструктор клиента падает: warn и fallback', async () => {
    flags.rekCtorFails = true
    const { moderateImage } = await freshModeration({ AWS_ACCESS_KEY_ID: 'AKIA' })
    const res = await moderateImage(tempImage())
    expect(res.safe).toBeNull()
    expect(rootLog.warn).toHaveBeenCalledWith('AI moderation: Rekognition init failed:', 'bad region')
    expect(rekSend).not.toHaveBeenCalled()
  })
})

describe('reviewProfile и isAIModerationConfigured', () => {
  it('reviewProfile склеивает непустые поля профиля', async () => {
    openaiCreate.mockResolvedValue({
      results: [{ flagged: false, categories: {}, category_scores: {} }],
    })
    const { reviewProfile } = await freshModeration({ OPENAI_API_KEY: 'sk-test' })
    await reviewProfile({ display_name: 'Иван', bio: null, city: 'Москва' })
    expect(openaiCreate).toHaveBeenCalledWith({ input: 'Иван Москва' })
  })

  it('isAIModerationConfigured: ключ → true, без ключей → false', async () => {
    let mod = await freshModeration()
    expect(mod.isAIModerationConfigured()).toBe(false)
    mod = await freshModeration({ OPENAI_API_KEY: 'sk-test' })
    expect(mod.isAIModerationConfigured()).toBe(true)
    mod = await freshModeration({ AWS_ACCESS_KEY_ID: 'AKIA' })
    expect(mod.isAIModerationConfigured()).toBe(true)
  })
})
