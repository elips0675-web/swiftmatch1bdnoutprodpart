import { getToken } from './token'

export function getRolloutBucket(userId: string | number | null | undefined): number {
  const s = String(userId ?? '')
  if (!s) return 0
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0
  }
  return h % 100
}

export function tokenUserId(): number | null {
  const token = getToken()
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  let decoded: string
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    decoded = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='))
  } catch {
    return null
  }
  try {
    const payload = JSON.parse(decoded) as { userId?: unknown }
    const userId = payload.userId
    if (typeof userId === 'number') return userId
    if (typeof userId === 'string' && /^\d+$/.test(userId)) return Number(userId)
    return null
  } catch {
    return null
  }
}