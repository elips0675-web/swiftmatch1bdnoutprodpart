import { Router } from 'express'
import pool from '../../db.js'
import logger from '../../logger.js'

/**
 * @openapi
 * /api/admin/hangouts:
 *   get:
 *     tags: [Admin]
 *     summary: Hangouts list for moderation
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [active, cancelled, completed, blocked] }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Array of hangouts with author info
 *
 * /api/admin/hangouts/{id}:
 *   put:
 *     tags: [Admin]
 *     summary: Update hangout moderation status (blocked/active)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status: { type: string, enum: [blocked, active] }
 */
const router = Router()

const ADMIN_HANGOUT_STATUSES = ['active', 'cancelled', 'completed', 'blocked']

router.get('/hangouts', async (req, res) => {
  try {
    const { status } = req.query
    const page = Math.max(Number(req.query.page) || 1, 1)
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100)
    const offset = (page - 1) * limit

    const where = []
    const params = []
    if (status && ADMIN_HANGOUT_STATUSES.includes(status)) {
      where.push('h.status = ?')
      params.push(status)
    }

    const [rows] = await pool.query(
      `SELECT h.id, h.user_id AS author_id, h.category, h.title, h.description,
              h.place_name, h.city, h.event_date, h.max_companions, h.status, h.created_at,
              up.display_name, up.avatar_url,
              (SELECT COUNT(*) FROM hangout_responses hr WHERE hr.hangout_id = h.id) AS responses_count
       FROM hangouts h
       LEFT JOIN user_profiles up ON up.id = h.user_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY h.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    )
    res.json(rows || [])
  } catch (err) {
    logger.error('Admin hangouts fetch error:', err)
    res.json([])
  }
})

router.put('/hangouts/:id', async (req, res) => {
  try {
    const { id } = req.params
    if (!/^\d+$/.test(id)) return res.status(400).json({ message: 'Invalid id' })
    const { status } = req.body
    if (!['blocked', 'active'].includes(status)) {
      return res.status(400).json({ message: "status must be 'blocked' or 'active'" })
    }

    const [result] = await pool.query('UPDATE hangouts SET status = ? WHERE id = ?', [status, id])
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Hangout not found' })

    req.log?.info?.(`admin ${req.admin?.id} set hangout ${id} status=${status}`)
    res.json({ message: `Hangout ${status}` })
  } catch (err) {
    logger.error('Admin hangout update error:', err)
    res.status(500).json({ message: 'Failed to update hangout' })
  }
})

export default router
