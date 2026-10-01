import { useEffect, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'
import { useAuth } from '@/context/auth-context'
import { refreshAuthToken, notifyUnauthorized } from '@/lib/auth-refresh'

let WS_URL: string | undefined
if (typeof window !== 'undefined') {
  const envWs = import.meta.env.VITE_WS_URL as string | undefined
  const isNative = typeof window.Capacitor !== 'undefined' && window.Capacitor.isNativePlatform()
  if (isNative) {
    WS_URL = envWs || 'wss://swiftmatch.app'
  } else {
    WS_URL = envWs || `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`
  }
}

const AUTH_ERRORS = ['authentication required', 'invalid token', 'unauthorized']

function isAuthError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '')
  return AUTH_ERRORS.some((needle) => message.toLowerCase().includes(needle))
}

export function useWebSocket() {
  const { token, logout } = useAuth()
  const socketRef = useRef<Socket | null>(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    if (!token) return

    const socket = io(WS_URL, {
      auth: { token },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      randomizationFactor: 0.5,
    })

    // Сервер проверяет токен только при handshake. Сокет переподключается со
    // старым токеном, захваченным при создании: если HTTP-слой к тому времени
    // обновил токен через /api/auth/refresh, WS вечно ловит «Invalid token» и
    // молча переподключается по кругу — realtime до конца сессии мёртв.
    // Поэтому на auth-ошибку делаем одну попытку обновить токен и пересоздать
    // сокет с новым. Сетевой обрыв — не повод разлогинивать.
    let refreshing = false

    socket.on('connect', () => setConnected(true))
    socket.on('disconnect', () => setConnected(false))
    socket.on('user:banned', () => {
      if (import.meta.env.DEV) console.log('[ws] user:banned — server banned this user')
      logout()
    })
    socket.on('auth:unauthorized', () => {
      logout()
    })
    socket.on('connect_error', (err) => {
      setConnected(false)
      if (!isAuthError(err) || refreshing) return
      refreshing = true
      refreshAuthToken().then((newToken) => {
        refreshing = false
        if (!newToken) {
          notifyUnauthorized()
          logout()
          return
        }
        socket.auth = { token: newToken }
        socket.disconnect()
        socket.connect()
      })
    })

    socketRef.current = socket

    return () => {
      socket.removeAllListeners()
      socket.disconnect()
      socketRef.current = null
      setConnected(false)
    }
  }, [token, logout])

  return { socket: socketRef.current, connected }
}