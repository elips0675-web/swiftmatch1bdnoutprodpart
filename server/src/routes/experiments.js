import { Router } from 'express'
import crypto from 'crypto'
import { auth } from '../middleware.js'
import { adminAuth } from '../middleware/adminAuth.js'
import pool from '../db.js'
import { rootLogger } from '../logger.js'
import { wrapRouter } from '../async-handler.js'

const router = Router()

export async function trackEvent(eventType, userId, metadata = {}) {
  try {
    await pool.query(
      'INSERT INTO analytics_events (event_type, user_id, metadata) VALUES (?, ?, ?)',
      [eventType, userId || null, JSON.stringify(metadata)],
    )
  } catch (err) {
    rootLogger.warn(`Analytics track "${eventType}" failed:`, err.message)
  }
}

// GET /api/experiments/:key — stable A/B variant assignment (50/50 by hash)
/**
 * @openapi
 * /api/experiments/{key}:
 *   get:
 *     tags: [Experiments]
 *     summary: Get A/B experiment variant assignment
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Assigned variant for the experiment }
 */
router.get('/api/experiments/:key', auth, async (req, res) => {
  try {
    const key = String(req.params.key).slice(0, 64)
    const [[enabled]] = await pool.query(
      'SELECT enabled FROM experiments WHERE experiment_key = ?',
      [key],
    )
    if (!enabled || !enabled.enabled) {
      return res.json({ key, variant: 'control', enabled: false })
    }

    const [[existing]] = await pool.query(
      'SELECT variant FROM experiment_assignments WHERE experiment_key = ? AND user_id = ?',
      [key, req.userId],
    )
    if (existing) return res.json({ key, variant: existing.variant, enabled: true })

    const hash = crypto.createHash('md5').update(`${key}:${req.userId}`).digest('hex')
    const variant = (parseInt(hash.slice(0, 8), 16) % 2 === 0) ? 'variant_b' : 'variant_a'
    await pool.query(
      'INSERT IGNORE INTO experiment_assignments (experiment_key, user_id, variant) VALUES (?, ?, ?)',
      [key, req.userId, variant],
    )
    res.json({ key, variant, enabled: true })
  } catch (err) {
    rootLogger.error('Experiment assign error:', err)
    res.status(500).json({ error: 'SERVER_ERROR' })
  }
})

// POST /api/analytics/track — product analytics event
/**
 * @openapi
 * /api/analytics/track:
 *   post:
 *     tags: [Experiments]
 *     summary: Track a product analytics event
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Event tracked }
 */
router.post('/api/analytics/track', auth, async (req, res) => {
  try {
    const { event_type: eventType, metadata } = req.body
    if (!eventType || typeof eventType !== 'string') {
      return res.status(400).json({ error: 'MISSING_EVENT_TYPE' })
    }
    await trackEvent(eventType.slice(0, 100), req.userId, metadata && typeof metadata === 'object' ? metadata : {})
    res.json({ ok: true })
  } catch (err) {
    rootLogger.error('Analytics track error:', err)
    res.status(500).json({ error: 'SERVER_ERROR' })
  }
})

// ─── Admin ────────────────────────────────────────────────────
/**
 * @openapi
 * /api/admin/experiments:
 *   get:
 *     tags: [Experiments]
 *     summary: List experiments with variant counts
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Array of experiments }
 */
router.get('/api/admin/experiments', adminAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT e.id, e.name, e.experiment_key, e.description, e.enabled, e.created_at,
              (SELECT COUNT(*) FROM experiment_assignments ea WHERE ea.experiment_key = e.experiment_key AND ea.variant = 'variant_a') AS variant_a_count,
              (SELECT COUNT(*) FROM experiment_assignments ea WHERE ea.experiment_key = e.experiment_key AND ea.variant = 'variant_b') AS variant_b_count
       FROM experiments e ORDER BY e.id DESC`,
    )
    res.json(rows)
  } catch (err) {
    rootLogger.error('Admin experiments list error:', err)
    res.status(500).json({ error: 'SERVER_ERROR' })
  }
})

/**
 * @openapi
 * /api/admin/experiments:
 *   post:
 *     tags: [Experiments]
 *     summary: Create an experiment
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Created experiment id }
 */
router.post('/api/admin/experiments', adminAuth, async (req, res) => {
  try {
    const { name, experiment_key: key, description } = req.body
    if (!name || !key) return res.status(400).json({ error: 'MISSING_FIELDS' })
    const [result] = await pool.query(
      'INSERT INTO experiments (name, experiment_key, description) VALUES (?, ?, ?)',
      [String(name).slice(0, 100), String(key).slice(0, 64), description ? String(description).slice(0, 300) : null],
    )
    res.json({ id: result.insertId })
  } catch (err) {
    rootLogger.error('Admin experiments create error:', err)
    res.status(500).json({ error: 'SERVER_ERROR' })
  }
})

/**
 * @openapi
 * /api/admin/experiments/{id}:
 *   put:
 *     tags: [Experiments]
 *     summary: Toggle experiment enabled state
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Experiment updated }
 */
router.put('/api/admin/experiments/:id', adminAuth, async (req, res) => {
  try {
    const { enabled } = req.body
    await pool.query(
      'UPDATE experiments SET enabled = ? WHERE id = ?',
      [enabled ? 1 : 0, req.params.id],
    )
    res.json({ ok: true })
  } catch (err) {
    rootLogger.error('Admin experiments toggle error:', err)
    res.status(500).json({ error: 'SERVER_ERROR' })
  }
})

/**
 * @openapi
 * /api/admin/experiments/{id}:
 *   delete:
 *     tags: [Experiments]
 *     summary: Delete an experiment
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Experiment deleted }
 */
router.delete('/api/admin/experiments/:id', adminAuth, async (req, res) => {
  try {
    const [[row]] = await pool.query('SELECT experiment_key FROM experiments WHERE id = ?', [req.params.id])
    if (row) {
      await pool.query('DELETE FROM experiment_assignments WHERE experiment_key = ?', [row.experiment_key])
      await pool.query('DELETE FROM experiments WHERE id = ?', [req.params.id])
    }
    res.json({ ok: true })
  } catch (err) {
    rootLogger.error('Admin experiments delete error:', err)
    res.status(500).json({ error: 'SERVER_ERROR' })
  }
})

export default wrapRouter(router)