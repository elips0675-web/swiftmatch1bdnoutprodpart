import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { moderateImage } from '../ai-moderation.js'

describe('moderateImage: fail-closed без вердикта AI (P2 #34)', () => {
  let savedAws

  beforeEach(() => {
    savedAws = process.env.AWS_ACCESS_KEY_ID
    delete process.env.AWS_ACCESS_KEY_ID
  })

  afterEach(() => {
    if (savedAws === undefined) delete process.env.AWS_ACCESS_KEY_ID
    else process.env.AWS_ACCESS_KEY_ID = savedAws
  })

  it('без клиента Rekognition возвращает safe=null, а не ложное auto-approve', async () => {
    const result = await moderateImage('/tmp/does-not-exist.jpg')
    expect(result.safe).toBeNull()
    expect(result.source).toBe('none')
    expect(result.reasons).toContain('moderation_unavailable')
  })
})
