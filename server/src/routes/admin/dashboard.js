import { Router } from 'express'
import pool from '../../db.js'
import logger from '../../logger.js'
import { wrapRouter } from '../../async-handler.js'

const router = Router()

/**
 * @openapi
 * /api/admin/stats:
 *   get:
 *     tags: [Admin]
 *     summary: Get dashboard stats
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Dashboard stats }
 */
router.get('/stats', async (req, res) => {
  try {
    const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM users')
    const [[{ activeToday }]] = await pool.query(
      'SELECT COUNT(*) as activeToday FROM user_profiles WHERE online = 1',
    )
    const [[{ totalMatches }]] = await pool.query('SELECT COUNT(*) as totalMatches FROM matches')
    const [[{ revenue }]] = await pool.query(
      'SELECT COALESCE(SUM(price), 0) as revenue FROM subscriptions WHERE is_active = 1 AND expires_at > NOW()',
    )
    const [[{ activeSubs }]] = await pool.query(
      'SELECT COUNT(*) as activeSubs FROM subscriptions WHERE is_active = 1 AND expires_at > NOW()',
    )
    const [[{ newToday }]] = await pool.query(
      'SELECT COUNT(*) as newToday FROM users WHERE DATE(created_at) = CURDATE()',
    )

    res.json({
      totalUsers: total,
      activeToday,
      totalMatches,
      revenue: Math.round(revenue),
      activeSubs,
      newToday,
    })
  } catch (err) {
    logger.error('Stats error:', err)
    res.status(500).json({ message: 'Failed to fetch stats' })
  }
})

/**
 * @openapi
 * /api/admin/revenue-by-month:
 *   get:
 *     tags: [Admin]
 *     summary: Get revenue by month
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Revenue by month data }
 */
router.get('/revenue-by-month', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT DATE_FORMAT(started_at, '%Y-%m') as month, SUM(price) as revenue
       FROM subscriptions
       WHERE is_active = 1
       GROUP BY DATE_FORMAT(started_at, '%Y-%m')
       ORDER BY month
       LIMIT 12`,
    )
    res.json(rows)
  } catch (err) {
    logger.error('Revenue by month error:', err)
    res.status(500).json({ message: 'Failed to fetch revenue data' })
  }
})

/**
 * @openapi
 * /api/admin/registration-trend:
 *   get:
 *     tags: [Admin]
 *     summary: Get user registration trend
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Registration trend data }
 */
router.get('/registration-trend', async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.period) || 7, 1), 90)
  try {
    const [rows] = await pool.query(
      `SELECT DATE(created_at) as date, COUNT(*) as users
       FROM users
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY DATE(created_at)
       ORDER BY date`,
      [days],
    )
    res.json(rows)
  } catch (err) {
    logger.error('Registration trend error:', err)
    res.status(500).json({ message: 'Failed to fetch trend' })
  }
})

/**
 * @openapi
 * /api/admin/city-distribution:
 *   get:
 *     tags: [Admin]
 *     summary: Get user city distribution
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: City distribution data }
 */
router.get('/city-distribution', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT city as name, COUNT(*) as value
       FROM user_profiles
       WHERE city IS NOT NULL AND city != ''
       GROUP BY city
       ORDER BY value DESC
       LIMIT 10`,
    )
    res.json(rows)
  } catch (err) {
    logger.error('City distribution error:', err)
    res.status(500).json({ message: 'Failed to fetch city data' })
  }
})

/**
 * @openapi
 * /api/admin/recent-activity:
 *   get:
 *     tags: [Admin]
 *     summary: Get recent user activity
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Recent activity data }
 */
router.get('/recent-activity', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT al.id, al.action_type as type,
              CONCAT(up.display_name, ' ', al.action_type) as text,
              DATE_FORMAT(al.created_at, '%H:%i') as time
       FROM activity_log al
       LEFT JOIN user_profiles up ON al.user_id = up.id
       ORDER BY al.created_at DESC, al.id DESC
       LIMIT 20`,
    )
    res.json(rows)
  } catch (err) {
    logger.error('Recent activity error:', err)
    res.status(500).json({ message: 'Failed to fetch activity' })
  }
})

export default wrapRouter(router)
