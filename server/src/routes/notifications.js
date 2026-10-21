import { Router } from 'express'
import pool from '../db.js'
import { auth } from '../middleware.js'
import logger from '../logger.js'
import {
  getPrefs, savePrefs, normalizePrefs, defaultPrefs, describeMatrix, CHANNELS,
} from '../notification-prefs.js'
import { getQuiet, saveQuiet, normalizeQuiet } from '../quiet-hours.js'
import { wrapRouter } from '../async-handler.js'

const router = Router()

/**
 * GET /api/notifications/preferences
 * Текущие настройки уведомлений: полная матрица 9 событий x 2 канала.
 * Отсутствие строки в БД = всё включено (fail-open), ответ всё равно полный.
 */
/**
 * @openapi
 * /api/notifications/preferences:
 *   get:
 *     tags: [Notifications]
 *     summary: Get notification preferences matrix
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Notification preferences and matrix }
 */
router.get('/api/notifications/preferences', auth, async (req, res) => {
  try {
    const stored = await getPrefs(req.userId)
    const { prefs } = normalizePrefs(stored)
    res.json({ prefs, events: describeMatrix(), channels: CHANNELS, defaults: defaultPrefs() })
  } catch (err) {
    logger.error('Notification prefs read error:', err)
    res.status(500).json({ message: 'Failed to fetch notification preferences' })
  }
})

/**
 * PUT /api/notifications/preferences
 * Полная замена матрицы. Непереданные и невалидные ячейки = включены (дефолт),
 * поэтому частичный PATCH здесь означал бы тихое обнуление остальных настроек.
 * Неизвестные события и нереализованные каналы игнорируются; значения не boolean
 * отклоняются с 400 и перечисляются списком — иначе опечатка затирала бы настройки.
 */
/**
 * @openapi
 * /api/notifications/preferences:
 *   put:
 *     tags: [Notifications]
 *     summary: Replace notification preferences matrix
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Updated notification preferences }
 */
router.put('/api/notifications/preferences', auth, async (req, res) => {
  const input = req.body?.prefs !== undefined ? req.body.prefs : req.body
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return res.status(400).json({ message: 'prefs must be an object' })
  }
  try {
    const { prefs, invalid } = normalizePrefs(input)
    if (invalid.length > 0) {
      return res.status(400).json({ message: 'Values must be booleans', invalid })
    }
    await savePrefs(req.userId, prefs)
    res.json({ prefs, events: describeMatrix(), channels: CHANNELS })
  } catch (err) {
    logger.error('Notification prefs write error:', err)
    res.status(500).json({ message: 'Failed to save notification preferences' })
  }
})

/**
 * GET /api/notifications/quiet-hours
 * Тихие часы (DND): push не приходит в окне, in-app уведомления не гасятся.
 * Отдельный эндпоинт от матрицы: тишину хранят колонки, а не JSON prefs —
 * PUT матрицы её не затирает. Нет строки в БД = дефолт (тишина выключена).
 */
/**
 * @openapi
 * /api/notifications/quiet-hours:
 *   get:
 *     tags: [Notifications]
 *     summary: Get quiet hours (DND) settings for push
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Quiet hours settings }
 */
router.get('/api/notifications/quiet-hours', auth, async (req, res) => {
  try {
    const quiet = await getQuiet(req.userId)
    res.json({ quiet })
  } catch (err) {
    logger.error('Quiet hours read error:', err)
    res.status(500).json({ message: 'Failed to fetch quiet hours' })
  }
})

/**
 * PUT /api/notifications/quiet-hours
 * Полная замена настроек тишины. Непереданные поля = дефолт, невалидные
 * значения отклоняются 400 со списком полей — иначе опечатка в часах
 * молча выключала бы тишину пользователя.
 */
/**
 * @openapi
 * /api/notifications/quiet-hours:
 *   put:
 *     tags: [Notifications]
 *     summary: Replace quiet hours (DND) settings
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Updated quiet hours settings }
 */
router.put('/api/notifications/quiet-hours', auth, async (req, res) => {
  const input = req.body?.quiet !== undefined ? req.body.quiet : req.body
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return res.status(400).json({ message: 'quiet must be an object' })
  }
  try {
    const { quiet, invalid } = normalizeQuiet(input)
    if (invalid.length > 0) {
      return res.status(400).json({ message: 'Invalid quiet hours values', invalid })
    }
    await saveQuiet(req.userId, quiet)
    res.json({ quiet })
  } catch (err) {
    logger.error('Quiet hours write error:', err)
    res.status(500).json({ message: 'Failed to save quiet hours' })
  }
})

/**
 * GET /api/notifications
 * Список последних уведомлений текущего пользователя + счётчик непрочитанных.
 * payload (JSON) обогащается именами автора и встречи для отображения.
 */
/**
 * @openapi
 * /api/notifications:
 *   get:
 *     tags: [Notifications]
 *     summary: List recent notifications with unread count
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 30, minimum: 1, maximum: 100 }
 *         description: Page size
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0, minimum: 0 }
 *         description: Rows to skip
 *     responses:
 *       200: { description: Notification items and unread count }
 */
router.get('/api/notifications', auth, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 30, 1), 100)
    const offset = Math.max(parseInt(req.query.offset) || 0, 0)
    const [rows] = await pool.query(
      `SELECT n.id, n.type, n.payload, n.is_read, n.created_at,
              up.display_name AS actor_name,
              h.title AS hangout_title
       FROM notifications n
       LEFT JOIN user_profiles up
              ON up.id = CAST(JSON_UNQUOTE(JSON_EXTRACT(n.payload, '$.from_user_id')) AS UNSIGNED)
       LEFT JOIN hangouts h
              ON h.id = CAST(JSON_UNQUOTE(JSON_EXTRACT(n.payload, '$.hangout_id')) AS UNSIGNED)
       WHERE n.user_id = ? AND n.deleted_at IS NULL
       ORDER BY n.created_at DESC, n.id DESC
       LIMIT ? OFFSET ?`,
      [req.userId, limit, offset],
    )
    const [[{ unread }]] = await pool.query(
      'SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND is_read = 0 AND deleted_at IS NULL',
      [req.userId],
    )

    const items = rows.map((row) => ({
      ...row,
      payload: typeof row.payload === 'string' ? safeParse(row.payload) : row.payload || {},
    }))
    res.json({ items, unread })
  } catch (err) {
    logger.error('Notifications list error:', err)
    res.status(500).json({ message: 'Failed to fetch notifications' })
  }
})

function safeParse(value) {
  try { return JSON.parse(value) } catch { return {} }
}

/**
 * @openapi
 * /api/notifications/read-all:
 *   put:
 *     tags: [Notifications]
 *     summary: Mark all notifications as read
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: All notifications marked as read }
 */
router.put('/api/notifications/read-all', auth, async (req, res) => {
  try {
    await pool.query(
      'UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0 AND deleted_at IS NULL',
      [req.userId],
    )
    res.json({ message: 'All notifications marked as read' })
  } catch (err) {
    logger.error('Notifications read-all error:', err)
    res.status(500).json({ message: 'Failed to mark notifications' })
  }
})

/**
 * @openapi
 * /api/notifications/{id}/read:
 *   put:
 *     tags: [Notifications]
 *     summary: Mark a single notification as read
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Notification marked as read }
 */
router.put('/api/notifications/:id/read', auth, async (req, res) => {
  const { id } = req.params
  if (!/^\d+$/.test(id)) return res.status(400).json({ message: 'Invalid id' })
  try {
    const [result] = await pool.query(
      'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?',
      [id, req.userId],
    )
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Notification not found' })
    res.json({ message: 'Marked as read' })
  } catch (err) {
    logger.error('Notifications read error:', err)
    res.status(500).json({ message: 'Failed to mark notification' })
  }
})

export default wrapRouter(router)
