import { getToken, setToken } from '@/lib/token'

const ADMIN_BACKUP_KEY = 'swiftmatch_admin_token'
const IMPERSONATED_USER_KEY = 'swiftmatch_impersonated_user'

export interface ImpersonatedUser {
  id: number
  name: string
}

export function startImpersonation(token: string, user: ImpersonatedUser): void {
  const adminToken = getToken()
  if (adminToken) sessionStorage.setItem(ADMIN_BACKUP_KEY, adminToken)
  sessionStorage.setItem(IMPERSONATED_USER_KEY, JSON.stringify(user))
  setToken(token)
}

export function getImpersonatedUser(): ImpersonatedUser | null {
  const raw = sessionStorage.getItem(IMPERSONATED_USER_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as ImpersonatedUser
    if (parsed && typeof parsed.id === 'number') return parsed
    return null
  } catch {
    return null
  }
}

export function isImpersonating(): boolean {
  return Boolean(sessionStorage.getItem(ADMIN_BACKUP_KEY))
}

export function stopImpersonation(): boolean {
  const adminToken = sessionStorage.getItem(ADMIN_BACKUP_KEY)
  if (!adminToken) return false
  setToken(adminToken)
  sessionStorage.removeItem(ADMIN_BACKUP_KEY)
  sessionStorage.removeItem(IMPERSONATED_USER_KEY)
  return true
}
