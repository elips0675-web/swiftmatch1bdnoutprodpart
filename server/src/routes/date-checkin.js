import { Router } from 'express'
import pool from '../db.js'
import { auth } from '../middleware.js'
import logger from '../logger.js'
import { FieldError, textField } from '../profile-fields.js'
import { wrapRouter } from '../async-handler.js'

const router = Router()

/**
 * @openapi
 * /api/checkin/contacts:
 *   get:
 *     tags: [Checkin]
 *     summary: List emergency contacts
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Array of emergency contacts }
 */
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

/**
 * @openapi
 * /api/checkin/contacts:
 *   post:
 *     tags: [Checkin]
 *     summary: Create an emergency contact
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201: { description: Contact created with id }
 */
router.post('/contacts', auth, async (req, res) => {
  try {
    const { name, phone, email, relation } = req.body;
    const normName = textField(name, 255);
    if (!normName || normName.trim().length < 2) {
      return res.status(400).json({ error: 'Name is required (min 2 chars)' });
    }
    const safeName = normName.trim();
    const normPhone = textField(phone, 20) || null;
    const normEmail = textField(email, 255) || null;
    const normRelation = textField(relation, 100) || null;

    const [result] = await pool.execute(
      'INSERT INTO emergency_contacts (user_id, name, phone, email, relation) VALUES (?, ?, ?, ?, ?)',
      [req.userId, safeName, normPhone, normEmail, normRelation]
    );
    res.status(201).json({ id: result.insertId, name: safeName });
  } catch (err) {
    if (err instanceof FieldError) return res.status(400).json({ error: err.message });
    logger.error('Emergency contact POST error', { error: err.message, userId: req.userId });
    res.status(500).json({ error: 'Failed to create contact' });
  }
});

/**
 * @openapi
 * /api/checkin/contacts/{id}:
 *   delete:
 *     tags: [Checkin]
 *     summary: Delete an emergency contact
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Contact deleted }
 */
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

/**
 * @openapi
 * /api/checkin/start:
 *   post:
 *     tags: [Checkin]
 *     summary: Start a safety check-in
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201: { description: Check-in scheduled }
 */
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

/**
 * @openapi
 * /api/checkin/{id}/checkin:
 *   post:
 *     tags: [Checkin]
 *     summary: Confirm a check-in
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Check-in confirmed }
 */
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

/**
 * @openapi
 * /api/checkin/{id}/cancel:
 *   post:
 *     tags: [Checkin]
 *     summary: Cancel an active check-in
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Check-in cancelled }
 */
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

/**
 * @openapi
 * /api/checkin/active:
 *   get:
 *     tags: [Checkin]
 *     summary: List active check-ins
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Array of active check-ins }
 */
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

export default wrapRouter(router)
