let memoryToken: string | null = null

const AUTH_TOKEN_KEY = 'swiftmatch_auth_token'

export function getToken(): string | null {
  if (memoryToken) return memoryToken
  const stored = sessionStorage.getItem(AUTH_TOKEN_KEY)
  if (stored) {
    memoryToken = stored
    return stored
  }
  const legacy = localStorage.getItem(AUTH_TOKEN_KEY) || localStorage.getItem('token')
  if (legacy) {
    memoryToken = legacy
    return legacy
  }
  return null
}

export function setToken(token: string | null): void {
  memoryToken = token
  if (token) {
    sessionStorage.setItem(AUTH_TOKEN_KEY, token)
    localStorage.setItem(AUTH_TOKEN_KEY, token)
  } else {
    sessionStorage.removeItem(AUTH_TOKEN_KEY)
    localStorage.removeItem(AUTH_TOKEN_KEY)
  }
}

export function clearToken(): void {
  memoryToken = null
  sessionStorage.removeItem(AUTH_TOKEN_KEY)
  localStorage.removeItem(AUTH_TOKEN_KEY)
  sessionStorage.removeItem('swiftchat_salt')
  sessionStorage.removeItem('swiftmatch_refresh_token')
  localStorage.removeItem('token')
  localStorage.removeItem('authToken')
  localStorage.removeItem('userProfile')
}
