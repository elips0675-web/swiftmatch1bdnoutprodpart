import pool from './db.js'
import { createLogger } from './logger.js'

const log = createLogger('subscriptions')

const DAY_MS = 24 * 60 * 60 * 1000

export async function expireSubscriptions(db = pool) {
  const [result] = await db.query(
    `UPDATE subscriptions
        SET is_active = 0,
            status = IF(status = 'active', 'expired', status)
      WHERE is_active = 1 AND expires_at <= NOW()`,
  )
  const affected = result?.affectedRows ?? 0
  if (affected > 0) log.info(`Expired ${affected} subscriptions`)
  return affected
}

let expiryTimer = null

function runExpiry(db) {
  expireSubscriptions(db).catch((err) =>
    log.error(`Subscription expiry failed: ${err?.message ?? err}`),
  )
}

export function startSubscriptionExpiry({ intervalMs = DAY_MS, db = pool } = {}) {
  if (expiryTimer) return expiryTimer
  runExpiry(db)
  expiryTimer = setInterval(() => runExpiry(db), intervalMs)
  expiryTimer.unref?.()
  return expiryTimer
}

export function stopSubscriptionExpiry() {
  if (!expiryTimer) return
  clearInterval(expiryTimer)
  expiryTimer = null
}
