import { Router } from 'express'
import logger from '../../logger.js'
import {
  buildWeeklySummary,
  resolveRecipient,
  sendWeeklyReport,
} from '../../weekly-report.js'

const router = Router()

/**
 * @openapi
 * /api/admin/weekly-report:
 *   get:
 *     tags: [Admin]
 *     summary: Preview the weekly admin summary without sending it
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Weekly summary preview }
 */
router.get('/weekly-report', async (req, res) => {
  try {
    const summary = await buildWeeklySummary()
    res.json({ ...summary, recipient: resolveRecipient() })
  } catch (err) {
    logger.error('Weekly report preview error:', err)
    res.status(500).json({ message: 'Failed to build weekly report' })
  }
})

/**
 * @openapi
 * /api/admin/weekly-report/send:
 *   post:
 *     tags: [Admin]
 *     summary: Send the weekly admin summary now
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Weekly summary sent }
 *       400: { description: ADMIN_EMAIL is not configured }
 *       502: { description: Weekly summary could not be delivered }
 */
router.post('/weekly-report/send', async (req, res) => {
  const result = await sendWeeklyReport()
  if (!result.sent) {
    const status = result.reason === 'no-recipient' ? 400 : 502
    return res.status(status).json({ message: 'Weekly report not sent', reason: result.reason })
  }
  res.json({ message: 'Weekly report sent', summary: result.summary })
})

export default router
