import { Router } from 'express'
import pool from '../../db.js'
import logger from '../../logger.js'
import { wrapRouter } from '../../async-handler.js'
import { buildProductMetrics } from '../../product-metrics.js'

const router = Router()

function wrap(fn) {
  return async (req, res) => {
    try { await fn(req, res) } catch (err) {
      logger.error('Analytics error:', err)
      res.json([])
    }
  }
}

/**
 * @openapi
 * /api/admin/analytics/overview:
 *   get:
 *     tags: [Admin]
 *     summary: Get analytics overview
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Analytics overview }
 */
router.get('/analytics/overview', wrap(async (req, res) => {
  const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM users')
  const [[{ premium }]] = await pool.query(
    "SELECT COUNT(*) as premium FROM subscriptions WHERE is_active = 1 AND expires_at > NOW()",
  )
  const totalRevenue = 0

  res.json({
    mau: String(total || 0),
    conversionRate: total ? ((premium / total) * 100).toFixed(1) + '%' : '0%',
    arpu: total ? (totalRevenue / total).toFixed(2) : '0',
  })
}))

/**
 * @openapi
 * /api/admin/analytics/retention:
 *   get:
 *     tags: [Admin]
 *     summary: Get user retention analytics
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Retention data }
 */
router.get('/analytics/retention', wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT DATEDIFF(NOW(), u.created_at) as day, 
            COUNT(DISTINCT al.user_id) * 100.0 / MAX(u_count.cnt) as rate
     FROM users u
     LEFT JOIN analytics_events al ON u.id = al.user_id
     LEFT JOIN (SELECT COUNT(*) as cnt FROM users WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)) u_count ON 1=1
     WHERE u.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
     GROUP BY DATEDIFF(NOW(), u.created_at)
     ORDER BY day
     LIMIT 30`,
  )
  res.json(rows.map(r => ({ day: `Day ${r.day+1}`, rate: Math.round(r.rate || 0) })))
}))

/**
 * @openapi
 * /api/admin/analytics/revenue-mix:
 *   get:
 *     tags: [Admin]
 *     summary: Get revenue mix by subscription tier
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Revenue mix data }
 */
router.get('/analytics/revenue-mix', wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT tier, COUNT(*) as cnt FROM subscriptions WHERE is_active = 1 AND expires_at > NOW() GROUP BY tier`,
  )
  const colors = { plus: '#3b82f6', gold: '#f59e0b', platinum: '#8b5cf6' }
  const names = { plus: 'Plus', gold: 'Gold', platinum: 'Platinum' }
  const total = rows.reduce((s, r) => s + r.cnt, 0) || 1
  res.json(rows.map(r => ({
    name: names[r.tier] || r.tier,
    value: Math.round((r.cnt / total) * 100),
    color: colors[r.tier] || '#94a3b8',
  })))
}))

/**
 * @openapi
 * /api/admin/analytics/registrations:
 *   get:
 *     tags: [Admin]
 *     summary: Get daily registrations over the last 14 days
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Registrations data }
 */
router.get('/analytics/registrations', wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT DATE(created_at) as day, COUNT(*) as users
     FROM users
     WHERE created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)
     GROUP BY DATE(created_at)
     ORDER BY day`,
  )
  res.json(rows)
}))

/**
 * @openapi
 * /api/admin/analytics/product-metrics:
 *   get:
 *     tags: [Admin]
 *     summary: Get product funnel metrics with owner-approved targets
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Funnel metrics computed from analytics_events and messages }
 */
router.get('/analytics/product-metrics', async (req, res) => {
  try {
    const [[registered]] = await pool.query('SELECT COUNT(*) AS cnt FROM users')
    const [[liked]] = await pool.query(
      "SELECT COUNT(DISTINCT user_id) AS cnt FROM analytics_events WHERE event_type IN ('like', 'super_like') AND user_id IS NOT NULL",
    )
    const [[matched]] = await pool.query(
      "SELECT COUNT(DISTINCT user_id) AS cnt FROM analytics_events WHERE event_type IN ('like', 'super_like') AND user_id IS NOT NULL AND JSON_EXTRACT(metadata, '$.matched') = TRUE",
    )
    const [[d7]] = await pool.query(
      `SELECT COUNT(DISTINCT u.id) AS cohort,
              COUNT(DISTINCT CASE WHEN e.created_at >= DATE_ADD(u.created_at, INTERVAL 7 DAY)
                                    AND e.created_at < DATE_ADD(u.created_at, INTERVAL 8 DAY)
                                  THEN u.id END) AS retained
       FROM users u
       LEFT JOIN analytics_events e ON e.user_id = u.id
       WHERE u.created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)
         AND u.created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)`,
    )
    const [[messaged]] = await pool.query(
      `SELECT COUNT(*) AS cnt, AVG(TIMESTAMPDIFF(SECOND, u.created_at, f.first_at)) AS avg_seconds
       FROM (SELECT sender_id, MIN(created_at) AS first_at FROM messages GROUP BY sender_id) f
       JOIN users u ON u.id = f.sender_id
       WHERE f.first_at >= u.created_at`,
    )
    res.json(buildProductMetrics({
      registered: registered?.cnt,
      liked: liked?.cnt,
      matched: matched?.cnt,
      d7Cohort: d7?.cohort,
      d7Retained: d7?.retained,
      messaged: messaged?.cnt,
      avgSeconds: messaged?.avg_seconds,
    }))
  } catch (err) {
    logger.error('Product metrics error:', err)
    res.json(buildProductMetrics({}))
  }
})

export default wrapRouter(router)
