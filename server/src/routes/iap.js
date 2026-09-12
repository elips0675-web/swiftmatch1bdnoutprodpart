import { Router } from 'express'
import pool from '../db.js'
import logger from '../logger.js'

const router = Router()

const REVENUECAT_WEBHOOK_SECRET = process.env.REVENUECAT_WEBHOOK_SECRET

// POST /api/iap/webhook — RevenueCat webhook
router.post('/api/iap/webhook', async (req, res) => {
  if (!REVENUECAT_WEBHOOK_SECRET) {
    return res.status(503).json({ message: 'RevenueCat webhook not configured' })
  }
  const authHeader = req.headers.authorization
  if (authHeader !== `Bearer ${REVENUECAT_WEBHOOK_SECRET}`) {
    return res.status(401).json({ message: 'Invalid signature' })
  }

  try {
    const event = req.body.event || req.body
    const { type, app_user_id, product_id, expiration_at_ms, period_type } = event

    logger.info(`IAP webhook: ${type} for user ${app_user_id}, product ${product_id}`)

    switch (type) {
      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
        await pool.query(
          `INSERT INTO subscriptions (user_id, tier, provider, provider_subscription_id, status, current_period_end)
           VALUES (?, ?, 'revenuecat', ?, 'active', ?)
           ON DUPLICATE KEY UPDATE status = 'active', current_period_end = ?`,
          [app_user_id, product_id, product_id, new Date(expiration_at_ms), new Date(expiration_at_ms)],
        )
        break
      case 'CANCELLATION':
        await pool.query(
          "UPDATE subscriptions SET status = 'canceled' WHERE user_id = ? AND provider_subscription_id = ?",
          [app_user_id, product_id],
        )
        break
      case 'EXPIRATION':
        await pool.query(
          "UPDATE subscriptions SET status = 'expired' WHERE user_id = ? AND provider_subscription_id = ?",
          [app_user_id, product_id],
        )
        break
    }

    res.json({ received: true })
  } catch (err) {
    logger.error('IAP webhook error:', err)
    res.status(500).json({ message: 'Webhook processing failed' })
  }
})

// GET /api/iap/products — available IAP products (ids = RevenueCat product ids, см. src/lib/iap.ts productIdFor)
router.get('/api/iap/products', (req, res) => {
  const tiers = [
    { id: 'plus', name: 'Plus', price: 499 },
    { id: 'gold', name: 'Gold', price: 999 },
    { id: 'platinum', name: 'Platinum', price: 1990 },
  ]
  const durations = [
    { months: 1, discount: 0, period: 'month' },
    { months: 6, discount: 20, period: '6months' },
    { months: 12, discount: 40, period: 'year' },
  ]
  res.json(
    tiers.flatMap((tier) =>
      durations.map((d) => ({
        id: `${tier.id}_${d.months >= 12 ? '12m' : d.months >= 6 ? '6m' : '1m'}`,
        name: `${tier.name} ${d.months} Month`,
        price: Math.round(tier.price * d.months * (1 - d.discount / 100)),
        period: d.period,
      })),
    ),
  )
})

// GET /api/iap/status — check IAP subscription status
router.get('/api/iap/status', async (req, res) => {
  try {
    const userId = req.userId || req.query.userId
    if (!userId) return res.status(400).json({ message: 'userId required' })

    const [rows] = await pool.query(
      "SELECT tier, status, current_period_end FROM subscriptions WHERE user_id = ? AND provider = 'revenuecat' ORDER BY created_at DESC LIMIT 1",
      [userId],
    )
    if (rows.length === 0) {
      return res.json({ active: false, tier: null })
    }
    const sub = rows[0]
    res.json({ active: sub.status === 'active', tier: sub.tier, expiresAt: sub.current_period_end })
  } catch (err) {
    logger.error('IAP status error:', err)
    res.status(500).json({ message: 'Failed to get status' })
  }
})

export default router
