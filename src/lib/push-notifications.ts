
import { getToken } from "./token"

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  return Uint8Array.from([...rawData].map(char => char.charCodeAt(0)))
}

export async function requestNotificationPermission() {
  if (!('Notification' in window)) return false
  const permission = await Notification.requestPermission()
  return permission === 'granted'
}

export async function subscribeToPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    if (import.meta.env.DEV) console.log('Push API not supported')
    return false
  }

  const permission = await requestNotificationPermission()
  if (!permission) return false

  try {
    const token = getToken()
    const vapidRes = await fetch('/api/push/vapid-public-key')
    const { publicKey } = await vapidRes.json()
    if (!publicKey) {
      if (import.meta.env.DEV) console.log('VAPID key not configured on server')
      return false
    }

    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    })

    const subJSON = subscription.toJSON()
    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        endpoint: subJSON.endpoint,
        p256dh: subJSON.keys?.p256dh,
        auth: subJSON.keys?.auth,
      }),
    })
    if (!res.ok) {
      if (import.meta.env.DEV) console.error('Push subscribe server error:', await res.text())
      return false
    }
    return true
  } catch (err) {
    if (import.meta.env.DEV) console.error('Push subscribe failed:', err)
    return false
  }
}

export async function unsubscribeFromPush() {
  if (!('serviceWorker' in navigator)) return

  try {
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()
    if (subscription) {
      const token = getToken()
      const subJSON = subscription.toJSON()
      try {
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ endpoint: subJSON.endpoint }),
        })
      } finally {
        await subscription.unsubscribe()
      }
    }
  } catch (err) {
    if (import.meta.env.DEV) console.error('Push unsubscribe failed:', err)
  }
}
