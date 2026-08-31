import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import pool from '../db.js'
import { getIO } from '../ws.js'
import { getBannedWords, containsBannedWord } from '../banned-words.js'
import { sendPushToUser } from './push.js'
import { auth, optionalAuth } from '../middleware.js'
import logger from '../logger.js'
import { stripHtml } from '../sanitize.js'
import { trackEvent } from './experiments.js'
import { createBreaker } from '../circuit-breaker.js'

const OPENAI_API_KEY = process.env.OPENAI_API_KEY

/**
 * @openapi
 * /api/hangouts:
 *   get:
 *     tags: [Hangouts]
 *     summary: Hangouts feed with filters (category, geo radius, dates, city)
 *     parameters:
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *       - in: query
 *         name: lat
 *         schema: { type: number }
 *       - in: query
 *         name: lng
 *         schema: { type: number }
 *       - in: query
 *         name: radius
 *         schema: { type: number, description: "km" }
 *       - in: query
 *         name: date_from
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: date_to
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: city
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Array of hangouts
 *
 * /api/hangouts/{id}:
 *   get:
 *     tags: [Hangouts]
 *     summary: Hangout detail with author profile
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Hangout with author
 */
const router = Router()

const HANGOUT_CATEGORIES = ['cinema', 'theater', 'exhibition', 'cafe', 'concert', 'sport', 'other']

async function countAcceptedResponses(hangoutId) {
  const [[row]] = await pool.query(
    'SELECT COUNT(*) AS cnt FROM hangout_responses WHERE hangout_id = ? AND status = ?',
    [hangoutId, 'accepted'],
  )
  return Number(row?.cnt || 0)
}

async function resolvePaidGate(hangout, userId) {
  if (!hangout) return null
  const price = Number(hangout.price) || 0
  if (price <= 0) return null
  const [[ticket]] = await pool.query(
    'SELECT status FROM hangout_tickets WHERE hangout_id = ? AND user_id = ? LIMIT 1',
    [hangout.id, userId],
  )
  if (!ticket || ticket.status !== 'paid') {
    return { statusCode: 402, message: 'PAYMENT_REQUIRED', price }
  }
  const capacityLimit = hangout.capacity !== null && hangout.capacity !== undefined
    ? Number(hangout.capacity)
    : Number(hangout.max_companions)
  if (capacityLimit > 0) {
    const [[sold]] = await pool.query(
      'SELECT COUNT(*) AS cnt FROM hangout_tickets WHERE hangout_id = ? AND status = ?',
      [hangout.id, 'paid'],
    )
    const accepted = hangout.hangout_type === 'date' ? await countAcceptedResponses(hangout.id) : 0
    if (Number(sold?.cnt || 0) + accepted >= capacityLimit) {
      return { statusCode: 409, message: 'CAPACITY_FULL' }
    }
  }
  return null
}

const respondLimiter = rateLimit({ windowMs: 60_000, max: 30, message: { message: 'Too many responses' } })
const createLimiter = rateLimit({ windowMs: 60_000, max: 10, message: { message: 'Too many hangouts created' } })

const PAGE_SIZE_DEFAULT = 20
const PAGE_SIZE_MAX = 50

function parseLimit(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return PAGE_SIZE_DEFAULT
  return Math.min(Math.floor(n), PAGE_SIZE_MAX)
}

const COMPANIONS_CAP_FREE = 10
const COMPANIONS_CAP_PREMIUM = 20

async function getCompanionsCap(userId) {
  const [subRows] = await pool.query(
    'SELECT id FROM subscriptions WHERE user_id = ? AND is_active = 1 AND expires_at > NOW() LIMIT 1',
    [userId],
  )
  return subRows.length > 0 ? COMPANIONS_CAP_PREMIUM : COMPANIONS_CAP_FREE
}


const HANGOUT_LIST_SELECT = `
  SELECT h.id, h.user_id AS author_id, h.category, h.title, h.description,
         h.place_name, h.place_address, h.city, h.lat, h.lng, h.event_date,
         h.max_companions, h.hangout_type, h.status, h.created_at,
         h.price, h.capacity, h.boosted,
         up.display_name, up.avatar_url, up.age, up.online,
         (SELECT COUNT(*) FROM hangout_tickets ht WHERE ht.hangout_id = h.id AND ht.status = 'paid') AS sold_tickets,
         po.id AS offer_id, po.title AS offer_title, po.price AS offer_price,
         po.image_url AS offer_image_url, po.deeplink AS offer_deeplink,
         po.category AS offer_category, po.city AS offer_city, po.valid_to AS offer_valid_to,
         po.pinned AS offer_pinned,
         (SELECT COUNT(*) FROM hangout_responses hr WHERE hr.hangout_id = h.id AND hr.status = 'accepted') AS accepted_count,
         (SELECT COUNT(*) FROM hangout_participants hp WHERE hp.hangout_id = h.id AND hp.status = 'joined') AS participant_count,
         (SELECT ROUND(AVG(hrv.rating), 1) FROM hangout_reviews hrv WHERE hrv.hangout_id = h.id AND hrv.rating IS NOT NULL) AS rating,
         (SELECT COUNT(*) FROM hangout_reviews hrv2 WHERE hrv2.hangout_id = h.id AND hrv2.rating IS NOT NULL) AS review_count,
         (SELECT COALESCE(GROUP_CONCAT(CONCAT(hp2.user_id, '|', NULLIF(hp2.display_name, ''), '|', NULLIF(hp2.avatar_url, '')) SEPARATOR ';'), '')
            FROM (
              SELECT hp3.user_id, up3.display_name, up3.avatar_url, hp3.joined_at
              FROM hangout_participants hp3
              JOIN user_profiles up3 ON up3.id = hp3.user_id
              WHERE hp3.hangout_id = h.id AND hp3.status = 'joined'
              ORDER BY hp3.joined_at ASC
              LIMIT 3
            ) hp2
          ) AS attendees_csv`

const JOIN_PARTNER_OFFER = `LEFT JOIN partner_offers po ON po.id = h.partner_offer_id`

function parseAttendees(row) {
  if (!row) return undefined
  if (row.attendees_csv !== undefined) {
    row.attendees = String(row.attendees_csv || "")
      .split(';')
      .filter(Boolean)
      .map((part) => {
        const [user_id, display_name, avatar_url] = part.split('|')
        return { user_id: Number(user_id), display_name: display_name || undefined, avatar_url: avatar_url || null }
      })
    delete row.attendees_csv
  }
  return row
}

// ─── Feed ──────────────────────────────────────────────────────
router.get('/api/hangouts', optionalAuth, async (req, res) => {
  const { category, type, lat, lng, radius, date_from, date_to, city, q } = req.query
  const page = Math.max(Number(req.query.page) || 1, 1)
  const limit = parseLimit(req.query.limit)
  const offset = (page - 1) * limit

  try {
    const where = ["h.status IN ('active','completed')"]
    const params = []

    if (q && String(q).trim()) {
      const term = `%${String(q).trim().slice(0, 100)}%`
      where.push('(h.title LIKE ? OR h.description LIKE ? OR h.place_name LIKE ? OR h.city LIKE ?)')
      params.push(term, term, term, term)
    }

    if (category && HANGOUT_CATEGORIES.includes(category)) {
      where.push('h.category = ?')
      params.push(category)
    }
    if (type === 'date' || type === 'company') {
      where.push('h.hangout_type = ?')
      params.push(type)
    }
    if (city) {
      where.push('h.city = ?')
      params.push(String(city).slice(0, 100))
    }
    if (date_from) {
      where.push('h.event_date >= ?')
      params.push(String(date_from))
    }
    if (date_to) {
      where.push('h.event_date <= ?')
      params.push(String(date_to))
    }

    let distanceExpr = ''
    let having = ''
    const geoParams = []
    const parsedLat = lat !== undefined && lat !== '' ? parseFloat(lat) : NaN
    const parsedLng = lng !== undefined && lng !== '' ? parseFloat(lng) : NaN
    if (!isNaN(parsedLat) && !isNaN(parsedLng)) {
      const radiusKm = Number(radius) > 0 ? Number(radius) : 50
      distanceExpr = `, ROUND(ST_Distance_Sphere(ST_SRID(POINT(h.lng, h.lat), 4326), ST_SRID(POINT(?, ?), 4326)) / 1000, 1) AS distance_km`
      having = ' HAVING distance_km <= ?'
      geoParams.push(parsedLng, parsedLat, radiusKm)
    }

    const sql = `${HANGOUT_LIST_SELECT}${distanceExpr}
                 FROM hangouts h
                 JOIN user_profiles up ON up.id = h.user_id
                 ${JOIN_PARTNER_OFFER}
                 WHERE ${where.join(' AND ')}
                 ${having}
                 ORDER BY (h.boosted = 1) DESC, (po.pinned IS NOT NULL AND po.pinned = 1) DESC, h.event_date ASC
                 LIMIT ? OFFSET ?`
    const rows = await pool.query(sql, [...params, ...geoParams, limit, offset])

    res.json(rows[0].map(parseAttendees))
  } catch (err) {
    logger.error('Hangouts feed error:', err)
    res.status(500).json({ message: 'Failed to fetch hangouts' })
  }
})

// ─── My listings / my responses (before :id routes) ────────────
router.get('/api/hangouts/my', auth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `${HANGOUT_LIST_SELECT}
       FROM hangouts h
       JOIN user_profiles up ON up.id = h.user_id
       ${JOIN_PARTNER_OFFER}
       WHERE h.user_id = ?
       ORDER BY h.event_date DESC`,
       [req.userId],
    )
    res.json(rows.map(parseAttendees))
  } catch (err) {
    logger.error('My hangouts error:', err)
    res.status(500).json({ message: 'Failed to fetch my hangouts' })
  }
})

router.get('/api/hangouts/responses/my', auth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT hr.id, hr.hangout_id, hr.status AS response_status, hr.message, hr.created_at,
              h.category, h.title, h.description, h.place_name, h.city, h.lat, h.lng,
              h.event_date, h.max_companions, h.status AS hangout_status,
              up.display_name, up.avatar_url
       FROM hangout_responses hr
       JOIN hangouts h ON h.id = hr.hangout_id
       JOIN user_profiles up ON up.id = h.user_id
       WHERE hr.user_id = ? AND hr.status != 'cancelled'
       ORDER BY hr.created_at DESC`,
      [req.userId],
    )
    res.json(rows)
  } catch (err) {
    logger.error('My hangout responses error:', err)
    res.status(500).json({ message: 'Failed to fetch my responses' })
  }
})

// ─── Detail ────────────────────────────────────────────────────
router.get('/api/hangouts/:id', optionalAuth, async (req, res) => {
  const { id } = req.params
  if (!/^\d+$/.test(id)) return res.status(400).json({ message: 'Invalid id' })

  try {
    const sql = `${HANGOUT_LIST_SELECT},
         (SELECT COUNT(*) FROM hangout_responses hr2 WHERE hr2.hangout_id = h.id AND hr2.status = 'pending') AS pending_count,
         (SELECT hr3.status FROM hangout_responses hr3 WHERE hr3.hangout_id = h.id AND hr3.user_id = ? LIMIT 1) AS my_response_status,
         (SELECT COUNT(*) FROM hangout_likes hl WHERE hl.hangout_id = h.id AND hl.status = 'like') AS like_count,
         (SELECT hl2.status FROM hangout_likes hl2 WHERE hl2.hangout_id = h.id AND hl2.user_id = ? LIMIT 1) AS my_like_status,
         (SELECT hp2.status FROM hangout_participants hp2 WHERE hp2.hangout_id = h.id AND hp2.user_id = ? LIMIT 1) AS my_participant_status,
         (SELECT ht2.status FROM hangout_tickets ht2 WHERE ht2.hangout_id = h.id AND ht2.user_id = ? LIMIT 1) AS my_ticket_status
     FROM hangouts h
     JOIN user_profiles up ON up.id = h.user_id
     ${JOIN_PARTNER_OFFER}
     WHERE h.id = ?`
    const [rows] = await pool.query(sql, [req.userId || 0, req.userId || 0, req.userId || 0, req.userId || 0, id])
    if (rows.length === 0) return res.status(404).json({ message: 'Hangout not found' })

    const hangout = rows[0]
    const isAuthor = req.userId === hangout.author_id

    let responses = []
    let participants = []
    if (isAuthor) {
      ;[responses] = await pool.query(
        `SELECT hr.id, hr.user_id, hr.status, hr.message, hr.created_at,
                up.display_name, up.avatar_url, up.age, up.city
         FROM hangout_responses hr
         JOIN user_profiles up ON up.id = hr.user_id
         WHERE hr.hangout_id = ? AND hr.status != 'cancelled'
         ORDER BY hr.created_at ASC`,
        [id],
      )
    }

    if (hangout.hangout_type === 'company') {
      ;[participants] = await pool.query(
        `SELECT hp.id, hp.user_id, hp.role, hp.status, hp.joined_at,
                up.display_name, up.avatar_url, up.age
         FROM hangout_participants hp
         JOIN user_profiles up ON up.id = hp.user_id
         WHERE hp.hangout_id = ? AND hp.status = 'joined'
         ORDER BY hp.role = 'organizer' DESC, hp.joined_at ASC`,
        [id],
      )
    }

    const [[chat]] = isAuthor
      ? await pool.query(
          `SELECT hc.chat_id FROM hangout_chats hc WHERE hc.hangout_id = ? LIMIT 1`,
          [id],
        )
      : [[]]

    res.json({
      ...parseAttendees(hangout),
      is_author: isAuthor,
      responses: isAuthor ? responses : undefined,
      participants,
      chat_id: chat ? chat.chat_id : null,
    })
  } catch (err) {
    logger.error('Hangout detail error:', err)
    res.status(500).json({ message: 'Failed to fetch hangout' })
  }
})

// ─── Create ────────────────────────────────────────────────────
router.post('/api/hangouts', auth, createLimiter, async (req, res) => {
  const { category, title, description, place_name, place_address, city, lat, lng, event_date, max_companions, partner_offer_id, hangout_type, price, capacity } = req.body
  if (!category || !title || !event_date) {
    return res.status(400).json({ message: 'category, title and event_date are required' })
  }
  if (!HANGOUT_CATEGORIES.includes(category)) {
    return res.status(400).json({ message: 'Invalid category' })
  }

  const validType = ['date', 'company'].includes(hangout_type) ? hangout_type : 'date'

  const eventDate = new Date(event_date)
  if (isNaN(eventDate.getTime()) || eventDate.getTime() <= Date.now()) {
    return res.status(400).json({ message: 'event_date must be in the future' })
  }

  const companions = Number(max_companions)
  if (!Number.isInteger(companions) || companions < 1) {
    return res.status(400).json({ message: 'max_companions must be a positive integer' })
  }

  let parsedPrice = null
  if (price !== undefined && price !== null && price !== '') {
    parsedPrice = Number(price)
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      return res.status(400).json({ message: 'price must be a non-negative number' })
    }
    if (parsedPrice > 0 && parsedPrice < 1) {
      return res.status(400).json({ message: 'price must be at least 1 ₽ for paid hangouts' })
    }
  }

  let parsedCapacity = null
  if (capacity !== undefined && capacity !== null && capacity !== '') {
    parsedCapacity = Number(capacity)
    if (!Number.isInteger(parsedCapacity) || parsedCapacity < 1 || parsedCapacity > 1000) {
      return res.status(400).json({ message: 'capacity must be between 1 and 1000' })
    }
  }

  const cleanTitle = stripHtml(String(title)).slice(0, 255)
  if (!cleanTitle) return res.status(400).json({ message: 'title is required' })

  const parsedLat = lat !== undefined && lat !== null && lat !== '' ? parseFloat(lat) : null
  const parsedLng = lng !== undefined && lng !== null && lng !== '' ? parseFloat(lng) : null
  if ((parsedLat !== null && isNaN(parsedLat)) || (parsedLng !== null && isNaN(parsedLng))) {
    return res.status(400).json({ message: 'Invalid coordinates' })
  }

  try {
    // Лимит: free — 1 объявление в сутки, premium — без лимита
    const [subRows] = await pool.query(
      'SELECT id FROM subscriptions WHERE user_id = ? AND is_active = 1 AND expires_at > NOW() LIMIT 1',
      [req.userId],
    )
    if (subRows.length === 0) {
      const [[{ cnt }]] = await pool.query(
        'SELECT COUNT(*) AS cnt FROM hangouts WHERE user_id = ? AND created_at >= CURDATE()',
        [req.userId],
      )
      if (cnt >= 1) {
        return res.status(403).json({
          message: 'Free users can create up to 1 hangout per day',
          code: 'HANGOUT_DAILY_LIMIT',
        })
      }
    }

    const companionsCap = subRows.length > 0 ? COMPANIONS_CAP_PREMIUM : COMPANIONS_CAP_FREE
    if (companions > companionsCap) {
      return res.status(400).json({
        message: `max_companions can be up to ${companionsCap} for your plan`,
        code: companionsCap === COMPANIONS_CAP_PREMIUM ? undefined : 'COMPANIONS_LIMIT',
      })
    }

    const [result] = await pool.query(
      `INSERT INTO hangouts (user_id, category, title, description, place_name, place_address, city, lat, lng, event_date, max_companions, partner_offer_id, hangout_type, price, capacity)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.userId,
        category,
        cleanTitle,
        description ? stripHtml(String(description)).slice(0, 2000) || null : null,
        place_name ? stripHtml(String(place_name)).slice(0, 255) || null : null,
        place_address ? stripHtml(String(place_address)).slice(0, 255) || null : null,
        city ? stripHtml(String(city)).slice(0, 100) || null : null,
        parsedLat,
        parsedLng,
        eventDate,
        companions,
        partner_offer_id && /^\d+$/.test(String(partner_offer_id)) ? Number(partner_offer_id) : null,
        validType,
        parsedPrice,
        parsedCapacity,
      ],
    )

    trackEvent('hangout_created', req.userId, { category, hangout_id: result.insertId })
    res.status(201).json({ id: result.insertId, message: 'Hangout created' })
  } catch (err) {
    logger.error('Hangout create error:', err)
    res.status(500).json({ message: 'Failed to create hangout' })
  }
})

// ─── Update (author only, active only) ─────────────────────────
router.put('/api/hangouts/:id', auth, async (req, res) => {
  const { id } = req.params
  if (!/^\d+$/.test(id)) return res.status(400).json({ message: 'Invalid id' })

  try {
    const [[hangout]] = await pool.query('SELECT user_id, status FROM hangouts WHERE id = ?', [id])
    if (!hangout) return res.status(404).json({ message: 'Hangout not found' })
    if (hangout.user_id !== req.userId) return res.status(403).json({ message: 'Not the author' })
    if (hangout.status !== 'active') return res.status(409).json({ message: `Cannot edit hangout in status ${hangout.status}` })

    const allowed = ['title', 'description', 'place_name', 'place_address', 'city', 'lat', 'lng', 'event_date', 'max_companions', 'price', 'capacity']
    const sets = []
    const params = []
    let newCapacityValue
    let newCompanionsValue
    for (const field of allowed) {
      if (!(field in req.body)) continue
      let value = req.body[field]
      if (field === 'title') {
        value = stripHtml(String(value)).slice(0, 255)
        if (!value) return res.status(400).json({ message: 'title cannot be empty' })
      } else if (field === 'description') {
        value = value ? stripHtml(String(value)).slice(0, 2000) || null : null
      } else if (field === 'event_date') {
        const d = new Date(value)
        if (isNaN(d.getTime())) return res.status(400).json({ message: 'Invalid event_date' })
        value = d
      } else if (field === 'max_companions') {
        const c = Number(value)
        if (!Number.isInteger(c) || c < 1) {
          return res.status(400).json({ message: 'max_companions must be a positive integer' })
        }
        newCompanionsValue = c
        value = c
      } else if (field === 'price') {
        if (value === null || value === '') {
          value = null
        } else {
          const p = Number(value)
          if (!Number.isFinite(p) || p < 0) {
            return res.status(400).json({ message: 'price must be a non-negative number' })
          }
          if (p > 0 && p < 1) return res.status(400).json({ message: 'price must be at least 1 ₽ for paid hangouts' })
          value = p
        }
      } else if (field === 'capacity') {
        if (value === null || value === '') {
          value = null
        } else {
          const cap = Number(value)
          if (!Number.isInteger(cap) || cap < 1 || cap > 1000) {
            return res.status(400).json({ message: 'capacity must be between 1 and 1000' })
          }
          newCapacityValue = cap
          value = cap
        }
      } else if (field === 'lat' || field === 'lng') {
        value = value === null || value === '' ? null : parseFloat(value)
        if (value !== null && isNaN(value)) return res.status(400).json({ message: `Invalid ${field}` })
      } else if (typeof value === 'string') {
        value = stripHtml(value).slice(0, 255) || null
      }
      sets.push(`${field} = ?`)
      params.push(value)
    }
    if (sets.length === 0) return res.status(400).json({ message: 'Nothing to update' })

    if (newCapacityValue !== undefined) {
      const [[sold]] = await pool.query(
        'SELECT COUNT(*) AS cnt FROM hangout_tickets WHERE hangout_id = ? AND status = ?',
        [id, 'paid'],
      )
      if (Number(sold?.cnt || 0) > newCapacityValue) {
        return res.status(409).json({ message: `CAPACITY_BELOW_SOLD: ${sold?.cnt || 0}` })
      }
    }

    if (newCompanionsValue !== undefined) {
      const companionsCap = await getCompanionsCap(req.userId)
      if (newCompanionsValue > companionsCap) {
        return res.status(400).json({
          message: `max_companions can be up to ${companionsCap} for your plan`,
          code: companionsCap === COMPANIONS_CAP_PREMIUM ? undefined : 'COMPANIONS_LIMIT',
        })
      }
    }

    await pool.query(`UPDATE hangouts SET ${sets.join(', ')} WHERE id = ?`, [...params, id])
    res.json({ message: 'Hangout updated' })
  } catch (err) {
    logger.error('Hangout update error:', err)
    res.status(500).json({ message: 'Failed to update hangout' })
  }
})

// ─── Soft delete (cancel) ──────────────────────────────────────
router.delete('/api/hangouts/:id', auth, async (req, res) => {
  const { id } = req.params
  if (!/^\d+$/.test(id)) return res.status(400).json({ message: 'Invalid id' })

  try {
    const [[hangout]] = await pool.query('SELECT user_id, status FROM hangouts WHERE id = ?', [id])
    if (!hangout) return res.status(404).json({ message: 'Hangout not found' })
    if (hangout.user_id !== req.userId) return res.status(403).json({ message: 'Not the author' })

    await pool.query("UPDATE hangouts SET status = 'cancelled' WHERE id = ?", [id])

    const [respondents] = await pool.query(
      "SELECT user_id FROM hangout_responses WHERE hangout_id = ? AND status IN ('pending','accepted')",
      [id],
    )
    const io = getIO()
    for (const r of respondents) {
      try {
        const [nr] = await pool.query(
          'INSERT INTO notifications (user_id, type, payload) VALUES (?, ?, ?)',
          [r.user_id, 'hangout_cancelled', JSON.stringify({ hangout_id: Number(id) })],
        )
        if (io) {
          const [[row]] = await pool.query('SELECT id, type, payload, is_read, created_at FROM notifications WHERE id = ?', [nr.insertId])
          io.to(`user:${r.user_id}`).emit('notification:new', row)
        }
      } catch {}
      sendPushToUser(r.user_id, 'SwiftMatch', 'The hangout was cancelled by its author').catch(() => {})
      try {
        if (io) io.to(`user:${r.user_id}`).emit('hangout:cancelled', { hangoutId: Number(id) })
      } catch {}
    }

    res.json({ message: 'Hangout cancelled' })
  } catch (err) {
    logger.error('Hangout cancel error:', err)
    res.status(500).json({ message: 'Failed to cancel hangout' })
  }
})

// ─── Respond («Пойдем») ────────────────────────────────────────
router.post('/api/hangouts/:id/respond', auth, respondLimiter, async (req, res) => {
  const { id } = req.params
  if (!/^\d+$/.test(id)) return res.status(400).json({ message: 'Invalid id' })
  const message = req.body?.message ? stripHtml(String(req.body.message)).slice(0, 500) || null : null

  try {
    const [[hangout]] = await pool.query(
      'SELECT id, user_id, status, title, price, capacity, max_companions, hangout_type FROM hangouts WHERE id = ?',
      [id],
    )
    if (!hangout) return res.status(404).json({ message: 'Hangout not found' })
    if (hangout.user_id === req.userId) return res.status(400).json({ message: 'Cannot respond to your own hangout' })
    if (hangout.status !== 'active') return res.status(409).json({ message: `Hangout is ${hangout.status}` })

    const paidGate = await resolvePaidGate(hangout, req.userId)
    if (paidGate) return res.status(paidGate.statusCode).json({ message: paidGate.message, ...(paidGate.price !== undefined ? { price: paidGate.price } : {}) })

    const bannedWords = await getBannedWords()
    if (message && containsBannedWord(message, bannedWords)) {
      return res.status(403).json({ message: 'Message contains prohibited content' })
    }

    const [result] = await pool.query(
      "INSERT INTO hangout_responses (hangout_id, user_id, message) VALUES (?, ?, ?)",
      [id, req.userId, message],
    )

    const [[respondent]] = await pool.query('SELECT display_name FROM user_profiles WHERE id = ?', [req.userId])

    const [notifResult] = await pool.query(
      'INSERT INTO notifications (user_id, type, payload) VALUES (?, ?, ?)',
      [hangout.user_id, 'hangout_response', JSON.stringify({ from_user_id: req.userId, hangout_id: Number(id), response_id: result.insertId })],
    )
    const io = getIO()
    if (io) {
      const [[notif]] = await pool.query('SELECT id, type, payload, created_at FROM notifications WHERE id = ?', [notifResult.insertId])
      io.to(`user:${hangout.user_id}`).emit('notification:new', notif)
      io.to(`user:${hangout.user_id}`).emit('hangout:new_response', {
        hangoutId: Number(id),
        responseId: result.insertId,
        fromUserId: req.userId,
        fromName: respondent?.display_name || null,
      })
    }

    sendPushToUser(hangout.user_id, 'SwiftMatch', `${respondent?.display_name || 'Someone'} wants to join: ${hangout.title}`).catch(() => {})
    trackEvent('hangout_response_sent', req.userId, { hangout_id: Number(id), response_id: result.insertId })

    res.status(201).json({ id: result.insertId, message: 'Response sent' })
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Already responded to this hangout' })
    }
    logger.error('Hangout respond error:', err)
    res.status(500).json({ message: 'Failed to respond' })
  }
})

// ─── Cancel own response ───────────────────────────────────────
router.delete('/api/hangouts/:id/respond', auth, async (req, res) => {
  const { id } = req.params
  if (!/^\d+$/.test(id)) return res.status(400).json({ message: 'Invalid id' })

  try {
    const [result] = await pool.query(
      "UPDATE hangout_responses SET status = 'cancelled' WHERE hangout_id = ? AND user_id = ? AND status IN ('pending','declined')",
      [id, req.userId],
    )
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Response not found' })
    res.json({ message: 'Response cancelled' })
  } catch (err) {
    logger.error('Hangout response cancel error:', err)
    res.status(500).json({ message: 'Failed to cancel response' })
  }
})

// ─── Responses list (author only) ──────────────────────────────
router.get('/api/hangouts/:id/responses', auth, async (req, res) => {
  const { id } = req.params
  if (!/^\d+$/.test(id)) return res.status(400).json({ message: 'Invalid id' })

  try {
    const [[hangout]] = await pool.query('SELECT user_id FROM hangouts WHERE id = ?', [id])
    if (!hangout) return res.status(404).json({ message: 'Hangout not found' })
    if (hangout.user_id !== req.userId) return res.status(403).json({ message: 'Not the author' })

    const [rows] = await pool.query(
      `SELECT hr.id, hr.user_id, hr.status, hr.message, hr.created_at,
              up.display_name, up.avatar_url, up.age, up.city
       FROM hangout_responses hr
       JOIN user_profiles up ON up.id = hr.user_id
       WHERE hr.hangout_id = ? AND hr.status != 'cancelled'
       ORDER BY hr.created_at ASC`,
      [id],
    )
    res.json(rows)
  } catch (err) {
    logger.error('Hangout responses error:', err)
    res.status(500).json({ message: 'Failed to fetch responses' })
  }
})

// ─── Accept / decline response (author only) ───────────────────
router.put('/api/hangouts/:id/responses/:responseId', auth, async (req, res) => {
  const { id, responseId } = req.params
  if (!/^\d+$/.test(id) || !/^\d+$/.test(responseId)) return res.status(400).json({ message: 'Invalid id' })
  const { status } = req.body
  if (!['accepted', 'declined'].includes(status)) {
    return res.status(400).json({ message: "status must be 'accepted' or 'declined'" })
  }

  const conn = await pool.getConnection()
  try {
    const [[hangout]] = await conn.execute('SELECT id, user_id, status, max_companions FROM hangouts WHERE id = ?', [id])
    if (!hangout) { conn.release(); return res.status(404).json({ message: 'Hangout not found' }) }
    if (hangout.user_id !== req.userId) { conn.release(); return res.status(403).json({ message: 'Not the author' }) }
    if (hangout.status !== 'active') { conn.release(); return res.status(409).json({ message: `Hangout is ${hangout.status}` }) }

    const [[response]] = await conn.execute('SELECT id, user_id, status FROM hangout_responses WHERE id = ? AND hangout_id = ?', [responseId, id])
    if (!response) { conn.release(); return res.status(404).json({ message: 'Response not found' }) }

    let chatId = null
    if (status === 'accepted') {
      if (response.status === 'accepted') {
        const [[existingChat]] = await conn.query('SELECT chat_id FROM hangout_chats WHERE hangout_id = ? AND response_id = ?', [id, responseId])
        conn.release()
        return res.json({ message: 'Already accepted', chat_id: existingChat ? existingChat.chat_id : null })
      }

      const [[{ cnt }]] = await conn.execute(
        "SELECT COUNT(*) AS cnt FROM hangout_responses WHERE hangout_id = ? AND status = 'accepted'",
        [id],
      )
      if (cnt >= hangout.max_companions) {
        conn.release()
        return res.status(409).json({ message: 'Max companions reached' })
      }

      // Чат между автором и откликнувшимся — как при match
      const [existingPair] = await conn.query(
        `SELECT c.id FROM chats c
         JOIN chat_participants cp1 ON cp1.chat_id = c.id AND cp1.user_id = ?
         JOIN chat_participants cp2 ON cp2.chat_id = c.id AND cp2.user_id = ?
         WHERE c.is_group = 0
         LIMIT 1`,
        [req.userId, response.user_id],
      )
      if (existingPair.length > 0) {
        chatId = existingPair[0].id
      } else {
        const [chatResult] = await conn.execute('INSERT INTO chats (is_group) VALUES (0)')
        chatId = chatResult.insertId
        await conn.execute('INSERT INTO chat_participants (chat_id, user_id) VALUES (?, ?), (?, ?)', [chatId, req.userId, chatId, response.user_id])
      }
      await conn.execute(
        'INSERT IGNORE INTO hangout_chats (hangout_id, response_id, chat_id) VALUES (?, ?, ?)',
        [id, responseId, chatId],
      )
    }

    await conn.execute('UPDATE hangout_responses SET status = ? WHERE id = ?', [status, responseId])

    if (status === 'accepted') {
      const [[{ cntAccepted }]] = await conn.execute(
        "SELECT COUNT(*) AS cntAccepted FROM hangout_responses WHERE hangout_id = ? AND status = 'accepted'",
        [id],
      )
      if (cntAccepted >= hangout.max_companions) {
        await conn.execute("UPDATE hangouts SET status = 'completed' WHERE id = ?", [id])
      }
    }

    conn.release()

    const io = getIO()
    try {
      if (io) {
        io.to(`user:${response.user_id}`).emit('hangout:response_accepted', {
          hangoutId: Number(id),
          responseId: Number(responseId),
          chatId: chatId ? Number(chatId) : null,
          status,
        })
      }
    } catch {}

    try {
      const notifType = status === 'accepted' ? 'hangout_accepted' : 'hangout_declined'
      const [notifResult] = await pool.query(
        'INSERT INTO notifications (user_id, type, payload) VALUES (?, ?, ?)',
        [response.user_id, notifType, JSON.stringify({ hangout_id: Number(id), chat_id: chatId, from_user_id: req.userId })],
      )
      if (io) {
        const [[row]] = await pool.query('SELECT id, type, payload, is_read, created_at FROM notifications WHERE id = ?', [notifResult.insertId])
        io.to(`user:${response.user_id}`).emit('notification:new', row)
      }
    } catch {}

    if (status === 'accepted') {
      const [[author]] = await pool.query('SELECT display_name FROM user_profiles WHERE id = ?', [req.userId])
      sendPushToUser(response.user_id, 'SwiftMatch', `${author?.display_name || 'The author'} accepted your response!`).catch(() => {})
      trackEvent('hangout_match', req.userId, { hangout_id: Number(id), response_id: Number(responseId), chat_id: chatId })
    }

    res.json({ message: `Response ${status}`, chat_id: chatId })
  } catch (err) {
    conn.release()
    logger.error('Hangout response decision error:', err)
    res.status(500).json({ message: 'Failed to update response' })
  }
})

// ─── Hangout context for a chat (deep-link banner) ─────────────
router.get('/api/hangouts/by-chat/:chatId', auth, async (req, res) => {
  const { chatId } = req.params
  if (!/^\d+$/.test(chatId)) return res.status(400).json({ message: 'Invalid id' })
  try {
    const [[member]] = await pool.query(
      'SELECT 1 AS ok FROM chat_participants WHERE chat_id = ? AND user_id = ? LIMIT 1',
      [chatId, req.userId],
    )
    if (!member) return res.status(403).json({ message: 'Not a chat participant' })

    const [[row]] = await pool.query(
      `SELECT h.id, h.title, h.category, h.status, h.event_date
       FROM hangout_chats hc
       JOIN hangouts h ON h.id = hc.hangout_id
       WHERE hc.chat_id = ?
       ORDER BY h.created_at DESC
       LIMIT 1`,
      [chatId],
    )
    res.json(row || null)
  } catch (err) {
    logger.error('Hangout by-chat error:', err)
    res.status(500).json({ message: 'Failed to fetch hangout context' })
  }
})

// ═══════════════════════════════════════════════════════════════
//  HANGOUTS 2.0 — Date Flow (like / skip / mutual) + Company Flow (join)
// ═══════════════════════════════════════════════════════════════

const likeLimiter = rateLimit({ windowMs: 60_000, max: 30, message: { message: 'Too many likes' } })
const joinLimiter = rateLimit({ windowMs: 60_000, max: 20, message: { message: 'Too many joins' } })
const checkinLimiter = rateLimit({ windowMs: 60_000, max: 5, message: { message: 'Too many check-ins' } })
const reviewLimiter = rateLimit({ windowMs: 300_000, max: 10, message: { message: 'Too many reviews' } })

const CHECKIN_RADIUS_M = 500
const CHECKIN_WINDOW_HOURS = 2

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ─── Like (date flow) ──────────────────────────────────────────
router.post('/api/hangouts/:id/like', auth, likeLimiter, async (req, res) => {
  const { id } = req.params
  if (!/^\d+$/.test(id)) return res.status(400).json({ message: 'Invalid id' })

  try {
    const [[hangout]] = await pool.query('SELECT id, user_id, hangout_type, status, title, price, capacity, max_companions FROM hangouts WHERE id = ?', [id])
    if (!hangout) return res.status(404).json({ message: 'Hangout not found' })
    if (hangout.user_id === req.userId) return res.status(400).json({ message: 'Cannot like your own hangout' })
    if (hangout.status !== 'active') return res.status(409).json({ message: 'Hangout is not active' })
    if (hangout.hangout_type !== 'date') return res.status(400).json({ message: 'Like is only for date-type hangouts' })

    const paidGate = await resolvePaidGate(hangout, req.userId)
    if (paidGate) return res.status(paidGate.statusCode).json({ message: paidGate.message })

    await pool.query(
      'INSERT INTO hangout_likes (hangout_id, user_id, status) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE status = VALUES(status)',
      [id, req.userId, 'like'],
    )

    const [[mutual]] = await pool.query(
      'SELECT 1 FROM hangout_likes WHERE hangout_id = ? AND user_id = ? AND status = ? LIMIT 1',
      [id, hangout.user_id, 'like'],
    )

    let chatId = null
    if (mutual) {
      const [existingPair] = await pool.query(
        `SELECT c.id FROM chats c
         JOIN chat_participants cp1 ON cp1.chat_id = c.id AND cp1.user_id = ?
         JOIN chat_participants cp2 ON cp2.chat_id = c.id AND cp2.user_id = ?
         WHERE c.is_group = 0 LIMIT 1`,
        [req.userId, hangout.user_id],
      )
      if (existingPair.length > 0) {
        chatId = existingPair[0].id
      } else {
        const [chatResult] = await pool.query('INSERT INTO chats (is_group) VALUES (0)')
        chatId = chatResult.insertId
        await pool.query(
          'INSERT INTO chat_participants (chat_id, user_id) VALUES (?, ?), (?, ?)',
          [chatId, req.userId, chatId, hangout.user_id],
        )
      }
    }

    const io = getIO()
    if (mutual && io) {
      io.to(`user:${hangout.user_id}`).emit('hangout:mutual_like', {
        hangoutId: Number(id),
        chatId: chatId ? Number(chatId) : null,
        fromUserId: req.userId,
      })
      try {
        const [notifResult] = await pool.query(
          'INSERT INTO notifications (user_id, type, payload) VALUES (?, ?, ?)',
          [hangout.user_id, 'hangout_mutual_like', JSON.stringify({ hangout_id: Number(id), chat_id: chatId, from_user_id: req.userId })],
        )
        const [[notif]] = await pool.query('SELECT id, type, payload, is_read, created_at FROM notifications WHERE id = ?', [notifResult.insertId])
        io.to(`user:${hangout.user_id}`).emit('notification:new', notif)
      } catch {}
      const [[author]] = await pool.query('SELECT display_name FROM user_profiles WHERE id = ?', [hangout.user_id])
      sendPushToUser(hangout.user_id, 'SwiftMatch', `${author?.display_name || 'Someone'} liked your hangout: ${hangout.title}`).catch(() => {})
      trackEvent('hangout_mutual_like', req.userId, { hangout_id: Number(id), chat_id: chatId })
    }

    res.json({ liked: true, mutual: !!mutual, chat_id: chatId })
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY') {
      return res.json({ liked: true, mutual: false })
    }
    logger.error('Hangout like error:', err)
    res.status(500).json({ message: 'Failed to like hangout' })
  }
})

// ─── Skip (date flow) ──────────────────────────────────────────
router.post('/api/hangouts/:id/skip', auth, likeLimiter, async (req, res) => {
  const { id } = req.params
  if (!/^\d+$/.test(id)) return res.status(400).json({ message: 'Invalid id' })

  try {
    const [[hangout]] = await pool.query('SELECT id, hangout_type, status FROM hangouts WHERE id = ?', [id])
    if (!hangout) return res.status(404).json({ message: 'Hangout not found' })
    if (hangout.hangout_type !== 'date') return res.status(400).json({ message: 'Skip is only for date-type hangouts' })

    await pool.query(
      'INSERT INTO hangout_likes (hangout_id, user_id, status) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE status = VALUES(status)',
      [id, req.userId, 'skip'],
    )
    res.json({ skipped: true })
  } catch (err) {
    logger.error('Hangout skip error:', err)
    res.status(500).json({ message: 'Failed to skip hangout' })
  }
})

// ─── Join (company flow) ───────────────────────────────────────
router.post('/api/hangouts/:id/join', auth, joinLimiter, async (req, res) => {
  const { id } = req.params
  if (!/^\d+$/.test(id)) return res.status(400).json({ message: 'Invalid id' })

  try {
    const [[hangout]] = await pool.query(
      'SELECT id, user_id, hangout_type, status, max_companions, title, price, capacity FROM hangouts WHERE id = ?', [id])
    if (!hangout) return res.status(404).json({ message: 'Hangout not found' })
    if (hangout.hangout_type !== 'company') return res.status(400).json({ message: 'Join is only for company-type hangouts' })
    if (hangout.status !== 'active') return res.status(409).json({ message: 'Hangout is not active' })
    if (hangout.user_id === req.userId) return res.status(400).json({ message: 'You are the organizer' })

    const paidGate = await resolvePaidGate(hangout, req.userId)
    if (paidGate) return res.status(paidGate.statusCode).json({ message: paidGate.message })

    const [[existing]] = await pool.query(
      'SELECT id, status FROM hangout_participants WHERE hangout_id = ? AND user_id = ? LIMIT 1',
      [id, req.userId],
    )
    if (existing && existing.status === 'joined') {
      return res.status(409).json({ message: 'Already joined' })
    }
    if (existing && existing.status === 'removed') {
      return res.status(403).json({ message: 'You were removed from this hangout' })
    }

    const [[{ cnt }]] = await pool.query(
      "SELECT COUNT(*) AS cnt FROM hangout_participants WHERE hangout_id = ? AND status = 'joined'",
      [id],
    )
    if (cnt >= hangout.max_companions) {
      return res.status(409).json({ message: 'Hangout is full' })
    }

    if (existing) {
      await pool.query("UPDATE hangout_participants SET status = 'joined', role = 'member' WHERE id = ?", [existing.id])
    } else {
      await pool.query(
        'INSERT INTO hangout_participants (hangout_id, user_id, role, status) VALUES (?, ?, ?, ?)',
        [id, req.userId, 'member', 'joined'],
      )
    }

    const [[{ cntAfter }]] = await pool.query(
      "SELECT COUNT(*) AS cntAfter FROM hangout_participants WHERE hangout_id = ? AND status = 'joined'",
      [id],
    )
    let chatId = null
    if (cntAfter >= 2) {
      const [[existingChat]] = await pool.query(
        `SELECT hc.chat_id FROM hangout_chats hc
         JOIN chats c ON c.id = hc.chat_id
         WHERE hc.hangout_id = ? AND c.is_group = 1 LIMIT 1`,
        [id],
      )
      if (existingChat) {
        chatId = existingChat.chat_id
        const [[alreadyParticipant]] = await pool.query(
          'SELECT 1 FROM chat_participants WHERE chat_id = ? AND user_id = ? LIMIT 1',
          [chatId, req.userId],
        )
        if (!alreadyParticipant) {
          await pool.query('INSERT INTO chat_participants (chat_id, user_id) VALUES (?, ?)', [chatId, req.userId])
        }
      } else {
        const [chatResult] = await pool.query('INSERT INTO chats (is_group) VALUES (1)')
        chatId = chatResult.insertId
        const [members] = await pool.query(
          "SELECT user_id FROM hangout_participants WHERE hangout_id = ? AND status = 'joined'",
          [id],
        )
        await pool.query('INSERT INTO chat_participants (chat_id, user_id) VALUES (?, ?)', [chatId, hangout.user_id])
        for (const m of members) {
          await pool.query(
            'INSERT IGNORE INTO chat_participants (chat_id, user_id) VALUES (?, ?)',
            [chatId, m.user_id],
          )
        }
        await pool.query(
          'INSERT IGNORE INTO hangout_chats (hangout_id, chat_id) VALUES (?, ?)',
          [id, chatId],
        )
      }
    }

    const io = getIO()
    if (io) {
      io.to(`user:${hangout.user_id}`).emit('hangout:new_participant', {
        hangoutId: Number(id),
        userId: req.userId,
        participantCount: cntAfter,
      })
    }

    const [[joiner]] = await pool.query('SELECT display_name FROM user_profiles WHERE id = ?', [req.userId])
    sendPushToUser(hangout.user_id, 'SwiftMatch', `${joiner?.display_name || 'Someone'} joined your hangout: ${hangout.title}`).catch(() => {})
    trackEvent('hangout_joined', req.userId, { hangout_id: Number(id) })

    res.status(201).json({ joined: true, chat_id: chatId, participant_count: cntAfter })
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Already joined' })
    }
    logger.error('Hangout join error:', err)
    res.status(500).json({ message: 'Failed to join hangout' })
  }
})

// ─── Leave (company flow) ──────────────────────────────────────
router.delete('/api/hangouts/:id/join', auth, async (req, res) => {
  const { id } = req.params
  if (!/^\d+$/.test(id)) return res.status(400).json({ message: 'Invalid id' })

  try {
    const [result] = await pool.query(
      "UPDATE hangout_participants SET status = 'left' WHERE hangout_id = ? AND user_id = ? AND status = 'joined' AND role = 'member'",
      [id, req.userId],
    )
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Not a participant' })

    const io = getIO()
    const [[hangout]] = await pool.query('SELECT user_id FROM hangouts WHERE id = ?', [id])
    if (hangout && io) {
      io.to(`user:${hangout.user_id}`).emit('hangout:participant_left', { hangoutId: Number(id), userId: req.userId })
    }

    res.json({ left: true })
  } catch (err) {
    logger.error('Hangout leave error:', err)
    res.status(500).json({ message: 'Failed to leave hangout' })
  }
})

// ─── Check-in ──────────────────────────────────────────────────
router.post('/api/hangouts/:id/checkin', auth, checkinLimiter, async (req, res) => {
  const { id } = req.params
  if (!/^\d+$/.test(id)) return res.status(400).json({ message: 'Invalid id' })
  const { lat, lng } = req.body
  const parsedLat = parseFloat(lat)
  const parsedLng = parseFloat(lng)
  if (isNaN(parsedLat) || isNaN(parsedLng)) {
    return res.status(400).json({ message: 'lat and lng are required' })
  }

  try {
    const [[hangout]] = await pool.query('SELECT id, user_id, hangout_type, status, lat, lng FROM hangouts WHERE id = ?', [id])
    if (!hangout) return res.status(404).json({ message: 'Hangout not found' })
    if (hangout.status !== 'active') return res.status(409).json({ message: 'Hangout is not active' })

    if (hangout.lat && hangout.lng) {
      const dist = haversineDistance(parsedLat, parsedLng, parseFloat(hangout.lat), parseFloat(hangout.lng))
      if (dist > CHECKIN_RADIUS_M) {
        return res.status(400).json({ message: 'Too far from hangout location', distance_m: Math.round(dist) })
      }
    }

    const isParticipant = hangout.user_id === req.userId || hangout.hangout_type === 'company'
      ? (await pool.query(
          "SELECT 1 FROM hangout_participants WHERE hangout_id = ? AND user_id = ? AND status = 'joined' LIMIT 1",
          [id, req.userId],
        ))[0].length > 0
      : (await pool.query(
          "SELECT 1 FROM hangout_responses WHERE hangout_id = ? AND user_id = ? AND status = 'accepted' LIMIT 1",
          [id, req.userId],
        ))[0].length > 0

    if (!isParticipant) {
      return res.status(403).json({ message: 'Not a participant of this hangout' })
    }

    await pool.query(
      'INSERT INTO hangout_checkins (hangout_id, user_id, lat, lng) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE lat = VALUES(lat), lng = VALUES(lng), checked_at = NOW()',
      [id, req.userId, parsedLat, parsedLng],
    )

    const io = getIO()
    if (io) {
      io.to(`user:${hangout.user_id}`).emit('hangout:checkin', {
        hangoutId: Number(id),
        userId: req.userId,
        lat: parsedLat,
        lng: parsedLng,
      })
    }

    res.json({ checked_in: true })
  } catch (err) {
    logger.error('Hangout checkin error:', err)
    res.status(500).json({ message: 'Failed to check in' })
  }
})

// ─── Review ────────────────────────────────────────────────────
router.post('/api/hangouts/:id/review', auth, reviewLimiter, async (req, res) => {
  const { id } = req.params
  if (!/^\d+$/.test(id)) return res.status(400).json({ message: 'Invalid id' })
  const { reviewee_id, rating, tag } = req.body
  const parsedRating = Number(rating)
  if (!reviewee_id || !Number.isFinite(parsedRating) || parsedRating < 1 || parsedRating > 5) {
    return res.status(400).json({ message: 'reviewee_id and rating (1-5) are required' })
  }
  const validTags = ['punctual', 'fun', 'reliable', 'no_show']
  const safeTag = validTags.includes(tag) ? tag : null

  try {
    const [[hangout]] = await pool.query('SELECT id, user_id, status FROM hangouts WHERE id = ?', [id])
    if (!hangout) return res.status(404).json({ message: 'Hangout not found' })
    if (hangout.status !== 'active' && hangout.status !== 'completed') {
      return res.status(409).json({ message: 'Hangout must be active or completed to review' })
    }
    if (hangout.user_id === req.userId) {
      return res.status(400).json({ message: 'Cannot review yourself' })
    }

    const [[existing]] = await pool.query(
      'SELECT id FROM hangout_reviews WHERE hangout_id = ? AND reviewer_id = ? AND reviewee_id = ? LIMIT 1',
      [id, req.userId, reviewee_id],
    )
    if (existing) return res.status(409).json({ message: 'Already reviewed' })

    await pool.query(
      'INSERT INTO hangout_reviews (hangout_id, reviewer_id, reviewee_id, rating, tag) VALUES (?, ?, ?, ?, ?)',
      [id, req.userId, reviewee_id, parsedRating, safeTag],
    )

    res.status(201).json({ review: true })
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Already reviewed' })
    }
    logger.error('Hangout review error:', err)
    res.status(500).json({ message: 'Failed to submit review' })
  }
})

const hangoutTicketLimiter = rateLimit({ windowMs: 60_000, max: 10, message: { message: 'Too many ticket requests' } })

router.post('/api/hangouts/:id/purchase', auth, hangoutTicketLimiter, async (req, res) => {
  const { id } = req.params
  if (!/^\d+$/.test(id)) return res.status(400).json({ message: 'Invalid id' })

  try {
    const [[hangout]] = await pool.query(
      'SELECT id, user_id, title, status, price, capacity, max_companions, hangout_type FROM hangouts WHERE id = ?',
      [id],
    )
    if (!hangout) return res.status(404).json({ message: 'Hangout not found' })
    if (hangout.status !== 'active') return res.status(409).json({ message: 'Hangout is not active' })
    if (hangout.user_id === req.userId) return res.status(400).json({ message: 'Cannot purchase your own hangout' })

    const price = Number(hangout.price)
    if (!price || price <= 0) return res.status(400).json({ message: 'This hangout is free' })

    const capacityLimit = hangout.capacity !== null ? Number(hangout.capacity) : Number(hangout.max_companions)
    if (capacityLimit > 0) {
      const [[sold]] = await pool.query(
        'SELECT COUNT(*) AS cnt FROM hangout_tickets WHERE hangout_id = ? AND status = ?',
        [id, 'paid'],
      )
      if (Number(sold?.cnt || 0) >= capacityLimit) {
        return res.status(409).json({ message: 'CAPACITY_FULL' })
      }
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY
    if (!stripeKey) {
      await pool.query(
        `INSERT INTO hangout_tickets (hangout_id, user_id, amount, status, paid_at)
         VALUES (?, ?, ?, 'paid', NOW())
         ON DUPLICATE KEY UPDATE amount = VALUES(amount), status = 'paid', paid_at = NOW()`,
        [id, req.userId, price],
      )
      return res.status(201).json({ mock: true, paid: true, amount: price, url: null, session_id: null })
    }

    const { default: Stripe } = await import('stripe')
    const stripe = new Stripe(stripeKey)
    const origin = req.headers.origin || process.env.CLIENT_URL || 'http://localhost:8081'
    const successUrl = `${origin}/hangouts/${id}?ticket=success`
    const cancelUrl = `${origin}/hangouts/${id}?ticket=cancelled`

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'rub',
            product_data: { name: hangout.title, description: 'SwiftMatch hangout ticket' },
            unit_amount: Math.round(price * 100),
          },
        },
      ],
      metadata: { hangout_id: id, user_id: String(req.userId) },
      success_url: successUrl,
      cancel_url: cancelUrl,
    })

    await pool.query(
      `INSERT INTO hangout_tickets (hangout_id, user_id, stripe_session_id, amount, status)
       VALUES (?, ?, ?, ?, 'pending')
       ON DUPLICATE KEY UPDATE stripe_session_id = VALUES(stripe_session_id), amount = VALUES(amount), status = 'pending'`,
      [id, req.userId, session.id, price],
    )

    res.json({ url: session.url, session_id: session.id, mock: false, paid: false })
  } catch (err) {
    logger.error('Hangout purchase error:', err)
    res.status(500).json({ message: 'Failed to create ticket checkout' })
  }
})

const boostLimiter = rateLimit({ windowMs: 60_000, max: 10, message: { message: 'Too many boost requests' } })

// ─── Boost / Unboost own hangout (premium perk, author only) ───
// Продвижение поднимает свою встречу в начало ленты (boosted=1, без срока).
// Перк для premium: free — 403 PREMIUM_REQUIRED; лимит 1 активное на автора.
router.post('/api/hangouts/:id/boost', auth, boostLimiter, async (req, res) => {
  const { id } = req.params
  if (!/^\d+$/.test(id)) return res.status(400).json({ message: 'Invalid id' })

  try {
    const [[hangout]] = await pool.query('SELECT user_id, status FROM hangouts WHERE id = ?', [id])
    if (!hangout) return res.status(404).json({ message: 'Hangout not found' })
    if (hangout.user_id !== req.userId) return res.status(403).json({ message: 'Not the author' })
    if (hangout.status !== 'active') return res.status(409).json({ message: `Cannot boost hangout in status ${hangout.status}` })

    const cap = await getCompanionsCap(req.userId)
    if (cap === COMPANIONS_CAP_FREE) {
      return res.status(403).json({ message: 'Premium subscription required to boost a hangout', code: 'PREMIUM_REQUIRED' })
    }

    const [[already]] = await pool.query(
      'SELECT COUNT(*) AS cnt FROM hangouts WHERE user_id = ? AND boosted = 1 AND id <> ?',
      [req.userId, id],
    )
    if (Number(already?.cnt || 0) >= 1) {
      return res.status(409).json({ message: 'You can have only 1 boosted hangout at a time', code: 'BOOST_LIMIT' })
    }

    await pool.query('UPDATE hangouts SET boosted = 1 WHERE id = ?', [id])
    trackEvent('hangout_boosted', req.userId, { hangout_id: Number(id) })
    res.json({ boosted: true, message: 'Hangout boosted' })
  } catch (err) {
    logger.error('Hangout boost error:', err)
    res.status(500).json({ message: 'Failed to boost hangout' })
  }
})

router.post('/api/hangouts/:id/unboost', auth, boostLimiter, async (req, res) => {
  const { id } = req.params
  if (!/^\d+$/.test(id)) return res.status(400).json({ message: 'Invalid id' })

  try {
    const [[hangout]] = await pool.query('SELECT user_id FROM hangouts WHERE id = ?', [id])
    if (!hangout) return res.status(404).json({ message: 'Hangout not found' })
    if (hangout.user_id !== req.userId) return res.status(403).json({ message: 'Not the author' })

    await pool.query('UPDATE hangouts SET boosted = 0 WHERE id = ?', [id])
    res.json({ boosted: false, message: 'Hangout unboosted' })
  } catch (err) {
    logger.error('Hangout unboost error:', err)
    res.status(500).json({ message: 'Failed to unboost hangout' })
  }
})

// ─── AI-подбор встреч под пару (premium perk) ───
// body: { user_id?, language?: 'ru'|'en' } — user_id = профиль второй половины.
// Перк для premium: free — 403 PREMIUM_REQUIRED. OpenAI + DB/static fallback.
const suggestLimiter = rateLimit({ windowMs: 60_000, max: 20, message: { message: 'Too many suggest requests' } })

const suggestBreaker = createBreaker(
  async ({ me, partner, lang }) => {
    const OpenAI = (await import('openai')).default
    const client = new OpenAI({ apiKey: OPENAI_API_KEY })
    const meCtx = me ? `User A: ${me.display_name}, ${me.age} y.o., ${me.city || 'unknown'}, bio: "${me.bio || ''}", goal: ${me.dating_goal || 'unknown'}.` : 'User A: unknown.'
    const partnerCtx = partner ? `User B: ${partner.display_name}, ${partner.age} y.o., ${partner.city || 'unknown'}, bio: "${partner.bio || ''}", goal: ${partner.dating_goal || 'unknown'}.` : 'User B: unknown.'
    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a dating app assistant. Suggest 3 creative date/hangout ideas for this couple (${lang === 'ru' ? 'in Russian' : 'in English'}, fitting both profiles, realistic venues/activities). Output ONLY a JSON array of objects, each with "title" (short), "category" (cinema|theater|exhibition|cafe|concert|sport|other), "place" (suggested venue) and "description" (1-2 sentences, no hashtags).`,
        },
        { role: 'user', content: `${meCtx}\n${partnerCtx}` },
      ],
      temperature: 0.9,
      max_tokens: 300,
    })
    const raw = response.choices[0]?.message?.content || '[]'
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim())
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.slice(0, 3).filter((s) => s && typeof s === 'object' && s.title)
    }
    return null
  },
  'openai-hangout-suggest',
  { timeout: 9000, volumeThreshold: 3 },
)

const STATIC_SUGGESTIONS = [
  { title: 'Кофе и настольные игры', category: 'cafe', place: 'Уютная кофейня', description: 'Лёгкий формат: поговорить, посмеяться и узнать друг друга без напряжения.' },
  { title: 'Вечер в кино на инди-фильм', category: 'cinema', place: 'Независимый кинотеатр', description: 'После сеанса обсудить фильм за чашкой какао — отличный повод для разговора.' },
  { title: 'Прогулка по выставке современного искусства', category: 'exhibition', place: 'Городская галерея', description: 'Спокойный темп, много тем для разговора, можно задержаться сколько захочется.' },
  { title: 'Концерт живой музыки', category: 'concert', place: 'Live-площадка', description: 'Общие впечатления и танцы — быстрый способ почувствовать друг друга.' },
  { title: 'Лёгкая спортивная активность вдвоём', category: 'sport', place: 'Сквот-корт или бадминтон', description: 'Активность снимает застенчивость и дарит заряд энергии.' },
  { title: 'Мастер-класс для двоих', category: 'other', place: 'Творческая студия', description: 'Совместный результат и командная работа — сближает быстрее обычного свидания.' },
]

router.post('/api/hangouts/suggest', auth, suggestLimiter, async (req, res) => {
  try {
    const { user_id: userId, language = 'ru' } = req.body || {}
    const lang = language === 'en' ? 'en' : 'ru'

    const cap = await getCompanionsCap(req.userId)
    if (cap === COMPANIONS_CAP_FREE) {
      return res.status(403).json({ message: 'Premium subscription required to get date suggestions', code: 'PREMIUM_REQUIRED' })
    }

    // Профили обоих для персонализации (optional)
    const [[me]] = await pool.query(
      `SELECT display_name, age, bio, city, dating_goal FROM user_profiles WHERE id = ? LIMIT 1`,
      [req.userId],
    )
    let partner = null
    if (userId && /^\d+$/.test(String(userId))) {
      [[partner]] = await pool.query(
        `SELECT display_name, age, bio, city, dating_goal FROM user_profiles WHERE id = ? LIMIT 1`,
        [userId],
      )
    }

    if (OPENAI_API_KEY) {
      try {
        const suggestions = await suggestBreaker.fire({ me, partner, lang })
        if (suggestions && suggestions.length > 0) {
          trackEvent('hangout_suggest', req.userId, { source: 'openai', count: suggestions.length })
          return res.json({ source: 'openai', suggestions })
        }
      } catch (err) {
        logger.warn('Hangout suggest: OpenAI breaker failed, falling back to DB:', err.message)
      }
    }

    // DB fallback: реальные активные встречи рядом как идеи
    const [rows] = await pool.query(
      `SELECT id, category, title, place_name, city FROM hangouts
       WHERE status = 'active' AND event_date > NOW()
       ORDER BY created_at DESC LIMIT 5`,
    )
    const suggestionPool = []
    const used = new Set()
    for (const s of STATIC_SUGGESTIONS) {
      if (!used.has(s.title)) { suggestionPool.push(s); used.add(s.title) }
    }
    for (const r of rows) {
      const title = `${r.title} (${r.place_name || r.city || 'рядом'})`
      if (!used.has(r.title)) {
        suggestionPool.push({ title, category: r.category || 'other', place: r.place_name || r.city || '', description: 'Встреча рядом из афиши.' })
        used.add(r.title)
      }
    }
    const shuffled = suggestionPool.sort(() => Math.random() - 0.5).slice(0, 3)
    trackEvent('hangout_suggest', req.userId, { source: rows.length ? 'db' : 'static', count: shuffled.length })
    res.json({ source: rows.length ? 'db' : 'static', suggestions: shuffled })
  } catch (err) {
    logger.error('Hangout suggest error:', err)
    res.status(500).json({ message: 'Failed to suggest hangouts' })
  }
})

router.post('/api/hangouts/order/webhook', async (req, res) => {
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
    logger.error('Hangout webhook signature error:', err)
    return res.status(400).json({ message: 'Invalid signature' })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object
    const { hangout_id: hangoutId, user_id: userId } = session.metadata || {}
    if (session.payment_status !== 'paid') return res.json({ received: true })
    try {
      const conn = await pool.getConnection()
      try {
        await conn.beginTransaction()
        const [evt] = await conn.query(
          'INSERT IGNORE INTO webhook_events (provider, event_id) VALUES (?, ?)',
          ['stripe_hangout_ticket', String(event.id || '')],
        )
        if (!evt || evt.affectedRows === 0) {
          await conn.rollback()
          return res.json({ received: true })
        }
        await conn.query(
          `UPDATE hangout_tickets SET status = 'paid', paid_at = NOW()
           WHERE hangout_id = ? AND user_id = ? AND stripe_session_id = ?`,
          [hangoutId, userId, session.id],
        )
        await conn.commit()
      } catch (err) {
        await conn.rollback()
        throw err
      } finally {
        conn.release()
      }
    } catch (err) {
      logger.error('Hangout ticket webhook processing error:', err)
    }
  }
  res.json({ received: true })
})

export default router
