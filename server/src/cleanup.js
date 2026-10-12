// Этап 42 (аудит kimi 1.3): revoked refresh-токены нужны 30 дней для reuse-детекта,
// дальше их удаляем, чтобы таблица не разрасталась бесконечно
import pool from './db.js'
import { createLogger } from './logger.js'

const log = createLogger('cleanup')

const DAY_MS = 24 * 60 * 60 * 1000

// P2 #21: notifications — журнал доставки (письмо/пуш на каждое событие). Через
// 90 дней запись бесполезна и для пользователя, и для разбора, но таблица
// растёт линейно от активности, поэтому старые строки вычищаем.
export const NOTIFICATION_RETENTION_DAYS = 90

export async function purgeRevokedRefreshTokens(db = pool) {
  const [result] = await db.query(
    'DELETE FROM refresh_tokens WHERE revoked = 1 AND created_at < NOW() - INTERVAL 30 DAY',
  )
  const affected = result?.affectedRows ?? 0
  if (affected > 0) log.info(`Purged ${affected} revoked refresh tokens`)
  return affected
}

export async function purgeOldNotifications(db = pool, days = NOTIFICATION_RETENTION_DAYS) {
  const [result] = await db.query(
    'DELETE FROM notifications WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)',
    [days],
  )
  const affected = result?.affectedRows ?? 0
  if (affected > 0) log.info(`Purged ${affected} notifications older than ${days} days`)
  return affected
}

let refreshTimer = null
let notificationTimer = null

export function startRefreshTokenCleanup(intervalMs = DAY_MS) {
  if (refreshTimer) return refreshTimer
  refreshTimer = setInterval(() => {
    purgeRevokedRefreshTokens().catch((err) => log.error('Refresh token cleanup failed: ' + err.message))
  }, intervalMs)
  refreshTimer.unref?.()
  return refreshTimer
}

export function startNotificationCleanup(intervalMs = DAY_MS) {
  if (notificationTimer) return notificationTimer
  notificationTimer = setInterval(() => {
    purgeOldNotifications().catch((err) => log.error('Notification cleanup failed: ' + err.message))
  }, intervalMs)
  notificationTimer.unref?.()
  return notificationTimer
}

// Останавливает оба фоновых таймера очистки. Безопасен без предварительного
// запуска: graceful shutdown зовёт его и на путях, где таймеры не поднимались.
export function stopCleanup() {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
  if (notificationTimer) {
    clearInterval(notificationTimer)
    notificationTimer = null
  }
}
