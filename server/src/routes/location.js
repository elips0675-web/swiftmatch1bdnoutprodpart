import { Router } from 'express'
import pool from '../db.js'
import { auth } from '../middleware.js'
import logger from '../logger.js'

const router = Router()

/**
 * @openapi
 * /api/location:
 *   put:
 *     tags: [Location]
 *     summary: Update current user location
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Location updated }
 */
router.put('/api/location', auth, async (req, res) => {
  const { lat, lng } = req.body

  if (lat == null || lng == null) {
    return res.status(400).json({ message: 'lat and lng are required' })
  }

  const latNum = parseFloat(lat)
  const lngNum = parseFloat(lng)

  if (isNaN(latNum) || isNaN(lngNum) || latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
    return res.status(400).json({ message: 'Invalid coordinates' })
  }

  try {
    await pool.query(
      `UPDATE user_profiles SET lat = ?, lng = ?,
       location = ST_SRID(POINT(?, ?), 4326),
       last_location_update = NOW()
       WHERE id = ?`,
      [latNum, lngNum, lngNum, latNum, req.userId],
    )
    res.json({ message: 'Location updated' })
  } catch (err) {
    logger.error('Location update error:', err)
    res.status(500).json({ message: 'Failed to update location' })
  }
})

/**
 * @openapi
 * /api/location:
 *   get:
 *     tags: [Location]
 *     summary: Get current user location
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Stored location coordinates }
 */
router.get('/api/location', auth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT lat, lng, last_location_update FROM user_profiles WHERE id = ?',
      [req.userId],
    )
    if (!rows.length) {
      return res.status(404).json({ message: 'Profile not found' })
    }
    res.json(rows[0])
  } catch (err) {
    logger.error('Location get error:', err)
    res.status(500).json({ message: 'Failed to get location' })
  }
})

export default router
