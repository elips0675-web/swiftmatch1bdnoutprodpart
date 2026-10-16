import crypto from 'crypto'
import pool from './db.js'
import logger from './logger.js'
import { JWT_SECRET } from './middleware.js'

const REASON_MAX = 64
const TOKEN_HEX = 64

function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase()
}

export function unsubscribeToken(userId, email) {
  return crypto
    .createHmac('sha256', JWT_SECRET())
    .update(`${Number(userId)}:${normalizeEmail(email)}`)
    .digest('hex')
}

export function verifyUnsubscribeToken(userId, email, token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token)) return false
  const expected = Buffer.from(unsubscribeToken(userId, email), 'hex')
  const given = Buffer.from(token.toLowerCase(), 'hex')
  if (expected.length !== given.length || expected.length !== TOKEN_HEX / 2) return false
  return crypto.timingSafeEqual(expected, given)
}

export function webOrigin() {
  return process.env.CLIENT_URL || process.env.CORS_ORIGIN || 'http://localhost:8081'
}

export function buildUnsubscribeUrl(userId, email) {
  return `${webOrigin()}/unsubscribe?u=${encodeURIComponent(String(userId))}&t=${unsubscribeToken(userId, email)}`
}

export async function isUnsubscribeFeatureEnabled() {
  try {
    const [[row]] = await pool.query('SELECT email_unsubscribe_enabled FROM feature_flags WHERE id = 1')
    if (!row || row.email_unsubscribe_enabled === null || row.email_unsubscribe_enabled === undefined) return true
    return Boolean(row.email_unsubscribe_enabled)
  } catch (err) {
    logger.error('Unsubscribe flag load failed (fail-open):', err)
    return true
  }
}

export async function recordUnsubscribe({ userId, email, reason }) {
  const normalized = normalizeEmail(email)
  const text = typeof reason === 'string' && reason.length > 0 ? reason.slice(0, REASON_MAX) : null
  await pool.query(
    `INSERT INTO email_unsubscribes (user_id, email, reason) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE user_id = COALESCE(VALUES(user_id), user_id),
       reason = COALESCE(VALUES(reason), reason)`,
    [userId ?? null, normalized, text],
  )
}

export async function listEmailRecipients() {
  const [rows] = await pool.query(
    `SELECT u.id, u.email FROM users u
     LEFT JOIN email_unsubscribes e ON e.email = u.email
     WHERE u.is_active = 1 AND u.deleted_at IS NULL AND e.id IS NULL`,
  )
  return rows.map((r) => ({ id: r.id, email: r.email }))
}
