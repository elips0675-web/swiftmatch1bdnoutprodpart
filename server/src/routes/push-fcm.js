import { Router } from 'express'
import pool from '../db.js'
import { auth } from '../middleware.js'
import logger from '../logger.js'

const router = Router()

/**
 * @openapi
 * /api/push/fcm/register:
 *   post:
 *     tags: [Push]
 *     summary: Register an FCM token
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201: { description: FCM token registered }
 */
router.post('/api/push/fcm/register', auth, async (req, res) => {
  const { token, platform } = req.body
  if (!token) {
    return res.status(400).json({ message: 'token is required' })
  }

  const plat = platform === 'ios' ? 'ios' : 'android'

  try {
    await pool.query(
      `INSERT INTO fcm_tokens (user_id, token, platform)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE platform = VALUES(platform)`,
      [req.userId, token, plat],
    )
    res.status(201).json({ message: 'FCM token registered' })
  } catch (err) {
    logger.error('FCM register error:', err)
    res.status(500).json({ message: 'Failed to register FCM token' })
  }
})

/**
 * @openapi
 * /api/push/fcm/register:
 *   delete:
 *     tags: [Push]
 *     summary: Unregister an FCM token
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: FCM token unregistered }
 */
router.delete('/api/push/fcm/register', auth, async (req, res) => {
  const { token } = req.body

  try {
    if (token) {
      await pool.query(
        'DELETE FROM fcm_tokens WHERE user_id = ? AND token = ?',
        [req.userId, token],
      )
    } else {
      await pool.query('DELETE FROM fcm_tokens WHERE user_id = ?', [req.userId])
    }
    res.json({ message: 'FCM token unregistered' })
  } catch (err) {
    logger.error('FCM unregister error:', err)
    res.status(500).json({ message: 'Failed to unregister FCM token' })
  }
})

/**
 * @openapi
 * /api/push/fcm/status:
 *   get:
 *     tags: [Push]
 *     summary: Get FCM registration status
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: FCM registration status and tokens }
 */
router.get('/api/push/fcm/status', auth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT token, platform, created_at FROM fcm_tokens WHERE user_id = ?',
      [req.userId],
    )
    res.json({ registered: rows.length > 0, tokens: rows })
  } catch (err) {
    logger.error('FCM status error:', err)
    res.status(500).json({ message: 'Failed to check FCM status' })
  }
})

export default router
