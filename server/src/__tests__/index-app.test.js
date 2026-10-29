// Stage 226 (COV-03, часть 29): `server/src/index.js` — единственный файл
// сборки приложения — не покрывался ни одним тестом (0 %). `routes-mounted`
// поднимает его дочерним процессом, поэтому покрытие туда не собирается, а
// все проверки шли по тексту файла. Здесь приложение собирается в этом же
// процессе: инфраструктурные модули (WS, очереди, планировщики, Redis, Sentry,
// Swagger) замоканы, роуты — настоящие. Проверяются реальные ветки: request-id,
// alias `/api/v1`, dev-login, логин с lockout и TOTP, logout, `/api/content`,
// гейт `/api/admin`, `/api/admin/me`, финальный error handler, listen-callback
// и graceful shutdown.

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'

vi.hoisted(() => {
  process.env.NODE_ENV = 'test'
  process.env.JWT_SECRET = 'test-index-secret-0123456789abcdef'
  process.env.PORT = '45999'
  delete process.env.REDIS_URL
  delete process.env.CORS_ORIGIN
})

const captured = vi.hoisted(() => ({ apps: [], servers: [] }))

vi.mock('http', () => ({
  createServer: (app) => {
    const fake = {
      app,
      port: null,
      listenCb: null,
      listening: false,
      listen(port, cb) {
        fake.port = port
        fake.listenCb = cb
        fake.listening = true
        return fake
      },
      close: vi.fn((cb) => {
        fake.listening = false
        if (cb) cb()
      }),
      on: vi.fn(),
      once: vi.fn(),
    }
    captured.apps.push(app)
    captured.servers.push(fake)
    return fake
  },
  default: {},
}))

const db = vi.hoisted(() => ({ query: vi.fn(), end: vi.fn() }))
vi.mock('../db.js', () => ({ default: db }))

const log = vi.hoisted(() => {
  const make = () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() })
  const rootLogger = make()
  const requestLogger = make()
  return { rootLogger, requestLogger, createLogger: vi.fn(() => requestLogger) }
})
vi.mock('../logger.js', () => ({
  default: log.rootLogger,
  rootLogger: log.rootLogger,
  createLogger: log.createLogger,
}))

vi.mock('../ws.js', () => ({
  initIO: vi.fn(async () => {}),
  startMessageCleanup: vi.fn(),
  startCheckinCleanup: vi.fn(),
  stopWsTimers: vi.fn(),
  getIO: vi.fn(() => null),
  reverifySockets: vi.fn(),
}))

vi.mock('../cleanup.js', () => ({
  NOTIFICATION_RETENTION_DAYS: 90,
  purgeRevokedRefreshTokens: vi.fn(),
  purgeOldNotifications: vi.fn(),
  startRefreshTokenCleanup: vi.fn(),
  startNotificationCleanup: vi.fn(),
  stopCleanup: vi.fn(),
}))

vi.mock('../queue.js', () => ({
  emailQueue: null,
  pushQueue: null,
  imageQueue: null,
  redisConfigured: false,
  initQueues: vi.fn(),
  closeQueues: vi.fn(async () => {}),
  default: {},
}))

vi.mock('../queue-monitor.js', () => ({
  QUEUE_NAMES: ['email', 'push', 'image'],
  QUEUE_ALERT_THRESHOLD: 100,
  resolveQueues: vi.fn(() => ({})),
  queueStats: vi.fn(async () => ({})),
  redisConfigured: vi.fn(() => false),
  retryFailed: vi.fn(async () => ({})),
  queueNames: vi.fn(() => ['email', 'push', 'image']),
  backloggedQueues: vi.fn(() => []),
  formatBacklogAlert: vi.fn(() => ''),
  createBackpressureAlerter: vi.fn(() => () => {}),
  startQueueBackpressureMonitor: vi.fn(),
  stopQueueBackpressureMonitor: vi.fn(),
}))

vi.mock('../weekly-report.js', () => ({
  WEEK_MS: 7 * 24 * 60 * 60 * 1000,
  resolveRecipient: vi.fn(() => 'admin@test'),
  buildWeeklySummary: vi.fn(async () => ({})),
  formatWeeklyReport: vi.fn(() => ''),
  sendWeeklyReport: vi.fn(async () => ({})),
  startWeeklyReportMonitor: vi.fn(),
  stopWeeklyReportMonitor: vi.fn(),
}))

vi.mock('../subscriptions.js', () => ({
  expireSubscriptions: vi.fn(async () => 0),
  startSubscriptionExpiry: vi.fn(),
  stopSubscriptionExpiry: vi.fn(),
}))

vi.mock('../payment-reconcile.js', () => ({
  stripeReconcileEnabled: vi.fn(() => false),
  fetchRecentPaidSessions: vi.fn(async () => []),
  reconcilePremiumSubscriptions: vi.fn(async () => ({})),
  startPaymentReconcile: vi.fn(),
  stopPaymentReconcile: vi.fn(),
}))

vi.mock('../redis.js', () => ({
  getRedis: vi.fn(() => null),
  getRedisPub: vi.fn(() => null),
  getRedisSub: vi.fn(() => null),
  isRedisReady: vi.fn(async () => false),
  withRedis: vi.fn(async (fn) => fn(null)),
  disconnectRedis: vi.fn(async () => {}),
}))

vi.mock('../sentry.js', () => ({
  initSentry: vi.fn(() => false),
  registerSentryErrorHandler: vi.fn(() => false),
}))

vi.mock('../swagger.js', () => ({
  swaggerSpec: {},
  setupSwagger: vi.fn(),
}))

vi.mock('../lockout.js', () => ({
  isLocked: vi.fn(async () => null),
  recordFailure: vi.fn(async () => {}),
  recordSuccess: vi.fn(async () => {}),
}))

vi.mock('../totp.js', () => ({
  generateTotpSecret: vi.fn(() => ({ secret: 'SECRET', otpauthUrl: 'otpauth://x' })),
  verifyTotpToken: vi.fn(() => false),
}))

vi.mock('../middleware/adminAuth.js', () => ({
  adminAuth: vi.fn((req, res, next) => {
    if (!req.headers['x-anon-admin']) req.admin = { id: 9, teams: ['team-1'] }
    next()
  }),
}))

const bcrypt = vi.hoisted(() => ({ compare: vi.fn(async () => true), hash: vi.fn(async () => 'hash') }))
vi.mock('bcryptjs', () => ({ default: bcrypt, compare: bcrypt.compare, hash: bcrypt.hash }))

vi.mock('../shutdown.js', () => ({
  createGracefulShutdown: vi.fn(() => vi.fn(async () => true)),
}))

import pool from '../db.js'
import { adminAuth } from '../middleware/adminAuth.js'
import { isLocked, recordFailure, recordSuccess } from '../lockout.js'
import { verifyTotpToken } from '../totp.js'
import { getRedis, disconnectRedis } from '../redis.js'
import { closeQueues } from '../queue.js'
import { stopWsTimers } from '../ws.js'
import { stopCleanup } from '../cleanup.js'
import { stopQueueBackpressureMonitor } from '../queue-monitor.js'
import { stopWeeklyReportMonitor } from '../weekly-report.js'
import { stopSubscriptionExpiry } from '../subscriptions.js'
import { stopPaymentReconcile } from '../payment-reconcile.js'
import { createGracefulShutdown } from '../shutdown.js'

const JWT_SECRET = process.env.JWT_SECRET
const listeners = {}
const existing = {
  rej: new Set(process.listeners('unhandledRejection')),
  uncaught: new Set(process.listeners('uncaughtException')),
  term: new Set(process.listeners('SIGTERM')),
  int: new Set(process.listeners('SIGINT')),
}

let app = null
let server = null
let shutdownOptions = null
let shutdownFn = null
let guardLog = null

function rowsFor(pairs) {
  pool.query.mockImplementation(async (sql) => {
    const text = String(sql)
    for (const [needle, rows] of pairs) {
      if (text.includes(needle)) return [rows, []]
    }
    return [[], []]
  })
}

function signToken(payload = { userId: 7, role: 'admin' }) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '15m' })
}

beforeAll(async () => {
  await import('../index.js')

  app = captured.apps[0]
  server = captured.servers[0]
  const fresh = (event, before) => process.listeners(event).find((fn) => !before.has(fn))
  listeners.rej = fresh('unhandledRejection', existing.rej)
  listeners.uncaught = fresh('uncaughtException', existing.uncaught)
  listeners.term = fresh('SIGTERM', existing.term)
  listeners.int = fresh('SIGINT', existing.int)

  guardLog = log.rootLogger.info.mock.calls.find(([msg]) => String(msg).startsWith('Async guard:'))
  shutdownOptions = createGracefulShutdown.mock.calls[0][0]
  shutdownFn = createGracefulShutdown.mock.results[0].value
})

afterAll(() => {
  vi.unstubAllEnvs()
})

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockReset()
  pool.query.mockResolvedValue([[], []])
  pool.end.mockReset()
  pool.end.mockResolvedValue()
  isLocked.mockReset()
  isLocked.mockResolvedValue(null)
  recordFailure.mockReset()
  recordFailure.mockResolvedValue()
  recordSuccess.mockReset()
  recordSuccess.mockResolvedValue()
  verifyTotpToken.mockReset()
  verifyTotpToken.mockReturnValue(false)
  bcrypt.compare.mockReset()
  bcrypt.compare.mockResolvedValue(true)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('сборка приложения', () => {
  it('собирает приложение и запускает listen на PORT из окружения', () => {
    expect(app).toBeTypeOf('function')
    expect(server.listening).toBe(true)
    expect(server.port).toBe('45999')
  })

  it('логирует количество обёрнутых async-обработчиков', () => {
    expect(guardLog).toBeTruthy()
    expect(guardLog[0]).toMatch(/^Async guard: \d+\/\d+ route handlers wrapped$/)
  })
})

describe('request id и версия API', () => {
  it('пробрасывает присланный X-Request-Id в ответ', async () => {
    const res = await request(app).get('/health').set('x-request-id', 'rid-abc')
    expect(res.status).toBe(200)
    expect(res.headers['x-request-id']).toBe('rid-abc')
  })

  it('генерирует request id, если заголовка нет', async () => {
    const res = await request(app).get('/health')
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('алиас /api/v1/* работает и отдаёт X-API-Version', async () => {
    const res = await request(app).get('/api/v1/content')
    expect(res.status).toBe(200)
    expect(res.headers['x-api-version']).toBe('v1')
    expect(res.body.interests).toEqual([])
  })

  it('обычный путь /api/* заголовок версии не получает', async () => {
    const res = await request(app).get('/api/content')
    expect(res.status).toBe(200)
    expect(res.headers['x-api-version']).toBeUndefined()
  })
})

describe('POST /api/auth/dev-login', () => {
  it('в production отвечает 404 и не ходит в БД', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const res = await request(app).post('/api/auth/dev-login').send({})
    expect(res.status).toBe(404)
    expect(res.body.message).toBe('Not found')
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('входит админом, если в БД есть активный админ', async () => {
    rowsFor([[`role = 'admin'`, [{ id: 5 }]]])
    const res = await request(app).post('/api/auth/dev-login').send({})
    expect(res.status).toBe(200)
    expect(res.body.role).toBe('admin')
    expect(res.body.refresh_token).toMatch(/^[0-9a-f]{80}$/)
    expect(jwt.verify(res.body.token, JWT_SECRET).userId).toBe(5)
    expect(res.headers['set-cookie'].join(';')).toContain('sm_token=')
  })

  it('падает обратно на userId=2, если админа нет', async () => {
    const res = await request(app).post('/api/auth/dev-login').send({})
    expect(res.status).toBe(200)
    expect(res.body.role).toBe('user')
    expect(jwt.verify(res.body.token, JWT_SECRET).userId).toBe(2)
  })

  it('падает обратно на userId=2, если запрос админа упал', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (String(sql).includes('refresh_tokens')) return [[], []]
      throw new Error('db down')
    })
    const res = await request(app).post('/api/auth/dev-login').send({})
    expect(res.status).toBe(200)
    expect(jwt.verify(res.body.token, JWT_SECRET).userId).toBe(2)
  })
})

describe('POST /api/auth/login', () => {
  it('без email и пароля отвечает 400', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'a@b.c' })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Email and password required')
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('на заблокированный аккаунт отвечает 429 с остатком минут', async () => {
    isLocked.mockResolvedValueOnce(7)
    const res = await request(app).post('/api/auth/login').send({ email: 'A@B.c', password: 'x' })
    expect(res.status).toBe(429)
    expect(res.body.message).toContain('7 min')
    expect(isLocked).toHaveBeenCalledWith('a@b.c')
    expect(log.rootLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Login locked for a@b.c'))
  })

  it('неизвестный email: 401 и учёт неудачи', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'no@b.c', password: 'x' })
    expect(res.status).toBe(401)
    expect(res.body.message).toBe('Invalid credentials')
    expect(recordFailure).toHaveBeenCalledTimes(1)
  })

  it('неверный пароль: 401 и учёт неудачи', async () => {
    rowsFor([['FROM users WHERE email', [{ id: 3, role: 'user', password_hash: 'h', totp_enabled: 0 }]]])
    bcrypt.compare.mockResolvedValueOnce(false)
    const res = await request(app).post('/api/auth/login').send({ email: 'u@b.c', password: 'bad' })
    expect(res.status).toBe(401)
    expect(recordFailure).toHaveBeenCalledTimes(1)
    expect(recordSuccess).not.toHaveBeenCalled()
  })

  it('админ с 2FA без кода получает TOTP_REQUIRED', async () => {
    rowsFor([['FROM users WHERE email', [{ id: 4, role: 'admin', password_hash: 'h', totp_enabled: 1, totp_secret: 'S' }]]])
    const res = await request(app).post('/api/auth/login').send({ email: 'adm@b.c', password: 'ok' })
    expect(res.status).toBe(401)
    expect(res.body.message).toBe('TOTP_REQUIRED')
    expect(recordFailure).not.toHaveBeenCalled()
  })

  it('админ с 2FA и неверным кодом получает TOTP_INVALID', async () => {
    rowsFor([['FROM users WHERE email', [{ id: 4, role: 'admin', password_hash: 'h', totp_enabled: 1, totp_secret: 'S' }]]])
    verifyTotpToken.mockReturnValueOnce(false)
    const res = await request(app).post('/api/auth/login').send({ email: 'adm@b.c', password: 'ok', totp_code: '000000' })
    expect(res.status).toBe(401)
    expect(res.body.message).toBe('TOTP_INVALID')
    expect(verifyTotpToken).toHaveBeenCalledWith('S', '000000')
    expect(recordFailure).toHaveBeenCalledTimes(1)
  })

  it('админ с 2FA и верным кодом входит, email подтверждён', async () => {
    rowsFor([['FROM users WHERE email', [{ id: 4, role: 'admin', password_hash: 'h', totp_enabled: 1, totp_secret: 'S', verification_token: null }]]])
    verifyTotpToken.mockReturnValueOnce(true)
    const res = await request(app).post('/api/auth/login').send({ email: 'adm@b.c', password: 'ok', totp_code: '123456' })
    expect(res.status).toBe(200)
    expect(res.body.role).toBe('admin')
    expect(res.body.email_verified).toBe(true)
    expect(recordSuccess).toHaveBeenCalledWith('adm@b.c')
  })

  it('обычный пользователь с неподтверждённой почтой получает email_verified=false', async () => {
    rowsFor([['FROM users WHERE email', [{ id: 3, role: 'user', password_hash: 'h', totp_enabled: 0, verification_token: 'tok' }]]])
    const res = await request(app).post('/api/auth/login').send({ email: 'u@b.c', password: 'ok' })
    expect(res.status).toBe(200)
    expect(res.body.email_verified).toBe(false)
    expect(jwt.verify(res.body.token, JWT_SECRET).userId).toBe(3)
  })

  it('падение БД отдаёт 500 и пишет в лог', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await request(app).post('/api/auth/login').send({ email: 'u@b.c', password: 'ok' })
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Internal server error')
    expect(log.rootLogger.error).toHaveBeenCalledWith('Login error: db down')
  })
})

describe('POST /api/auth/logout', () => {
  it('удаляет refresh-токен из cookie и чистит cookie', async () => {
    const res = await request(app).post('/api/auth/logout').set('Cookie', 'sm_refresh=R1')
    expect(res.status).toBe(200)
    expect(pool.query).toHaveBeenCalledWith('DELETE FROM refresh_tokens WHERE token = ?', ['R1'])
    expect(res.headers['set-cookie'].join(';')).toContain('sm_refresh=;')
  })

  it('без cookie берёт refresh-токен из тела', async () => {
    const res = await request(app).post('/api/auth/logout').send({ refresh_token: 'R2' })
    expect(res.status).toBe(200)
    expect(pool.query).toHaveBeenCalledWith('DELETE FROM refresh_tokens WHERE token = ?', ['R2'])
  })

  it('без токена не ходит в БД', async () => {
    const res = await request(app).post('/api/auth/logout').send({})
    expect(res.status).toBe(200)
    expect(res.body.message).toBe('Logged out')
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('ошибка удаления не ломает ответ', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await request(app).post('/api/auth/logout').set('Cookie', 'sm_refresh=R3')
    expect(res.status).toBe(200)
  })
})

describe('GET /api/content', () => {
  it('без строки конфига отдаёт пустые списки', async () => {
    const res = await request(app).get('/api/content')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ interests: [], dating_goals: [], education: [], banned_words: [], cities: [] })
  })

  it('разбирает JSON-строки, схлопывает синоним technology → tech, берёт города из конфига', async () => {
    rowsFor([
      ['content_config', [{
        interests: '["sport","technology","sport"]',
        dating_goals: '["marriage"]',
        education: '["higher"]',
        banned_words: '["bad"]',
        cities: '["Moscow","Kazan"]',
      }]],
      ['DISTINCT city', [{ city: 'Berlin' }]],
    ])
    const res = await request(app).get('/api/content')
    expect(res.status).toBe(200)
    expect(res.body.interests).toEqual(['sport', 'tech'])
    expect(res.body.dating_goals).toEqual(['marriage'])
    expect(res.body.education).toEqual(['higher'])
    expect(res.body.banned_words).toEqual(['bad'])
    expect(res.body.cities).toEqual(['Moscow', 'Kazan'])
  })

  it('битый JSON и нестроковые поля деградируют к пустым спискам', async () => {
    rowsFor([
      ['content_config', [{ interests: ['tech'], dating_goals: '{oops', education: 42, banned_words: null, cities: '{bad' }]],
      ['DISTINCT city', [{ city: 'Berlin' }, { city: 'Kiev' }]],
    ])
    const res = await request(app).get('/api/content')
    expect(res.status).toBe(200)
    expect(res.body.interests).toEqual(['tech'])
    expect(res.body.dating_goals).toEqual([])
    expect(res.body.education).toEqual([])
    expect(res.body.banned_words).toEqual([])
    expect(res.body.cities).toEqual(['Berlin', 'Kiev'])
  })

  it('массив городов в конфиге приоритетнее списка из профилей', async () => {
    rowsFor([
      ['content_config', [{ interests: [], dating_goals: [], education: [], banned_words: [], cities: ['Paris'] }]],
      ['DISTINCT city', [{ city: 'Berlin' }]],
    ])
    const res = await request(app).get('/api/content')
    expect(res.body.cities).toEqual(['Paris'])
    expect(pool.query).toHaveBeenCalledTimes(1)
  })

  it('падение запроса отдаёт 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    const res = await request(app).get('/api/content')
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to fetch content')
    expect(log.rootLogger.error).toHaveBeenCalledWith('Public content error: db down')
  })
})

describe('гейт /api/admin', () => {
  it('GET /api/admin/features публичен и не зовёт adminAuth', async () => {
    const res = await request(app).get('/api/admin/features')
    expect(res.status).toBe(200)
    expect(res.body.videoCalls).toBe(true)
    expect(adminAuth).not.toHaveBeenCalled()
  })

  it('GET /api/admin/features/ с завершающим слэшем тоже публичен', async () => {
    const res = await request(app).get('/api/admin/features/')
    expect(res.status).toBe(200)
    expect(adminAuth).not.toHaveBeenCalled()
  })

  it('остальные GET проходят через adminAuth', async () => {
    const res = await request(app).get('/api/admin/no-such-endpoint')
    expect(res.status).toBe(404)
    expect(adminAuth).toHaveBeenCalledTimes(1)
  })

  it('не-GET на /features тоже проходит через adminAuth', async () => {
    const res = await request(app).post('/api/admin/features').send({})
    expect(res.status).toBe(404)
    expect(adminAuth).toHaveBeenCalledTimes(1)
  })
})

describe('GET /api/admin/me', () => {
  it('без токена отвечает 401 No token', async () => {
    const res = await request(app).get('/api/admin/me')
    expect(res.status).toBe(401)
    expect(res.body.message).toBe('No token')
  })

  it('невалидный токен отвечает 401 Invalid token', async () => {
    const res = await request(app).get('/api/admin/me').set('Authorization', 'Bearer garbage')
    expect(res.status).toBe(401)
    expect(res.body.message).toBe('Invalid token')
  })

  it('токен без пользователя в БД отвечает 401 User not found', async () => {
    const res = await request(app).get('/api/admin/me').set('Authorization', `Bearer ${signToken()}`)
    expect(res.status).toBe(401)
    expect(res.body.message).toBe('User not found')
  })

  it('отдаёт профиль вместе с командами модератора', async () => {
    rowsFor([['FROM users u', [{ id: 7, role: 'admin', name: 'Админ', email: 'adm@b.c' }]]])
    const res = await request(app).get('/api/admin/me').set('Authorization', `Bearer ${signToken()}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: 7, role: 'admin', name: 'Админ', email: 'adm@b.c', teams: ['team-1'] })
  })

  it('без req.admin отдаёт пустой список команд', async () => {
    rowsFor([['FROM users u', [{ id: 7, role: 'admin', name: 'A', email: 'a@b.c' }]]])
    const res = await request(app)
      .get('/api/admin/me')
      .set('x-anon-admin', '1')
      .set('Authorization', `Bearer ${signToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.teams).toEqual([])
  })

  it('берёт токен из cookie, если заголовка нет', async () => {
    rowsFor([['FROM users u', [{ id: 7, role: 'admin', name: 'A', email: 'a@b.c' }]]])
    const res = await request(app).get('/api/admin/me').set('Cookie', `sm_token=${signToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.id).toBe(7)
  })
})

describe('финальный error handler', () => {
  it('ошибка парсинга тела — это 400, а не 500: клиентская ошибка не будит алерты', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":')
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ message: 'Bad request', code: 'BAD_REQUEST' })
    expect(log.requestLogger.error).toHaveBeenCalledWith('Unhandled error', expect.any(Error))
  })

  it('необработанное исключение маршрута отдаёт 500', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (String(sql).includes('refresh_tokens')) throw new Error('insert failed')
      return [[], []]
    })
    const res = await request(app).post('/api/auth/dev-login').send({})
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Internal server error')
    expect(log.requestLogger.error).toHaveBeenCalledWith('Unhandled error', expect.any(Error))
  })
})

describe('listen-callback и graceful shutdown', () => {
  it('в непроизводственном окружении только подключает Redis', () => {
    log.rootLogger.warn.mockClear()
    server.listenCb()
    expect(log.rootLogger.info).toHaveBeenCalledWith('SwiftMatch API running on port 45999')
    expect(getRedis).toHaveBeenCalled()
    expect(log.rootLogger.warn).not.toHaveBeenCalled()
  })

  it('в production предупреждает о незаполненных интеграциях', () => {
    log.rootLogger.warn.mockClear()
    vi.stubEnv('NODE_ENV', 'production')
    server.listenCb()
    expect(log.rootLogger.warn).toHaveBeenCalledWith(expect.stringContaining('non-live integrations'))
  })

  it('в production с живыми интеграциями молчит', () => {
    log.rootLogger.warn.mockClear()
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_live_1')
    vi.stubEnv('SMTP_HOST', 'smtp.test')
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'sid')
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'tok')
    vi.stubEnv('FCM_SERVER_KEY', 'fcm')
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
    vi.stubEnv('OPENAI_API_KEY', 'sk-openai')
    server.listenCb()
    expect(log.rootLogger.warn).not.toHaveBeenCalled()
  })

  it('shutdown-опции останавливают все мониторы и закрывают пул', async () => {
    const options = shutdownOptions
    expect(options.httpServer).toBe(server)
    expect(options.closeQueues).toBe(closeQueues)
    expect(options.disconnectRedis).toBe(disconnectRedis)

    options.stopWsTimers()
    expect(stopWsTimers).toHaveBeenCalledTimes(1)
    expect(stopCleanup).toHaveBeenCalledTimes(1)
    expect(stopQueueBackpressureMonitor).toHaveBeenCalledTimes(1)
    expect(stopWeeklyReportMonitor).toHaveBeenCalledTimes(1)
    expect(stopSubscriptionExpiry).toHaveBeenCalledTimes(1)
    expect(stopPaymentReconcile).toHaveBeenCalledTimes(1)

    pool.end.mockRejectedValueOnce(new Error('pool end failed'))
    await expect(options.closePool()).resolves.toBeUndefined()
    expect(pool.end).toHaveBeenCalledTimes(1)
  })

  it('SIGTERM и SIGINT вызывают graceful shutdown', () => {
    listeners.term()
    listeners.int()
    expect(shutdownFn).toHaveBeenNthCalledWith(1, 'SIGTERM')
    expect(shutdownFn).toHaveBeenNthCalledWith(2, 'SIGINT')
  })

  it('unhandledRejection логирует стек и голую причину', () => {
    log.rootLogger.error.mockClear()
    listeners.rej(new Error('boom-rej'))
    expect(log.rootLogger.error).toHaveBeenCalledWith(expect.stringContaining('Unhandled rejection: Error: boom-rej'))
    listeners.rej('plain-reason')
    expect(log.rootLogger.error).toHaveBeenLastCalledWith('Unhandled rejection: plain-reason')
  })

  it('uncaughtException логирует стек и голую причину', () => {
    log.rootLogger.error.mockClear()
    listeners.uncaught(new Error('boom-unc'))
    expect(log.rootLogger.error).toHaveBeenCalledWith(expect.stringContaining('Uncaught exception: Error: boom-unc'))
    listeners.uncaught('plain-error')
    expect(log.rootLogger.error).toHaveBeenLastCalledWith('Uncaught exception: plain-error')
  })
})
