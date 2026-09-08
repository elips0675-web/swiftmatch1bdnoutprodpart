import { Router } from 'express'
import pool from '../db.js'
import { auth } from '../middleware.js'
import logger from '../logger.js'
import { trackEvent } from './experiments.js'
import { createBreaker } from '../circuit-breaker.js'

const router = Router()

/**
 * @openapi
 * /api/premium/tiers:
 *   get:
 *     tags: [Premium]
 *     summary: Get available subscription tiers
 *     responses:
 *       200:
 *         description: List of tiers
 *
 * /api/premium/my:
 *   get:
 *     tags: [Premium]
 *     summary: Get own active subscription
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Active subscription or null
 *       401:
 *         description: Authentication required
 *
 * /api/premium/create-checkout:
 *   post:
 *     tags: [Premium]
 *     summary: Create checkout session or activate mock subscription
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [tier, duration_months]
 *             properties:
 *               tier: { type: string, enum: [plus, gold, platinum] }
 *               duration_months: { type: integer }
 *     responses:
 *       201:
 *         description: Subscription activated (mock) or Stripe URL returned
 *       400:
 *         description: Invalid tier or missing fields
 *
 * /api/premium/cancel:
 *   post:
 *     tags: [Premium]
 *     summary: Cancel active subscription
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Subscription cancelled
 *       404:
 *         description: No active subscription found
 */

const TIERS = [
  { id: 'plus', name: 'Plus', price: 299, duration_months: 1, features: ['5 суперлайков в день', 'Без рекламы', 'Кто лайкнул меня'] },
  { id: 'gold', name: 'Gold', price: 699, duration_months: 1, features: ['10 суперлайков в день', 'Без рекламы', 'Кто лайкнул меня', 'Режим невидимки', 'Приоритетные лайки'] },
  { id: 'platinum', name: 'Platinum', price: 1499, duration_months: 1, features: ['∞ суперлайков', 'Без рекламы', 'Кто лайкнул меня', 'Режим невидимки', 'Приоритетные лайки', 'Персональный консьерж'] },
]

router.get('/api/premium/tiers', (req, res) => {
  res.json(TIERS)
})

router.get('/api/premium/my', auth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT tier, duration_months, price, started_at, expires_at, is_active FROM subscriptions WHERE user_id = ? AND is_active = 1 AND expires_at > NOW() ORDER BY started_at DESC LIMIT 1",
      [req.userId],
    )
    if (rows.length === 0) return res.json(null)
    res.json(rows[0])
  } catch (err) {
    logger.error('Premium check error:', err)
    res.status(500).json({ message: 'Failed to check premium status' })
  }
})

const PRICE_IDS = { plus: 'price_plus', gold: 'price_gold', platinum: 'price_platinum' }

router.post('/api/premium/create-checkout', auth, async (req, res) => {
  const { tier, duration_months } = req.body
  if (!tier || !duration_months) return res.status(400).json({ message: 'tier and duration_months are required' })

  const tierConfig = TIERS.find(t => t.id === tier)
  if (!tierConfig) return res.status(400).json({ message: 'Invalid tier' })

  const stripeKey = process.env.STRIPE_SECRET_KEY
  const isLive = process.env.STRIPE_LIVE === 'true'
  const isProd = process.env.NODE_ENV === 'production'
  if (stripeKey || isLive) {
    if (isLive && !stripeKey) {
      return res.status(500).json({ message: 'STRIPE_LIVE=true but STRIPE_SECRET_KEY is not set' })
    }
    try {
      const { default: Stripe } = await import('stripe')
      const stripe = new Stripe(stripeKey)

      const unitAmount = Math.round(tierConfig.price * duration_months * 100)
      const session = await createBreaker(
        (params) => stripe.checkout.sessions.create(params),
        'stripe-checkout',
        { timeout: 15_000 },
      ).fire({
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'rub',
            product_data: { name: `${tierConfig.name} (${duration_months} мес.)` },
            unit_amount: unitAmount,
          },
          quantity: 1,
        }],
        mode: 'payment',
        success_url: `${req.headers.origin}/premium/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${req.headers.origin}/premium/cancel`,
        metadata: { userId: String(req.userId), tier, duration_months: String(duration_months) },
      })

      return res.json({ url: session.url, sessionId: session.id })
    } catch (err) {
      if (isLive) {
        return res.status(502).json({ message: 'Stripe payment failed', error: err.message })
      }
      req.log?.warn('Stripe error, falling back to mock: ' + err.message)
    }
  }

  if (isLive) {
    return res.status(502).json({ message: 'Stripe not configured in live mode' })
  }

  const price = tierConfig.price * duration_months
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query(
      "UPDATE subscriptions SET is_active = 0 WHERE user_id = ? AND is_active = 1 AND expires_at > NOW()",
      [req.userId],
    )
    await conn.query(
      `INSERT INTO subscriptions (user_id, tier, duration_months, price, expires_at, is_active)
       VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MONTH), 1)`,
      [req.userId, tier, duration_months, price, duration_months],
    )
    await conn.commit()
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
  trackEvent('premium_purchase', req.userId, { tier, duration_months, price, mode: 'mock' })
  res.status(201).json({ message: 'Subscription activated (mock)', tier, expires_at: null })
})

router.post('/api/premium/cancel', auth, async (req, res) => {
  try {
    const [result] = await pool.query(
      "UPDATE subscriptions SET is_active = 0 WHERE user_id = ? AND is_active = 1 AND expires_at > NOW()",
      [req.userId],
    )
    if (result.affectedRows === 0) return res.status(404).json({ message: 'No active subscription found' })
    res.json({ message: 'Subscription cancelled' })
  } catch (err) {
    logger.error('Cancel error:', err)
    res.status(500).json({ message: 'Failed to cancel subscription' })
  }
})

router.post('/api/premium/webhook', async (req, res) => {
  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) return res.status(200).json({ received: true })

  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET
  const sig = req.headers['stripe-signature']
  if (!sig || !endpointSecret) return res.status(400).json({ message: 'Missing signature' })

  let event
  try {
    const { default: Stripe } = await import('stripe')
    const stripe = new Stripe(stripeKey)
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret)
  } catch (err) {
    logger.error('Webhook signature error:', err)
    return res.status(400).json({ message: 'Invalid signature' })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object
    const { userId, tier, duration_months } = session.metadata
    if (userId && tier) {
      try {
        const tierConfig = TIERS.find(t => t.id === tier)
        const price = tierConfig ? tierConfig.price * Number(duration_months || 1) : 0
        const conn = await pool.getConnection()
        try {
          await conn.beginTransaction()
          // Идемпотентность (этап 39, аудит дипсик): повторная доставка события игнорируется
          const [evt] = await conn.query(
            'INSERT IGNORE INTO webhook_events (provider, event_id) VALUES (?, ?)',
            ['stripe', String(event.id || '')],
          )
          if (!evt || evt.affectedRows === 0) {
            await conn.rollback()
            logger.warn(`Webhook event ${event.id} already processed, skipping`)
            return res.json({ received: true })
          }
          await conn.query(
            "UPDATE subscriptions SET is_active = 0 WHERE user_id = ? AND is_active = 1 AND expires_at > NOW()",
            [Number(userId)],
          )
          await conn.query(
            `INSERT INTO subscriptions (user_id, tier, duration_months, price, expires_at, is_active)
             VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MONTH), 1)`,
            [Number(userId), tier, Number(duration_months || 1), price, Number(duration_months || 1)],
          )
          await conn.commit()
        } catch (err) {
          await conn.rollback()
          throw err
        } finally {
          conn.release()
        }
      } catch (err) {
        logger.error('Webhook insert error:', err)
      }
    }
  }

  res.json({ received: true })
})

export default router
