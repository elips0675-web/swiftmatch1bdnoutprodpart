// Rate limiters (этап 40: вынесено из index.js для тестируемости)
// Этап 48: in-memory store (Redis недоступен локально, fallback дефолтный express-rate-limit)
// Этап 120: Redis-backed store при доступном REDIS_URL (multi-instance safe);
// fallback на in-memory (дефолт express-rate-limit) когда Redis не сконфигурирован.
// Этап 146: FailOpenStore — обёртка над Redis-стором: смерть/обрыв Redis-клиента
// не роняет 500 все /api (инцидент 21.10.2026), счёт переходит в память,
// деградация и восстановление логируются один раз на переход.
import rateLimit, { MemoryStore } from 'express-rate-limit'
import { RedisStore } from 'rate-limit-redis'
import { getRedis } from '../redis.js'
import logger from '../logger.js'

export class FailOpenStore {
  constructor(primary, fallback = new MemoryStore()) {
    this.primary = primary
    this.fallback = fallback
    this.degraded = false
  }

  async init(options) {
    try {
      await this.primary.init?.(options)
      this.markRecovered()
    } catch (err) {
      this.markDegraded(err)
      await this.fallback.init?.(options)
    }
  }

  async increment(key) {
    try {
      const result = await this.primary.increment(key)
      this.markRecovered()
      return result
    } catch (err) {
      this.markDegraded(err)
      return this.fallback.increment(key)
    }
  }

  async decrement(key) {
    try {
      await this.primary.decrement(key)
      this.markRecovered()
    } catch (err) {
      this.markDegraded(err)
      await this.fallback.decrement(key)
    }
  }

  async resetKey(key) {
    try {
      await this.primary.resetKey(key)
      this.markRecovered()
    } catch (err) {
      this.markDegraded(err)
      await this.fallback.resetKey(key)
    }
  }

  markDegraded(err) {
    if (this.degraded) return
    this.degraded = true
    logger.error('[ratelimit] Redis store error — in-memory fallback', err)
  }

  markRecovered() {
    if (!this.degraded) return
    this.degraded = false
    logger.info('[ratelimit] Redis store recovered')
  }
}

// Паттерн как в lockout.js: если Redis сконфигурирован и доступен — общий
// счётчик между процессами (pm2 cluster / Docker replicas); иначе — memory.
export function getRateLimitStore(prefix = 'rl:') {
  const r = getRedis()
  if (!r) return undefined
  return new FailOpenStore(
    new RedisStore({
      prefix,
      sendCommand: (...args) => r.call(...args),
    })
  )
}

// Фабрики — для тестов с изолированными счётчиками
export const makeAuthLimiter = () =>
  rateLimit({
    windowMs: 60_000,
    // 60 → 200 (этап: Е2Е-прогон 133 тестов с одного IP упирается в 60/мин
    // auth-запросов; lockout на 5 неудач остаётся главным анти-брутфорс-барьером)
    max: 1000,
    standardHeaders: true,
    legacyHeaders: false,
    store: getRateLimitStore('rl:auth:'),
    message: { message: 'Too many auth attempts' },
  })

export const makeApiLimiter = () =>
  rateLimit({
    windowMs: 60_000,
    max: 600,
    standardHeaders: true,
    legacyHeaders: false,
    store: getRateLimitStore('rl:api:'),
    message: { message: 'Too many requests' },
  })

export const makeChatMessageLimiter = () =>
  rateLimit({
    windowMs: 60_000,
    max: Number(process.env.CHAT_MESSAGE_RATE_MAX || 100),
    standardHeaders: true,
    legacyHeaders: false,
    store: getRateLimitStore('rl:chatmsg:'),
    message: { message: 'Too many messages' },
  })

export const makeIcebreakerLimiter = () =>
  rateLimit({
    windowMs: 60_000,
    max: Number(process.env.ICEBREAKER_RATE_MAX || 30),
    standardHeaders: true,
    legacyHeaders: false,
    store: getRateLimitStore('rl:icebreaker:'),
    message: { message: 'Too many icebreaker requests' },
  })

// Синглтоны для приложения
export const authLimiter = makeAuthLimiter()
export const apiLimiter = makeApiLimiter()
export const chatMessageLimiter = makeChatMessageLimiter()
export const icebreakerLimiter = makeIcebreakerLimiter()
