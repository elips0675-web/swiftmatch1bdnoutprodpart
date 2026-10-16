import { Router } from 'express'
import pool from '../db.js'
import logger from '../logger.js'
import { auditLog } from '../audit.js'

const router = Router()

/**
 * @openapi
 * /api/admin/photos:
 *   get:
 *     tags: [Admin]
 *     summary: Get all photos
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: List of photos }
 */
router.get('/photos', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.id, p.url, p.user_id, p.created_at, p.moderation_status,
              up.display_name, up.avatar_url
       FROM user_photos p
       JOIN user_profiles up ON up.id = p.user_id
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT 200`,
    )
    res.json(rows)
  } catch (err) {
    logger.error('All photos error:', err)
    res.status(500).json({ message: 'Failed to fetch photos' })
  }
})

/**
 * @openapi
 * /api/admin/photos/pending:
 *   get:
 *     tags: [Admin]
 *     summary: Get photos pending moderation
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: List of pending photos }
 */
router.get('/photos/pending', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.id, p.url, p.user_id, p.created_at, p.moderation_status,
              up.display_name, up.avatar_url
       FROM user_photos p
       JOIN user_profiles up ON up.id = p.user_id
       WHERE p.moderation_status = 'pending'
       ORDER BY p.created_at ASC, p.id ASC
       LIMIT 50`,
    )
    res.json(rows)
  } catch (err) {
    logger.error('Pending photos error:', err)
    res.status(500).json({ message: 'Failed to fetch pending photos' })
  }
})

/**
 * @openapi
 * /api/admin/photos/{id}/approve:
 *   post:
 *     tags: [Admin]
 *     summary: Approve photo by id
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Photo approved }
 */
router.post('/photos/:id/approve', async (req, res) => {
  try {
    const [result] = await pool.query(
      'UPDATE user_photos SET moderation_status = ? WHERE id = ? AND moderation_status = ?',
      ['approved', req.params.id, 'pending'],
    )
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Photo not found or already moderated' })
    }
    await auditLog({
      tableName: 'user_photos',
      recordId: Number(req.params.id),
      action: 'update',
      oldValues: { moderation_status: 'pending' },
      newValues: { moderation_status: 'approved' },
      userId: req.admin?.id ?? null,
      ipAddress: req.ip,
    })
    res.json({ message: 'Photo approved' })
  } catch (err) {
    logger.error('Approve photo error:', err)
    res.status(500).json({ message: 'Failed to approve photo' })
  }
})

/**
 * @openapi
 * /api/admin/photos/{id}/reject:
 *   post:
 *     tags: [Admin]
 *     summary: Reject photo by id
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Photo rejected }
 */
router.post('/photos/:id/reject', async (req, res) => {
  const { reason } = req.body
  try {
    const [result] = await pool.query(
      'UPDATE user_photos SET moderation_status = ?, moderation_reason = ? WHERE id = ? AND moderation_status = ?',
      ['rejected', reason || null, req.params.id, 'pending'],
    )
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Photo not found or already moderated' })
    }
    await auditLog({
      tableName: 'user_photos',
      recordId: Number(req.params.id),
      action: 'update',
      oldValues: { moderation_status: 'pending' },
      newValues: { moderation_status: 'rejected', moderation_reason: reason || null },
      userId: req.admin?.id ?? null,
      ipAddress: req.ip,
    })
    res.json({ message: 'Photo rejected' })
  } catch (err) {
    logger.error('Reject photo error:', err)
    res.status(500).json({ message: 'Failed to reject photo' })
  }
})

export default router
