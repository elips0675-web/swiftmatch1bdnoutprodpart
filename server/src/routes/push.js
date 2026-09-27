import { Router } from 'express'
import webpush from 'web-push'
import pool from '../db.js'
import { auth } from '../middleware.js'
import logger from '../logger.js'
import { pushQueue } from '../queue.js'
import { isFCMConfigured, sendFcmToUser, sendFcmToAll } from '../fcm.js'

const router = Router()

const vapidPublic = process.env.VAPID_PUBLIC_KEY || ''
const vapidPrivate = process.env.VAPID_PRIVATE_KEY || ''

if (vapidPublic && vapidPrivate) {
  webpush.setVapidDetails('mailto:admin@swiftmatch.app', vapidPublic, vapidPrivate)
}

router.get('/api/push/vapid-public-key', (req, res) => {
  res.json({ publicKey: vapidPublic || '' })
})

router.post('/api/push/subscribe', auth, async (req, res) => {
  const { endpoint, p256dh, auth: authKey, platform } = req.body
  if (!endpoint) {
    return res.status(400).json({ message: 'endpoint is required' })
  }

  try {
    if (platform === 'fcm') {
      await pool.query(
        `INSERT INTO push_subscriptions (user_id, endpoint, platform)
         VALUES (?, ?, 'fcm')
         ON DUPLICATE KEY UPDATE platform = 'fcm'`,
        [req.userId, endpoint],
      )
    } else {
      if (!p256dh || !authKey) {
        return res.status(400).json({ message: 'p256dh and auth are required for web push' })
      }
      await pool.query(
        `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, platform)
         VALUES (?, ?, ?, ?, 'web')
         ON DUPLICATE KEY UPDATE p256dh = VALUES(p256dh), auth = VALUES(auth), platform = 'web'`,
        [req.userId, endpoint, p256dh, authKey],
      )
    }
    res.status(201).json({ message: 'Subscribed' })
  } catch (err) {
    logger.error('Push subscribe error:', err)
    res.status(500).json({ message: 'Failed to subscribe' })
  }
})

router.delete('/api/push/subscribe', auth, async (req, res) => {
  const { endpoint } = req.body
  try {
    await pool.query(
      'DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?',
      [req.userId, endpoint || ''],
    )
    res.json({ message: 'Unsubscribed' })
  } catch (err) {
    logger.error('Push unsubscribe error:', err)
    res.status(500).json({ message: 'Failed to unsubscribe' })
  }
})

export async function sendPushToUser(userId, title, body, url = '/') {
  if (pushQueue) {
    await pushQueue.add({ userId, title, body, url })
    return 1
  }

  const fcmSent = await sendPushFcm(userId, title, body, url)
  const webSent = await sendPushWeb(userId, title, body, url)
  return fcmSent + webSent
}

export async function sendPushToAll(title, body, url = '/') {
  if (pushQueue) {
    await pushQueue.add({ title, body, url })
    return 1
  }

  const fcmSent = await sendPushFcmAll(title, body, url)
  const webSent = await sendPushAllDirect(title, body, url)
  return fcmSent + webSent
}

async function sendPushFcm(userId, title, body, url) {
  if (!isFCMConfigured()) return 0
  try {
    const [rows] = await pool.query(
      "SELECT endpoint FROM push_subscriptions WHERE user_id = ? AND platform = 'fcm'",
      [userId],
    )
    if (rows.length === 0) return 0
    const result = await sendFcmToAll(
      rows.map((r) => r.endpoint),
      title, body, { url },
    )
    return result.sent || 0
  } catch (err) {
    logger.error('FCM push error:', err)
    return 0
  }
}

async function sendPushFcmAll(title, body, url) {
  if (!isFCMConfigured()) return 0
  try {
    const [rows] = await pool.query(
      "SELECT endpoint FROM push_subscriptions WHERE platform = 'fcm'",
    )
    if (rows.length === 0) return 0
    const result = await sendFcmToAll(
      rows.map((r) => r.endpoint),
      title, body, { url },
    )
    return result.sent || 0
  } catch (err) {
    logger.error('FCM push all error:', err)
    return 0
  }
}

async function sendPushWeb(userId, title, body, url) {
  if (!vapidPublic || !vapidPrivate) return 0
  return sendPushDirect(userId, title, body, url)
}

async function sendPushDirect(userId, title, body, url) {
  try {
    const [rows] = await pool.query(
      "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ? AND platform = 'web'",
      [userId],
    )
    let sent = 0
    for (const sub of rows) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ title, body, url, icon: '/icon-192x192.png' }),
        )
        sent++
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await pool.query('DELETE FROM push_subscriptions WHERE endpoint = ?', [sub.endpoint])
        }
      }
    }
    return sent
  } catch (err) {
    logger.error('Send push error:', err)
    return 0
  }
}

async function sendPushAllDirect(title, body, url) {
  try {
    const [rows] = await pool.query(
      "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE platform = 'web'",
    )
    let sent = 0
    for (const sub of rows) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ title, body, url, icon: '/icon-192x192.png' }),
        )
        sent++
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await pool.query('DELETE FROM push_subscriptions WHERE endpoint = ?', [sub.endpoint])
        }
      }
    }
    return sent
  } catch (err) {
    logger.error('Send push all error:', err)
    return 0
  }
}

export default router
