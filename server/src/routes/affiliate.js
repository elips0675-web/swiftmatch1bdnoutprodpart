import { Router } from 'express'
import pool from '../db.js'
import logger from '../logger.js'

const router = Router()

const AFFILIATE_CATEGORIES = ['restaurant', 'hotel', 'flowers', 'taxi', 'gift']

/**
 * @openapi
 * /api/affiliate/offers:
 *   get:
 *     tags: [Affiliate]
 *     summary: Блок «Куда пойти» — аффилиат-подборка мест/сервисов для пары (dining/travel/gift)
 *     parameters:
 *       - in: query
 *         name: city
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Массив аффилиат-офферов
 */
router.get('/api/affiliate/offers', async (req, res) => {
  try {
    const { city, limit } = req.query
    const maxCount = Math.min(Math.max(Number(limit) || 6, 1), 12)

    const placeholders = AFFILIATE_CATEGORIES.map(() => '?').join(',')
    const base = `
      SELECT po.id, po.partner_id, po.category, po.title, po.description,
             po.image_url, po.deeplink, po.price, po.city,
             p.name AS partner_name, p.commission_rate
      FROM partner_offers po
      JOIN partners p ON p.id = po.partner_id
      WHERE po.status = 'active'
        AND po.category IN (${placeholders})
        AND po.deeplink IS NOT NULL AND po.deeplink <> ''
        AND (po.valid_to IS NULL OR po.valid_to >= CURDATE())
    `
    const params = [...AFFILIATE_CATEGORIES]
    const whereCity = city
      ? ` AND po.city = ?`
      : ''
    if (city) params.push(city)

    const [rows] = await pool.query(
      `${base}${whereCity}
       GROUP BY po.id
       ORDER BY (po.pinned = 1) DESC, po.created_at DESC
       LIMIT ?`,
      [...params, maxCount],
    )

    const offers = rows.map((o) => ({
      id: o.id,
      partner_id: o.partner_id,
      category: o.category,
      title: o.title,
      description: o.description,
      image_url: o.image_url,
      deeplink: o.deeplink,
      price: o.price === null ? null : Number(o.price),
      city: o.city,
      partner_name: o.partner_name,
      commission_rate: o.commission_rate === null ? null : Number(o.commission_rate),
    }))

    res.json({ offers })
  } catch (err) {
    logger.error('Affiliate offers error:', err)
    res.status(500).json({ message: 'Failed to load affiliate offers' })
  }
})

export default router
