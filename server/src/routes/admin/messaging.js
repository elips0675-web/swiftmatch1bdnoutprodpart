import { Router } from 'express'
import pool from '../../db.js'
import { sendPushToAll } from '../push.js'
import { sendCustomEmail } from '../../mail.js'
import logger from '../../logger.js'
import { buildUnsubscribeUrl, listEmailRecipients, isUnsubscribeFeatureEnabled } from '../../email-unsubscribe.js'

const router = Router()

const CAMPAIGN_TARGETS = ['all', 'premium', 'new']
const CAMPAIGN_CHANNELS = ['push', 'email']

/**
 * @openapi
 * /api/admin/campaigns:
 *   get:
 *     tags: [Admin]
 *     summary: List messaging campaigns
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: List of campaigns }
 */
router.get('/campaigns', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, title, body, target, channel, status,
              DATE_FORMAT(created_at, '%Y-%m-%d') as sentAt,
              delivered, opened, clicked
       FROM campaigns
       ORDER BY created_at DESC`,
    )
    res.json(rows)
  } catch (err) {
    logger.error('Campaigns error:', err)
    res.status(500).json({ message: 'Failed to fetch campaigns' })
  }
})

/**
 * @openapi
 * /api/admin/campaigns:
 *   post:
 *     tags: [Admin]
 *     summary: Create and send a messaging campaign
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201: { description: Campaign created }
 */
router.post('/campaigns', async (req, res) => {
  const { title, body, target, channel } = req.body
  if (!title || !body) {
    return res.status(400).json({ message: 'Title and body required' })
  }
  const targetValue = target || 'all'
  const channelValue = channel || 'push'
  if (!CAMPAIGN_TARGETS.includes(targetValue) || !CAMPAIGN_CHANNELS.includes(channelValue)) {
    return res.status(400).json({ message: 'Unknown campaign target or channel' })
  }
  try {
    const [result] = await pool.query(
      `INSERT INTO campaigns (title, body, target, channel, admin_id, status, delivered, opened, clicked)
       VALUES (?, ?, ?, ?, ?, 'sent', 0, 0, 0)`,
      [title, body, targetValue, channelValue, req.admin.id],
    )

    if (channelValue === 'push') {
      sendPushToAll(title, body, '/').catch(err => {
        logger.error('Campaign push send failed:', err)
      })
    }

    if (channelValue === 'email') {
      const recipients = await listEmailRecipients()
      const withLink = await isUnsubscribeFeatureEnabled()
      for (const u of recipients) {
        const footer = withLink
          ? `<p style="font-size:12px;color:#888">${buildUnsubscribeUrl(u.id, u.email)}</p>`
          : ''
        const html = `<h2>${title}</h2><p>${body}</p>${footer}`
        sendCustomEmail(u.email, title, html).catch(err => {
          logger.error('Campaign email send failed:', err)
        })
      }
    }

    res.status(201).json({ id: result.insertId, message: 'Campaign sent' })
  } catch (err) {
    logger.error('Create campaign error:', err)
    res.status(500).json({ message: 'Failed to create campaign' })
  }
})

export default router
