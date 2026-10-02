import { Router } from 'express'
import pool from '../../db.js'
import logger from '../../logger.js'

const router = Router()

router.get('/stats', async (req, res) => {
  try {
    const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM users')
    const [[{ activeToday }]] = await pool.query(
      'SELECT COUNT(*) as activeToday FROM user_profiles WHERE online = 1',
    )
    const [[{ totalMatches }]] = await pool.query('SELECT COUNT(*) as totalMatches FROM matches')
    const [[{ revenue }]] = await pool.query(
      'SELECT COALESCE(SUM(price), 0) as revenue FROM subscriptions WHERE is_active = 1',
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

export default router
