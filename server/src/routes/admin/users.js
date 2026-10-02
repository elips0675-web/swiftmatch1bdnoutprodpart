import { Router } from 'express'
import pool from '../../db.js'
import logger from '../../logger.js'
import { softDelete, softDeleteWhere } from '../../audit.js'
import { getIO } from '../../ws.js'

const router = Router()

// План выводится и фильтруется одним и тем же выражением: разъезд между
// колонкой `premium` в SELECT и условием фильтра означал бы, что админ выбирает
// «Plus», а список не меняется (фильтр был в query, но не попадал в WHERE).
const TIER_SQL = `COALESCE((SELECT s.tier FROM subscriptions s WHERE s.user_id = u.id AND s.is_active = 1 AND s.expires_at > NOW() LIMIT 1), 'free')`

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

router.post('/users/:id/unban', async (req, res) => {
  try {
    await pool.query('UPDATE users SET is_active = 1 WHERE id = ?', [req.params.id])
    res.json({ message: 'User unbanned' })
  } catch (err) {
    logger.error('Unban error:', err)
    res.status(500).json({ message: 'Failed to unban user' })
  }
})

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

export default router
