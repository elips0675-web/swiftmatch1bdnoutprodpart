// Stage 113 (TEST-03): `src/sentry.js` — латентный дефект снят.
// Stage 114 (DEPS-02): `@sentry/node` поднят 9 → 11, `dataCollection` ограничен явно.
//
// В `@sentry/node` v8 удалили legacy `Sentry.Handlers`, а в дереве стоял v9
// (9.47.2): `typeof Sentry.Handlers === 'undefined'`. Старый код звал
// `Sentry.Handlers.requestHandler()` на импорте-пути `initSentry` и
// `Sentry.Handlers.errorHandler()` в `registerSentryErrorHandler` — то есть
// падал `TypeError` ровно тогда, когда `SENTRY_DSN` задан, то есть в проде,
// где Sentry и нужен. В dev/тестах DSN пуст, `initSentry` выходит на первой
// строке (`:7-10`), поэтому дефект не всплывал.
//
// Тест фиксирует контракт v9+: `init()` получает `expressIntegration` (не
// `Handlers.requestHandler`), ошибки маршрутов ловит `setupExpressErrorHandler`,
// а не `Handlers.errorHandler`. Мок `@sentry/node` сделан так, что обращение к
// несуществующему `Handlers` даёт `undefined`, как в реальном пакете, — старая
// реализация упала бы на первом же тесте.
//
// Отдельно: v11 собирает по умолчанию больше, чем v10 (userInfo, cookies,
// тела запросов/ответов, данные DB-запросов, входы/выходы genAI), поэтому тест
// требует явный ограничительный `dataCollection` — иначе приватность
// дейтинг-переписки и cookie авторизации утекали бы в Sentry по дефолту.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'

vi.mock('../logger.js', () => {
  const mock = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
  return { default: mock, createLogger: () => ({ ...mock }), rootLogger: mock }
})

const sentryMock = {
  init: vi.fn(),
  expressIntegration: vi.fn((opts) => ({ name: 'Express', opts })),
  setupExpressErrorHandler: vi.fn(),
}

vi.mock('@sentry/node', () => sentryMock)

import { rootLogger } from '../logger.js'

async function freshSentry(dsn) {
  if (dsn === undefined) delete process.env.SENTRY_DSN
  else process.env.SENTRY_DSN = dsn
  vi.resetModules()
  return import('../sentry.js')
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.SENTRY_DSN
})

describe('sentry.js — инициализация при @sentry/node v9', () => {
  it('без SENTRY_DSN — warn и false, init не вызывается', async () => {
    const mod = await freshSentry(undefined)
    expect(mod.initSentry()).toBe(false)
    expect(rootLogger.warn).toHaveBeenCalledWith('[sentry] SENTRY_DSN not set, skipping')
    expect(sentryMock.init).not.toHaveBeenCalled()
    expect(sentryMock.setupExpressErrorHandler).not.toHaveBeenCalled()
  })

  it('с DSN — init с expressIntegration и setupExpressErrorHandler, без legacy Handlers', async () => {
    const mod = await freshSentry('https://public@example.com/1')
    const app = express()
    expect(mod.initSentry()).toBe(true)

    expect(sentryMock.expressIntegration).toHaveBeenCalledTimes(1)
    expect(sentryMock.init).toHaveBeenCalledTimes(1)
    const opts = sentryMock.init.mock.calls[0][0]
    expect(opts.dsn).toBe('https://public@example.com/1')
    expect(opts.integrations).toEqual([{ name: 'Express', opts: { shouldHandleError: expect.any(Function) } }])
    expect(opts.integrations[0].opts.shouldHandleError()).toBe(false)
    expect(opts.dataCollection).toEqual({
      userInfo: false,
      cookies: false,
      httpBodies: [],
      databaseQueryData: false,
      genAI: { inputs: false, outputs: false },
    })
    expect(opts.tracesSampleRate).toBeGreaterThan(0)
    expect(typeof opts.beforeSend).toBe('function')
    expect(rootLogger.info).toHaveBeenCalledWith('[sentry] initialized')

    expect(mod.registerSentryErrorHandler(app)).toBe(true)
    expect(sentryMock.setupExpressErrorHandler).toHaveBeenCalledWith(app)
  })

  it('beforeSend вычищает email/IP/username, auth/cookie-заголовки и email в тексте ошибки', async () => {
    const mod = await freshSentry('https://public@example.com/1')
    mod.initSentry(express())
    const beforeSend = sentryMock.init.mock.calls[0][0].beforeSend

    const event = beforeSend({
      user: { email: 'a@b.co', ip_address: '1.2.3.4', username: 'vasya', id: 42 },
      request: { headers: { authorization: 'Bearer x', cookie: 'a=b', 'x-rid': 'keep' } },
      exception: { values: [{ value: 'boom для user@example.com и test@mail.ru' }] },
    })

    expect(event.user).toEqual({ id: 42 })
    expect(event.request.headers).toEqual({ 'x-rid': 'keep' })
    expect(event.exception.values[0].value).toBe('boom для [EMAIL] и [EMAIL]')
  })

  it('beforeSend переживает событие без user/request/exception', async () => {
    const mod = await freshSentry('https://public@example.com/1')
    mod.initSentry(express())
    const beforeSend = sentryMock.init.mock.calls[0][0].beforeSend
    expect(() => beforeSend({ message: 'plain' })).not.toThrow()
  })

  it('registerSentryErrorHandler без DSN — false, хендлер не регистрируется', async () => {
    const mod = await freshSentry(undefined)
    expect(mod.registerSentryErrorHandler(express())).toBe(false)
    expect(sentryMock.setupExpressErrorHandler).not.toHaveBeenCalled()
  })

  it('в production — environment/сэмплирование по NODE_ENV и release без версии', async () => {
    delete process.env.npm_package_version
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const mod = await freshSentry('https://public@example.com/1')
      mod.initSentry(express())
      const opts = sentryMock.init.mock.calls[0][0]
      expect(opts.environment).toBe('production')
      expect(opts.tracesSampleRate).toBe(0.1)
      expect(opts.release).toBe('swiftmatch-server@0.0.0')
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prev
    }
  })

  it('без NODE_ENV — environment development и полное сэмплирование', async () => {
    const prev = process.env.NODE_ENV
    delete process.env.NODE_ENV
    try {
      const mod = await freshSentry('https://public@example.com/1')
      mod.initSentry(express())
      const opts = sentryMock.init.mock.calls[0][0]
      expect(opts.environment).toBe('development')
      expect(opts.tracesSampleRate).toBe(1.0)
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prev
    }
  })
})
