import { Router } from 'express'
import pool from '../../db.js'
import logger from '../../logger.js'
import { wrapRouter } from '../../async-handler.js'

const router = Router()

/**
 * @openapi
 * /api/admin/reports:
 *   get:
 *     tags: [Admin]
 *     summary: List user reports
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: List of reports }
 */
router.get('/reports', async (req, res) => {
  try {
    const teams = Array.isArray(req.admin?.teams) ? req.admin.teams : []
    const scoped = teams.length > 0
    const [rows] = await pool.query(
      `SELECT r.id, r.reason, r.description, r.status, r.team_id as teamId,
               DATE_FORMAT(r.created_at, '%Y-%m-%d') as date,
               reporter.display_name as reporterName,
               reported.display_name as reportedUserName,
               NULL as evidence,
               t.name as teamName
       FROM reports r
       LEFT JOIN user_profiles reporter ON r.reporter_id = reporter.id
       LEFT JOIN user_profiles reported ON r.reported_id = reported.id
       LEFT JOIN moderation_teams t ON t.id = r.team_id
       ${scoped ? 'WHERE r.team_id IN (?)' : ''}
       ORDER BY r.created_at DESC`,
      scoped ? [teams] : [],
    )
    res.json(rows)
  } catch (err) {
    logger.error('Reports error:', err)
    res.status(500).json({ message: 'Failed to fetch reports' })
  }
})

/**
 * @openapi
 * /api/admin/reports/{id}/status:
 *   post:
 *     tags: [Admin]
 *     summary: Update report status by id
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Report status updated }
 */
router.post('/reports/:id/status', async (req, res) => {
  const { status } = req.body
  const allowed = ['reviewed', 'dismissed', 'action_taken']
  if (!allowed.includes(status)) {
    return res.status(400).json({ message: 'Invalid status' })
  }
  try {
    // Скоуп модератора (P3 #31): нельзя поменять статус жалобы вне своих
    // команд — иначе скоуп обходится прямым запросом по id (IDOR).
    const teams = Array.isArray(req.admin?.teams) ? req.admin.teams : []
    if (teams.length > 0) {
      const [[existing]] = await pool.query('SELECT team_id FROM reports WHERE id = ?', [req.params.id])
      if (!existing) return res.status(404).json({ message: 'Report not found' })
      if (existing.team_id == null || !teams.includes(existing.team_id)) {
        return res.status(403).json({ message: 'REPORT_OUT_OF_SCOPE' })
      }
    }

    await pool.query('UPDATE reports SET status = ? WHERE id = ?', [status, req.params.id])

    if (status === 'action_taken') {
      const [[report]] = await pool.query('SELECT reported_id FROM reports WHERE id = ?', [req.params.id])
      if (report) {
        await pool.query('UPDATE users SET is_active = 0 WHERE id = ?', [report.reported_id])
        await pool.query(
          'INSERT INTO moderation_log (admin_id, target_user_id, action, reason) VALUES (?, ?, ?, ?)',
          [req.admin.id, report.reported_id, 'banned', 'Automatic ban from report'],
        )
      }
    }
    res.json({ message: `Report #${req.params.id} marked as ${status}` })
  } catch (err) {
    logger.error('Report status error:', err)
    res.status(500).json({ message: 'Failed to update report' })
  }
})

/**
 * @openapi
 * /api/admin/moderation-log:
 *   get:
 *     tags: [Admin]
 *     summary: Get moderation log
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Moderation log entries }
 */
router.get('/moderation-log', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT ml.id, DATE_FORMAT(ml.created_at, '%Y-%m-%d') as date,
              admin.display_name as admin, ml.action,
              target.display_name as targetUser, ml.reason
       FROM moderation_log ml
       LEFT JOIN user_profiles admin ON ml.admin_id = admin.id
       LEFT JOIN user_profiles target ON ml.target_user_id = target.id
       ORDER BY ml.created_at DESC, ml.id DESC
       LIMIT 100`,
    )
    res.json(rows)
  } catch (err) {
    logger.error('Moderation log error:', err)
    res.status(500).json({ message: 'Failed to fetch moderation log' })
  }
})

// ─── Photo verification (anti-cat) ────────────────────────────
/**
 * @openapi
 * /api/admin/verifications:
 *   get:
 *     tags: [Admin]
 *     summary: Get pending photo verifications
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: List of pending verifications }
 */
router.get('/verifications', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT v.id, v.user_id, v.photo_url, v.status, v.admin_note, v.created_at, v.reviewed_at,
              u.email, up.display_name
       FROM user_verifications v
       LEFT JOIN users u ON u.id = v.user_id
       LEFT JOIN user_profiles up ON up.id = v.user_id
       WHERE v.status = 'pending'
       ORDER BY v.created_at ASC, v.id ASC LIMIT 50`,
    )
    res.json(rows)
  } catch (err) {
    logger.error('Verifications list error:', err)
    res.status(500).json({ message: 'Failed to fetch verifications' })
  }
})

/**
 * @openapi
 * /api/admin/verifications/{id}:
 *   put:
 *     tags: [Admin]
 *     summary: Review a photo verification by id
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Verification updated }
 */
router.put('/verifications/:id', async (req, res) => {
  const { id } = req.params
  const { status, admin_note } = req.body || {}
  if (!/^\d+$/.test(id)) return res.status(400).json({ message: 'Invalid id' })
  if (!['verified', 'rejected'].includes(status)) {
    return res.status(400).json({ message: 'status must be verified or rejected' })
  }
  try {
    const [result] = await pool.query(
      'UPDATE user_verifications SET status = ?, admin_note = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?',
      [status, admin_note || null, req.userId || null, id],
    )
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Verification not found' })

    if (status === 'verified') {
      const [[sub]] = await pool.query('SELECT user_id FROM user_verifications WHERE id = ?', [id])
      if (sub) {
        await pool.query('UPDATE user_profiles SET photo_verified = 1 WHERE id = ?', [sub.user_id])
      }
    }
    res.json({ message: `Verification ${status}` })
  } catch (err) {
    logger.error('Verifications update error:', err)
    res.status(500).json({ message: 'Failed to update verification' })
  }
})

export default wrapRouter(router)
