import 'dotenv/config'
import express from 'express'
import { createServer } from 'http'
import cors from 'cors'
import jwt from 'jsonwebtoken'
import path from 'path'
import { fileURLToPath } from 'url'
import crypto from 'crypto'
import { apiLimiter as limiter, authLimiter } from './middleware/limiters.js'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import pool from './db.js'
import { initIO, startMessageCleanup, startCheckinCleanup } from './ws.js'
import { createLogger, rootLogger } from './logger.js'
import { idempotency } from './middleware/idempotency.js'
import { csrf, csrfGuard, csrfRouter } from './middleware/csrf.js'
import { startRefreshTokenCleanup } from './cleanup.js'
import { isLocked, recordFailure, recordSuccess } from './lockout.js'
import twoFaRoutes from './routes/totp-2fa.js'
import { verifyTotpToken } from './totp.js'
import { adminAuth } from './middleware/adminAuth.js'
import { initSentry, registerSentryErrorHandler } from './sentry.js'
import { getRedis, disconnectRedis } from './redis.js'
import { initQueues, closeQueues } from './queue.js'

import adminDashboard from './routes/admin/dashboard.js'
import adminUsers from './routes/admin/users.js'
import adminAnalytics from './routes/admin/analytics.js'
import adminReports from './routes/admin/reports.js'
import adminContent from './routes/admin/content.js'
import adminFeatures from './routes/admin/features.js'
import adminMessaging from './routes/admin/messaging.js'
import adminMonetization from './routes/admin/monetization.js'
import adminHangouts from './routes/admin/hangouts.js'
import profileRoutes from './routes/profile.js'
import uploadRoutes from './routes/upload.js'
import pushRoutes from './routes/push.js'
import socialRoutes from './routes/social.js'
import premiumRoutes from './routes/premium.js'
import authRoutes, { createRefreshToken } from './routes/auth.js'
import adminModerationRoutes from './routes/admin-moderation.js'
import smsRoutes from './routes/sms.js'
import moderationRoutes from './routes/moderation.js'
import iapRoutes from './routes/iap.js'
import gdprRoutes from './routes/gdpr.js'
import fcmRoutes from './routes/push-fcm.js'
import locationRoutes from './routes/location.js'
import scheduleRoutes from './routes/schedule.js'
import dateCheckinRoutes from './routes/date-checkin.js'
import referralRoutes from './routes/referral.js'
import icebreakersRoutes from './routes/icebreakers.js'
import experimentsRoutes from './routes/experiments.js'
import hangoutsRoutes from './routes/hangouts.js'
import partnersRoutes from './routes/partners.js'
import partnerDashboard from './routes/partner-dashboard.js'
import eventsRoutes from './routes/events.js'
import affiliateRoutes from './routes/affiliate.js'
import adminPartners from './routes/admin/partners.js'
import adminBackup from './routes/admin/backup.js'
import notificationsRoutes from './routes/notifications.js'
import { metricsMiddleware, metricsRoute } from './metrics.js'
import { JWT_SECRET } from './middleware.js'
import { setAuthCookies, clearAuthCookies, extractToken, REFRESH_COOKIE } from './cookies.js'
import { setupSwagger } from './swagger.js'
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = express()
const PORT = process.env.PORT || 3002

// Этап 42 (аудит kimi 2.3): resilience-гварды.
// unhandledRejection — логируем и живём (beta-приоритет доступности).
// uncaughtException — логируем; перезапуск обеспечивает pm2 в деплое
process.on('unhandledRejection', (reason) => {
  rootLogger.error('Unhandled rejection: ' + (reason?.stack || reason))
})
process.on('uncaughtException', (err) => {
  rootLogger.error('Uncaught exception: ' + (err?.stack || err))
})



if (process.env.NODE_ENV === 'production' && !process.env.CORS_ORIGIN) {
  throw new Error('CORS_ORIGIN is required in production (fail-fast)')
}
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }))
app.use(helmet())
app.use(cookieParser())
// CSRF double-submit: раздача токена (безопасно на любой точке).
// Активация guard (блокировка мутирующих запросов без x-csrf-token) — после
// выноса API на поддомен: раскомментировать app.use(csrfGuard) ниже.
app.use(csrf)
// app.use(csrfGuard)

// Sentry must be initialized BEFORE routes and the final error handler,
// otherwise its errorHandler (registered last) never fires.
initSentry(app)

// Request ID + structured logger
app.use((req, res, next) => {
  req.rid = req.headers['x-request-id'] || crypto.randomUUID()
  res.setHeader('X-Request-Id', req.rid)
  req.log = createLogger(req.rid)
  next()
})

// API versioning: /api/v1/* aliases the current v1 routes, adds version header
app.use((req, res, next) => {
  if (req.url.startsWith('/api/v1/')) {
    res.setHeader('X-API-Version', 'v1')
    req.url = '/api' + req.url.slice('/api/v1'.length)
  }
  next()
})

app.use(metricsMiddleware)
app.get('/metrics', metricsRoute)
app.use('/api/premium/webhook', express.raw({ type: 'application/json' }))
app.use('/api/partners/order/webhook', express.raw({ type: 'application/json' }))
app.use('/api/hangouts/order/webhook', express.raw({ type: 'application/json' }))
app.use('/api/events/order/webhook', express.raw({ type: 'application/json' }))
app.use(express.json())
app.use('/uploads', express.static(path.join(__dirname, '../uploads')))
app.use('/api/', limiter)
app.use('/api/auth/', authLimiter)
app.use('/api/premium/create-checkout', idempotency)

// adminAuth импортируется из middleware/adminAuth.js (единый гейт, этап 38)

// Dev route: auto-login as first admin from DB (or fallback userId=2)
app.post('/api/auth/dev-login', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ message: 'Not found' })
  }
  let userId = 2
  let role = 'user'
  try {
    const [[admin]] = await pool.query("SELECT id FROM users WHERE role = 'admin' AND is_active = 1 LIMIT 1")
    if (admin) { userId = admin.id; role = 'admin' }
  } catch { /* fallback to userId=2 */ }
  const token = jwt.sign({ userId, role }, JWT_SECRET(), { expiresIn: '24h' })
  setAuthCookies(res, token)
  res.json({ token, role })
})

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password required' })
  }

  // Account lockout: 5 неудач подряд -> блок на 15 мин (этап 34, аудит kimi; этап 48 — Redis-backed)
  const lockKey = String(email).toLowerCase()
  const lockedForMin = await isLocked(lockKey)
  if (lockedForMin !== null) {
    rootLogger.warn(`Login locked for ${lockKey} (${lockedForMin} min left)`)
    return res.status(429).json({ message: `Too many failed attempts. Try again in ${lockedForMin} min` })
  }

  try {
    const [rows] = await pool.query(
      'SELECT id, email, role, password_hash, totp_secret, totp_enabled FROM users WHERE email = ? AND is_active = 1',
      [email],
    )
    if (rows.length === 0) {
      await recordFailure(lockKey)
      return res.status(401).json({ message: 'Invalid credentials' })
    }

    const user = rows[0]
    const { default: bcrypt } = await import('bcryptjs')
    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) {
      await recordFailure(lockKey)
      return res.status(401).json({ message: 'Invalid credentials' })
    }

    // TOTP 2FA (этап 38, аудит kimi): для админов с включённой 2FA пароль — только первый фактор
    if (user.role === 'admin' && user.totp_enabled === 1) {
      const code = String(req.body.totp_code || '').trim()
      if (!code) {
        return res.status(401).json({ message: 'TOTP_REQUIRED' })
      }
      if (!verifyTotpToken(user.totp_secret, code)) {
        await recordFailure(lockKey)
        return res.status(401).json({ message: 'TOTP_INVALID' })
      }
    }
    await recordSuccess(lockKey)

    const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET(), { expiresIn: '24h' })
    const fp = crypto.createHash('sha256').update((req.ip || '') + '|' + (req.headers['user-agent'] || '')).digest('hex').slice(0, 32)
    const refresh_token = await createRefreshToken(user.id, undefined, fp)
    setAuthCookies(res, token, refresh_token)
    res.json({ token, refresh_token, role: user.role })
  } catch (err) {
    rootLogger.error('Login error: ' + err.message)
    res.status(500).json({ message: 'Internal server error' })
  }
})

app.post('/api/auth/logout', (req, res) => {
  const refreshToken = req.cookies?.[REFRESH_COOKIE] || req.body?.refresh_token
  if (refreshToken) {
    pool.query('DELETE FROM refresh_tokens WHERE token = ?', [refreshToken]).catch(() => {})
  }
  clearAuthCookies(res)
  res.json({ message: 'Logged out' })
})

// TOTP 2FA management (этап 38): setup/enable/disable, только админы
app.use(twoFaRoutes)
app.use(csrfRouter)

// Public content endpoint (no auth)
app.get('/api/content', async (req, res) => {
  try {
    const [[row]] = await pool.query('SELECT * FROM content_config WHERE id = 1')
    if (!row) return res.json({ interests: [], dating_goals: [], education: [], banned_words: [], cities: [] })
    function parseJsonField(val, fallback) {
      if (Array.isArray(val)) return val
      if (typeof val === 'string') { try { return JSON.parse(val) } catch { return fallback || [] } }
      return fallback || []
    }
    let storedCities = null
    if (Array.isArray(row.cities)) storedCities = row.cities
    else if (typeof row.cities === 'string') { try { const arr = JSON.parse(row.cities); if (Array.isArray(arr)) storedCities = arr } catch { storedCities = null } }
    const [cities] = await pool.query(
      'SELECT DISTINCT city FROM user_profiles WHERE city IS NOT NULL AND city != "" ORDER BY city',
    )
    res.json({
      interests: parseJsonField(row.interests, []),
      dating_goals: parseJsonField(row.dating_goals, []),
      education: parseJsonField(row.education, []),
      banned_words: parseJsonField(row.banned_words, []),
      cities: storedCities || cities.map(c => c.city),
    })
  } catch (err) {
    rootLogger.error('Public content error: ' + err.message)
    res.status(500).json({ message: 'Failed to fetch content' })
  }
})

setupSwagger(app)

app.use(profileRoutes)
app.use(uploadRoutes)
app.use(pushRoutes)
app.use(premiumRoutes)
app.use(socialRoutes)
app.use(authRoutes)
app.use(smsRoutes)
app.use(moderationRoutes)
app.use(iapRoutes)
app.use(fcmRoutes)
app.use(locationRoutes)
app.use(scheduleRoutes)
app.use('/api/admin', (req, res, next) => {
  if (req.method === 'GET' && (req.path === '/features' || req.path === '/features/')) {
    return next()
  }
  return adminAuth(req, res, next)
})

app.get('/api/admin/me', async (req, res) => {
  const token = extractToken(req)
  if (!token) {
    return res.status(401).json({ message: 'No token' })
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET())
    const [rows] = await pool.query(
      'SELECT u.id, u.role, up.display_name as name, u.email FROM users u LEFT JOIN user_profiles up ON u.id = up.id WHERE u.id = ?',
      [decoded.userId],
    )
    if (rows.length === 0) return res.status(401).json({ message: 'User not found' })
    res.json(rows[0])
  } catch {
    res.status(401).json({ message: 'Invalid token' })
  }
})

app.use('/api/admin', adminDashboard)
app.use('/api/admin', adminUsers)
app.use('/api/admin', adminAnalytics)
app.use('/api/admin', adminReports)
app.use('/api/admin', adminContent)
app.use('/api/admin', adminFeatures)
app.use('/api/admin', adminMessaging)
app.use('/api/admin', adminMonetization)
app.use('/api/admin', adminHangouts)
app.use('/api/admin', adminPartners)
app.use('/api/admin', adminModerationRoutes)
app.use('/api/admin', adminBackup)
app.use(gdprRoutes)
app.use(referralRoutes)
app.use('/api/checkin', dateCheckinRoutes)
app.use(icebreakersRoutes)
app.use(experimentsRoutes)
app.use(hangoutsRoutes)
app.use(partnersRoutes)
app.use(partnerDashboard)
app.use(eventsRoutes)
app.use(affiliateRoutes)
app.use(notificationsRoutes)

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({ status: 'ok', db: 'connected' })
  } catch {
    res.status(503).json({ status: 'error', db: 'disconnected' })
  }
})

// Error middleware order matters: Sentry errorHandler must be registered
// before the generic 500 handler above to catch route errors.
registerSentryErrorHandler(app)

app.use((err, req, res, next) => {
  const log = req.log || rootLogger
  log.error('Unhandled error', err)
  res.status(500).json({ message: 'Internal server error' })
})

const httpServer = createServer(app)
await initIO(httpServer)
startMessageCleanup()
startCheckinCleanup()
startRefreshTokenCleanup()
initQueues()
httpServer.listen(PORT, () => {
  rootLogger.info(`SwiftMatch API running on port ${PORT}`)
  getRedis() // lazy connect
})

process.on('SIGTERM', async () => {
  rootLogger.info('SIGTERM received — shutting down')
  await closeQueues()
  await disconnectRedis()
  await pool.end().catch(() => {})
  httpServer.close(() => process.exit(0))
})
