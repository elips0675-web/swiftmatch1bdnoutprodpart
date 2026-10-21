import { Router } from 'express'
import pool from '../db.js'
import logger from '../logger.js'
import { verifyUnsubscribeToken, recordUnsubscribe, isUnsubscribeFeatureEnabled } from '../email-unsubscribe.js'
import { wrapRouter } from '../async-handler.js'

const router = Router()

/**
 * @openapi
 * /api/email/unsubscribe:
 *   post:
 *     tags: [Email]
 *     summary: Unsubscribe an email address from campaigns
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               u: { type: integer, description: User id }
 *               t: { type: string, description: HMAC token from the email link }
 *     responses:
 *       200: { description: Unsubscribed (idempotent) }
 *       400: { description: Invalid link }
 *       404: { description: Unsubscribe disabled by feature flag }
 */
router.post('/api/email/unsubscribe', async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {}
  const userId = Number(body.u)
  const token = typeof body.t === 'string' ? body.t : ''

  if (!Number.isInteger(userId) || userId <= 0 || token.length === 0) {
    return res.status(400).json({ code: 'UNSUBSCRIBE_INVALID', message: 'Invalid unsubscribe link' })
  }

  try {
    if (!(await isUnsubscribeFeatureEnabled())) {
      return res.status(404).json({ code: 'UNSUBSCRIBE_DISABLED', message: 'Unsubscribe is disabled' })
    }

    const [rows] = await pool.query('SELECT id, email FROM users WHERE id = ?', [userId])
    const user = rows[0]

    if (!user || !verifyUnsubscribeToken(user.id, user.email, token)) {
      return res.status(400).json({ code: 'UNSUBSCRIBE_INVALID', message: 'Invalid unsubscribe link' })
    }

    await recordUnsubscribe({ userId: user.id, email: user.email, reason: 'link' })
    res.json({ code: 'UNSUBSCRIBED' })
  } catch (err) {
    logger.error('Unsubscribe error:', err)
    res.status(500).json({ code: 'UNSUBSCRIBE_FAILED', message: 'Failed to unsubscribe' })
  }
})

export default wrapRouter(router)
