import { Router } from 'express'
import crypto from 'crypto'
import pool from '../db.js'
import { auth } from '../middleware.js'
import logger from '../logger.js'
import { textField } from '../profile-fields.js'
import { auditLog } from '../audit.js'
import { buildExportPayload, buildExportArchive } from '../gdpr-export.js'

const router = Router()

/**
 * @openapi
 * /api/data/export:
 *   get:
 *     tags: [GDPR]
 *     summary: Export all user data (JSON, or ZIP archive with ?format=zip)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Full user data export (JSON) or ZIP archive }
 */
router.get('/api/data/export', auth, async (req, res) => {
  const wantsZip =
    String(req.query.format || '').toLowerCase() === 'zip' ||
    String(req.headers.accept || '').includes('application/zip')

  try {
    if (wantsZip) {
      const archive = await buildExportArchive({ db: pool, userId: req.userId })
      if (!archive) return res.status(404).json({ message: 'User not found' })
      res.setHeader('Content-Type', 'application/zip')
      res.setHeader('Content-Disposition', `attachment; filename="${archive.filename}"`)
      return res.send(archive.buffer)
    }

    const payload = await buildExportPayload(pool, req.userId)
    if (!payload) return res.status(404).json({ message: 'User not found' })
    res.json(payload)
  } catch (err) {
    logger.error('Data export error:', err)
    res.status(500).json({ message: 'Failed to export data' })
  }
})

/**
 * @openapi
 * /api/data/erase/request:
 *   post:
 *     tags: [GDPR]
 *     summary: Request account erasure
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Erase request created with confirmation token }
 */
router.post('/api/data/erase/request', auth, async (req, res) => {
  try {
    const token = crypto.randomBytes(32).toString('hex')
    await pool.query(
      'INSERT INTO data_erase_requests (user_id, token, status) VALUES (?, ?, ?)',
      [req.userId, token, 'pending'],
    )
    logger.info('Erase request created', { userId: req.userId })
    res.json({ message: 'Erase request created. Confirm within 24h.', token })
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Erase request already exists' })
    }
    logger.error('Erase request error:', err)
    res.status(500).json({ message: 'Failed to create erase request' })
  }
})

/**
 * @openapi
 * /api/data/erase/confirm:
 *   post:
 *     tags: [GDPR]
 *     summary: Confirm and execute account erasure
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Account erased successfully }
 */
router.post('/api/data/erase/confirm', auth, async (req, res) => {
  const { token } = req.body
  if (!token) return res.status(400).json({ message: 'Token is required' })

  try {
    const [[request]] = await pool.query(
      'SELECT id, status FROM data_erase_requests WHERE user_id = ? AND token = ? AND status = ? AND requested_at > NOW() - INTERVAL 24 HOUR',
      [req.userId, token, 'pending'],
    )
    if (!request) return res.status(404).json({ message: 'Invalid or expired token' })

    await pool.query(
      'UPDATE data_erase_requests SET status = ?, confirmed_at = NOW() WHERE id = ?',
      ['confirmed', request.id],
    )

    const [photoDelete] = await pool.query('DELETE FROM user_photos WHERE user_id = ?', [req.userId])
    if (photoDelete.affectedRows > 0) {
      await auditLog({
        tableName: 'user_photos',
        recordId: null,
        action: 'delete_bulk',
        oldValues: { user_id: req.userId, count: photoDelete.affectedRows },
        userId: req.userId,
        ipAddress: req.ip,
      })
    }
    await pool.query('DELETE FROM user_interests WHERE user_id = ?', [req.userId])
    await pool.query('DELETE FROM likes WHERE from_user_id = ? OR to_user_id = ?', [req.userId, req.userId])
    await pool.query('DELETE FROM messages WHERE sender_id = ?', [req.userId])
    await pool.query('DELETE FROM notifications WHERE user_id = ?', [req.userId])
    await pool.query('DELETE FROM activity_log WHERE user_id = ?', [req.userId])
    await pool.query('DELETE FROM consent_log WHERE user_id = ?', [req.userId])
    await pool.query('DELETE FROM push_subscriptions WHERE user_id = ?', [req.userId])
    await pool.query('DELETE FROM refresh_tokens WHERE user_id = ?', [req.userId])
    await pool.query('DELETE FROM user_profiles WHERE id = ?', [req.userId])
    await pool.query('DELETE FROM subscriptions WHERE user_id = ?', [req.userId])
    await pool.query('UPDATE users SET email = CONCAT(\'erased-\', id, \'@erased.swiftmatch.app\'), password_hash = \'\', is_active = 0 WHERE id = ?', [req.userId])

    await pool.query(
      'UPDATE data_erase_requests SET status = ?, completed_at = NOW() WHERE id = ?',
      ['completed', request.id],
    )

    logger.info('Account erased', { userId: req.userId })
    res.json({ message: 'Account erased successfully' })
  } catch (err) {
    logger.error('Erase confirm error:', err)
    res.status(500).json({ message: 'Failed to erase account' })
  }
})

/**
 * @openapi
 * /api/consent:
 *   post:
 *     tags: [GDPR]
 *     summary: Record a consent choice
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201: { description: Consent recorded }
 */
router.post('/api/consent', auth, async (req, res) => {
  const { consent_type, granted } = req.body
  const safeType = (textField(consent_type, 100) || '').trim()
  if (!safeType || granted === undefined) {
    return res.status(400).json({ message: 'consent_type and granted are required' })
  }

  try {
    await pool.query(
      'INSERT INTO consent_log (user_id, consent_type, granted, ip_address) VALUES (?, ?, ?, ?)',
      [req.userId, safeType, granted ? 1 : 0, req.ip],
    )
    res.status(201).json({ message: 'Consent recorded' })
  } catch (err) {
    logger.error('Consent log error:', err)
    res.status(500).json({ message: 'Failed to record consent' })
  }
})

/**
 * @openapi
 * /api/consent/history:
 *   get:
 *     tags: [GDPR]
 *     summary: List consent history
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Array of consent records }
 */
router.get('/api/consent/history', auth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, consent_type, granted, ip_address, created_at FROM consent_log WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50',
      [req.userId],
    )
    res.json(rows)
  } catch (err) {
    logger.error('Consent history error:', err)
    res.status(500).json({ message: 'Failed to fetch consent history' })
  }
})

export default router
