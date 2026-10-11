import { Router } from 'express'
import pool from '../db.js'
import { auth } from '../middleware.js'
import { rootLogger } from '../logger.js'
import { auditLog } from '../audit.js'

const router = Router()

const SEVERE_REASONS = ['nudity', 'violence', 'hate_speech', 'sexual', 'harassment']
const SOFT_BAN_THRESHOLD = 3
const PERMA_BAN_THRESHOLD = 5

/**
 * @openapi
 * /api/reports:
 *   post:
 *     tags: [Report]
 *     summary: Submit a user report
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Report submitted with resulting action }
 */
router.post('/api/reports', auth, async (req, res) => {
  const { reported_id, reason, description } = req.body
  if (!reported_id || !reason) {
    return res.status(400).json({ message: 'Missing required fields: reported_id, reason' })
  }

  const allowedReasons = ['spam', 'fake', 'nudity', 'violence', 'hate_speech', 'harassment', 'offensive', 'other']
  if (!allowedReasons.includes(reason)) {
    return res.status(400).json({ message: 'Invalid reason' })
  }

  try {
    await pool.query(
      'INSERT INTO reports (reporter_id, reported_id, reason, description, status) VALUES (?, ?, ?, ?, ?)',
      [req.userId, reported_id, reason, description || null, 'pending'],
    )

    // Count total reports against this user
    const [[{ count }]] = await pool.query(
      'SELECT COUNT(*) as count FROM reports WHERE reported_id = ?',
      [reported_id],
    )

    const isSevere = SEVERE_REASONS.includes(reason)
    let action = null

    if (isSevere || count >= PERMA_BAN_THRESHOLD) {
      await pool.query('UPDATE users SET is_active = 0 WHERE id = ?', [reported_id])
      await auditLog({ tableName: 'users', recordId: reported_id, action: 'delete', userId: req.userId, ipAddress: req.ip })
      action = 'permanent_ban'
    } else if (count >= SOFT_BAN_THRESHOLD) {
      await pool.query('UPDATE users SET is_active = 0 WHERE id = ?', [reported_id])
      action = 'temporary_ban'
    }

    if (action) {
      await pool.query(
        'INSERT INTO moderation_log (admin_id, target_user_id, action, reason) VALUES (?, ?, ?, ?)',
        [1, reported_id, action, `Auto: ${count} reports, reason: ${reason}`],
      )
    }

    res.json({ message: 'Report submitted', reportCount: count, action })
  } catch (err) {
    rootLogger.error('Report submission error:', err)
    res.status(500).json({ message: 'Failed to submit report' })
  }
})

export default router
