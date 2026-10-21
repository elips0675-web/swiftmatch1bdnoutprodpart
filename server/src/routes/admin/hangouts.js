import { Router } from 'express'
import pool from '../../db.js'
import logger from '../../logger.js'
import { wrapRouter } from '../../async-handler.js'

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

const MERGE_CHILD_TABLES = [
  'hangout_chats',
  'hangout_reviews',
  'hangout_checkins',
  'hangout_tickets',
  'hangout_likes',
  'hangout_participants',
  'hangout_responses',
  'hangout_watchers',
]

/**
 * @openapi
 * /api/admin/hangouts/{id}/merge:
 *   post:
 *     tags: [Admin]
 *     summary: Merge duplicate hangout into a survivor (duplicate becomes a hidden tombstone)
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
 *             required: [mergeIntoId]
 *             properties:
 *               mergeIntoId: { type: integer, description: survivor hangout id }
 *     responses:
 *       200: { description: Hangouts merged }
 *       400: { description: Invalid merge ids }
 *       404: { description: Hangout not found }
 *       409: { description: Hangout already merged }
 *       500: { description: Failed to merge hangouts }
 */
router.post('/hangouts/:id/merge', async (req, res) => {
  const dupId = Number(req.params.id)
  const keepId = Number(req.body.mergeIntoId)
  if (!Number.isInteger(dupId) || dupId <= 0 || !Number.isInteger(keepId) || keepId <= 0 || dupId === keepId) {
    return res.status(400).json({ message: 'Invalid merge ids' })
  }
  let conn
  try {
    const [rows] = await pool.query('SELECT id, merged_into FROM hangouts WHERE id IN (?, ?)', [dupId, keepId])
    const dup = rows.find((r) => r.id === dupId)
    const keep = rows.find((r) => r.id === keepId)
    if (!dup || !keep) return res.status(404).json({ message: 'Hangout not found' })
    if (dup.merged_into || keep.merged_into) {
      return res.status(409).json({ message: 'Hangout already merged' })
    }

    conn = await pool.getConnection()
    await conn.beginTransaction()
    try {
      let movedRows = 0
      for (const table of MERGE_CHILD_TABLES) {
        const [result] = await conn.query(`UPDATE IGNORE \`${table}\` SET hangout_id = ? WHERE hangout_id = ?`, [keepId, dupId])
        movedRows += result.affectedRows
        await conn.query(`DELETE FROM \`${table}\` WHERE hangout_id = ?`, [dupId])
      }

      await conn.query(
        'INSERT INTO audit_log (table_name, record_id, action, old_values, new_values, user_id, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          'hangouts',
          dupId,
          'merge',
          JSON.stringify({ mergedInto: keepId }),
          JSON.stringify({ movedRows }),
          req.admin?.id ?? null,
          req.ip ?? null,
        ],
      )
      await conn.query(
        "UPDATE hangouts SET status = 'cancelled', merged_into = ?, merged_at = NOW() WHERE id = ?",
        [keepId, dupId],
      )
      await conn.commit()
    } catch (err) {
      await conn.rollback()
      throw err
    } finally {
      conn.release()
    }

    req.log?.info?.(`admin ${req.admin?.id} merged hangout ${dupId} into ${keepId}`)
    res.json({ message: 'Hangouts merged', mergedFrom: dupId, mergedInto: keepId })
  } catch (err) {
    logger.error('Admin hangout merge error:', err)
    res.status(500).json({ message: 'Failed to merge hangouts' })
  }
})

export default wrapRouter(router)
