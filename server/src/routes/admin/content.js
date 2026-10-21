import { Router } from 'express'
import pool from '../../db.js'
import logger from '../../logger.js'
import { wrapRouter } from '../../async-handler.js'

const router = Router()

async function getContentConfig() {
  const [[row]] = await pool.query('SELECT * FROM content_config WHERE id = 1')
  if (!row) return null
  function p(v, fb) { if (Array.isArray(v)) return v; if (typeof v === 'string') { try { return JSON.parse(v) } catch {} } return fb === undefined ? [] : fb }
  function pa(v) {
    if (Array.isArray(v)) return v
    if (typeof v === 'string') { try { const arr = JSON.parse(v); if (Array.isArray(arr)) return arr } catch {} }
    return null
  }
  return {
    interests: p(row.interests, []),
    dating_goals: p(row.dating_goals, []),
    education: p(row.education, []),
    banned_words: p(row.banned_words, []),
    cities: pa(row.cities),
  }
}

/**
 * @openapi
 * /api/admin/content:
 *   get:
 *     tags: [Admin]
 *     summary: Get content configuration
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Content configuration }
 */
router.get('/content', async (req, res) => {
  try {
    const config = await getContentConfig()
    if (!config) return res.json({ interests: [], dating_goals: [], education: [], banned_words: [], cities: [] })

    if (Array.isArray(config.cities)) {
      return res.json(config)
    }

    const [cities] = await pool.query(
      'SELECT DISTINCT city FROM user_profiles WHERE city IS NOT NULL AND city != "" ORDER BY city',
    )

    res.json({ ...config, cities: cities.map(c => c.city) })
  } catch (err) {
    logger.error('Content fetch error:', err)
    res.status(500).json({ message: 'Failed to fetch content' })
  }
})

/**
 * @openapi
 * /api/admin/content/{section}:
 *   put:
 *     tags: [Admin]
 *     summary: Update a content section
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Section updated }
 */
router.put('/content/:section', async (req, res) => {
  const { section } = req.params
  const allowed = ['interests', 'dating_goals', 'education', 'banned_words', 'cities']
  if (!allowed.includes(section)) {
    return res.status(400).json({ message: 'Invalid section' })
  }
  try {
    const config = await getContentConfig() || { interests: [], dating_goals: [], education: [], banned_words: [], cities: null }
    config[section] = req.body.items || []

    await pool.query(
      `INSERT INTO content_config (id, interests, dating_goals, education, banned_words, cities)
       VALUES (1, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE ${section} = ?`,
      [
        JSON.stringify(config.interests),
        JSON.stringify(config.dating_goals),
        JSON.stringify(config.education),
        JSON.stringify(config.banned_words),
        Array.isArray(config.cities) ? JSON.stringify(config.cities) : null,
        JSON.stringify(config[section]),
      ],
    )
    res.json({ message: `${section} updated`, items: config[section] })
  } catch (err) {
    logger.error('Content update error:', err)
    res.status(500).json({ message: 'Failed to update content' })
  }
})

export default wrapRouter(router)
