import pool from './db.js'
import logger from './logger.js'

// Провайдеры вебхуков. Значение ложится и в webhook_events (дедуп), и в
// webhook_deliveries (журнал), и по нему же админка выбирает обработчик для replay.
export const WEBHOOK_PROVIDERS = Object.freeze({
  premium: 'stripe',
  events: 'stripe_event',
  partnerOrder: 'stripe_partner_order',
  partnerSubscription: 'stripe_partner_sub',
  hangoutTicket: 'stripe_hangout_ticket',
  iap: 'revenuecat',
})

function serializePayload(payload) {
  if (payload == null) return null
  if (typeof payload === 'string') return payload
  try {
    return JSON.stringify(payload)
  } catch {
    return null
  }
}

/**
 * Журнал доставки. Пишется ВНЕ транзакции обработки: строка webhook_events
 * (дедуп) откатывается вместе с транзакцией, поэтому упавшая доставка по ней
 * не видна, а журнал обязан её сохранить. Ошибка записи журнала не должна
 * ронять обработку платежа — потому try/catch и только лог.
 */
export async function logWebhookDelivery({ provider, eventId, eventType, payload }) {
  try {
    await pool.query(
      `INSERT INTO webhook_deliveries (provider, event_id, event_type, status, payload, attempts)
       VALUES (?, ?, ?, 'received', ?, 1)
       ON DUPLICATE KEY UPDATE event_type = VALUES(event_type), payload = VALUES(payload), attempts = attempts + 1`,
      [provider, String(eventId || ''), eventType || null, serializePayload(payload)],
    )
  } catch (err) {
    logger.error('Webhook journal insert failed:', err.message)
  }
}

export async function markWebhookProcessed(provider, eventId) {
  try {
    await pool.query(
      `UPDATE webhook_deliveries SET status = 'processed', error = NULL, processed_at = NOW()
       WHERE provider = ? AND event_id = ?`,
      [provider, String(eventId || '')],
    )
  } catch (err) {
    logger.error('Webhook journal update failed:', err.message)
  }
}

export async function markWebhookFailed(provider, eventId, error) {
  try {
    await pool.query(
      `UPDATE webhook_deliveries SET status = 'failed', error = ?, processed_at = NOW()
       WHERE provider = ? AND event_id = ?`,
      [String(error || 'unknown error').slice(0, 1000), provider, String(eventId || '')],
    )
  } catch (err) {
    logger.error('Webhook journal update failed:', err.message)
  }
}

export async function listWebhookDeliveries({ provider, status, limit, offset } = {}) {
  const where = []
  const params = []
  if (provider) {
    where.push('provider = ?')
    params.push(provider)
  }
  if (status) {
    where.push('status = ?')
    params.push(status)
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200)
  const off = Math.max(Number(offset) || 0, 0)

  const [rows] = await pool.query(
    `SELECT id, provider, event_id AS eventId, event_type AS eventType, status, error, attempts,
            created_at AS createdAt, processed_at AS processedAt
     FROM webhook_deliveries ${clause}
     ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, lim, off],
  )
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM webhook_deliveries ${clause}`,
    params,
  )
  return { rows, total: Number(total) || 0, limit: lim, offset: off }
}

export async function getWebhookDelivery(id) {
  const [rows] = await pool.query(
    `SELECT id, provider, event_id AS eventId, event_type AS eventType, status, payload
     FROM webhook_deliveries WHERE id = ?`,
    [id],
  )
  return rows[0] || null
}
