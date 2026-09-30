import { Router } from 'express'
import pool from '../db.js'
import { auth } from '../middleware.js'
import { getIO } from '../ws.js'
import logger from '../logger.js'
import { activeUser } from '../active-user.js'

const router = Router()

router.get('/api/schedule', auth, async (req, res) => {
  try {
    const { status } = req.query
    let sql = `SELECT ds.*, up.display_name as partner_name, up.avatar_url as partner_avatar
               FROM date_schedules ds
               JOIN user_profiles up ON (CASE WHEN ds.proposer_id = ? THEN ds.invitee_id ELSE ds.proposer_id END) = up.id
               WHERE (ds.proposer_id = ? OR ds.invitee_id = ?) AND ${activeUser('up')}`
    const params = [req.userId, req.userId, req.userId]
    if (status && status !== 'all') {
      sql += ' AND ds.status = ?'
      params.push(status)
    }
    sql += ' ORDER BY ds.scheduled_at ASC'
    const [rows] = await pool.query(sql, params)
    res.json(rows)
  } catch (err) {
    req.log.error('Schedule list error:', err)
    res.status(500).json({ message: 'Failed to fetch schedules' })
  }
})

router.post('/api/schedule', auth, async (req, res) => {
  try {
    const { chat_id, scheduled_at, duration_minutes, message } = req.body
    if (!chat_id || !scheduled_at) {
      return res.status(400).json({ message: 'chat_id and scheduled_at are required' })
    }
    const ts = new Date(scheduled_at)
    if (isNaN(ts.getTime())) {
      return res.status(400).json({ message: 'Invalid scheduled_at' })
    }

    const [participants] = await pool.query(
      'SELECT user_id FROM chat_participants WHERE chat_id = ?',
      [chat_id],
    )
    const userIds = participants.map(p => p.user_id)
    if (!userIds.includes(req.userId)) {
      return res.status(403).json({ message: 'Not a participant' })
    }
    const inviteeId = userIds.find(id => id !== req.userId)
    if (!inviteeId) {
      return res.status(400).json({ message: 'No other participant found' })
    }

    const [result] = await pool.query(
      `INSERT INTO date_schedules (chat_id, proposer_id, invitee_id, scheduled_at, duration_minutes, message)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [chat_id, req.userId, inviteeId, ts, duration_minutes || 60, message || null],
    )

    const [[schedule]] = await pool.query(
      `SELECT ds.*, up.display_name as partner_name, up.avatar_url as partner_avatar
       FROM date_schedules ds
       JOIN user_profiles up ON up.id = ?
       WHERE ds.id = ? AND ${activeUser('up')}`,
      [req.userId, result.insertId],
    )

    try {
      const io = getIO()
      if (io) {
        io.to(`user:${req.userId}`).emit('schedule:updated', schedule)
        io.to(`user:${inviteeId}`).emit('schedule:updated', schedule)
      }
    } catch {}

    res.status(201).json(schedule)
  } catch (err) {
    req.log.error('Schedule create error:', err)
    res.status(500).json({ message: 'Failed to create schedule' })
  }
})

router.put('/api/schedule/:id/accept', auth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM date_schedules WHERE id = ? AND invitee_id = ? AND status = ?',
      [req.params.id, req.userId, 'pending'],
    )
    if (rows.length === 0) return res.status(404).json({ message: 'Schedule not found or already responded' })

    await pool.query('UPDATE date_schedules SET status = ? WHERE id = ?', ['accepted', req.params.id])
    const [[schedule]] = await pool.query('SELECT * FROM date_schedules WHERE id = ?', [req.params.id])

    try {
      const io = getIO()
      if (io) {
        io.to(`user:${schedule.proposer_id}`).emit('schedule:updated', schedule)
        io.to(`user:${schedule.invitee_id}`).emit('schedule:updated', schedule)
      }
    } catch {}

    res.json(schedule)
  } catch (err) {
    req.log.error('Schedule accept error:', err)
    res.status(500).json({ message: 'Failed to accept schedule' })
  }
})

router.put('/api/schedule/:id/decline', auth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM date_schedules WHERE id = ? AND invitee_id = ? AND status = ?',
      [req.params.id, req.userId, 'pending'],
    )
    if (rows.length === 0) return res.status(404).json({ message: 'Schedule not found or already responded' })

    await pool.query('UPDATE date_schedules SET status = ? WHERE id = ?', ['declined', req.params.id])
    const [[schedule]] = await pool.query('SELECT * FROM date_schedules WHERE id = ?', [req.params.id])

    try {
      const io = getIO()
      if (io) {
        io.to(`user:${schedule.proposer_id}`).emit('schedule:updated', schedule)
        io.to(`user:${schedule.invitee_id}`).emit('schedule:updated', schedule)
      }
    } catch {}

    res.json(schedule)
  } catch (err) {
    req.log.error('Schedule decline error:', err)
    res.status(500).json({ message: 'Failed to decline schedule' })
  }
})

router.put('/api/schedule/:id/cancel', auth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM date_schedules WHERE id = ? AND proposer_id = ? AND status IN (?, ?)',
      [req.params.id, req.userId, 'pending', 'accepted'],
    )
    if (rows.length === 0) return res.status(404).json({ message: 'Schedule not found or cannot be cancelled' })

    await pool.query('UPDATE date_schedules SET status = ? WHERE id = ?', ['cancelled', req.params.id])
    const [[schedule]] = await pool.query('SELECT * FROM date_schedules WHERE id = ?', [req.params.id])

    try {
      const io = getIO()
      if (io) {
        io.to(`user:${schedule.proposer_id}`).emit('schedule:updated', schedule)
        io.to(`user:${schedule.invitee_id}`).emit('schedule:updated', schedule)
      }
    } catch {}

    res.json(schedule)
  } catch (err) {
    req.log.error('Schedule cancel error:', err)
    res.status(500).json({ message: 'Failed to cancel schedule' })
  }
})

export default router
