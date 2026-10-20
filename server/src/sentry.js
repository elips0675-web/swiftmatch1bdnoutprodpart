import * as Sentry from '@sentry/node'
import { rootLogger } from './logger.js'

const SENTRY_DSN = process.env.SENTRY_DSN

export function initSentry() {
  if (!SENTRY_DSN) {
    rootLogger.warn('[sentry] SENTRY_DSN not set, skipping')
    return false
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    release: `swiftmatch-server@${process.env.npm_package_version || '0.0.0'}`,
    integrations: [
      Sentry.expressIntegration({ shouldHandleError: () => false }),
    ],
    // @sentry/node v11 собирает по умолчанию больше, чем v10: userInfo, cookies,
    // тела запросов/ответов, данные DB-запросов и входы/выходы genAI уходят в
    // Sentry, если не ограничить явно. Для дейтинга это регрессия приватности
    // (переписка, cookie авторизации, содержимое профиля), поэтому держим
    // ограничительный базлайн v10 явно, а не полагаемся на дефолт.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpBodies: [],
      databaseQueryData: false,
      genAI: { inputs: false, outputs: false },
    },
    beforeSend(event) {
      if (event.user) {
        delete event.user.email
        delete event.user.ip_address
        delete event.user.username
      }
      if (event.request?.headers) {
        delete event.request.headers['authorization']
        delete event.request.headers['cookie']
      }
      if (event.exception) {
        event.exception.values = event.exception.values?.map(v => ({
          ...v,
          value: v.value?.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[EMAIL]'),
        }))
      }
      return event
    },
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  })

  // @sentry/node v8+ удалил legacy `Sentry.Handlers`. Инструментацию Express
  // (request scope/tracing) делает `expressIntegration()` внутри `init()`
  // (см. integrations выше), а ошибки маршрутов ловит `setupExpressErrorHandler`,
  // зарегистрированный ПОСЛЕ маршрутов (см. registerSentryErrorHandler) —
  // error-middleware, поставленный до маршрутов, в Express никогда не сработает.
  rootLogger.info('[sentry] initialized')
  return true
}

export function registerSentryErrorHandler(app) {
  if (!SENTRY_DSN) return false
  Sentry.setupExpressErrorHandler(app)
  return true
}
