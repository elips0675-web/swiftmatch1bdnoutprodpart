// Circuit Breaker для внешних API (аудит дипсик: нет таймаутов и retry с backoff)
// При падении внешнего сервиса запросы fail-fast вместо зависания на 24 сек.
import CircuitBreaker from 'opossum'
import { rootLogger } from './logger.js'

const defaultOptions = {
  timeout: 10_000,
  errorThresholdPercentage: 50,
  resetTimeout: 30_000,
  volumeThreshold: 5,
}

export function createBreaker(fn, name, opts = {}) {
  const breaker = new CircuitBreaker(fn, { ...defaultOptions, ...opts })

  breaker.on('open', () => {
    rootLogger.warn(`[circuit-breaker] ${name} — OPEN (failing fast)`)
  })

  breaker.on('halfOpen', () => {
    rootLogger.info(`[circuit-breaker] ${name} — HALF-OPEN (testing recovery)`)
  })

  breaker.on('close', () => {
    rootLogger.info(`[circuit-breaker] ${name} — CLOSED (recovered)`)
  })

  breaker.on('fallback', () => {
    rootLogger.warn(`[circuit-breaker] ${name} — fallback invoked`)
  })

  return breaker
}

export default { createBreaker }
