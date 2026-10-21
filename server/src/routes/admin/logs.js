import { Router } from 'express'
import { getRecentLogs } from '../../log-buffer.js'
import { wrapRouter } from '../../async-handler.js'

const router = Router()

/**
 * @openapi
 * /api/admin/logs/recent:
 *   get:
 *     tags: [Admin]
 *     summary: Recent warn/error log entries (in-memory ring buffer)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of recent log entries
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 logs:
 *                   type: array
 *                   items:
 *                     type: object
 */
router.get('/logs/recent', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200)
  const logs = getRecentLogs().slice(-limit)
  res.json({ logs })
})

export default wrapRouter(router)