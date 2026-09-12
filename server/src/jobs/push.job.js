import webpush from 'web-push'
import pool from '../db.js'
import { rootLogger } from '../logger.js'
import { isFCMConfigured, sendFcmToAll } from '../fcm.js'

const vapidPublic = process.env.VAPID_PUBLIC_KEY || ''
const vapidPrivate = process.env.VAPID_PRIVATE_KEY || ''

if (vapidPublic && vapidPrivate) {
  webpush.setVapidDetails('mailto:admin@swiftmatch.app', vapidPublic, vapidPrivate)
}

export default async function processPush(job) {
  const { userId, title, body, url, userIds } = job.data

  try {
    let rows

    if (userIds && userIds.length > 0) {
      [rows] = await pool.query(
        "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id IN (?) AND platform = 'web'",
        [userIds],
      )
    } else if (userId) {
      [rows] = await pool.query(
        "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ? AND platform = 'web'",
        [userId],
      )
    } else {
      [rows] = await pool.query(
        "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE platform = 'web'",
      )
    }

    let sent = 0
    if (vapidPublic && vapidPrivate) {
      for (const sub of rows) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify({ title, body, url: url || '/', icon: '/icon-192x192.png' }),
          )
          sent++
        } catch (err) {
          if (err.statusCode === 410 || err.statusCode === 404) {
            await pool.query('DELETE FROM push_subscriptions WHERE endpoint = ?', [sub.endpoint])
          }
        }
      }
    }

    // FCM (Android/iOS) отдельной таблицей fcm_tokens — отправляем всегда, не только без Redis
    let fcmSent = 0
    if (isFCMConfigured()) {
      let fcmTokens = []
      if (userIds && userIds.length > 0) {
        ;[fcmTokens] = await pool.query(
          'SELECT token FROM fcm_tokens WHERE user_id IN (?)',
          [userIds],
        )
      } else if (userId) {
        ;[fcmTokens] = await pool.query(
          'SELECT token FROM fcm_tokens WHERE user_id = ?',
          [userId],
        )
      } else {
        ;[fcmTokens] = await pool.query('SELECT token FROM fcm_tokens')
      }
      if (fcmTokens.length > 0) {
        const result = await sendFcmToAll(fcmTokens.map((r) => r.token), title, body, { url: url || '/' })
        fcmSent = result.sent || 0
      }
    }

    rootLogger.info(`[push-job] Sent ${sent} web + ${fcmSent} fcm push notifications`)
    return { sent, fcmSent }
  } catch (err) {
    rootLogger.error('[push-job] Error:', err)
    throw err
  }
}
