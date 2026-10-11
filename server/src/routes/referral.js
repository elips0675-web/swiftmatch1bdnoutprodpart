import { Router } from 'express'
import crypto from 'crypto'
import pool from '../db.js'
import { auth } from '../middleware.js'
import { rootLogger } from '../logger.js'

const router = Router()

function generateCode() {
  return crypto.randomBytes(4).toString('hex')
}

/**
 * @openapi
 * /api/referral/code:
 *   get:
 *     tags: [Referral]
 *     summary: Get current user referral code
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Referral code }
 */
router.get('/api/referral/code', auth, async (req, res) => {
  try {
    const [[user]] = await pool.query('SELECT referral_code FROM users WHERE id = ?', [req.userId])
    if (!user) return res.status(404).json({ message: 'User not found' })

    if (user.referral_code) {
      return res.json({ code: user.referral_code })
    }

    const code = generateCode()
    await pool.query('UPDATE users SET referral_code = ? WHERE id = ?', [code, req.userId])
    res.json({ code })
  } catch (err) {
    rootLogger.error('Referral code error:', err)
    res.status(500).json({ message: 'Failed to get referral code' })
  }
})

/**
 * @openapi
 * /api/referral/apply:
 *   post:
 *     tags: [Referral]
 *     summary: Validate a referral code
 *     responses:
 *       200: { description: Referral code valid with referrer id }
 */
router.post('/api/referral/apply', async (req, res) => {
  const { code } = req.body
  if (!code) return res.status(400).json({ message: 'Referral code required' })

  try {
    const [[referrer]] = await pool.query('SELECT id FROM users WHERE referral_code = ?', [code])
    if (!referrer) return res.status(404).json({ message: 'Invalid referral code' })

    res.json({ referrer_id: referrer.id, message: 'Referral code valid' })
  } catch (err) {
    rootLogger.error('Referral apply error:', err)
    res.status(500).json({ message: 'Failed to apply referral' })
  }
})

/**
 * @openapi
 * /api/referral/stats:
 *   get:
 *     tags: [Referral]
 *     summary: Get referral statistics
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Referral counts }
 */
router.get('/api/referral/stats', auth, async (req, res) => {
  try {
    const [[{ count }]] = await pool.query(
      'SELECT COUNT(*) as count FROM users WHERE referred_by = ?',
      [req.userId],
    )
    const [[{ premium }]] = await pool.query(
      'SELECT COUNT(*) as premium FROM users WHERE referred_by = ? AND role = ? AND (SELECT id FROM subscriptions WHERE user_id = users.id AND status = ? LIMIT 1) IS NOT NULL',
      [req.userId, 'user', 'active'],
    )
    res.json({ totalReferrals: count, premiumReferrals: premium })
  } catch (err) {
    rootLogger.error('Referral stats error:', err)
    res.status(500).json({ message: 'Failed to fetch referral stats' })
  }
})

export default router
