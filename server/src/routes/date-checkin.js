import { Router } from 'express'
import pool from '../db.js'
import { auth } from '../middleware.js'
import logger from '../logger.js'

const router = Router()

router.get('/contacts', auth, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, name, phone, email, relation FROM emergency_contacts WHERE user_id = ? ORDER BY created_at DESC',
      [req.userId]
    );
    res.json(rows || []);
  } catch (err) {
    logger.error('Emergency contacts GET error', { error: err.message, userId: req.userId });
    res.status(500).json({ error: 'Failed to load contacts' });
  }
});

router.post('/contacts', auth, async (req, res) => {
  try {
    const { name, phone, email, relation } = req.body;
    if (!name || name.trim().length < 2) {
      return res.status(400).json({ error: 'Name is required (min 2 chars)' });
    }

    const [result] = await pool.execute(
      'INSERT INTO emergency_contacts (user_id, name, phone, email, relation) VALUES (?, ?, ?, ?, ?)',
      [req.userId, name.trim(), phone || null, email || null, relation || null]
    );
    res.status(201).json({ id: result.insertId, name: name.trim() });
  } catch (err) {
    logger.error('Emergency contact POST error', { error: err.message, userId: req.userId });
    res.status(500).json({ error: 'Failed to create contact' });
  }
});

router.delete('/contacts/:id', auth, async (req, res) => {
  try {
    const [result] = await pool.execute(
      'DELETE FROM emergency_contacts WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Contact not found' });
    res.json({ success: true });
  } catch (err) {
    logger.error('Emergency contact DELETE error', { error: err.message, userId: req.userId });
    res.status(500).json({ error: 'Failed to delete contact' });
  }
});

router.post('/start', auth, async (req, res) => {
  try {
    const { schedule_id, contact_id, checkin_minutes, message } = req.body;
    const minutes = parseInt(checkin_minutes, 10) || 60;
    if (minutes < 15 || minutes > 480) {
      return res.status(400).json({ error: 'Check-in time must be between 15 and 480 minutes' });
    }

    const checkinAt = new Date(Date.now() + minutes * 60 * 1000);
    const [result] = await pool.execute(
      'INSERT INTO date_checkins (user_id, schedule_id, contact_id, checkin_at, message, location_sharing) VALUES (?, ?, ?, ?, ?, ?)',
      [req.userId, schedule_id || null, contact_id || null, checkinAt, message || null, req.body.location_sharing ? 1 : 0]
    );
    res.status(201).json({ id: result.insertId, checkin_at: checkinAt.toISOString() });
  } catch (err) {
    logger.error('Check-in start error', { error: err.message, userId: req.userId });
    res.status(500).json({ error: 'Failed to start check-in' });
  }
});

router.post('/:id/checkin', auth, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, status FROM date_checkins WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Check-in not found' });
    if (rows[0].status !== 'active') return res.status(400).json({ error: 'Check-in is not active' });

    await pool.execute(
      "UPDATE date_checkins SET status = 'checked_in', checked_in_at = NOW() WHERE id = ?",
      [req.params.id]
    );
    res.json({ success: true, status: 'checked_in' });
  } catch (err) {
    logger.error('Check-in confirm error', { error: err.message, userId: req.userId });
    res.status(500).json({ error: 'Failed to confirm check-in' });
  }
});

router.post('/:id/cancel', auth, async (req, res) => {
  try {
    const [result] = await pool.execute(
      "UPDATE date_checkins SET status = 'cancelled' WHERE id = ? AND user_id = ? AND status = 'active'",
      [req.params.id, req.userId]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Active check-in not found' });
    res.json({ success: true });
  } catch (err) {
    logger.error('Check-in cancel error', { error: err.message, userId: req.userId });
    res.status(500).json({ error: 'Failed to cancel check-in' });
  }
});

router.get('/active', auth, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT dc.id, dc.checkin_at, dc.message, dc.location_sharing, dc.status,
              ec.name AS contact_name, ec.phone AS contact_phone
       FROM date_checkins dc
       LEFT JOIN emergency_contacts ec ON dc.contact_id = ec.id
       WHERE dc.user_id = ? AND dc.status IN ('active', 'missed')
       ORDER BY dc.checkin_at DESC, dc.id DESC LIMIT 10`,
      [req.userId]
    );
    res.json(rows || []);
  } catch (err) {
    logger.error('Active check-ins GET error', { error: err.message, userId: req.userId });
    res.status(500).json({ error: 'Failed to load check-ins' });
  }
});

export default router
