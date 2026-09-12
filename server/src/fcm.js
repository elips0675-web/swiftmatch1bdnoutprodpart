import { rootLogger } from './logger.js'

const FCM_SERVER_KEY = process.env.FCM_SERVER_KEY
const FCM_SERVICE_ACCOUNT = process.env.FCM_SERVICE_ACCOUNT
let fcmConfigured = false
let firebaseApp = null

// FCM_SERVICE_ACCOUNT принимает: base64 JSON (старый формат), сырой JSON или путь к файлу
export async function parseServiceAccount(value) {
  const trimmed = String(value).trim()
  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed)
  }
  if (/\.json$/i.test(trimmed) || /[\\/]/.test(trimmed)) {
    const { readFile } = await import('fs/promises')
    return JSON.parse(await readFile(trimmed, 'utf-8'))
  }
  return JSON.parse(Buffer.from(trimmed, 'base64').toString('utf-8'))
}

async function getFirebaseApp() {
  if (firebaseApp) return firebaseApp

  if (FCM_SERVICE_ACCOUNT) {
    try {
      const admin = await import('firebase-admin')
      const serviceAccount = await parseServiceAccount(FCM_SERVICE_ACCOUNT)
      if (!admin.apps.length) {
        firebaseApp = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
      }
      return firebaseApp
    } catch (err) {
      rootLogger.warn('FCM: firebase-admin init (service account) failed:', err.message)
      return null
    }
  }

  try {
    const admin = await import('firebase-admin')
    if (!admin.apps.length) {
      firebaseApp = admin.initializeApp({
        credential: admin.credential.applicationDefault(),
      })
    }
    return firebaseApp
  } catch (err) {
    rootLogger.warn('FCM: firebase-admin init failed:', err.message)
    return null
  }
}

export function isFCMConfigured() {
  return fcmConfigured || !!FCM_SERVICE_ACCOUNT
}

export async function sendFcmToUser(fcmToken, title, body, data = {}) {
  if (!FCM_SERVER_KEY && !FCM_SERVICE_ACCOUNT) {
    rootLogger.info('[FCM MOCK] Would send to token', fcmToken?.slice(0, 10), title)
    return { success: true, mock: true }
  }

  const app = await getFirebaseApp()
  if (app) {
    try {
      const admin = await import('firebase-admin')
      const message = {
        token: fcmToken,
        notification: { title, body },
        data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
        android: { priority: 'high', notification: { sound: 'default' } },
        apns: { payload: { aps: { sound: 'default' } } },
      }
      const response = await admin.messaging().send(message)
      return { success: true, messageId: response }
    } catch (err) {
      rootLogger.error('FCM firebase-admin send failed:', err)
      return { success: false, error: err.message }
    }
  }

  if (!FCM_SERVER_KEY) return { success: false, error: 'FCM_SERVER_KEY not set' }

  try {
    const res = await fetch('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `key=${FCM_SERVER_KEY}`,
      },
      body: JSON.stringify({
        to: fcmToken,
        notification: { title, body, sound: 'default' },
        data,
      }),
    })
    const result = await res.json()
    if (result.failure) {
      rootLogger.error('FCM HTTP send failed:', result)
      return { success: false, error: result.results?.[0]?.error }
    }
    return { success: true }
  } catch (err) {
    rootLogger.error('FCM HTTP send error:', err)
    return { success: false, error: err.message }
  }
}

export async function sendFcmToAll(fcmTokens, title, body, data = {}) {
  if (!FCM_SERVER_KEY && !FCM_SERVICE_ACCOUNT) {
    rootLogger.info('[FCM MOCK] Would send to', fcmTokens?.length, 'tokens')
    return { success: true, mock: true }
  }
  const results = await Promise.allSettled(
    fcmTokens.map((token) => sendFcmToUser(token, title, body, data)),
  )
  const sent = results.filter((r) => r.status === 'fulfilled' && r.value.success).length
  return { success: sent > 0, sent }
}

fcmConfigured = !!(FCM_SERVER_KEY || FCM_SERVICE_ACCOUNT)
