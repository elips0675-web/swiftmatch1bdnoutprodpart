import { Router } from 'express'
import pool from '../../db.js'
import logger from '../../logger.js'

const router = Router()

function wrap(fn) {
  return async (req, res) => {
    try { await fn(req, res) } catch (err) {
      logger.error('Analytics error:', err)
      res.json([])
    }
  }
}

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

router.get('/analytics/retention', wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT DATEDIFF(NOW(), u.created_at) as day, 
            COUNT(DISTINCT al.user_id) * 100.0 / MAX(u_count.cnt) as rate
     FROM users u
     LEFT JOIN activity_log al ON u.id = al.user_id
     LEFT JOIN (SELECT COUNT(*) as cnt FROM users WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)) u_count ON 1=1
     WHERE u.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
     GROUP BY DATEDIFF(NOW(), u.created_at)
     ORDER BY day
     LIMIT 30`,
  )
  res.json(rows.map(r => ({ day: `Day ${r.day+1}`, rate: Math.round(r.rate || 0) })))
}))

router.get('/analytics/revenue-mix', wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT tier, COUNT(*) as cnt FROM subscriptions WHERE is_active = 1 GROUP BY tier`,
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

export default router
