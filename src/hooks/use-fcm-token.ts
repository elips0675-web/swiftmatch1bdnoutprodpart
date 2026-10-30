import { useEffect, useRef } from 'react'
import { getToken } from '@/lib/token'

declare global {
  interface Window {
    Capacitor?: {
      isNativePlatform: () => boolean
      registerPlugin: (name: string) => unknown
    }
  }
}

export function useFcmToken() {
  const registeredRef = useRef(false)

  useEffect(() => {
    if (registeredRef.current) return

    const isNative = typeof window !== 'undefined' &&
      window.Capacitor?.isNativePlatform() === true

    if (!isNative) {
      if (import.meta.env.DEV) console.log('[FCM] Not native platform — skipping FCM registration')
      return
    }

    let cancelled = false

    async function register() {
      try {
        const { PushNotifications } = await import('@capacitor/push-notifications')

        const permResult = await PushNotifications.requestPermissions()
        if (permResult.receive !== 'granted') {
          if (import.meta.env.DEV) console.log('[FCM] Permission not granted')
          return
        }

        await PushNotifications.register()

        PushNotifications.addListener('registration', async (pushToken) => {
          if (cancelled || !pushToken.value) return

          const authToken = getToken()
          if (!authToken) {
            if (import.meta.env.DEV) console.log('[FCM] No auth token — delaying registration')
            return
          }

          try {
            const res = await fetch('/api/push/subscribe', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${authToken}`,
              },
              body: JSON.stringify({ endpoint: pushToken.value, platform: 'fcm' }),
            })
            if (res.ok && import.meta.env.DEV) {
              console.log('[FCM] Token registered successfully')
            }
          } catch (err) {
            if (import.meta.env.DEV) console.error('[FCM] Token registration failed:', err)
          }
        })

        PushNotifications.addListener('pushNotificationReceived', (notification) => {
          if (import.meta.env.DEV) {
            console.log('[FCM] Notification received:', notification)
          }
        })

        PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
          const data = action.notification.data
          if (data?.url && typeof window !== 'undefined') {
            window.location.href = data.url
          }
        })

        registeredRef.current = true
      } catch (err) {
        if (import.meta.env.DEV) console.error('[FCM] Initialization error:', err)
      }
    }

    register()

    return () => {
      cancelled = true
    }
  }, [])
}
