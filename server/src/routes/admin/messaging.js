import { Router } from 'express'
import pool from '../../db.js'
import { sendPushToAll } from '../push.js'
import { sendCustomEmail } from '../../mail.js'
import logger from '../../logger.js'

const router = Router()

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
  try {
    const [result] = await pool.query(
      `INSERT INTO campaigns (title, body, target, channel, admin_id, status, delivered, opened, clicked)
       VALUES (?, ?, ?, ?, ?, 'sent', 0, 0, 0)`,
      [title, body, target || 'all', channel || 'push', req.admin.id],
    )

    if (channel === 'push') {
      sendPushToAll(title, body, '/').catch(err => {
        logger.error('Campaign push send failed:', err)
      })
    }

    if (channel === 'email') {
      const [users] = await pool.query(
        'SELECT email FROM users WHERE is_active = 1 AND deleted_at IS NULL',
      )
      const html = `<h2>${title}</h2><p>${body}</p>`
      for (const u of users) {
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
