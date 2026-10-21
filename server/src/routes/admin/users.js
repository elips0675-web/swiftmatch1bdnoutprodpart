import { Router } from 'express'
import jwt from 'jsonwebtoken'
import pool from '../../db.js'
import logger from '../../logger.js'
import { softDelete, softDeleteWhere, auditLog } from '../../audit.js'
import { JWT_SECRET } from '../../middleware.js'
import { getIO } from '../../ws.js'
import { wrapRouter } from '../../async-handler.js'

const router = Router()

// План выводится и фильтруется одним и тем же выражением: разъезд между
// колонкой `premium` в SELECT и условием фильтра означал бы, что админ выбирает
// «Plus», а список не меняется (фильтр был в query, но не попадал в WHERE).
const TIER_SQL = `COALESCE((SELECT s.tier FROM subscriptions s WHERE s.user_id = u.id AND s.is_active = 1 AND s.expires_at > NOW() LIMIT 1), 'free')`

// Слияние дубликатов (P1 #11): переносим каждую FK-колонку на users из
// удаляемого аккаунта в оставшийся. UPDATE IGNORE съедает конфликты
// уникальных ключей (уже существующий мэтч/лайк/интерес/алиас оставляет
// строку на стоке — её уберёт CASCADE при удалении дубликата), а не
// выбрасывает 500 на дубликате ключа. admin-идентичности (campaigns.admin_id,
// moderation_log.admin_id) не переносятся: это действия админа, а не данные юзера.
const MERGE_TRANSFER = [
  ['activity_log', 'user_id'],
  ['analytics_events', 'user_id'],
  ['chat_participants', 'user_id'],
  ['chats', 'last_sender_id'],
  ['consent_log', 'user_id'],
  ['contest_entries', 'user_id'],
  ['data_erase_requests', 'user_id'],
  ['date_checkins', 'user_id'],
  ['date_schedules', 'proposer_id'],
  ['date_schedules', 'invitee_id'],
  ['emergency_contacts', 'user_id'],
  ['event_tickets', 'user_id'],
  ['experiment_assignments', 'user_id'],
  ['fcm_tokens', 'user_id'],
  ['group_members', 'user_id'],
  ['group_post_comments', 'user_id'],
  ['group_post_likes', 'user_id'],
  ['group_posts', 'user_id'],
  ['hangout_checkins', 'user_id'],
  ['hangout_likes', 'user_id'],
  ['hangout_participants', 'user_id'],
  ['hangout_responses', 'user_id'],
  ['hangout_reviews', 'reviewer_id'],
  ['hangout_reviews', 'reviewee_id'],
  ['hangout_tickets', 'user_id'],
  ['hangouts', 'user_id'],
  ['invites', 'from_user_id'],
  ['invites', 'to_user_id'],
  ['likes', 'from_user_id'],
  ['likes', 'to_user_id'],
  ['matches', 'user1_id'],
  ['matches', 'user2_id'],
  ['message_reactions', 'user_id'],
  ['messages', 'sender_id'],
  ['moderation_log', 'target_user_id'],
  ['notification_preferences', 'user_id'],
  ['notifications', 'user_id'],
  ['partner_orders', 'user_id'],
  ['poll_answers', 'user_id'],
  ['post_comments', 'user_id'],
  ['post_likes', 'user_id'],
  ['posts', 'user_id'],
  ['push_subscriptions', 'user_id'],
  ['reports', 'reporter_id'],
  ['reports', 'reported_id'],
  ['saved_filters', 'user_id'],
  ['sms_verification', 'user_id'],
  ['subscriptions', 'user_id'],
  ['user_aliases', 'user_id'],
  ['user_blocks', 'blocker_id'],
  ['user_blocks', 'blocked_id'],
  ['user_interests', 'user_id'],
  ['user_photos', 'user_id'],
  ['user_stories', 'user_id'],
  ['user_titles', 'user_id'],
  ['user_verifications', 'user_id'],
]

// Парные колонки: после переноса строка «оба участника = оставшийся» теряет
// смысл (мэтч с самим собой, лайк самому себе, жалоба на себя, блок себя).
const MERGE_PAIR_CLEANUP = [
  ['matches', 'user1_id', 'user2_id'],
  ['likes', 'from_user_id', 'to_user_id'],
  ['reports', 'reporter_id', 'reported_id'],
  ['user_blocks', 'blocker_id', 'blocked_id'],
  ['invites', 'from_user_id', 'to_user_id'],
  ['hangout_reviews', 'reviewer_id', 'reviewee_id'],
]

const DUPLICATES_SQL = `
  SELECT u.id, up.display_name as name, u.email, u.phone, up.city,
         DATE_FORMAT(u.created_at, '%Y-%m-%d') as joined,
         CASE WHEN u.is_active = 1 THEN 'active' ELSE 'banned' END as status,
         (SELECT COUNT(*) FROM matches m WHERE m.user1_id = u.id OR m.user2_id = u.id) as matchesCount,
         (SELECT COUNT(*) FROM messages msg WHERE msg.sender_id = u.id) as messagesCount,
         (SELECT COUNT(*) FROM subscriptions s WHERE s.user_id = u.id AND s.is_active = 1 AND s.expires_at > NOW()) as activeSubs,
         CASE WHEN u.phone IS NOT NULL AND u.phone != ''
              THEN CONCAT('phone:', REGEXP_REPLACE(u.phone, '[^0-9]', ''))
              ELSE CONCAT('email:', LOWER(TRIM(u.email))) END as dupKey
  FROM users u
  LEFT JOIN user_profiles up ON u.id = up.id
  WHERE u.deleted_at IS NULL
    AND (CASE WHEN u.phone IS NOT NULL AND u.phone != ''
              THEN CONCAT('phone:', REGEXP_REPLACE(u.phone, '[^0-9]', ''))
              ELSE CONCAT('email:', LOWER(TRIM(u.email))) END) IN (
      SELECT dupKey FROM (
        SELECT CASE WHEN u2.phone IS NOT NULL AND u2.phone != ''
                    THEN CONCAT('phone:', REGEXP_REPLACE(u2.phone, '[^0-9]', ''))
                    ELSE CONCAT('email:', LOWER(TRIM(u2.email))) END as dupKey
        FROM users u2
        WHERE u2.deleted_at IS NULL
      ) t GROUP BY dupKey HAVING COUNT(*) > 1
    )
  ORDER BY dupKey, u.id
`

// Мгновенный разлогин забаненного юзера: шлём WS-событие user:banned и, как
// страховку, обрываем его сокеты (клиент, который не обрабатывает событие,
// всё равно теряет соединение и поднимется заново — но auth вернёт USER_BANNED).
function notifyBanned(userId) {
  if (!userId) return
  const io = getIO()
  if (!io) return
  try {
    io.to(`user:${userId}`).emit('user:banned', { userId })
    setTimeout(() => io.in(`user:${userId}`).disconnectSockets(true), 100)
  } catch (err) {
    logger.error('notifyBanned WS error:', err)
  }
}

function notifyMerged(dupId, keepId) {
  const io = getIO()
  if (!io) return
  try {
    io.to(`user:${dupId}`).emit('user:merged', { mergedInto: keepId })
    setTimeout(() => io.in(`user:${dupId}`).disconnectSockets(true), 100)
  } catch (err) {
    logger.error('notifyMerged WS error:', err)
  }
}

/**
 * @openapi
 * /api/admin/users:
 *   get:
 *     tags: [Admin]
 *     summary: List users with filters and pagination
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Users list with total count }
 */
router.get('/users', async (req, res) => {
  try {
    const { search, status, city, premium, sort = 'joined', dir = 'desc', page = '1' } = req.query
    const pageSize = 15
    const offset = (Math.max(1, Number(page)) - 1) * pageSize

    let where = ['1=1']
    let params = []

    if (search) {
      where.push('(u.email LIKE ? OR up.display_name LIKE ? OR up.city LIKE ?)')
      params.push(`%${search}%`, `%${search}%`, `%${search}%`)
    }
    if (status && status !== 'all') {
      where.push('u.is_active = ?')
      params.push(status === 'active' ? 1 : 0)
    }
    if (city && city !== 'all') {
      where.push('up.city = ?')
      params.push(city)
    }
    if (premium && premium !== 'all') {
      where.push(`${TIER_SQL} = ?`)
      params.push(premium)
    }

    const allowedSort = { name: 'up.display_name', joined: 'u.created_at', age: 'up.age' }
    const sortCol = allowedSort[sort] || 'u.created_at'
    const sortDir = dir === 'asc' ? 'ASC' : 'DESC'

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM users u
       LEFT JOIN user_profiles up ON u.id = up.id
       WHERE ${where.join(' AND ')}`,
      params,
    )

    const [rows] = await pool.query(
      `SELECT u.id, up.display_name as name, up.age, u.email, up.city,
              CASE WHEN u.is_active = 1 THEN 'active' ELSE 'banned' END as status,
              ${TIER_SQL} as premium, false as online,
              DATE_FORMAT(u.created_at, '%Y-%m-%d') as joined,
              DATE_FORMAT(u.last_login, '%Y-%m-%d %H:%i') as lastActive,
              COALESCE(up.bio, '') as bio
       FROM users u
       LEFT JOIN user_profiles up ON u.id = up.id
       WHERE ${where.join(' AND ')}
       ORDER BY ${sortCol} ${sortDir}, u.id ${sortDir}
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    )

    const [[{ cities }]] = await pool.query(
      `SELECT COALESCE(
        (SELECT JSON_ARRAYAGG(city) FROM (SELECT DISTINCT city FROM user_profiles WHERE city IS NOT NULL AND city != '') t),
        '[]'
      ) as cities`,
    )

    res.json({ users: rows, total, cities: JSON.parse(cities || '[]') })
  } catch (err) {
    logger.error('Users list error:', err)
    res.status(500).json({ message: 'Failed to fetch users' })
  }
})

/**
 * @openapi
 * /api/admin/users/duplicates:
 *   get:
 *     tags: [Admin]
 *     summary: Find duplicate profiles by normalized phone or email
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Groups of users sharing phone or email }
 *       500: { description: Failed to fetch duplicates }
 */
router.get('/users/duplicates', async (req, res) => {
  try {
    const [rows] = await pool.query(DUPLICATES_SQL)
    const byKey = new Map()
    for (const row of rows) {
      const key = row.dupKey
      if (!byKey.has(key)) byKey.set(key, [])
      byKey.get(key).push({
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        city: row.city,
        joined: row.joined,
        status: row.status,
        matchesCount: row.matchesCount,
        messagesCount: row.messagesCount,
        activeSubs: row.activeSubs,
      })
    }
    const groups = [...byKey.entries()]
      .filter(([, users]) => users.length > 1)
      .map(([key, users]) => ({ key, kind: key.startsWith('phone:') ? 'phone' : 'email', users }))
    res.json({ groups })
  } catch (err) {
    logger.error('Duplicates error:', err)
    res.status(500).json({ message: 'Failed to fetch duplicates' })
  }
})

/**
 * @openapi
 * /api/admin/users/{id}:
 *   get:
 *     tags: [Admin]
 *     summary: Get user by id
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: User details }
 */
router.get('/users/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, up.display_name as name, up.age, u.email, up.city,
              CASE WHEN u.is_active = 1 THEN 'active' ELSE 'banned' END as status,
              COALESCE((SELECT s.tier FROM subscriptions s WHERE s.user_id = u.id AND s.is_active = 1 AND s.expires_at > NOW() LIMIT 1), 'free') as premium, up.bio,
              DATE_FORMAT(u.created_at, '%Y-%m-%d') as joined,
              DATE_FORMAT(u.last_login, '%Y-%m-%d %H:%i') as lastActive,
              (SELECT COUNT(*) FROM matches WHERE user1_id = u.id OR user2_id = u.id) as matchesCount,
              (SELECT COUNT(*) FROM reports WHERE reported_id = u.id) as reportsCount
       FROM users u
       LEFT JOIN user_profiles up ON u.id = up.id
       WHERE u.id = ?`,
      [req.params.id],
    )
    if (rows.length === 0) {
      return res.status(404).json({ message: 'User not found' })
    }
    res.json(rows[0])
  } catch (err) {
    logger.error('User detail error:', err)
    res.status(500).json({ message: 'Failed to fetch user' })
  }
})

/**
 * @openapi
 * /api/admin/users/{id}/ban:
 *   post:
 *     tags: [Admin]
 *     summary: Ban user by id
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: User banned }
 */
router.post('/users/:id/ban', async (req, res) => {
  try {
    await pool.query('UPDATE users SET is_active = 0 WHERE id = ?', [req.params.id])
    await pool.query(
      'INSERT INTO moderation_log (admin_id, target_user_id, action, reason) VALUES (?, ?, ?, ?)',
      [req.admin.id, req.params.id, 'ban', req.body.reason || 'No reason'],
    )
    notifyBanned(Number(req.params.id))
    res.json({ message: 'User banned' })
  } catch (err) {
    logger.error('Ban error:', err)
    res.status(500).json({ message: 'Failed to ban user' })
  }
})

/**
 * @openapi
 * /api/admin/users/{id}/unban:
 *   post:
 *     tags: [Admin]
 *     summary: Unban user by id
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: User unbanned }
 */
router.post('/users/:id/unban', async (req, res) => {
  try {
    await pool.query('UPDATE users SET is_active = 1 WHERE id = ?', [req.params.id])
    res.json({ message: 'User unbanned' })
  } catch (err) {
    logger.error('Unban error:', err)
    res.status(500).json({ message: 'Failed to unban user' })
  }
})

/**
 * @openapi
 * /api/admin/users/{id}:
 *   delete:
 *     tags: [Admin]
 *     summary: Soft delete user by id
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: User deleted }
 */
router.delete('/users/:id', async (req, res) => {
  try {
    await softDelete('users', req.params.id, req.admin?.id, req.ip)
    await pool.query('UPDATE users SET is_active = 0 WHERE id = ?', [req.params.id])
    res.json({ message: 'User deleted' })
  } catch (err) {
    logger.error('Delete error:', err)
    res.status(500).json({ message: 'Failed to delete user' })
  }
})

/**
 * @openapi
 * /api/admin/users/{id}/merge:
 *   post:
 *     tags: [Admin]
 *     summary: Merge duplicate profile into the kept user
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         description: duplicate user id to merge from (victim)
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               keepId:
 *                 type: integer
 *                 description: user id that stays after the merge (survivor)
 *             required: [keepId]
 *     responses:
 *       200: { description: Users merged }
 *       400: { description: Invalid ids or victim is an admin }
 *       404: { description: User not found }
 *       500: { description: Failed to merge users }
 */
router.post('/users/:id/merge', async (req, res) => {
  const dupId = Number(req.params.id)
  const keepId = Number(req.body.keepId)
  if (!Number.isInteger(dupId) || dupId <= 0 || !Number.isInteger(keepId) || keepId <= 0 || dupId === keepId) {
    return res.status(400).json({ message: 'Invalid merge ids' })
  }
  let conn
  try {
    const [dupRows] = await pool.query('SELECT id, role FROM users WHERE id = ? AND deleted_at IS NULL', [dupId])
    if (dupRows.length === 0) {
      return res.status(404).json({ message: 'User not found' })
    }
    if (dupRows[0].role === 'admin') {
      return res.status(400).json({ message: 'Cannot merge an admin account' })
    }
    const [keepRows] = await pool.query('SELECT id, role FROM users WHERE id = ? AND deleted_at IS NULL', [keepId])
    if (keepRows.length === 0) {
      return res.status(404).json({ message: 'User not found' })
    }

    conn = await pool.getConnection()
    await conn.beginTransaction()
    try {
      for (const [table, column] of MERGE_TRANSFER) {
        await conn.query(`UPDATE IGNORE \`${table}\` SET \`${column}\` = ? WHERE \`${column}\` = ?`, [keepId, dupId])
      }
      for (const [table, colA, colB] of MERGE_PAIR_CLEANUP) {
        await conn.query(`DELETE FROM \`${table}\` WHERE \`${colA}\` = ? AND \`${colB}\` = ?`, [keepId, keepId])
      }

      await conn.query(
        `INSERT INTO user_profiles (id, display_name, name, age, birth_date, bio, avatar_url, gender, looking_for,
          dating_goal, height, city, country, lat, lng, last_location_update, location, zodiac, circadian,
          attachment_style, education, super_likes, boost_until, incognito, passport_mode, photo_verified,
          passport_city, passport_lat, passport_lng, online, last_seen, created_at, updated_at, deleted_at,
          profile_score, profile_score_updated_at)
         SELECT ?, display_name, name, age, birth_date, bio, avatar_url, gender, looking_for,
          dating_goal, height, city, country, lat, lng, last_location_update, location, zodiac, circadian,
          attachment_style, education, super_likes, boost_until, incognito, passport_mode, photo_verified,
          passport_city, passport_lat, passport_lng, online, last_seen, created_at, updated_at, deleted_at,
          profile_score, profile_score_updated_at
         FROM user_profiles
         WHERE id = ?
           AND NOT EXISTS (SELECT 1 FROM user_profiles WHERE id = ?)
           AND age BETWEEN 16 AND 120
           AND (height IS NULL OR height BETWEEN 100 AND 250)`,
        [keepId, dupId, keepId],
      )
      await conn.query('UPDATE users SET referred_by = NULL WHERE referred_by = ?', [dupId])
      await conn.query(
        'INSERT INTO audit_log (table_name, record_id, action, old_values, new_values, user_id, ip_address) VALUES (?, ?, ?, NULL, ?, ?, ?)',
        ['users', dupId, 'merge', JSON.stringify({ mergedInto: keepId }), req.admin?.id ?? null, req.ip ?? null],
      )
      await conn.query('DELETE FROM users WHERE id = ?', [dupId])
      await conn.commit()
    } catch (err) {
      await conn.rollback()
      throw err
    } finally {
      conn.release()
    }
    notifyMerged(dupId, keepId)
    res.json({ message: 'Users merged', mergedFrom: dupId, mergedInto: keepId })
  } catch (err) {
    logger.error('Merge error:', err)
    res.status(500).json({ message: 'Failed to merge users' })
  }
})

/**
 * @openapi
 * /api/admin/users/bulk:
 *   post:
 *     tags: [Admin]
 *     summary: Perform bulk action on users
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Bulk action completed }
 */
router.post('/users/bulk', async (req, res) => {
  const { ids, action } = req.body
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ message: 'No user IDs provided' })
  }
  try {
    if (action === 'delete') {
      await softDeleteWhere('users', `id IN (?)`, [ids], req.admin?.id, req.ip)
      await pool.query(`UPDATE users SET is_active = 0 WHERE id IN (?)`, [ids])
      ids.forEach(notifyBanned)
    } else if (action === 'ban') {
      await pool.query(`UPDATE users SET is_active = 0 WHERE id IN (?)`, [ids])
      ids.forEach(notifyBanned)
    } else if (action === 'suspend') {
      await pool.query(`UPDATE users SET is_active = 0 WHERE id IN (?)`, [ids])
      ids.forEach(notifyBanned)
    }
    res.json({ message: `Bulk ${action} completed` })
  } catch (err) {
    logger.error('Bulk action error:', err)
    res.status(500).json({ message: 'Failed to perform bulk action' })
  }
})

const IMPERSONATION_TTL_SECONDS = 3600

/**
 * @openapi
 * /api/admin/impersonate/{userId}:
 *   post:
 *     tags: [Admin]
 *     summary: Impersonate a user by id
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Impersonation token }
 */
router.post('/impersonate/:userId', async (req, res) => {
  const targetId = Number(req.params.userId)
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return res.status(400).json({ message: 'Invalid user id' })
  }
  try {
    const [rows] = await pool.query(
      'SELECT id, email FROM users WHERE id = ? AND is_active = 1 AND deleted_at IS NULL',
      [targetId],
    )
    if (rows.length === 0) {
      return res.status(404).json({ message: 'User not found' })
    }
    const adminId = req.admin?.id ?? null
    const token = jwt.sign(
      { userId: targetId, role: 'user', impersonatedBy: adminId },
      JWT_SECRET(),
      { expiresIn: '1h' },
    )
    await auditLog({
      tableName: 'users',
      recordId: targetId,
      action: 'impersonate',
      newValues: { impersonatedBy: adminId },
      userId: adminId,
      ipAddress: req.ip,
    })
    res.json({
      token,
      expiresIn: IMPERSONATION_TTL_SECONDS,
      user: { id: rows[0].id, email: rows[0].email },
    })
  } catch (err) {
    logger.error('Impersonate error:', err)
    res.status(500).json({ message: 'Failed to impersonate' })
  }
})

export default wrapRouter(router)
