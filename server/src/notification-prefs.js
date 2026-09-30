import pool from './db.js'
import logger from './logger.js'

export const CHANNELS = ['inApp', 'push']

// Канон событий выведен из кода, а не из плана: список покрывает все 6 точек
// INSERT INTO notifications и все 6 вызовов sendPushToUser. `channels` — реально
// реализованные каналы события, поэтому в UI нет переключателей, которые ничего
// не делают (у invite нет push, у chat_message нет in-app).
export const NOTIFICATION_EVENTS = [
  { key: 'like', channels: ['inApp', 'push'] },
  { key: 'invite', channels: ['inApp'] },
  { key: 'hangout_response', channels: ['inApp', 'push'] },
  { key: 'hangout_accepted', channels: ['inApp', 'push'] },
  { key: 'hangout_declined', channels: ['inApp'] },
  { key: 'hangout_cancelled', channels: ['inApp', 'push'] },
  { key: 'hangout_mutual_like', channels: ['inApp', 'push'] },
  { key: 'hangout_joined', channels: ['push'] },
  { key: 'chat_message', channels: ['push'] },
]

const EVENT_INDEX = new Map(NOTIFICATION_EVENTS.map((e) => [e.key, e]))

export function defaultPrefs() {
  const out = {}
  for (const event of NOTIFICATION_EVENTS) {
    out[event.key] = {}
    for (const channel of event.channels) out[event.key][channel] = true
  }
  return out
}

// Приводит произвольный вход к полной матрице: реализованные ячейки заполняются
// (true по умолчанию), нереализованные и неизвестные события отбрасываются.
// Возвращает { prefs, invalid: string[] } — invalid содержит отклонённые значения,
// чтобы роут мог ответить 400, а не молча затереть настройки.
export function normalizePrefs(input) {
  const prefs = defaultPrefs()
  const invalid = []
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { prefs, invalid: [] }
  }
  for (const [key, cell] of Object.entries(input)) {
    const event = EVENT_INDEX.get(key)
    if (!event) continue
    if (cell === null || typeof cell !== 'object' || Array.isArray(cell)) {
      invalid.push(key)
      continue
    }
    for (const [channel, value] of Object.entries(cell)) {
      if (!event.channels.includes(channel)) continue
      if (typeof value !== 'boolean') {
        invalid.push(`${key}.${channel}`)
        continue
      }
      prefs[key][channel] = value
    }
  }
  return { prefs, invalid }
}

function parsePrefs(raw) {
  if (!raw) return null
  if (typeof raw === 'object') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

// Слияние сохранённого с дефолтом: неизвестные ключи и нереализованные каналы
// отбрасываются, недостающие ячейки = включены. Так ответ API всегда полный,
// даже если настройки писались старой версией кода.
function mergeStored(stored) {
  const { prefs } = normalizePrefs(stored)
  return prefs
}

function buildMap(userIds, rows) {
  const map = new Map()
  for (const id of userIds) map.set(id, null)
  for (const row of rows || []) {
    const stored = parsePrefs(row.prefs)
    map.set(Number(row.user_id), stored ? mergeStored(stored) : null)
  }
  return map
}

// Батч-загрузка для циклов рассылки (например отмена встречи шлёт всем
// respondents) — иначе на каждый получатель ушёл бы отдельный SELECT.
export async function getPrefsMap(userIds) {
  const ids = [...new Set((userIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))]
  if (ids.length === 0) return new Map()
  try {
    const [rows] = await pool.query(
      'SELECT user_id, prefs FROM notification_preferences WHERE user_id IN (?)',
      [ids],
    )
    return buildMap(ids, rows)
  } catch (err) {
    logger.error('Notification prefs load failed (fail-open):', err)
    return buildMap(ids, null)
  }
}

export async function getPrefs(userId) {
  const map = await getPrefsMap([userId])
  return map.get(Number(userId)) || null
}

export function isAllowedIn(map, userId, event, channel) {
  const def = EVENT_INDEX.get(event)
  if (!def || !def.channels.includes(channel)) return true
  const prefs = map?.get(Number(userId))
  if (!prefs) return true
  const value = prefs[event]?.[channel]
  return value === undefined ? true : value === true
}

export async function isAllowed(userId, event, channel) {
  const prefs = await getPrefs(userId)
  return isAllowedIn(new Map([[Number(userId), prefs]]), userId, event, channel)
}

export async function savePrefs(userId, prefs) {
  await pool.query(
    `INSERT INTO notification_preferences (user_id, prefs) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE prefs = VALUES(prefs)`,
    [userId, JSON.stringify(prefs)],
  )
}

export function describeMatrix() {
  return NOTIFICATION_EVENTS.map((e) => ({ key: e.key, channels: [...e.channels] }))
}
