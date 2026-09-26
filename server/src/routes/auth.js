import { Router } from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import pool from '../db.js'
import { JWT_SECRET, auth, verifyToken } from '../middleware.js'
import { sendVerificationEmail, sendPasswordResetEmail } from '../mail.js'
import logger from '../logger.js'
import { trackEvent } from './experiments.js'
import { setAuthCookies, clearAuthCookies, ACCESS_COOKIE, REFRESH_COOKIE } from '../cookies.js'
import { stripHtml } from '../sanitize.js'

const router = Router()

function makeFingerprint(req) {
  const ip = req.ip || req.connection?.remoteAddress || ''
  const ua = req.headers['user-agent'] || ''
  return crypto.createHash('sha256').update(ip + '|' + ua).digest('hex').slice(0, 32)
}

/**
 * @openapi
 * /api/auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Register a new user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string }
 *               password: { type: string, minLength: 6 }
 *               displayName: { type: string }
 *     responses:
 *       201:
 *         description: Account created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token: { type: string }
 *                 userId: { type: integer }
 *       400:
 *         description: Validation error
 *       409:
 *         description: Email already registered
 *
 * /api/auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Login with email and password
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string }
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: Login successful
 *       401:
 *         description: Invalid credentials
 *
 * /api/auth/forgot-password:
 *   post:
 *     tags: [Auth]
 *     summary: Send password reset email
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string }
 *     responses:
 *       200:
 *         description: Reset email sent if account exists
 *
 * /api/auth/reset-password:
 *   post:
 *     tags: [Auth]
 *     summary: Reset password with token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, password]
 *             properties:
 *               token: { type: string }
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: Password reset successful
 *       400:
 *         description: Invalid or expired token
 *
 * /api/auth/verify-email:
 *   post:
 *     tags: [Auth]
 *     summary: Verify email with token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token: { type: string }
 *     responses:
 *       200:
 *         description: Email verified
 *       400:
 *         description: Invalid token
 */
const REFRESH_EXPIRY_DAYS = 30

// familyId: одна «семья» на логин-сессию; refresh ротирует токен внутри семьи,
// переиспользование ротированного токена отзывает всю семью (этап 34)
async function createRefreshToken(userId, familyId, fingerprint) {
  const token = crypto.randomBytes(40).toString('hex')
  const family = familyId || crypto.randomUUID()
  await pool.query(
    'INSERT INTO refresh_tokens (user_id, token, family_id, fingerprint, expires_at) VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))',
    [userId, token, family, fingerprint || null, REFRESH_EXPIRY_DAYS],
  )
  return token
}

router.post('/api/auth/register', async (req, res) => {
  const { email, password, displayName, referralCode, phone, consent } = req.body
  if (!email || !password) return res.status(400).json({ message: 'Email and password required' })
  if (password.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters' })
  if (phone && !/^\+?[1-9]\d{6,14}$/.test(phone)) {
    return res.status(400).json({ message: 'Invalid phone number format' })
  }

  try {
    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email])
    if (existing.length > 0) return res.status(409).json({ message: 'Email already registered' })

    const { default: bcrypt } = await import('bcryptjs')
    const password_hash = await bcrypt.hash(password, 10)
    const verification_token = crypto.randomBytes(32).toString('hex')

    let referredBy = null
    if (referralCode) {
      const [[ref]] = await pool.query('SELECT id FROM users WHERE referral_code = ?', [referralCode])
      if (ref) referredBy = ref.id
    }

    const [result] = await pool.query(
      'INSERT INTO users (email, password_hash, role, verification_token, referral_code, referred_by, phone) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [email, password_hash, 'user', verification_token, crypto.randomBytes(3).toString('hex'), referredBy, phone || null],
    )
    const userId = result.insertId

    await pool.query(
      'INSERT INTO user_profiles (id, display_name, name, age, location) VALUES (?, ?, ?, 18, ST_SRID(POINT(0, 0), 4326))',
      [userId, stripHtml(displayName || email.split('@')[0]), stripHtml(displayName || email.split('@')[0])],
    )

    const token = jwt.sign({ userId, role: 'user' }, JWT_SECRET(), { expiresIn: '24h' })
    const fp = makeFingerprint(req)
    const refresh_token = await createRefreshToken(userId, undefined, fp)
    setAuthCookies(res, token, refresh_token)
    if (consent === true) {
      await pool.query(
        'INSERT INTO consent_log (user_id, consent_type, granted, ip_address) VALUES (?, ?, 1, ?)',
        [userId, 'data_processing', req.ip],
      )
    }
    sendVerificationEmail(email, verification_token)
    trackEvent('registration', userId, { referral: !!referredBy, has_phone: !!phone })

    res.status(201).json({
      token, refresh_token, userId,
      phone: phone || null,
      phone_verified: false,
      message: 'Account created',
    })
  } catch (err) {
    logger.error('Register error:', err)
    res.status(500).json({ message: 'Failed to create account' })
  }
})

router.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body
  if (!email) return res.status(400).json({ message: 'Email required' })

  try {
    const [rows] = await pool.query('SELECT id FROM users WHERE email = ?', [email])
    if (rows.length === 0) return res.json({ message: 'If the email exists, a reset link has been sent' })

    const token = crypto.randomBytes(32).toString('hex')
    await pool.query(
      'UPDATE users SET reset_token = ?, reset_token_expires = DATE_ADD(NOW(), INTERVAL 1 HOUR) WHERE id = ?',
      [token, rows[0].id],
    )

    sendPasswordResetEmail(email, token)
    res.json({ message: 'If the email exists, a reset link has been sent' })
  } catch (err) {
    logger.error('Forgot password error:', err)
    res.status(500).json({ message: 'Failed to process request' })
  }
})

router.post('/api/auth/reset-password', async (req, res) => {
  const { token, password } = req.body
  if (!token || !password) return res.status(400).json({ message: 'Token and password required' })
  if (password.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters' })

  try {
    const [rows] = await pool.query(
      'SELECT id FROM users WHERE reset_token = ? AND reset_token_expires > NOW()',
      [token],
    )
    if (rows.length === 0) return res.status(400).json({ message: 'Invalid or expired token' })

    const { default: bcrypt } = await import('bcryptjs')
    const password_hash = await bcrypt.hash(password, 10)
    await pool.query(
      'UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?',
      [password_hash, rows[0].id],
    )
    // Смена пароля инвалидирует все refresh-сессии пользователя (этап 34, аудит kimi)
    await pool.query('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ? AND revoked = 0', [rows[0].id])

    res.json({ message: 'Password reset successful' })
  } catch (err) {
    logger.error('Reset password error:', err)
    res.status(500).json({ message: 'Failed to reset password' })
  }
})

router.post('/api/auth/resend-verification', async (req, res) => {
  const { email } = req.body
  if (!email) return res.status(400).json({ message: 'Email required' })

  try {
    const [rows] = await pool.query(
      'SELECT id FROM users WHERE email = ?',
      [email],
    )
    if (rows.length === 0) return res.status(404).json({ message: 'User not found' })

    const verification_token = crypto.randomBytes(32).toString('hex')
    await pool.query(
      'UPDATE users SET verification_token = ? WHERE id = ?',
      [verification_token, rows[0].id],
    )

    sendVerificationEmail(email, verification_token)
    res.json({ message: 'Verification email sent' })
  } catch (err) {
    logger.error('Resend verification error:', err)
    res.status(500).json({ message: 'Failed to resend verification' })
  }
})

router.post('/api/auth/verify-email', async (req, res) => {
  const { token } = req.body
  if (!token) return res.status(400).json({ message: 'Token required' })

  try {
    const [rows] = await pool.query(
      'SELECT id FROM users WHERE verification_token = ?',
      [token],
    )
    if (rows.length === 0) return res.status(400).json({ message: 'Invalid token' })

    await pool.query(
      'UPDATE users SET verification_token = NULL WHERE id = ?',
      [rows[0].id],
    )

    res.json({ message: 'Email verified' })
  } catch (err) {
    logger.error('Verify email error:', err)
    res.status(500).json({ message: 'Failed to verify email' })
  }
})

router.post('/api/auth/refresh', async (req, res) => {
  const refresh_token = req.body?.refresh_token || req.cookies?.[REFRESH_COOKIE]
  if (!refresh_token) return res.status(400).json({ message: 'Refresh token required' })

  try {
    const [rows] = await pool.query(
      'SELECT id, user_id, family_id, revoked, fingerprint FROM refresh_tokens WHERE token = ? AND expires_at > NOW()',
      [refresh_token],
    )
    if (rows.length === 0) return res.status(401).json({ message: 'Invalid or expired refresh token' })
    const current = rows[0]

    // Session fingerprinting (аудит дипсик): если fingerprint записан и не совпадает — подозрение на угон
    if (current.fingerprint) {
      const newFp = makeFingerprint(req)
      if (newFp !== current.fingerprint) {
        logger.warn(`Fingerprint mismatch for user ${current.user_id}: expected ${current.fingerprint}, got ${newFp}`)
      }
    }

    // Атомарный claim: параллельный второй запрос с тем же токеном получит affectedRows=0
    const [upd] = await pool.query('UPDATE refresh_tokens SET revoked = 1 WHERE id = ? AND revoked = 0', [current.id])
    if (upd.affectedRows === 0) {
      // Токен уже ротирован и используется повторно — компрометация семьи
      await pool.query('UPDATE refresh_tokens SET revoked = 1 WHERE family_id = ? AND revoked = 0', [current.family_id])
      logger.warn(`Refresh token reuse detected for user ${current.user_id} — family revoked`)
      return res.status(401).json({ message: 'Token reuse detected' })
    }

    const token = jwt.sign({ userId: current.user_id, role: 'user' }, JWT_SECRET(), { expiresIn: '24h' })
    const new_refresh_token = crypto.randomBytes(40).toString('hex')
    const newFp = makeFingerprint(req)
    await pool.query(
      'INSERT INTO refresh_tokens (user_id, token, family_id, fingerprint, expires_at) VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))',
      [current.user_id, new_refresh_token, current.family_id, newFp, REFRESH_EXPIRY_DAYS],
    )
    setAuthCookies(res, token, new_refresh_token)
    res.json({ token, refresh_token: new_refresh_token })
  } catch (err) {
    logger.error('Refresh error:', err)
    res.status(500).json({ message: 'Failed to refresh token' })
  }
})

// Инвалидировать все сессии пользователя (смена пароля вручную, подозрение на взлом)
router.post('/api/auth/logout-all', auth, async (req, res) => {
  try {
    await pool.query('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ? AND revoked = 0', [req.userId])
    clearAuthCookies(res)
    res.json({ message: 'All sessions revoked' })
  } catch (err) {
    logger.error('Logout-all error:', err)
    res.status(500).json({ message: 'Failed to revoke sessions' })
  }
})

router.get('/api/auth/me', async (req, res) => {
  const token = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.split(' ')[1]
    : req.cookies?.[ACCESS_COOKIE]
  // Прobe-эндпоинт: без валидного токена отдаём 200 (без консольного шума 401 на клиенте)
  const unauthenticated = () => res.json({ authenticated: false })
  if (!token) return unauthenticated()

  try {
    const decoded = verifyToken(token)
    const [rows] = await pool.query(
      `SELECT u.id, u.email, u.role, up.display_name, up.avatar_url
       FROM users u LEFT JOIN user_profiles up ON u.id = up.id WHERE u.id = ?`,
      [decoded.userId],
    )
    if (rows.length === 0) return unauthenticated()
    const u = rows[0]
    res.json({
      authenticated: true,
      id: u.id,
      email: u.email,
      role: u.role,
      name: u.display_name,
      avatar: u.avatar_url,
    })
  } catch {
    unauthenticated()
  }
})

export { createRefreshToken }
export default router
