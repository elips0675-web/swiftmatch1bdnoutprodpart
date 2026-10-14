import { Router } from 'express'
import pool from '../../db.js'
import logger from '../../logger.js'

const router = Router()

/**
 * @openapi
 * /api/admin/monetization/pricing:
 *   get:
 *     tags: [Admin]
 *     summary: Get subscription pricing
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Pricing data }
 */
router.get('/monetization/pricing', async (req, res) => {
  try {
    const tiers = [
      { tier: 'Plus', key: 'plus', color: '#3b82f6' },
      { tier: 'Gold', key: 'gold', color: '#f59e0b' },
      { tier: 'Platinum', key: 'platinum', color: '#8b5cf6' },
    ]
    const [rows] = await pool.query(
      `SELECT tier,
              SUM(CASE WHEN duration_months = 1 THEN price END) as p1,
              SUM(CASE WHEN duration_months = 6 THEN price END) as p6,
              SUM(CASE WHEN duration_months = 12 THEN price END) as p12
       FROM subscriptions
       GROUP BY tier`,
    )
    const priceMap = {}
    rows.forEach(r => { priceMap[r.tier] = { 1: r.p1, 6: r.p6, 12: r.p12 } })

    const result = tiers.map(t => ({
      ...t,
      prices: {
        1: priceMap[t.key]?.[1] || 0,
        6: priceMap[t.key]?.[6] || 0,
        12: priceMap[t.key]?.[12] || 0,
      },
    }))
    res.json(result)
  } catch (err) {
    logger.error('Pricing error:', err)
    res.status(500).json({ message: 'Failed to fetch pricing' })
  }
})

/**
 * @openapi
 * /api/admin/monetization/revenue:
 *   get:
 *     tags: [Admin]
 *     summary: Get monetization revenue over the last 12 months
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Revenue data }
 */
router.get('/monetization/revenue', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT DATE_FORMAT(started_at, '%b') as month,
              SUM(CASE WHEN tier IS NOT NULL THEN price ELSE 0 END) as subscriptions,
              0 as ads, 0 as boosts
       FROM subscriptions
       WHERE started_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
       GROUP BY DATE_FORMAT(started_at, '%Y-%m'), DATE_FORMAT(started_at, '%b')
       ORDER BY MIN(started_at)`,
    )
    res.json(rows)
  } catch (err) {
    logger.error('Revenue error:', err)
    res.status(500).json({ message: 'Failed to fetch revenue' })
  }
})

/**
 * @openapi
 * /api/admin/monetization/pricing:
 *   put:
 *     tags: [Admin]
 *     summary: Save subscription pricing
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Pricing saved }
 */
router.put('/monetization/pricing', async (req, res) => {
  const { tiers } = req.body
  if (!Array.isArray(tiers)) return res.status(400).json({ message: 'tiers array required' })
  try {
    await pool.query(
      `INSERT INTO config (config_key, config_value) VALUES ('pricing', ?)
       ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_at = NOW()`,
      [JSON.stringify(tiers)],
    )
    res.json({ message: 'Pricing saved' })
  } catch (err) {
    logger.error('Save pricing error:', err)
    res.status(500).json({ message: 'Failed to save pricing' })
  }
})

/**
 * @openapi
 * /api/admin/monetization/ads:
 *   get:
 *     tags: [Admin]
 *     summary: Get ad configuration
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Ad configuration }
 */
router.get('/monetization/ads', async (req, res) => {
  try {
    const [[row]] = await pool.query("SELECT config_value FROM config WHERE config_key = 'ads' LIMIT 1")
    if (!row) {
      return res.json({ google: true, yandex: false, googleId: 'ca-app-pub-3940256099942544/5224354917', yandexId: 'R-M-DEMO-rewarded' })
    }
    const config = typeof row.config_value === 'string' ? JSON.parse(row.config_value) : row.config_value
    res.json(config)
  } catch (err) {
    logger.error('Get ads error:', err)
    res.status(500).json({ message: 'Failed to fetch ad config' })
  }
})

/**
 * @openapi
 * /api/admin/monetization/ads:
 *   put:
 *     tags: [Admin]
 *     summary: Save ad configuration
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Ad config saved }
 */
router.put('/monetization/ads', async (req, res) => {
  const { google, yandex, googleId, yandexId } = req.body
  try {
    await pool.query(
      `INSERT INTO config (config_key, config_value) VALUES ('ads', ?)
       ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_at = NOW()`,
      [JSON.stringify({ google, yandex, googleId, yandexId })],
    )
    res.json({ message: 'Ad config saved' })
  } catch (err) {
    logger.error('Save ads error:', err)
    res.status(500).json({ message: 'Failed to save ad config' })
  }
})

/**
 * @openapi
 * /api/admin/monetization/funnel:
 *   get:
 *     tags: [Admin]
 *     summary: Get monetization funnel
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Funnel data }
 */
router.get('/monetization/funnel', async (req, res) => {
  try {
    const visitors = 0
    const [[{ registrations }]] = await pool.query('SELECT COUNT(*) as registrations FROM users')
    const [[{ profiles }]] = await pool.query('SELECT COUNT(*) as profiles FROM user_profiles')
    const [[{ firstLike }]] = await pool.query('SELECT COUNT(DISTINCT from_user_id) as firstLike FROM likes')
    const [[{ premium }]] = await pool.query('SELECT COUNT(DISTINCT user_id) as premium FROM subscriptions WHERE is_active = 1 AND expires_at > NOW()')

    res.json([
      { stage: 'Посетители', count: visitors },
      { stage: 'Регистрации', count: registrations },
      { stage: 'Заполнили профиль', count: profiles },
      { stage: 'Первый лайк', count: firstLike },
      { stage: 'Premium', count: premium },
    ])
  } catch (err) {
    logger.error('Funnel error:', err)
    res.status(500).json({ message: 'Failed to fetch funnel' })
  }
})

export default router
