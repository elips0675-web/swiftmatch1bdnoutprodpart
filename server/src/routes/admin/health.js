import { Router } from 'express'
import logger from '../../logger.js'
import { collectHealth } from '../../health-check.js'
import { wrapRouter } from '../../async-handler.js'

const router = Router()

/**
 * @openapi
 * /api/admin/health:
 *   get:
 *     tags: [Admin]
 *     summary: Subsystem health for the admin dashboard
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Health report with per-subsystem status }
 */
router.get('/health', async (req, res) => {
  try {
    res.json(await collectHealth())
  } catch (err) {
    logger.error('Health report error:', err)
    res.status(500).json({ message: 'Failed to collect health' })
  }
})

export default wrapRouter(router)
