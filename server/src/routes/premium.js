import { Router } from 'express'
import pool from '../db.js'
import { auth } from '../middleware.js'
import logger from '../logger.js'
import { trackEvent } from './experiments.js'
import { createBreaker } from '../circuit-breaker.js'
import { refuseMockPayment } from '../runtime.js'
import { logWebhookDelivery, markWebhookProcessed, markWebhookFailed, WEBHOOK_PROVIDERS } from '../webhooks.js'
import { FieldError, intField } from '../profile-fields.js'
import { wrapRouter } from '../async-handler.js'

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
 *     summary: Cancel active subscription (access stays until the paid period ends)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Subscription canceled, access remains until expires_at
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
      "SELECT tier, duration_months, price, started_at, expires_at, status, is_active FROM subscriptions WHERE user_id = ? AND is_active = 1 AND expires_at > NOW() ORDER BY started_at DESC, id DESC LIMIT 1",
      [req.userId],
    )
    if (rows.length === 0) return res.json(null)
    res.json(rows[0])
  } catch (err) {
    logger.error('Premium check error:', err)
    res.status(500).json({ message: 'Failed to check premium status' })
  }
})

router.post('/api/premium/create-checkout', auth, async (req, res) => {
  const { tier, duration_months } = req.body
  if (!tier || !duration_months) return res.status(400).json({ message: 'tier and duration_months are required' })

  const tierConfig = TIERS.find(t => t.id === tier)
  if (!tierConfig) return res.status(400).json({ message: 'Invalid tier' })

  let months
  try {
    months = intField(duration_months, 'duration_months', { min: 1, max: 120 })
  } catch (err) {
    if (err instanceof FieldError) return res.status(400).json({ message: err.message })
    throw err
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY
  const isLive = process.env.STRIPE_LIVE === 'true'
  if (stripeKey || isLive) {
    if (isLive && !stripeKey && refuseMockPayment(res)) return
    try {
      const { default: Stripe } = await import('stripe')
      const stripe = new Stripe(stripeKey)

      const unitAmount = Math.round(tierConfig.price * months * 100)
      const session = await createBreaker(
        (params) => stripe.checkout.sessions.create(params),
        'stripe-checkout',
        { timeout: 15_000 },
      ).fire({
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'rub',
            product_data: { name: `${tierConfig.name} (${months} мес.)` },
            unit_amount: unitAmount,
          },
          quantity: 1,
        }],
        mode: 'payment',
        success_url: `${req.headers.origin}/premium/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${req.headers.origin}/premium/cancel`,
        metadata: { userId: String(req.userId), tier, duration_months: String(months) },
      })

      return res.json({ url: session.url, sessionId: session.id })
    } catch (err) {
      if (isLive) {
        return res.status(502).json({ message: 'Stripe payment failed', error: err.message })
      }
      req.log?.warn('Stripe error, falling back to mock: ' + err.message)
    }
  }

  if (refuseMockPayment(res)) return

  const price = tierConfig.price * months
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
      [req.userId, tier, months, price, months],
    )
    await conn.commit()
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
  trackEvent('premium_purchase', req.userId, { tier, duration_months: months, price, mode: 'mock' })
  res.status(201).json({ message: 'Subscription activated (mock)', tier, expires_at: null })
})

router.post('/api/premium/cancel', auth, async (req, res) => {
  try {
    const [result] = await pool.query(
      "UPDATE subscriptions SET status = 'canceled' WHERE user_id = ? AND is_active = 1 AND expires_at > NOW()",
      [req.userId],
    )
    if (result.affectedRows === 0) return res.status(404).json({ message: 'No active subscription found' })
    const [rows] = await pool.query(
      "SELECT expires_at FROM subscriptions WHERE user_id = ? AND is_active = 1 AND expires_at > NOW() ORDER BY expires_at DESC, id DESC LIMIT 1",
      [req.userId],
    )
    res.json({ message: 'Subscription cancelled', status: 'canceled', activeUntil: rows[0]?.expires_at ?? null })
  } catch (err) {
    logger.error('Cancel error:', err)
    res.status(500).json({ message: 'Failed to cancel subscription' })
  }
})

/**
 * @openapi
 * /api/premium/webhook:
 *   post:
 *     tags: [Premium]
 *     summary: Stripe webhook receiver
 *     responses:
 *       200: { description: OK }
 */
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
    const { userId, tier } = event.data.object.metadata
    if (userId && tier) {
      const eventId = String(event.id || '')
      await logWebhookDelivery({ provider: WEBHOOK_PROVIDERS.premium, eventId, eventType: event.type, payload: event })
      try {
        const conn = await pool.getConnection()
        try {
          await conn.beginTransaction()
          // Идемпотентность (этап 39, аудит дипсик): повторная доставка события игнорируется
          const [evt] = await conn.query(
            'INSERT IGNORE INTO webhook_events (provider, event_id) VALUES (?, ?)',
            [WEBHOOK_PROVIDERS.premium, eventId],
          )
          if (!evt || evt.affectedRows === 0) {
            await conn.rollback()
            logger.warn(`Webhook event ${event.id} already processed, skipping`)
            return res.json({ received: true })
          }
          await applyPremiumCheckout(event, conn)
          await conn.commit()
          await markWebhookProcessed(WEBHOOK_PROVIDERS.premium, eventId)
        } catch (err) {
          await conn.rollback()
          throw err
        } finally {
          conn.release()
        }
      } catch (err) {
        logger.error('Webhook insert error:', err)
        await markWebhookFailed(WEBHOOK_PROVIDERS.premium, eventId, err.message)
      }
    }
  }

  if (event.type === 'charge.refunded') {
    const eventId = String(event.id || '')
    await logWebhookDelivery({ provider: WEBHOOK_PROVIDERS.premium, eventId, eventType: event.type, payload: event })
    try {
      const conn = await pool.getConnection()
      try {
        await conn.beginTransaction()
        const [evt] = await conn.query(
          'INSERT IGNORE INTO webhook_events (provider, event_id) VALUES (?, ?)',
          [WEBHOOK_PROVIDERS.premium, eventId],
        )
        if (!evt || evt.affectedRows === 0) {
          await conn.rollback()
          logger.warn(`Webhook event ${event.id} already processed, skipping`)
          return res.json({ received: true })
        }
        const outcome = await applyStripeRefund(event, conn)
        await conn.commit()
        if (outcome.applied || outcome.reason === 'partial') {
          await markWebhookProcessed(WEBHOOK_PROVIDERS.premium, eventId)
          if (!outcome.applied) logger.warn(`Refund event ${event.id} ignored: ${outcome.reason}`)
        } else {
          await markWebhookFailed(WEBHOOK_PROVIDERS.premium, eventId, `refund not applied: ${outcome.reason}`)
        }
      } catch (err) {
        await conn.rollback()
        throw err
      } finally {
        conn.release()
      }
    } catch (err) {
      logger.error('Refund webhook error:', err)
      await markWebhookFailed(WEBHOOK_PROVIDERS.premium, eventId, err.message)
    }
  }

  res.json({ received: true })
})

export async function applyPremiumCheckout(event, conn) {
  const session = event.data.object
  const metadata = session.metadata || {}
  const { userId, tier, duration_months } = metadata
  if (!userId || !tier) return false
  const sessionId = session.id ? String(session.id) : null
  const paymentIntent = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : (session.payment_intent?.id ?? null)
  if (sessionId) {
    const [existing] = await conn.query(
      "SELECT id FROM subscriptions WHERE provider = 'stripe' AND provider_subscription_id = ? LIMIT 1",
      [sessionId],
    )
    if (existing.length > 0) return false
  }
  const tierConfig = TIERS.find(t => t.id === tier)
  const months = Number(duration_months || 1)
  const price = tierConfig ? tierConfig.price * months : 0
  await conn.query(
    "UPDATE subscriptions SET is_active = 0 WHERE user_id = ? AND is_active = 1 AND expires_at > NOW()",
    [Number(userId)],
  )
  await conn.query(
    `INSERT INTO subscriptions (user_id, provider, provider_subscription_id, provider_payment_intent, tier, duration_months, price, expires_at, current_period_end, is_active, status)
     VALUES (?, 'stripe', ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MONTH), DATE_ADD(NOW(), INTERVAL ? MONTH), 1, 'active')`,
    [Number(userId), sessionId, paymentIntent, tier, months, price, months, months],
  )
  return true
}

export async function applyStripeRefund(event, conn) {
  const charge = event?.data?.object || {}
  const paymentIntent = typeof charge.payment_intent === 'string'
    ? charge.payment_intent
    : (charge.payment_intent?.id ?? null)
  const amount = Number(charge.amount)
  const refundedAmount = Number(charge.amount_refunded)
  const fullyRefunded = charge.refunded === true || (amount > 0 && refundedAmount >= amount)
  if (!fullyRefunded) return { applied: false, reason: 'partial' }
  if (!paymentIntent) return { applied: false, reason: 'no-payment-intent' }
  const [rows] = await conn.query(
    "SELECT id FROM subscriptions WHERE provider = 'stripe' AND provider_payment_intent = ? LIMIT 1",
    [paymentIntent],
  )
  if (rows.length === 0) return { applied: false, reason: 'not-found' }
  await conn.query(
    "UPDATE subscriptions SET is_active = 0, status = 'refunded' WHERE id = ?",
    [rows[0].id],
  )
  return { applied: true, subscriptionId: rows[0].id }
}

export async function applyPremiumEvent(event, conn) {
  const type = event?.type
  if (type === 'charge.refunded') return applyStripeRefund(event, conn)
  if (type === 'checkout.session.completed') return applyPremiumCheckout(event, conn)
  return false
}

export default wrapRouter(router)
