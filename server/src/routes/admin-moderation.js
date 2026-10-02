import { Router } from 'express'
import pool from '../db.js'
import logger from '../logger.js'

const router = Router()

router.get('/photos', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.id, p.url, p.user_id, p.created_at, p.moderation_status,
              up.display_name, up.avatar_url
       FROM user_photos p
       JOIN user_profiles up ON up.id = p.user_id
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT 200`,
    )
    res.json(rows)
  } catch (err) {
    logger.error('All photos error:', err)
    res.status(500).json({ message: 'Failed to fetch photos' })
  }
})

router.get('/photos/pending', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.id, p.url, p.user_id, p.created_at, p.moderation_status,
              up.display_name, up.avatar_url
       FROM user_photos p
       JOIN user_profiles up ON up.id = p.user_id
       WHERE p.moderation_status = 'pending'
       ORDER BY p.created_at ASC, p.id ASC
       LIMIT 50`,
    )
    res.json(rows)
  } catch (err) {
    logger.error('Pending photos error:', err)
    res.status(500).json({ message: 'Failed to fetch pending photos' })
  }
})

router.post('/photos/:id/approve', async (req, res) => {
  try {
    await pool.query(
      'UPDATE user_photos SET moderation_status = ? WHERE id = ? AND moderation_status = ?',
      ['approved', req.params.id, 'pending'],
    )
    res.json({ message: 'Photo approved' })
  } catch (err) {
    logger.error('Approve photo error:', err)
    res.status(500).json({ message: 'Failed to approve photo' })
  }
})

router.post('/photos/:id/reject', async (req, res) => {
  const { reason } = req.body
  try {
    await pool.query(
      'UPDATE user_photos SET moderation_status = ?, moderation_reason = ? WHERE id = ? AND moderation_status = ?',
      ['rejected', reason || null, req.params.id, 'pending'],
    )
    res.json({ message: 'Photo rejected' })
  } catch (err) {
    logger.error('Reject photo error:', err)
    res.status(500).json({ message: 'Failed to reject photo' })
  }
})

export default router
