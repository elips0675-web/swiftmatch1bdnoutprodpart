import { describe, it, expect, vi } from 'vitest'

const { rootLog } = vi.hoisted(() => ({
  rootLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../logger.js', () => ({
  default: rootLog,
  createLogger: () => rootLog,
  rootLogger: rootLog,
}))

import { createBreaker } from '../circuit-breaker.js'

describe('createBreaker — обёртка opossum', () => {
  it('успешный вызов прокидывает результат и аргументы во внутреннюю функцию', async () => {
    const fn = vi.fn(async (a, b) => a + b)
    const breaker = createBreaker(fn, 'test-ok')
    await expect(breaker.fire(2, 3)).resolves.toBe(5)
    expect(fn).toHaveBeenCalledWith(2, 3)
  })

  it('ошибка внутренней функции пробрасывается наружу', async () => {
    const breaker = createBreaker(async () => {
      throw new Error('boom')
    }, 'test-fail')
    await expect(breaker.fire()).rejects.toThrow('boom')
  })

  it('дефолтные параметры: timeout 10s, порог 50 %, reset 30s', () => {
    const breaker = createBreaker(async () => 1, 'test-defaults')
    expect(breaker.options.timeout).toBe(10_000)
    expect(breaker.options.errorThresholdPercentage).toBe(50)
    expect(breaker.options.resetTimeout).toBe(30_000)
    expect(breaker.options.volumeThreshold).toBe(5)
  })

  it('переданные opts перекрывают дефолты', () => {
    const breaker = createBreaker(async () => 1, 'test-opts', { timeout: 9_000, volumeThreshold: 3 })
    expect(breaker.options.timeout).toBe(9_000)
    expect(breaker.options.volumeThreshold).toBe(3)
    expect(breaker.options.resetTimeout).toBe(30_000)
  })

  it('событие open пишет warn с именем breaker', () => {
    const breaker = createBreaker(async () => 1, 'stripe-checkout')
    breaker.emit('open')
    expect(rootLog.warn).toHaveBeenCalledWith('[circuit-breaker] stripe-checkout — OPEN (failing fast)')
  })

  it('события halfOpen и close пишут info', () => {
    const breaker = createBreaker(async () => 1, 'openai-icebreakers')
    breaker.emit('halfOpen')
    breaker.emit('close')
    expect(rootLog.info).toHaveBeenCalledWith('[circuit-breaker] openai-icebreakers — HALF-OPEN (testing recovery)')
    expect(rootLog.info).toHaveBeenCalledWith('[circuit-breaker] openai-icebreakers — CLOSED (recovered)')
  })

  it('событие fallback пишет warn', () => {
    const breaker = createBreaker(async () => 1, 's3-upload')
    breaker.emit('fallback')
    expect(rootLog.warn).toHaveBeenCalledWith('[circuit-breaker] s3-upload — fallback invoked')
  })
})
