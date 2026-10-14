import pool from './db.js'

const socketsByUser = new Map()

export function resetPresence() {
  socketsByUser.clear()
}

export function onlineUserIds() {
  return [...socketsByUser.keys()].map(Number)
}

export function registerSocket(userId, socketId) {
  const key = String(userId)
  if (key === 'undefined' || key === 'null') return false
  let set = socketsByUser.get(key)
  if (!set) {
    set = new Set()
    socketsByUser.set(key, set)
  }
  const firstSocket = set.size === 0
  set.add(String(socketId))
  return firstSocket
}

export function unregisterSocket(userId, socketId) {
  const key = String(userId)
  const set = socketsByUser.get(key)
  if (!set) return false
  set.delete(String(socketId))
  if (set.size > 0) return false
  socketsByUser.delete(key)
  return true
}

export async function markOnline(userId) {
  await pool.query('UPDATE user_profiles SET online = 1, last_seen = NOW() WHERE id = ?', [userId])
}

export async function markOffline(userId) {
  await pool.query('UPDATE user_profiles SET online = 0, last_seen = NOW() WHERE id = ?', [userId])
}

export async function touchLastSeen(userIds) {
  const ids = [...new Set((userIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))]
  if (ids.length === 0) return 0
  const placeholders = ids.map(() => '?').join(', ')
  await pool.query(`UPDATE user_profiles SET last_seen = NOW() WHERE id IN (${placeholders})`, ids)
  return ids.length
}

export function applyActivityPrivacy(payload, viewerId, targetIdOf) {
  if (!payload) return payload
  const rows = Array.isArray(payload) ? payload : [payload]
  const viewer = viewerId === undefined || viewerId === null ? null : Number(viewerId)
  const targetOf = typeof targetIdOf === 'function' ? targetIdOf : (row) => row.id
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const isSelf = viewer !== null && Number(targetOf(row)) === viewer
    if (!isSelf) {
      if (row.show_online != null && Number(row.show_online) === 0) row.online = 0
      if (row.show_last_seen != null && Number(row.show_last_seen) === 0) row.last_seen = null
    }
    delete row.show_online
    delete row.show_last_seen
  }
  return payload
}
