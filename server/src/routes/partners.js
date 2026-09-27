import { Router } from 'express'
import crypto from 'crypto'
import pool from '../db.js'
import { auth } from '../middleware.js'
import logger from '../logger.js'
import { getIO } from '../ws.js'
import { getCached, setCached, invalidate } from '../cache.js'
import { parseRadiusKm } from '../geo.js'

const router = Router()

/**
 * @openapi
 * /api/partners/offers:
 *   get:
 *     tags: [Partners]
 *     summary: Partner offers feed (Wave 1 deeplink partners)
 *     parameters:
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *       - in: query
 *         name: city
 *         schema: { type: string }
 *       - in: query
 *         name: placement
 *         schema: { type: string, enum: [hangout, chat, profile, passport, attachment_result] }
 *       - in: query
 *         name: lat
 *         schema: { type: number }
 *       - in: query
 *         name: lng
 *         schema: { type: number }
 *       - in: query
 *         name: radius
 *         schema: { type: number, description: "km" }
 *     responses:
 *       200: { description: Array of active offers }
 */
router.get('/api/partners/offers', auth, async (req, res) => {
  const { category, city, placement, lat, lng, radius } = req.query
  const where = ["o.status = 'active'", "p.status = 'active'"]
  const params = []
  if (category) {
    where.push('o.category = ?')
    params.push(String(category))
  }
  if (city) {
    where.push('(o.city = ? OR o.city IS NULL)')
    params.push(String(city))
  }
  if (placement) {
    where.push('FIND_IN_SET(?, o.placement)')
    params.push(String(placement))
  }
  let geoSelect = ''
  let having = ''
  if (lat !== undefined && lng !== undefined && !Number.isNaN(Number(lat)) && !Number.isNaN(Number(lng))) {
    geoSelect = ', ST_Distance_Sphere(POINT(?, ?), POINT(o.lng, o.lat)) AS distance_m'
    params.push(Number(lng), Number(lat))
    const radiusKm = parseRadiusKm(radius)
    if (radiusKm !== null) {
      having = ' HAVING distance_m < ?'
      params.push(radiusKm * 1000)
    }
  }
  try {
    const sql = `SELECT o.id, o.partner_id, p.name AS partner_name, o.category, o.title,
                        o.description, o.image_url, o.price, o.city, o.placement${geoSelect}
                 FROM partner_offers o
                 JOIN partners p ON p.id = o.partner_id
                 WHERE ${where.join(' AND ')}
                   AND (o.valid_from IS NULL OR o.valid_from <= CURDATE())
                   AND (o.valid_to IS NULL OR o.valid_to >= CURDATE())${having}
                 ORDER BY o.created_at DESC
                 LIMIT 20`
    const [rows] = await pool.query(sql, params)
    res.json(rows)
  } catch (err) {
    logger.error('Partner offers error:', err)
    res.status(500).json({ message: 'Failed to fetch partner offers' })
  }
})

/**
 * @openapi
 * /api/partners/track:
 *   post:
 *     tags: [Partners]
 *     summary: Track a click/conversion and return the tagged deeplink
 *     responses:
 *       200: { description: "{ deeplink } with utm_source=swiftmatch&ref=<referral_code>" }
 *       404: { description: Offer not found or paused }
 */
router.post('/api/partners/track', auth, async (req, res) => {
  const { offer_id: offerId, conversion_type: conversionType, lat, lng, city } = req.body || {}
  const type = ['click', 'booking', 'purchase', 'lead'].includes(conversionType) ? conversionType : 'click'
  if (!offerId || !/^\d+$/.test(String(offerId))) {
    return res.status(400).json({ message: 'offer_id is required' })
  }
  try {
    const [[offer]] = await pool.query(
      `SELECT o.id, o.partner_id, o.deeplink, o.city AS offer_city, o.lat AS offer_lat, o.lng AS offer_lng
       FROM partner_offers o JOIN partners p ON p.id = o.partner_id
       WHERE o.id = ? AND o.status = 'active' AND p.status = 'active'
       LIMIT 1`,
      [offerId],
    )
    if (!offer) return res.status(404).json({ message: 'Offer not found or paused' })

    await pool.query(
      `INSERT INTO partner_conversions (partner_id, offer_id, user_id, conversion_type)
       VALUES (?, ?, ?, ?)`,
      [offer.partner_id, offer.id, req.userId, type],
    )

    const [[user]] = await pool.query('SELECT referral_code FROM users WHERE id = ? LIMIT 1', [req.userId])
    const ref = user && user.referral_code ? user.referral_code : ''
    // {lat}/{lng} — точка юзера (body или query); {to_lat}/{to_lng} — место оффера, иначе точка юзера;
    // {city} — город оффера или юзера. Неизвестные и незаполненные плейсхолдеры сохраняются как есть.
    const query = req.query || {}
    const ctxLat = lat ?? query.lat
    const ctxLng = lng ?? query.lng
    const numOrNull = (v) =>
      v !== undefined && v !== null && String(v).trim() !== '' && !Number.isNaN(Number(v))
        ? encodeURIComponent(String(v))
        : null
    const placeholders = {
      lat: numOrNull(ctxLat),
      lng: numOrNull(ctxLng),
      to_lat:
        offer.offer_lat !== null && offer.offer_lat !== undefined
          ? encodeURIComponent(String(offer.offer_lat))
          : numOrNull(ctxLat ?? ''),
      to_lng:
        offer.offer_lng !== null && offer.offer_lng !== undefined
          ? encodeURIComponent(String(offer.offer_lng))
          : numOrNull(ctxLng ?? ''),
      city:
        (city || query.city) && String(city || query.city).trim() !== ''
          ? encodeURIComponent(String(city || query.city).trim())
          : null,
    }
    let deeplink = String(offer.deeplink).replace(/\{(\w+)\}/g, (match, key) =>
      Object.prototype.hasOwnProperty.call(placeholders, key) && placeholders[key] !== null
        ? placeholders[key]
        : match,
    )
    deeplink += `${deeplink.includes('?') ? '&' : '?'}utm_source=swiftmatch&ref=${encodeURIComponent(ref)}`
    res.json({ deeplink })
  } catch (err) {
    logger.error('Partner track error:', err)
    res.status(500).json({ message: 'Failed to track partner action' })
  }
})

/**
 * @openapi
 * /api/partners/postback/{id}:
 *   post:
 *     tags: [Partners]
 *     summary: S2S postback from a partner (server-to-server conversion)
 *     description: Auth via affiliate_token in "token" field, query param or Authorization header. Idempotent by external_order_id.
 *     responses:
 *       200: { description: "{ id, commission }" }
 *       401: { description: Invalid token }
 *       404: { description: Partner not found or paused }
 */
router.post('/api/partners/postback/:id', async (req, res) => {
  const { id } = req.params
  if (!/^\d+$/.test(id)) return res.status(400).json({ message: 'Invalid id' })
  const body = req.body || {}
  const { external_order_id: externalOrderId, offer_id: offerId } = body
  const type = ['booking', 'purchase', 'lead'].includes(body.conversion_type) ? body.conversion_type : 'purchase'
  const amount = Number(body.amount)

  if (!externalOrderId || typeof externalOrderId !== 'string' || externalOrderId.length > 100) {
    return res.status(400).json({ message: 'external_order_id is required' })
  }
  if (!Number.isFinite(amount) || amount < 0) {
    return res.status(400).json({ message: 'Valid amount is required' })
  }

  try {
    const [[partner]] = await pool.query(
      `SELECT id, affiliate_token, hmac_secret, commission_rate FROM partners
       WHERE id = ? AND status = 'active'
       LIMIT 1`,
      [id],
    )
    if (!partner) return res.status(401).json({ message: 'Unauthorized' })

    // Верификация: HMAC-подпись (приоритет) или affiliate_token
    if (partner.hmac_secret) {
      const signature = req.headers['x-partner-signature']
      if (!signature) return res.status(401).json({ message: 'Missing X-Partner-Signature' })
      const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
      const expected = crypto.createHmac('sha256', partner.hmac_secret).update(raw).digest('hex')
      if (!crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))) {
        return res.status(401).json({ message: 'Invalid signature' })
      }
    } else {
      const token = body.token || req.query.token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
      if (!token || token !== partner.affiliate_token) {
        return res.status(401).json({ message: 'Unauthorized' })
      }
    }

    const [[dup]] = await pool.query(
      `SELECT id FROM partner_conversions WHERE external_order_id = ? LIMIT 1`,
      [externalOrderId],
    )
    if (dup) {
      return res.json({ id: dup.id, duplicate: true })
    }

    let offerIdResolved = null
    if (offerId && /^\d+$/.test(String(offerId))) {
      const [[offer]] = await pool.query(
        'SELECT id FROM partner_offers WHERE id = ? AND partner_id = ? LIMIT 1',
        [offerId, partner.id],
      )
      offerIdResolved = offer ? offer.id : null
    }

    const commission = Math.round(amount * Number(partner.commission_rate)) / 100
    const [result] = await pool.query(
      `INSERT INTO partner_conversions
         (partner_id, offer_id, user_id, conversion_type, external_order_id, amount, commission, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'approved')
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
      [partner.id, offerIdResolved, body.user_id && /^\d+$/.test(String(body.user_id)) ? Number(body.user_id) : null,
       type, externalOrderId, amount, commission],
    )
    res.json({ id: result.insertId, commission })
  } catch (err) {
    logger.error('Partner postback error:', err)
    res.status(500).json({ message: 'Failed to process postback' })
  }
})

const HOTEL_CACHE_TTL = 3600

router.get('/api/partners/offers/hotel', auth, async (req, res) => {
  const { city } = req.query
  if (!city || !String(city).trim()) {
    return res.status(400).json({ message: 'city is required' })
  }
  const cacheKey = `partner:offers:hotel:${String(city).trim().toLowerCase()}`
  try {
    const cached = await getCached(cacheKey)
    if (cached) return res.json(cached)

    const [rows] = await pool.query(
      `SELECT o.id, o.partner_id, p.name AS partner_name, o.category, o.title,
              o.description, o.image_url, o.price, o.city, o.lat, o.lng, o.deeplink
       FROM partner_offers o
       JOIN partners p ON p.id = o.partner_id
       WHERE o.category = 'hotel' AND FIND_IN_SET('passport', o.placement)
         AND o.status = 'active' AND p.status = 'active'
         AND (o.valid_from IS NULL OR o.valid_from <= CURDATE())
         AND (o.valid_to IS NULL OR o.valid_to >= CURDATE())
         AND (o.city = ? OR o.city IS NULL)
       ORDER BY o.created_at DESC
       LIMIT 20`,
      [String(city).trim()],
    )
    await setCached(cacheKey, rows, HOTEL_CACHE_TTL).catch(() => {})
    res.json(rows)
  } catch (err) {
    logger.error('Hotel offers error:', err)
    res.json([])
  }
})

router.post('/api/partners/hotel/book', auth, async (req, res) => {
  const { offer_id: offerId, check_in: checkIn, check_out: checkOut, guests } = req.body || {}
  if (!offerId || !/^\d+$/.test(String(offerId))) {
    return res.status(400).json({ message: 'offer_id is required' })
  }
  if (!checkIn || !checkOut) {
    return res.status(400).json({ message: 'check_in and check_out are required (YYYY-MM-DD)' })
  }
  try {
    const [[offer]] = await pool.query(
      `SELECT o.id, o.partner_id, o.title, o.deeplink, o.city, o.lat, o.lng,
              p.name AS partner_name, p.commission_rate, p.status AS partner_status
       FROM partner_offers o JOIN partners p ON p.id = o.partner_id
       WHERE o.id = ? AND o.category = 'hotel' AND o.status = 'active' AND p.status = 'active' LIMIT 1`,
      [offerId],
    )
    if (!offer) return res.status(404).json({ message: 'Hotel offer not found' })

    const guestsCount = Math.min(Math.max(Number(guests) || 2, 1), 10)

    const [result] = await pool.query(
      `INSERT INTO partner_conversions (partner_id, offer_id, user_id, conversion_type, amount, commission, status)
       VALUES (?, ?, ?, 'booking', 0, 0, 'pending')`,
      [offer.partner_id, offer.id, req.userId],
    )

    let deeplink = String(offer.deeplink || '')
    if (deeplink) {
      const sep = deeplink.includes('?') ? '&' : '?'
      deeplink += `${sep}checkin=${encodeURIComponent(checkIn)}&checkout=${encodeURIComponent(checkOut)}&guests=${guestsCount}`
    }

    res.status(201).json({
      conversion_id: result.insertId,
      offer_id: offer.id,
      hotel: offer.title,
      partner_name: offer.partner_name,
      check_in: checkIn,
      check_out: checkOut,
      guests: guestsCount,
      deeplink,
      city: offer.city,
    })
  } catch (err) {
    logger.error('Hotel booking error:', err)
    res.status(500).json({ message: 'Failed to create hotel booking' })
  }
})

router.post('/api/partners/spa/book', auth, async (req, res) => {
  const { offer_id: offerId, date, time, service } = req.body || {}
  if (!offerId || !/^\d+$/.test(String(offerId))) {
    return res.status(400).json({ message: 'offer_id is required' })
  }
  if (!date || !time) {
    return res.status(400).json({ message: 'date and time are required' })
  }
  try {
    const [[offer]] = await pool.query(
      `SELECT o.id, o.partner_id, o.title, o.deeplink, o.city, o.price,
              p.name AS partner_name, p.commission_rate, p.status AS partner_status
       FROM partner_offers o JOIN partners p ON p.id = o.partner_id
       WHERE o.id = ? AND o.category IN ('spa','experience') AND o.status = 'active' AND p.status = 'active' LIMIT 1`,
      [offerId],
    )
    if (!offer) return res.status(404).json({ message: 'Spa/fitness offer not found' })

    const [result] = await pool.query(
      `INSERT INTO partner_conversions (partner_id, offer_id, user_id, conversion_type, amount, commission, status)
       VALUES (?, ?, ?, 'booking', 0, 0, 'pending')`,
      [offer.partner_id, offer.id, req.userId],
    )

    let deeplink = String(offer.deeplink || '')
    if (deeplink) {
      const sep = deeplink.includes('?') ? '&' : '?'
      deeplink += `${sep}date=${encodeURIComponent(date)}&time=${encodeURIComponent(time)}${service ? `&service=${encodeURIComponent(service)}` : ''}`
    }

    res.status(201).json({
      conversion_id: result.insertId,
      offer_id: offer.id,
      title: offer.title,
      partner_name: offer.partner_name,
      date,
      time,
      service: service || null,
      price: offer.price,
      deeplink,
    })
  } catch (err) {
    logger.error('Spa booking error:', err)
    res.status(500).json({ message: 'Failed to create spa booking' })
  }
})

/**
 * @openapi
 * /api/partners/offers/{id}:
 *   get:
 *     tags: [Partners]
 *     summary: Single offer details
 */
router.get('/api/partners/offers/:id', auth, async (req, res) => {
  const { id } = req.params
  if (!/^\d+$/.test(id)) return res.status(400).json({ message: 'Invalid id' })
  try {
    const [[offer]] = await pool.query(
      `SELECT o.id, o.partner_id, p.name AS partner_name, o.category, o.title,
              o.description, o.image_url, o.price, o.city, o.placement
       FROM partner_offers o
       JOIN partners p ON p.id = o.partner_id
       WHERE o.id = ? AND o.status = 'active' AND p.status = 'active'
       LIMIT 1`,
      [id],
    )
    if (!offer) return res.status(404).json({ message: 'Offer not found' })
    res.json(offer)
  } catch (err) {
    logger.error('Partner offer detail error:', err)
    res.status(500).json({ message: 'Failed to fetch offer' })
  }
})

/**
 * @openapi
 * /api/partners/order:
 *   post:
 *     tags: [Partners]
 *     summary: Create a Stripe Checkout order (flowers/gifts)
 */
router.post('/api/partners/order', auth, async (req, res) => {
  const { offer_id: offerId, recipient_name: recipientName, recipient_address: recipientAddress, gift_message: giftMessage } = req.body || {}
  if (!offerId || !/^\d+$/.test(String(offerId))) {
    return res.status(400).json({ message: 'offer_id is required' })
  }
  try {
    const [[offer]] = await pool.query(
      `SELECT o.id, o.partner_id, o.title, o.price, o.deeplink, p.name AS partner_name, p.commission_rate, p.status AS partner_status
       FROM partner_offers o JOIN partners p ON p.id = o.partner_id
       WHERE o.id = ? AND o.status = 'active' AND p.status = 'active' LIMIT 1`,
      [offerId],
    )
    if (!offer) return res.status(404).json({ message: 'Offer not found' })
    if (!offer.price || Number(offer.price) <= 0) {
      return res.status(400).json({ message: 'This offer has no price set' })
    }

    const amount = Math.round(Number(offer.price) * 100) / 100
    const commission = Math.round(amount * Number(offer.commission_rate)) / 100

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
              product_data: { name: offer.title, description: `${offer.partner_name} — ${offer.title}` },
              unit_amount: Math.round(amount * 100),
            },
            quantity: 1,
          }],
          mode: 'payment',
          success_url: `${req.headers.origin}/partner-order/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${req.headers.origin}/partner-order/cancel?offer_id=${offerId}`,
          metadata: {
            userId: String(req.userId),
            offer_id: String(offerId),
            partner_id: String(offer.partner_id),
            recipient_name: recipientName || '',
            recipient_address: recipientAddress || '',
            gift_message: giftMessage || '',
          },
        })

        await pool.query(
          `INSERT INTO partner_orders (partner_id, offer_id, user_id, stripe_session_id, amount, commission, recipient_name, recipient_address, gift_message, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
          [offer.partner_id, offerId, req.userId, session.id, amount, commission,
           recipientName || null, recipientAddress || null, giftMessage || null],
        )

        return res.json({ url: session.url, sessionId: session.id })
      } catch (err) {
        if (isLive) {
          return res.status(502).json({ message: 'Stripe payment failed', error: err.message })
        }
        req.log?.warn('Stripe error (partner order), falling back to mock: ' + err.message)
      }
    }

    if (isLive || isProd) {
      return res.status(502).json({ message: isProd ? 'Stripe not configured for production' : 'Stripe not configured in live mode' })
    }

    const orderId = `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    await pool.query(
      `INSERT INTO partner_orders (partner_id, offer_id, user_id, stripe_session_id, amount, commission, recipient_name, recipient_address, gift_message, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid')`,
      [offer.partner_id, offerId, req.userId, orderId, amount, commission,
       recipientName || null, recipientAddress || null, giftMessage || null],
    )
    await pool.query(
      `INSERT INTO partner_conversions (partner_id, offer_id, user_id, conversion_type, amount, commission, external_order_id, stripe_session_id, status)
       VALUES (?, ?, ?, 'purchase', ?, ?, ?, ?, 'approved')`,
      [offer.partner_id, offerId, req.userId, amount, commission, orderId, orderId],
    )
    res.status(201).json({ message: 'Order created (mock)', orderId, deeplink: offer.deeplink })
  } catch (err) {
    logger.error('Partner order error:', err)
    res.status(500).json({ message: 'Failed to create order' })
  }
})

/**
 * @openapi
 * /api/partners/order/webhook:
 *   post:
 *     tags: [Partners]
 *     summary: Stripe webhook for partner orders (flowers/gifts)
 */
router.post('/api/partners/order/webhook', async (req, res) => {
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
    logger.error('Partner order webhook signature error:', err)
    return res.status(400).json({ message: 'Invalid signature' })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object
    const { userId, offer_id: offerId, partner_id: partnerId, recipient_name, recipient_address, gift_message } = session.metadata || {}
    if (session.payment_status !== 'paid') return res.json({ received: true })
    try {
      const conn = await pool.getConnection()
      try {
        await conn.beginTransaction()
        const [evt] = await conn.query(
          'INSERT IGNORE INTO webhook_events (provider, event_id) VALUES (?, ?)',
          ['stripe_partner_order', String(event.id || '')],
        )
        if (!evt || evt.affectedRows === 0) {
          await conn.rollback()
          return res.json({ received: true })
        }
        await conn.query(
          `UPDATE partner_orders SET status = 'paid' WHERE stripe_session_id = ? AND status = 'pending'`,
          [session.id],
        )
        await conn.query(
          `INSERT INTO partner_conversions (partner_id, offer_id, user_id, conversion_type, external_order_id, stripe_session_id, amount, commission, status)
           SELECT po.partner_id, po.offer_id, po.user_id, 'purchase', po.stripe_session_id, po.stripe_session_id, po.amount, po.commission, 'approved'
           FROM partner_orders po WHERE po.stripe_session_id = ? LIMIT 1`,
          [session.id],
        )
        await conn.commit()
      } catch (err) {
        await conn.rollback()
        throw err
      } finally {
        conn.release()
      }
    } catch (err) {
      logger.error('Partner order webhook processing error:', err)
    }
  }
  res.json({ received: true })
})

/**
 * @openapi
 * /api/partners/orders/my:
 *   get:
 *     tags: [Partners]
 *     summary: User's partner order history
 */
router.get('/api/partners/orders/my', auth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT po.id, po.amount, po.status, po.recipient_name, po.gift_message,
              po.created_at, o.title AS offer_title, p.name AS partner_name, o.category
       FROM partner_orders po
       JOIN partner_offers o ON o.id = po.offer_id
       JOIN partners p ON p.id = po.partner_id
       WHERE po.user_id = ?
       ORDER BY po.created_at DESC
       LIMIT 50`,
      [req.userId],
    )
    res.json(rows)
  } catch (err) {
    logger.error('Partner orders list error:', err)
    res.json([])
  }
})

/**
 * @openapi
 * /api/partners/booking:
 *   post:
 *     tags: [Partners]
 *     summary: Create a restaurant table booking
 */
router.post('/api/partners/booking', auth, async (req, res) => {
  const { offer_id: offerId, date, time, guests, message } = req.body || {}
  if (!offerId || !/^\d+$/.test(String(offerId))) {
    return res.status(400).json({ message: 'offer_id is required' })
  }
  if (!date || !time) {
    return res.status(400).json({ message: 'date and time are required (YYYY-MM-DD, HH:MM)' })
  }
  try {
    const [[offer]] = await pool.query(
      `SELECT o.id, o.partner_id, o.title, o.deeplink, o.city, o.lat, o.lng, p.name AS partner_name, p.commission_rate, p.status AS partner_status
       FROM partner_offers o JOIN partners p ON p.id = o.partner_id
       WHERE o.id = ? AND o.category = 'restaurant' AND o.status = 'active' AND p.status = 'active' LIMIT 1`,
      [offerId],
    )
    if (!offer) return res.status(404).json({ message: 'Restaurant offer not found' })

    const guestsCount = Math.min(Math.max(Number(guests) || 2, 1), 20)

    const [result] = await pool.query(
      `INSERT INTO partner_conversions (partner_id, offer_id, user_id, conversion_type, amount, commission, status)
       VALUES (?, ?, ?, 'booking', 0, 0, 'pending')`,
      [offer.partner_id, offer.id, req.userId],
    )

    let deeplink = String(offer.deeplink || '')
    if (deeplink) {
      const sep = deeplink.includes('?') ? '&' : '?'
      deeplink += `${sep}date=${encodeURIComponent(date)}&time=${encodeURIComponent(time)}&guests=${guestsCount}`
    }

    const bookingData = {
      conversion_id: result.insertId,
      offer_id: offer.id,
      restaurant: offer.title,
      partner_name: offer.partner_name,
      date,
      time,
      guests: guestsCount,
      message: message || null,
      deeplink,
      city: offer.city,
    }

    res.status(201).json(bookingData)
  } catch (err) {
    logger.error('Partner booking error:', err)
    res.status(500).json({ message: 'Failed to create booking' })
  }
})

/**
 * @openapi
 * /api/partners/booking/share:
 *   post:
 *     tags: [Partners]
 *     summary: Share a restaurant booking card in a chat (WS event)
 */
router.post('/api/partners/booking/share', auth, async (req, res) => {
  const { chat_id: chatId, offer_id: offerId, date, time, guests, message: bookMsg } = req.body || {}
  if (!chatId || !/^\d+$/.test(String(chatId))) {
    return res.status(400).json({ message: 'chat_id is required' })
  }
  if (!offerId || !/^\d+$/.test(String(offerId))) {
    return res.status(400).json({ message: 'offer_id is required' })
  }
  try {
    const [[offer]] = await pool.query(
      `SELECT o.id, o.title, o.deeplink, o.city, p.name AS partner_name
       FROM partner_offers o JOIN partners p ON p.id = o.partner_id
       WHERE o.id = ? AND o.category = 'restaurant' AND o.status = 'active' LIMIT 1`,
      [offerId],
    )
    if (!offer) return res.status(404).json({ message: 'Restaurant not found' })

    const [[participant]] = await pool.query(
      'SELECT user_id FROM chat_participants WHERE chat_id = ? AND user_id = ? LIMIT 1',
      [chatId, req.userId],
    )
    if (!participant) return res.status(403).json({ message: 'Not a participant of this chat' })

    const guestsCount = Math.min(Math.max(Number(guests) || 2, 1), 20)
    const card = {
      type: 'restaurant_shared',
      restaurant: offer.title,
      partner_name: offer.partner_name,
      date: date || null,
      time: time || null,
      guests: guestsCount,
      message: bookMsg || null,
      city: offer.city,
    }

    try {
      const ws = getIO()
      if (ws) {
        ws.to(`chat:${chatId}`).emit('partner:restaurant_shared', {
          chatId: Number(chatId),
          senderId: req.userId,
          card,
        })
      }
    } catch {}

    res.json({ shared: true })
  } catch (err) {
    logger.error('Partner booking share error:', err)
    res.status(500).json({ message: 'Failed to share booking' })
  }
})

export default router
