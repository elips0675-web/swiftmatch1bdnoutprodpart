import { Router } from 'express'
import pool from '../db.js'
import { auth } from '../middleware.js'
import logger from '../logger.js'

const router = Router()

const EVENT_CATEGORIES = ['event', 'experience']

const EVENT_SELECT = `o.id, o.partner_id, o.category, o.title, COALESCE(o.poster_url, o.image_url) AS poster_url,
    o.description, o.price, o.city, o.location, o.event_start, o.event_end, o.event_url, o.deeplink,
    o.capacity, o.tickets_sold,
    GREATEST(0, COALESCE(o.capacity, 999999) - o.tickets_sold) AS remaining,
    p.name AS partner_name`

const EVENT_WHERE = `o.status = 'active' AND p.status = 'active'
    AND o.category IN ('event','experience')
    AND o.event_start IS NOT NULL
    AND o.event_start >= NOW()
    AND (o.event_end IS NULL OR o.event_end > NOW())`

/**
 * @openapi
 * /api/events:
 *   get:
 *     tags: [Events]
 *     summary: Public events showcase (speed-dating, mixers, master-classes)
 *     parameters:
 *       - in: query
 *         name: city
 *         schema: { type: string }
 *     responses:
 *       200: { description: Array of active events }
 */
router.get('/api/events', auth, async (req, res) => {
  const { city } = req.query
  try {
    const where = [EVENT_WHERE]
    const params = []
    if (city && String(city).trim()) {
      where.push('(o.city = ? OR o.city IS NULL)')
      params.push(String(city).trim())
    }
    const [rows] = await pool.query(
      `SELECT ${EVENT_SELECT}
       FROM partner_offers o JOIN partners p ON p.id = o.partner_id
       WHERE ${where.join(' AND ')}
       ORDER BY o.event_start ASC
       LIMIT 50`,
      params,
    )
    for (const ev of rows) {
      ev.sold_out = Number(ev.remaining) <= 0
      ev.remaining = Number(ev.remaining)
    }
    res.json(rows)
  } catch (err) {
    logger.error('Events feed error:', err)
    res.json([])
  }
})

/**
 * @openapi
 * /api/events/{id}:
 *   get:
 *     tags: [Events]
 *     summary: Single event details
 */
router.get('/api/events/:id', auth, async (req, res) => {
  const { id } = req.params
  if (!/^\d+$/.test(id)) return res.status(400).json({ message: 'Invalid id' })
  try {
    const [[ev]] = await pool.query(
      `SELECT ${EVENT_SELECT}
       FROM partner_offers o JOIN partners p ON p.id = o.partner_id
       WHERE o.id = ? AND ${EVENT_WHERE}
       LIMIT 1`,
      [id],
    )
    if (!ev) return res.status(404).json({ message: 'Event not found' })
    ev.sold_out = Number(ev.remaining) <= 0
    ev.remaining = Number(ev.remaining)

    const [[mine]] = await pool.query(
      `SELECT id, status, stripe_session_id, amount FROM event_tickets WHERE offer_id = ? AND user_id = ? LIMIT 1`,
      [id, req.userId],
    )
    res.json({ ...ev, my_ticket: mine || null })
  } catch (err) {
    logger.error('Event detail error:', err)
    res.status(500).json({ message: 'Failed to fetch event' })
  }
})

/**
 * @openapi
 * /api/events/{id}/purchase:
 *   post:
 *     tags: [Events]
 *     summary: Buy an event ticket (Stripe Checkout or mock)
 */
router.post('/api/events/:id/purchase', auth, async (req, res) => {
  const { id } = req.params
  if (!/^\d+$/.test(id)) return res.status(400).json({ message: 'Invalid id' })
  try {
    const [[ev]] = await pool.query(
      `SELECT o.id, o.partner_id, o.title, o.price, o.capacity, o.tickets_sold, o.event_start, o.event_end,
              p.name AS partner_name, p.commission_rate, p.status AS partner_status
       FROM partner_offers o JOIN partners p ON p.id = o.partner_id
       WHERE o.id = ? AND ${EVENT_WHERE}
       LIMIT 1`,
      [id],
    )
    if (!ev) return res.status(404).json({ message: 'Event not found or ended' })
    if (!ev.price || Number(ev.price) <= 0) {
      return res.status(400).json({ message: 'This event is not ticketed' })
    }
    if (ev.capacity != null && Number(ev.tickets_sold) >= Number(ev.capacity)) {
      return res.status(409).json({ message: 'Event is sold out', code: 'SOLD_OUT' })
    }

    const [[existing]] = await pool.query(
      'SELECT id, status FROM event_tickets WHERE offer_id = ? AND user_id = ? LIMIT 1',
      [id, req.userId],
    )
    if (existing) {
      return res.status(409).json({ message: existing.status === 'paid' ? 'Ticket already purchased' : 'Purchase already in progress', code: 'ALREADY_PURCHASED' })
    }

    const amount = Math.round(Number(ev.price) * 100) / 100
    const commission = Math.round(amount * Number(ev.commission_rate)) / 100

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
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ['card'],
          line_items: [{
            price_data: {
              currency: 'rub',
              product_data: { name: ev.title, description: `Событие: ${ev.title} — ${ev.partner_name}` },
              unit_amount: Math.round(amount * 100),
            },
            quantity: 1,
          }],
          mode: 'payment',
          success_url: `${req.headers.origin}/events?purchased=1&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${req.headers.origin}/events?cancelled=1&offer_id=${id}`,
          metadata: {
            userId: String(req.userId),
            offer_id: String(id),
            partner_id: String(ev.partner_id),
            kind: 'event',
          },
        })

        const [orderResult] = await pool.query(
          `INSERT INTO partner_orders (partner_id, offer_id, user_id, stripe_session_id, amount, commission, status)
           VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
          [ev.partner_id, id, req.userId, session.id, amount, commission],
        )
        const [ticketResult] = await pool.query(
          `INSERT INTO event_tickets (offer_id, user_id, partner_order_id, stripe_session_id, amount, status)
           VALUES (?, ?, ?, ?, ?, 'pending')`,
          [id, req.userId, orderResult.insertId, session.id, amount],
        )
        return res.json({ url: session.url, sessionId: session.id, ticket_id: ticketResult.insertId })
      } catch (err) {
        if (isLive) {
          return res.status(502).json({ message: 'Stripe payment failed', error: err.message })
        }
        req.log?.warn('Stripe error (event purchase), falling back to mock: ' + err.message)
      }
    }

    if (isLive || isProd) {
      return res.status(502).json({ message: isProd ? 'Stripe not configured for production' : 'Stripe not configured in live mode' })
    }

    const orderId = `event_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    await pool.query(
      `INSERT INTO partner_orders (partner_id, offer_id, user_id, stripe_session_id, amount, commission, status)
       VALUES (?, ?, ?, ?, ?, ?, 'paid')`,
      [ev.partner_id, id, req.userId, orderId, amount, commission],
    )
    const [ticketResult] = await pool.query(
      `INSERT INTO event_tickets (offer_id, user_id, partner_order_id, stripe_session_id, amount, status, paid_at)
       VALUES (?, ?, ?, ?, ?, 'paid', NOW())`,
      [id, req.userId, null, orderId, amount],
    )
    await pool.query(
      `INSERT INTO partner_conversions (partner_id, offer_id, user_id, conversion_type, amount, commission, external_order_id, stripe_session_id, status)
       VALUES (?, ?, ?, 'purchase', ?, ?, ?, ?, 'approved')`,
      [ev.partner_id, id, req.userId, amount, commission, orderId, orderId],
    )
    await pool.query('UPDATE partner_offers SET tickets_sold = tickets_sold + 1 WHERE id = ?', [id])

    res.status(201).json({ message: 'Ticket purchased (mock)', ticket_id: ticketResult.insertId, mock: true })
  } catch (err) {
    logger.error('Event purchase error:', err)
    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Ticket already purchased', code: 'ALREADY_PURCHASED' })
    }
    res.status(500).json({ message: 'Failed to purchase ticket' })
  }
})

/**
 * @openapi
 * /api/events/order/webhook:
 *   post:
 *     tags: [Events]
 *     summary: Stripe webhook for event tickets
 */
router.post('/api/events/order/webhook', async (req, res) => {
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
    logger.error('Event webhook signature error:', err)
    return res.status(400).json({ message: 'Invalid signature' })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object
    if (!session.metadata || session.metadata.kind !== 'event') return res.json({ received: true })
    if (session.payment_status !== 'paid') return res.json({ received: true })
    const { userId, offer_id: offerId } = session.metadata
    try {
      const conn = await pool.getConnection()
      try {
        await conn.beginTransaction()
        const [evt] = await conn.query(
          'INSERT IGNORE INTO webhook_events (provider, event_id) VALUES (?, ?)',
          ['stripe_event', String(event.id || '')],
        )
        if (!evt || evt.affectedRows === 0) {
          await conn.rollback()
          return res.json({ received: true })
        }
        const [upd] = await conn.query(
          `UPDATE event_tickets SET status = 'paid', paid_at = NOW()
           WHERE stripe_session_id = ? AND status = 'pending'`,
          [session.id],
        )
        if (upd && upd.affectedRows > 0) {
          await conn.query('UPDATE partner_offers SET tickets_sold = tickets_sold + 1 WHERE id = ?', [offerId])
          await conn.query(
            `INSERT INTO partner_conversions (partner_id, offer_id, user_id, conversion_type, external_order_id, stripe_session_id, amount, commission, status)
             SELECT po.partner_id, po.offer_id, po.user_id, 'purchase', po.stripe_session_id, po.stripe_session_id, po.amount, po.commission, 'approved'
             FROM partner_orders po WHERE po.stripe_session_id = ? LIMIT 1`,
            [session.id],
          )
          await conn.query("UPDATE partner_orders SET status = 'paid' WHERE stripe_session_id = ? AND status = 'pending'", [session.id])
        }
        await conn.commit()
      } catch (err) {
        await conn.rollback()
        throw err
      } finally {
        conn.release()
      }
    } catch (err) {
      logger.error('Event webhook processing error:', err)
    }
  }
  res.json({ received: true })
})

export default router
