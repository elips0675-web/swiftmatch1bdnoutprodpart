import { Router } from 'express'
import logger from '../../logger.js'
import { queueNames, queueStats, retryFailed, redisConfigured } from '../../queue-monitor.js'
import { wrapRouter } from '../../async-handler.js'

const router = Router()

/**
 * @openapi
 * /api/admin/queues:
 *   get:
 *     tags: [Admin]
 *     summary: Get queue stats
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Queue stats }
 */
router.get('/queues', async (req, res) => {
  try {
    const queues = await queueStats()
    res.json({
      queues,
      available: queues.filter((queue) => queue.enabled).map((queue) => queue.name),
      redisConfigured: redisConfigured(),
    })
  } catch (err) {
    logger.error('Queue stats error:', err)
    res.status(500).json({ message: 'Failed to fetch queue stats' })
  }
})

/**
 * @openapi
 * /api/admin/queues/{name}/retry:
 *   post:
 *     tags: [Admin]
 *     summary: Retry failed jobs in a queue
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Retry result }
 */
router.post('/queues/:name/retry', async (req, res) => {
  const { name } = req.params
  if (!queueNames().includes(name)) {
    return res.status(400).json({ message: 'Unknown queue' })
  }
  try {
    const result = await retryFailed(name)
    if (!result.available) {
      return res.status(503).json({ message: 'Queue disabled', ...result })
    }
    res.json(result)
  } catch (err) {
    logger.error('Queue retry error:', err)
    res.status(500).json({ message: 'Failed to retry queue jobs' })
  }
})

export default wrapRouter(router)
