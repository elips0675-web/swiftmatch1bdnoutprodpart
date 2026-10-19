import pool from './db.js'
import logger from './logger.js'

export const QUIET_DEFAULTS = Object.freeze({
  enabled: false,
  start: '22:00',
  end: '08:00',
  timezone: 'UTC',
})

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export function isValidTimezone(tz) {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

function toMinutes(hhmm) {
  const m = TIME_RE.exec(hhmm)
  if (!m) return null
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
}

function localMinutes(now, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now)
    const hour = parts.find((p) => p.type === 'hour')?.value
    const minute = parts.find((p) => p.type === 'minute')?.value
    if (hour === undefined || minute === undefined) return null
    const value = Number(hour) * 60 + Number(minute)
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

export function isQuietAt(quiet, now = new Date()) {
  const settings = { ...QUIET_DEFAULTS, ...quiet }
  if (!settings.enabled) return false
  if (settings.start === settings.end) return false
  const start = toMinutes(settings.start)
  const end = toMinutes(settings.end)
  if (start === null || end === null) return false
  const minutes = localMinutes(now, settings.timezone)
  if (minutes === null) return false
  if (start < end) return minutes >= start && minutes < end
  return minutes >= start || minutes < end
}

export function normalizeQuiet(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { quiet: { ...QUIET_DEFAULTS }, invalid: ['quiet'] }
  }
  const quiet = { ...QUIET_DEFAULTS }
  const invalid = []
  if ('enabled' in input) {
    if (typeof input.enabled !== 'boolean') invalid.push('enabled')
    else quiet.enabled = input.enabled
  }
  if ('start' in input) {
    if (typeof input.start !== 'string' || !TIME_RE.test(input.start)) invalid.push('start')
    else quiet.start = input.start
  }
  if ('end' in input) {
    if (typeof input.end !== 'string' || !TIME_RE.test(input.end)) invalid.push('end')
    else quiet.end = input.end
  }
  if ('timezone' in input) {
    if (!isValidTimezone(input.timezone)) invalid.push('timezone')
    else quiet.timezone = input.timezone
  }
  return { quiet, invalid }
}

async function loadQuiet(userId) {
  try {
    const [rows] = await pool.query(
      `SELECT np.quiet_enabled AS enabled, np.quiet_start AS start,
              np.quiet_end AS end, np.quiet_timezone AS timezone,
              ff.quiet_hours_enabled AS flag
         FROM notification_preferences np
         LEFT JOIN feature_flags ff ON ff.id = 1
        WHERE np.user_id = ?`,
      [userId],
    )
    const row = rows[0]
    if (!row) return { quiet: { ...QUIET_DEFAULTS }, flagOn: false }
    return {
      quiet: {
        enabled: Number(row.enabled) === 1,
        start: row.start ?? QUIET_DEFAULTS.start,
        end: row.end ?? QUIET_DEFAULTS.end,
        timezone: row.timezone ?? QUIET_DEFAULTS.timezone,
      },
      flagOn: Number(row.flag ?? 0) === 1,
    }
  } catch (err) {
    logger.error('Quiet hours load failed (fail-open):', err)
    return { quiet: { ...QUIET_DEFAULTS }, flagOn: false }
  }
}

export async function getQuiet(userId) {
  const { quiet } = await loadQuiet(userId)
  return quiet
}

export async function isQuietNow(userId, now = new Date()) {
  const { quiet, flagOn } = await loadQuiet(userId)
  if (!flagOn) return false
  return isQuietAt(quiet, now)
}

export async function saveQuiet(userId, quiet) {
  await pool.query(
    `INSERT INTO notification_preferences
       (user_id, prefs, quiet_enabled, quiet_start, quiet_end, quiet_timezone)
     VALUES (?, '{}', ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       quiet_enabled = VALUES(quiet_enabled),
       quiet_start = VALUES(quiet_start),
       quiet_end = VALUES(quiet_end),
       quiet_timezone = VALUES(quiet_timezone)`,
    [userId, quiet.enabled ? 1 : 0, quiet.start, quiet.end, quiet.timezone],
  )
}

export async function quietUserSet(userIds, now = new Date()) {
  const ids = [...new Set((userIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))]
  if (ids.length === 0) return new Set()
  try {
    const [rows] = await pool.query(
      `SELECT np.user_id, np.quiet_start AS start,
              np.quiet_end AS end, np.quiet_timezone AS timezone
         FROM notification_preferences np
         JOIN feature_flags ff ON ff.id = 1 AND ff.quiet_hours_enabled = 1
        WHERE np.quiet_enabled = 1 AND np.user_id IN (?)`,
      [ids],
    )
    const quiet = new Set()
    for (const row of rows || []) {
      const id = Number(row.user_id)
      if (!Number.isInteger(id) || id <= 0) continue
      if (isQuietAt({ enabled: true, start: row.start, end: row.end, timezone: row.timezone }, now)) {
        quiet.add(id)
      }
    }
    return quiet
  } catch (err) {
    logger.error('Quiet hours batch load failed (fail-open):', err)
    return new Set()
  }
}
