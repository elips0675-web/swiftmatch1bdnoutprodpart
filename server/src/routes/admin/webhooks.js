import { Router } from 'express'
import pool from '../../db.js'
import logger from '../../logger.js'
import {
  listWebhookDeliveries,
  getWebhookDelivery,
  markWebhookProcessed,
  markWebhookFailed,
  WEBHOOK_PROVIDERS,
} from '../../webhooks.js'
import { applyPremiumCheckout } from '../premium.js'
import { applyEventTicket } from '../events.js'
import { applyPartnerOrder } from '../partners.js'
import { applyPartnerSubscription } from '../partner-dashboard.js'
import { applyHangoutTicket } from '../hangouts.js'

const router = Router()

const REPLAY_HANDLERS = {
  [WEBHOOK_PROVIDERS.premium]: applyPremiumCheckout,
  [WEBHOOK_PROVIDERS.events]: applyEventTicket,
  [WEBHOOK_PROVIDERS.partnerOrder]: applyPartnerOrder,
  [WEBHOOK_PROVIDERS.partnerSubscription]: applyPartnerSubscription,
  [WEBHOOK_PROVIDERS.hangoutTicket]: applyHangoutTicket,
}

const ALLOWED_STATUS = new Set(['received', 'processed', 'failed'])

router.get('/webhooks', async (req, res) => {
  try {
    const { provider, status, limit, offset } = req.query
    if (status && !ALLOWED_STATUS.has(String(status))) {
      return res.status(400).json({ message: 'Invalid status filter' })
    }
    const result = await listWebhookDeliveries({ provider, status, limit, offset })
    res.json(result)
  } catch (err) {
    logger.error('Webhook journal list error:', err)
    res.status(500).json({ message: 'Failed to list webhook deliveries' })
  }
})

router.post('/webhooks/:id/replay', async (req, res) => {
  let row
  try {
    row = await getWebhookDelivery(req.params.id)
    if (!row) return res.status(404).json({ message: 'Delivery not found' })
    const handler = REPLAY_HANDLERS[row.provider]
    if (!handler) return res.status(400).json({ message: 'Provider not replayable' })

    let event
    try {
      event = JSON.parse(row.payload)
    } catch {
      return res.status(400).json({ message: 'Stored payload is not valid JSON' })
    }
    if (!event || typeof event !== 'object') {
      return res.status(400).json({ message: 'Stored payload is empty' })
    }

    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      await handler(event, conn)
      await conn.commit()
    } catch (err) {
      await conn.rollback()
      throw err
    } finally {
      conn.release()
    }
    await markWebhookProcessed(row.provider, row.eventId)
    res.json({ message: 'Replayed', id: row.id })
  } catch (err) {
    logger.error('Webhook replay error:', err)
    if (row) await markWebhookFailed(row.provider, row.eventId, err.message)
    res.status(500).json({ message: 'Replay failed' })
  }
})

export default router
