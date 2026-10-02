import { Router } from 'express'
import pool from '../db.js'
import { auth } from '../middleware.js'
import { rootLogger } from '../logger.js'
import { sendSMS } from '../sms.js'

const router = Router()

// Rate limiter: 3 SMS per hour per user
const smsRateMap = new Map()

function checkSmsRate(userId) {
  const key = `sms:${userId}`
  const now = Date.now()
  const windowMs = 3600000 // 1 hour
  const maxSends = 3

  const records = smsRateMap.get(key) || []
  const recent = records.filter((t) => now - t < windowMs)
  if (recent.length >= maxSends) {
    return { allowed: false, retryAfter: Math.ceil((recent[0] + windowMs - now) / 1000) }
  }
  recent.push(now)
  smsRateMap.set(key, recent)
  // Cleanup old entries periodically
  if (smsRateMap.size > 10000) {
    for (const [k, v] of smsRateMap) {
      const valid = v.filter((t) => now - t < windowMs)
      if (valid.length === 0) smsRateMap.delete(k)
      else smsRateMap.set(k, valid)
    }
  }
  return { allowed: true }
}

// POST /api/sms/send-code — send verification code
router.post('/api/sms/send-code', auth, async (req, res) => {
  try {
    const { phone } = req.body
    if (!phone || !/^\+?[1-9]\d{6,14}$/.test(phone)) {
      return res.status(400).json({ error: 'INVALID_PHONE', message: 'Invalid phone number' })
    }

    const rate = checkSmsRate(req.userId)
    if (!rate.allowed) {
      return res.status(429).json({
        error: 'RATE_LIMITED',
        message: `Too many requests. Try again in ${rate.retryAfter}s`,
        retryAfter: rate.retryAfter,
      })
    }

    const code = Math.floor(1000 + Math.random() * 9000).toString()
    const expiresAt = new Date(Date.now() + 600000) // 10 minutes

    // Store code in DB
    await pool.query(
      `INSERT INTO sms_verification (user_id, phone, code, expires_at)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE code = VALUES(code), expires_at = VALUES(expires_at), verified = 0, updated_at = NOW()`,
      [req.userId, phone, code, expiresAt],
    )

    await sendSMS(phone, `Your SwiftMatch verification code: ${code}`)

    rootLogger.info(`SMS code sent to user ${req.userId} -> ${phone}`)
    res.json({ success: true, message: 'Verification code sent' })
  } catch (err) {
    rootLogger.error('SMS send-code error:', err)
    res.status(500).json({ error: 'SERVER_ERROR', message: 'Failed to send code' })
  }
})

// POST /api/sms/verify — verify code
router.post('/api/sms/verify', auth, async (req, res) => {
  try {
    const { phone, code } = req.body
    if (!phone || !code) {
      return res.status(400).json({ error: 'MISSING_FIELDS', message: 'Phone and code required' })
    }

    const [rows] = await pool.query(
      `SELECT id, code, expires_at, verified FROM sms_verification
       WHERE user_id = ? AND phone = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
      [req.userId, phone],
    )

    if (rows.length === 0) {
      return res.status(400).json({ error: 'NO_CODE', message: 'No verification code found' })
    }

    const record = rows[0]
    if (record.verified) {
      return res.json({ success: true, message: 'Phone already verified' })
    }

    if (new Date(record.expires_at) < new Date()) {
      return res.status(400).json({ error: 'CODE_EXPIRED', message: 'Code expired. Request a new one.' })
    }

    if (record.code !== code) {
      return res.status(400).json({ error: 'INVALID_CODE', message: 'Invalid code' })
    }

    // Mark as verified
    await pool.query('UPDATE sms_verification SET verified = 1 WHERE id = ?', [record.id])

    // Update user's phone in users table
    await pool.query('UPDATE users SET phone = ? WHERE id = ?', [phone, req.userId])

    rootLogger.info(`Phone verified for user ${req.userId}`)
    res.json({ success: true, message: 'Phone verified' })
  } catch (err) {
    rootLogger.error('SMS verify error:', err)
    res.status(500).json({ error: 'SERVER_ERROR', message: 'Verification failed' })
  }
})

// GET /api/sms/status — check verification status
router.get('/api/sms/status', auth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT phone, verified, created_at FROM sms_verification
       WHERE user_id = ? AND verified = 1 ORDER BY created_at DESC, id DESC LIMIT 1`,
      [req.userId],
    )

    if (rows.length > 0) {
      return res.json({ verified: true, phone: rows[0].phone })
    }

    const [userRows] = await pool.query('SELECT phone FROM users WHERE id = ?', [req.userId])
    res.json({ verified: false, phone: userRows[0]?.phone || null })
  } catch (err) {
    rootLogger.error('SMS status error:', err)
    res.status(500).json({ error: 'SERVER_ERROR', message: 'Failed to get status' })
  }
})

export default router
