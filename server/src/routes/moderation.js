import { Router } from 'express'
import { auth } from '../middleware.js'
import { adminAuth } from '../middleware/adminAuth.js'
import pool from '../db.js'
import { rootLogger } from '../logger.js'
import { moderateText, moderateImage, reviewProfile, isAIModerationConfigured } from '../ai-moderation.js'

const router = Router()

// POST /api/moderation/check-text — moderate a text fragment
/**
 * @openapi
 * /api/moderation/check-text:
 *   post:
 *     tags: [Moderation]
 *     summary: Moderate a text fragment
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Moderation verdict for the text }
 */
router.post('/api/moderation/check-text', auth, async (req, res) => {
  try {
    const { text } = req.body
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'MISSING_TEXT', message: 'Text is required' })
    }
    const result = await moderateText(text)
    res.json(result)
  } catch (err) {
    rootLogger.error('Moderation check-text error:', err)
    res.status(500).json({ error: 'SERVER_ERROR', message: 'Moderation failed' })
  }
})

// POST /api/moderation/check-image — moderate an uploaded image (by path)
/**
 * @openapi
 * /api/moderation/check-image:
 *   post:
 *     tags: [Moderation]
 *     summary: Moderate an uploaded image by path
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Moderation verdict for the image }
 */
router.post('/api/moderation/check-image', auth, async (req, res) => {
  try {
    const { filePath } = req.body
    if (!filePath) {
      return res.status(400).json({ error: 'MISSING_PATH', message: 'filePath is required' })
    }
    const result = await moderateImage(filePath)
    res.json(result)
  } catch (err) {
    rootLogger.error('Moderation check-image error:', err)
    res.status(500).json({ error: 'SERVER_ERROR', message: 'Moderation failed' })
  }
})

// POST /api/moderation/review-profile — run AI review on a user profile
/**
 * @openapi
 * /api/moderation/review-profile:
 *   post:
 *     tags: [Moderation]
 *     summary: Run AI review on a user profile
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: AI review result for the profile }
 */
router.post('/api/moderation/review-profile', adminAuth, async (req, res) => {
  try {
    const { userId } = req.body
    if (!userId) return res.status(400).json({ error: 'MISSING_USER_ID' })

    const [rows] = await pool.query(
      `SELECT display_name, bio, city FROM user_profiles WHERE id = ?`,
      [userId],
    )
    if (rows.length === 0) return res.status(404).json({ error: 'NOT_FOUND' })

    const result = await reviewProfile(rows[0])

    // Log the review result
    await pool.query(
      `INSERT INTO moderation_log (admin_id, target_user_id, action, reason)
       VALUES (?, ?, 'ai_review', ?)`,
      [req.userId || 0, userId, JSON.stringify(result)],
    )

    res.json(result)
  } catch (err) {
    rootLogger.error('Moderation review-profile error:', err)
    res.status(500).json({ error: 'SERVER_ERROR', message: 'Review failed' })
  }
})

// GET /api/moderation/status — check if AI moderation is configured
/**
 * @openapi
 * /api/moderation/status:
 *   get:
 *     tags: [Moderation]
 *     summary: Check if AI moderation is configured
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Moderation configuration status }
 */
router.get('/api/moderation/status', auth, async (req, res) => {
  res.json({
    configured: isAIModerationConfigured(),
    text: !!process.env.OPENAI_API_KEY,
    image: !!process.env.AWS_ACCESS_KEY_ID,
  })
})

export default router
