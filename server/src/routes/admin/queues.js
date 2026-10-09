import { Router } from 'express'
import logger from '../../logger.js'
import { queueNames, queueStats, retryFailed } from '../../queue-monitor.js'

const router = Router()

router.get('/queues', async (req, res) => {
  try {
    const queues = await queueStats()
    res.json({ queues, available: queues.map((q) => q.name) })
  } catch (err) {
    logger.error('Queue stats error:', err)
    res.status(500).json({ message: 'Failed to fetch queue stats' })
  }
})

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

export default router
