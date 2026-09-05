import { Router } from 'express'
import crypto from 'crypto'
import pool from '../db.js'
import { auth } from '../middleware.js'
import logger from '../logger.js'
import { invalidate } from '../cache.js'

const router = Router()

const OFFER_CATEGORIES = ['cinema', 'restaurant', 'flowers', 'taxi', 'hotel', 'spa', 'photo', 'gift', 'event', 'experience']
const PLACEMENTS = ['hangout', 'chat', 'profile', 'passport', 'attachment_result']

async function getPartnerByUserId(userId) {
  const [[row]] = await pool.query('SELECT * FROM partners WHERE user_id = ? LIMIT 1', [userId])
  return row || null
}

function requirePartner(handler) {
  return async (req, res) => {
    try {
      const partner = await getPartnerByUserId(req.userId)
      if (!partner) return res.status(403).json({ message: 'Not a partner account' })
      if (partner.status !== 'active') return res.status(403).json({ message: 'Partner account is paused' })
      req.partner = partner
      return handler(req, res)
    } catch (err) {
      logger.error('Partner middleware error:', err)
      res.status(500).json({ message: 'Server error' })
    }
  }
}

// ─── Registration ─────────────────────────────────────────────
router.post('/api/partner/register', auth, async (req, res) => {
  const { name, type, description, contact_email, contact_phone } = req.body || {}
  const trimmed = String(name || '').trim()
  if (!trimmed || trimmed.length < 2) {
    return res.status(400).json({ message: 'Partner name is required (min 2 chars)' })
  }
  try {
    const existing = await getPartnerByUserId(req.userId)
    if (existing) return res.status(409).json({ message: 'Already registered as partner' })

    const [[nameExists]] = await pool.query('SELECT id FROM partners WHERE name = ?', [trimmed])
    if (nameExists) return res.status(409).json({ message: 'Partner name already taken' })

    const hmacSecret = `wh_${crypto.randomBytes(16).toString('hex')}`
    const affiliateToken = crypto.randomBytes(16).toString('hex')
    const [result] = await pool.query(
      `INSERT INTO partners (user_id, name, type, description, contact_email, contact_phone, affiliate_token, hmac_secret, commission_rate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 10)`,
      [req.userId, trimmed, type || 'deeplink', description || null, contact_email || null, contact_phone || null, affiliateToken, hmacSecret],
    )
    res.status(201).json({ id: result.insertId, name: trimmed, hmac_secret: hmacSecret, affiliate_token: affiliateToken })
  } catch (err) {
    logger.error('Partner register error:', err)
    res.status(500).json({ message: 'Failed to register partner' })
  }
})

// ─── Dashboard ────────────────────────────────────────────────
router.get('/api/partner/dashboard', auth, requirePartner(async (req, res) => {
  try {
    const partnerId = req.partner.id

    const [[stats]] = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM partner_offers WHERE partner_id = ?) AS offers_count,
         (SELECT COALESCE(SUM(clicks_total), 0) FROM (SELECT COUNT(*) AS clicks_total FROM partner_conversions WHERE partner_id = ? AND conversion_type = 'click' GROUP BY offer_id) sub) AS clicks_total,
         (SELECT COUNT(*) FROM partner_conversions WHERE partner_id = ? AND conversion_type != 'click') AS conversions_count,
         (SELECT COALESCE(SUM(commission), 0) FROM partner_conversions WHERE partner_id = ? AND conversion_type != 'click') AS commission_total,
         (SELECT COALESCE(SUM(amount), 0) FROM partner_payouts WHERE partner_id = ? AND status = 'completed') AS paid_out,
         (SELECT COALESCE(SUM(commission), 0) FROM partner_conversions WHERE partner_id = ? AND conversion_type != 'click')
           - (SELECT COALESCE(SUM(amount), 0) FROM partner_payouts WHERE partner_id = ? AND status = 'completed') AS commission_pending`,
      [partnerId, partnerId, partnerId, partnerId, partnerId, partnerId, partnerId],
    )

    const [[sub]] = await pool.query(
      'SELECT tier, status, expires_at FROM partner_subscriptions WHERE partner_id = ? ORDER BY created_at DESC LIMIT 1',
      [partnerId],
    )

    res.json({ partner: { id: req.partner.id, name: req.partner.name, type: req.partner.type, status: req.partner.status }, stats, subscription: sub || null })
  } catch (err) {
    logger.error('Partner dashboard error:', err)
    res.status(500).json({ message: 'Failed to load dashboard' })
  }
}))

// ─── Own offers CRUD ──────────────────────────────────────────
router.get('/api/partner/offers', auth, requirePartner(async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT o.id, o.category, o.title, o.description, o.deeplink, o.price, o.city, o.placement, o.status, o.created_at,
              o.event_start, o.event_end, o.location, o.poster_url, o.event_url, o.capacity, o.tickets_sold,
              (SELECT COUNT(*) FROM partner_conversions c WHERE c.offer_id = o.id AND c.conversion_type = 'click') AS clicks
       FROM partner_offers o WHERE o.partner_id = ? ORDER BY o.created_at DESC`,
      [req.partner.id],
    )
    res.json(rows)
  } catch (err) {
    logger.error('Partner offers list error:', err)
    res.status(500).json({ message: 'Failed to load offers' })
  }
}))

router.post('/api/partner/offers', auth, requirePartner(async (req, res) => {
  const { category, title, description, deeplink, price, city, placement, event_start: eventStart, event_end: eventEnd, location, poster_url: posterUrl, event_url: eventUrl, capacity } = req.body || {}
  if (!category || !OFFER_CATEGORIES.includes(category)) {
    return res.status(400).json({ message: `category must be one of: ${OFFER_CATEGORIES.join(', ')}` })
  }
  if (!title || String(title).trim().length < 3) {
    return res.status(400).json({ message: 'title is required (min 3 chars)' })
  }
  if (!deeplink) {
    return res.status(400).json({ message: 'deeplink is required' })
  }
  const isEvent = category === 'event' || category === 'experience'
  if (isEvent && (!eventStart || isNaN(Date.parse(eventStart)))) {
    return res.status(400).json({ message: 'event_start is required for events (YYYY-MM-DD HH:mm)' })
  }
  try {
    const placements = String(placement || 'chat').split(',').map((p) => p.trim()).filter((p) => PLACEMENTS.includes(p))
    if (placements.length === 0) placements.push('chat')

    const [[sub]] = await pool.query(
      "SELECT tier FROM partner_subscriptions WHERE partner_id = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1",
      [req.partner.id],
    )
    const tier = sub?.tier || 'basic'
    const maxOffers = tier === 'pro' ? 50 : 5
    const [[{ count }]] = await pool.query('SELECT COUNT(*) AS count FROM partner_offers WHERE partner_id = ?', [req.partner.id])
    if (count >= maxOffers) {
      return res.status(403).json({ message: `Offer limit reached (${maxOffers}). Upgrade to Pro for more.`, code: 'UPGRADE_REQUIRED' })
    }

    const [result] = await pool.query(
      `INSERT INTO partner_offers (partner_id, category, title, description, deeplink, price, city, placement, status, event_start, event_end, location, poster_url, event_url, capacity)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
      [req.partner.id, category, String(title).trim(), description || null, deeplink, price || null, city || null, placements.join(','), eventStart ? new Date(eventStart) : null, eventEnd ? new Date(eventEnd) : null, location || null, posterUrl || null, eventUrl || null, capacity ? Number(capacity) : null],
    )
    await pool.query(
      `UPDATE partner_offers SET event_start = ?, event_end = ?, location = ?, poster_url = ?, event_url = ?, capacity = ? WHERE id = ?`,
      [eventStart ? new Date(eventStart) : null, eventEnd ? new Date(eventEnd) : null, location || null, posterUrl || null, eventUrl || null, capacity ? Number(capacity) : null, result.insertId],
    )
    invalidate('partner:offers:*').catch(() => {})
    res.status(201).json({ id: result.insertId })
  } catch (err) {
    logger.error('Partner offer create error:', err)
    res.status(500).json({ message: 'Failed to create offer' })
  }
}))

router.put('/api/partner/offers/:offerId', auth, requirePartner(async (req, res) => {
  const { offerId } = req.params
  if (!/^\d+$/.test(offerId)) return res.status(400).json({ message: 'Invalid offer id' })
  try {
    const [[offer]] = await pool.query('SELECT id FROM partner_offers WHERE id = ? AND partner_id = ?', [offerId, req.partner.id])
    if (!offer) return res.status(404).json({ message: 'Offer not found' })

    const { title, description, deeplink, price, city, placement, status, event_start: eventStart, event_end: eventEnd, location, poster_url: posterUrl, event_url: eventUrl, capacity } = req.body || {}
    const updates = []
    const params = []
    if (title !== undefined) { updates.push('title = ?'); params.push(String(title).trim()) }
    if (description !== undefined) { updates.push('description = ?'); params.push(description) }
    if (deeplink !== undefined) { updates.push('deeplink = ?'); params.push(deeplink) }
    if (price !== undefined) { updates.push('price = ?'); params.push(price) }
    if (city !== undefined) { updates.push('city = ?'); params.push(city) }
    if (placement !== undefined) {
      const placements = String(placement).split(',').map((p) => p.trim()).filter((p) => PLACEMENTS.includes(p))
      updates.push('placement = ?'); params.push(placements.join(','))
    }
    if (status !== undefined && ['active', 'paused'].includes(status)) {
      updates.push('status = ?'); params.push(status)
    }
    if (eventStart !== undefined) { updates.push('event_start = ?'); params.push(eventStart ? new Date(eventStart) : null) }
    if (eventEnd !== undefined) { updates.push('event_end = ?'); params.push(eventEnd ? new Date(eventEnd) : null) }
    if (location !== undefined) { updates.push('location = ?'); params.push(location) }
    if (posterUrl !== undefined) { updates.push('poster_url = ?'); params.push(posterUrl) }
    if (eventUrl !== undefined) { updates.push('event_url = ?'); params.push(eventUrl) }
    if (capacity !== undefined) { updates.push('capacity = ?'); params.push(capacity === null ? null : Number(capacity)) }
    if (updates.length === 0) return res.status(400).json({ message: 'No fields to update' })

    params.push(offerId)
    await pool.query(`UPDATE partner_offers SET ${updates.join(', ')} WHERE id = ?`, params)
    invalidate('partner:offers:*').catch(() => {})
    res.json({ message: 'Offer updated' })
  } catch (err) {
    logger.error('Partner offer update error:', err)
    res.status(500).json({ message: 'Failed to update offer' })
  }
}))

router.delete('/api/partner/offers/:offerId', auth, requirePartner(async (req, res) => {
  const { offerId } = req.params
  if (!/^\d+$/.test(offerId)) return res.status(400).json({ message: 'Invalid offer id' })
  try {
    const [result] = await pool.query('DELETE FROM partner_offers WHERE id = ? AND partner_id = ?', [offerId, req.partner.id])
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Offer not found' })
    invalidate('partner:offers:*').catch(() => {})
    res.json({ message: 'Offer deleted' })
  } catch (err) {
    logger.error('Partner offer delete error:', err)
    res.status(500).json({ message: 'Failed to delete offer' })
  }
}))

// ─── Conversions (own) ────────────────────────────────────────
router.get('/api/partner/conversions', auth, requirePartner(async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT c.id, c.conversion_type, c.amount, c.commission, c.status, c.external_order_id, c.created_at,
              o.title AS offer_title
       FROM partner_conversions c
       LEFT JOIN partner_offers o ON o.id = c.offer_id
       WHERE c.partner_id = ?
       ORDER BY c.created_at DESC LIMIT 100`,
      [req.partner.id],
    )
    res.json(rows)
  } catch (err) {
    logger.error('Partner conversions error:', err)
    res.status(500).json({ message: 'Failed to load conversions' })
  }
}))

// ─── Subscription ─────────────────────────────────────────────
router.get('/api/partner/subscription', auth, requirePartner(async (req, res) => {
  try {
    const [[sub]] = await pool.query(
      'SELECT tier, status, starts_at, expires_at FROM partner_subscriptions WHERE partner_id = ? ORDER BY created_at DESC LIMIT 1',
      [req.partner.id],
    )
    res.json(sub || { tier: 'basic', status: 'active', expires_at: null })
  } catch (err) {
    logger.error('Partner subscription error:', err)
    res.status(500).json({ message: 'Failed to load subscription' })
  }
}))

const PARTNER_TIERS = {
  basic: { name: 'Basic', price: 0, maxOffers: 5, commissionRate: 10 },
  pro: { name: 'Pro', price: 2990, maxOffers: 50, commissionRate: 15 },
}

router.post('/api/partner/subscribe', auth, requirePartner(async (req, res) => {
  const { tier } = req.body || {}
  if (!tier || !PARTNER_TIERS[tier]) {
    return res.status(400).json({ message: `tier must be one of: ${Object.keys(PARTNER_TIERS).join(', ')}` })
  }
  if (tier === 'basic') {
    await pool.query(
      "UPDATE partner_subscriptions SET status = 'cancelled' WHERE partner_id = ? AND status = 'active'",
      [req.partner.id],
    )
    await pool.query('UPDATE partners SET commission_rate = 10 WHERE id = ?', [req.partner.id])
    return res.json({ message: 'Downgraded to Basic', tier: 'basic' })
  }

  if (process.env.STRIPE_SECRET_KEY) {
    const stripe = (await import('stripe')).default
    const stripeClient = new stripe(process.env.STRIPE_SECRET_KEY)
    const session = await stripeClient.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price_data: { currency: 'rub', product_data: { name: 'SwiftMatch Partner Pro' }, recurring: { interval: 'month' }, unit_amount: PARTNER_TIERS.pro.price * 100 }, quantity: 1 }],
      success_url: `${req.headers.origin || 'https://swiftmatch.app'}/partner/dashboard?upgraded=1`,
      cancel_url: `${req.headers.origin || 'https://swiftmatch.app'}/partner/dashboard?cancelled=1`,
      metadata: { partner_id: String(req.partner.id), tier: 'pro' },
    })
    return res.json({ url: session.url, session_id: session.id })
  }

  // Mock mode
  await pool.query(
    `INSERT INTO partner_subscriptions (partner_id, tier, status, stripe_session_id, expires_at)
     VALUES (?, 'pro', 'active', ?, DATE_ADD(NOW(), INTERVAL 30 DAY))`,
    [req.partner.id, `mock_${Date.now()}`],
  )
  await pool.query('UPDATE partners SET commission_rate = 15 WHERE id = ?', [req.partner.id])
  res.json({ message: 'Pro activated (mock)', tier: 'pro', mock: true })
}))

export default router
