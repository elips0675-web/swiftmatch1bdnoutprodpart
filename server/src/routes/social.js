import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { getRateLimitStore } from '../middleware/limiters.js'
import pool from '../db.js'
import { getIO } from '../ws.js'
import { getBannedWords, containsBannedWord } from '../banned-words.js'
import { sendPushToUser } from './push.js'
import { auth } from '../middleware.js'
import logger from '../logger.js'
import { stripHtml } from '../sanitize.js'
import { cacheRoutePerUser, invalidate } from '../cache.js'
import { trackEvent } from './experiments.js'

const likeLimiter = rateLimit({ store: getRateLimitStore(), windowMs: 60_000, max: 30, message: { message: 'Too many likes' } })

/**
 * @openapi
 * /api/chats:
 *   get:
 *     tags: [Chats]
 *     summary: Get chat list with unread counts
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Chat list
 *
 * /api/chats/{chatId}/read:
 *   put:
 *     tags: [Chats]
 *     summary: Mark chat as read
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: chatId
 *         required: true
 *         schema: { type: integer }
 *
 * /api/chats/{chatId}/messages:
 *   get:
 *     tags: [Chats]
 *     summary: Get messages with reactions
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: chatId
 *         required: true
 *         schema: { type: integer }
 *
 * /api/chats/{chatId}/messages/{msgId}/reactions:
 *   post:
 *     tags: [Chats]
 *     summary: Toggle emoji reaction on a message
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: chatId
 *         required: true
 *         schema: { type: integer }
 *       - in: path
 *         name: msgId
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [emoji]
 *             properties:
 *               emoji: { type: string }
 *
 * /api/likes:
 *   post:
 *     tags: [Social]
 *     summary: Like a user
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [liked_user_id]
 *             properties:
 *               liked_user_id: { type: integer }
 */

const router = Router()

// ─── Search / Discovery ────────────────────────────────────────
router.get('/api/users/search', auth, async (req, res) => {
  const { gender, looking_for, age_min, age_max, city, interest, lat, lng, radius } = req.query
  try {
    const [[self]] = await pool.query(
      'SELECT attachment_style, lat, lng, age, passport_mode, passport_city, passport_lat, passport_lng FROM user_profiles WHERE id = ?',
      [req.userId],
    )
    const userStyle = self?.attachment_style

    let compJoin = ''
    let compSelect = ''
    let orderBy = 'up.online DESC, up.last_seen DESC'
    if (userStyle) {
      compJoin = ` LEFT JOIN compatibility_scores cs ON cs.style_a = ? AND cs.style_b = up.attachment_style`
      compSelect = ', COALESCE(cs.score, 0) AS compatibility_score'
      orderBy = 'COALESCE(cs.score, 0) DESC, up.online DESC, up.last_seen DESC'
    }

    const baseSelect = `up.id, up.display_name, up.name, up.age, up.gender, up.city, up.country, up.avatar_url, up.online, up.last_seen, up.dating_goal${compSelect}`

    const userPassportMode = self?.passport_mode
    const userPassportLat = userPassportMode ? self?.passport_lat : null
    const userPassportLng = userPassportMode ? self?.passport_lng : null
    const searchLat = lat || userPassportLat || self?.lat
    const searchLng = lng || userPassportLng || self?.lng
    const searchRadius = radius || 50
    const hasGeo = searchLat && searchLng
    let distanceExpr = ''
    let having = ''
    const geoParams = []
    if (hasGeo) {
      const userLat = parseFloat(searchLat)
      const userLng = parseFloat(searchLng)
      if (!isNaN(userLat) && !isNaN(userLng)) {
        distanceExpr = `, ROUND(ST_Distance_Sphere(up.location, ST_SRID(POINT(?, ?), 4326)), 1) AS distance`
        having = ' HAVING distance < ?'
        geoParams.push(userLng, userLat, Number(searchRadius) * 1000)
      }
    }

    const blockParams = [req.userId, req.userId]
    const blockJoin = ' LEFT JOIN user_blocks bl ON (bl.blocker_id = ? AND bl.blocked_id = up.id) OR (bl.blocker_id = up.id AND bl.blocked_id = ?)'
    const blockWhere = ' AND bl.blocker_id IS NULL'

    const whereClauses = ['up.id != ?', 'up.deleted_at IS NULL', 'up.incognito = 0']
    const whereParams = [req.userId]

    if (interest) {
      whereClauses.push('(i.name_ru = ? OR i.name_en = ?)')
      whereParams.push(interest, interest)
    }

    if (gender) { whereClauses.push('up.gender = ?'); whereParams.push(gender) }
    if (looking_for) { whereClauses.push('up.looking_for = ?'); whereParams.push(looking_for) }
    if (age_min) { whereClauses.push('up.age >= ?'); whereParams.push(Number(age_min)) }
    if (age_max) { whereClauses.push('up.age <= ?'); whereParams.push(Number(age_max)) }
    if (city) { whereClauses.push('up.city = ?'); whereParams.push(city) }

    const fromClause = interest
      ? `FROM user_profiles up
         JOIN user_interests ui ON ui.user_id = up.id
         JOIN interests i ON i.id = ui.interest_id`
      : 'FROM user_profiles up'

    const params = []
    if (hasGeo) params.push(geoParams[0], geoParams[1])
    if (userStyle) params.push(userStyle)
    params.push(...blockParams)
    params.push(...whereParams)
    if (hasGeo) params.push(geoParams[2])

    const sql = `SELECT ${baseSelect}${distanceExpr}
                 ${fromClause}
                 ${compJoin}
                 ${blockJoin}
                 WHERE ${whereClauses.join(' AND ')}${blockWhere}
                 ${having}
                 ORDER BY ${orderBy} LIMIT 50`

    const [rows] = await pool.query(sql, params)
    res.json(rows)
  } catch (err) {
    logger.error('Search error:', err)
    res.status(500).json({ message: 'Search failed' })
  }
})

const DAILY_LIKE_LIMIT = 10

// ─── Likes ─────────────────────────────────────────────────────
router.post('/api/likes', auth, likeLimiter, async (req, res) => {
  const { liked_user_id, type } = req.body
  if (!liked_user_id) return res.status(400).json({ message: 'liked_user_id is required' })

  try {
    const [subRows] = await pool.query(
      "SELECT id FROM subscriptions WHERE user_id = ? AND is_active = 1 AND expires_at > NOW() LIMIT 1",
      [req.userId],
    )
    if (subRows.length === 0) {
      const [[{ cnt }]] = await pool.query(
        "SELECT COUNT(*) AS cnt FROM likes WHERE from_user_id = ? AND DATE(created_at) = CURDATE()",
        [req.userId],
      )
      if (cnt >= DAILY_LIKE_LIMIT) {
        return res.status(403).json({ message: 'Daily like limit reached. Get premium for unlimited likes.', code: 'LIKE_LIMIT' })
      }
    }

    const likeType = type === 'super_like' ? 'super_like' : 'like'
    await pool.query(
      'INSERT IGNORE INTO likes (from_user_id, to_user_id, type) VALUES (?, ?, ?)',
      [req.userId, liked_user_id, likeType],
    )

    const [reciprocal] = await pool.query(
      'SELECT id FROM likes WHERE from_user_id = ? AND to_user_id = ?',
      [liked_user_id, req.userId],
    )

    let matched = false
    if (reciprocal.length > 0) {
      const [existing] = await pool.query(
        'SELECT id FROM matches WHERE (user1_id = ? AND user2_id = ?) OR (user1_id = ? AND user2_id = ?)',
        [req.userId, liked_user_id, liked_user_id, req.userId],
      )
      if (existing.length === 0) {
        await pool.query(
          'INSERT INTO matches (user1_id, user2_id, matched) VALUES (?, ?, 1)',
          [Math.min(req.userId, liked_user_id), Math.max(req.userId, liked_user_id)],
        )
      }
      matched = true
      invalidate(`user:${req.userId}:/api/matches*`).catch(() => {})
      invalidate(`user:${liked_user_id}:/api/matches*`).catch(() => {})
    }

    const [notifResult] = await pool.query(
      'INSERT INTO notifications (user_id, type, payload) VALUES (?, ?, ?)',
      [liked_user_id, 'like', JSON.stringify({ from_user_id: req.userId, type: likeType })],
    )
    const io = getIO()
    if (io) {
      const [[notif]] = await pool.query('SELECT id, type, payload, created_at FROM notifications WHERE id = ?', [notifResult.insertId])
      io.to(`user:${liked_user_id}`).emit('notification:new', notif)
    }

    const [[liker]] = await pool.query('SELECT display_name FROM user_profiles WHERE id = ?', [req.userId])
    sendPushToUser(liked_user_id, 'SwiftMatch', matched
      ? `It\'s a match with ${liker?.display_name || 'someone'}!`
      : `${liker?.display_name || 'Someone'} liked you!`)
    trackEvent(likeType, req.userId, { target_user_id: liked_user_id, matched })

    res.status(201).json({ message: matched ? 'It\'s a match!' : 'Like sent', matched })
  } catch (err) {
    logger.error('Like error:', err)
    res.status(500).json({ message: 'Failed to send like' })
  }
})

// ─── Matches ───────────────────────────────────────────────────
router.get('/api/matches', auth, cacheRoutePerUser(30), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT m.id, m.created_at as matched_at, up.id as user_id, up.display_name, up.name, up.age, up.avatar_url, up.city, up.online
       FROM matches m
       JOIN user_profiles up ON up.id = CASE WHEN m.user1_id = ? THEN m.user2_id ELSE m.user1_id END
       WHERE m.matched = 1 AND (m.user1_id = ? OR m.user2_id = ?)
       ORDER BY m.created_at DESC`,
      [req.userId, req.userId, req.userId],
    )
    res.json(rows)
  } catch (err) {
    logger.error('Matches error:', err)
    res.status(500).json({ message: 'Failed to fetch matches' })
  }
})

// ─── Invites ───────────────────────────────────────────────────
const INVITE_TYPES = ['coffee', 'cinema', 'walk', 'dinner', 'other']

router.post('/api/invites', auth, async (req, res) => {
  const { invitee_id, type, message } = req.body
  if (!invitee_id || !type) return res.status(400).json({ message: 'invitee_id and type are required' })
  if (!INVITE_TYPES.includes(type)) return res.status(400).json({ message: 'Invalid invite type' })

  try {
    await pool.query(
      'INSERT INTO invites (from_user_id, to_user_id, invite_type, message, status) VALUES (?, ?, ?, ?, ?)',
      [req.userId, invitee_id, type, message ? String(message).slice(0, 500) : null, 'pending'],
    )

    const [notifResult] = await pool.query(
      'INSERT INTO notifications (user_id, type, payload) VALUES (?, ?, ?)',
      [invitee_id, 'invite', JSON.stringify({ from_user_id: req.userId, type })],
    )
    const io = getIO()
    if (io) {
      const [[notif]] = await pool.query('SELECT id, type, payload, created_at FROM notifications WHERE id = ?', [notifResult.insertId])
      io.to(`user:${invitee_id}`).emit('notification:new', notif)
    }

    res.status(201).json({ message: 'Invite sent' })
  } catch (err) {
    logger.error('Invite error:', err)
    res.status(500).json({ message: 'Failed to send invite' })
  }
})

router.get('/api/invites', auth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT i.id, i.invite_type as type, i.message, i.status, i.created_at,
              i.from_user_id as sender_id, up.display_name as sender_name, up.avatar_url as sender_avatar
       FROM invites i
       JOIN user_profiles up ON i.from_user_id = up.id
       WHERE i.to_user_id = ?
       ORDER BY i.created_at DESC`,
      [req.userId],
    )
    res.json(rows)
  } catch (err) {
    logger.error('Invites fetch error:', err)
    res.status(500).json({ message: 'Failed to fetch invites' })
  }
})

router.put('/api/invites/:id/status', auth, async (req, res) => {
  const { status } = req.body
  if (!['accepted', 'declined', 'cancelled'].includes(status)) return res.status(400).json({ message: 'Invalid status' })

  try {
    await pool.query(
      'UPDATE invites SET status = ? WHERE id = ? AND to_user_id = ?',
      [status, req.params.id, req.userId],
    )
    res.json({ message: `Invite ${status}` })
  } catch (err) {
    logger.error('Invite status error:', err)
    res.status(500).json({ message: 'Failed to update invite' })
  }
})

// ─── Groups ────────────────────────────────────────────────────
router.get('/api/groups/:groupId', auth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT g.id, g.name_ru, g.name_en, g.description, g.img, g.members_count, g.online_count, g.href
       FROM chat_groups g
       WHERE g.id = ?`,
      [req.params.groupId],
    )
    if (rows.length === 0) return res.status(404).json({ message: 'Group not found' })
    res.json(rows[0])
  } catch (err) {
    logger.error('Group fetch error:', err)
    res.status(500).json({ message: 'Failed to fetch group' })
  }
})

router.get('/api/groups/:groupId/chat', auth, async (req, res) => {
  try {
    const [existing] = await pool.query(
      'SELECT id FROM chats WHERE group_id = ? AND is_group = 1 LIMIT 1',
      [req.params.groupId],
    )
    if (existing.length > 0) {
      const [participant] = await pool.query(
        'SELECT chat_id FROM chat_participants WHERE chat_id = ? AND user_id = ?',
        [existing[0].id, req.userId],
      )
      if (participant.length === 0) {
        await pool.query(
          'INSERT INTO chat_participants (chat_id, user_id) VALUES (?, ?)',
          [existing[0].id, req.userId],
        )
      }
      return res.json({ id: existing[0].id, isGroup: true })
    }

    const [result] = await pool.query(
      'INSERT INTO chats (is_group, group_id, last_message) VALUES (1, ?, ?)',
      [req.params.groupId, ''],
    )
    const chatId = result.insertId

    const [members] = await pool.query(
      'SELECT user_id FROM group_members WHERE group_id = ?',
      [req.params.groupId],
    )
    for (const m of members) {
      await pool.query(
        'INSERT INTO chat_participants (chat_id, user_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE chat_id = chat_id',
        [chatId, m.user_id],
      )
    }

    res.json({ id: chatId, isGroup: true })
  } catch (err) {
    logger.error('Group chat error:', err)
    res.status(500).json({ message: 'Failed to get group chat' })
  }
})

// ─── Group Posts ───────────────────────────────────────────────
router.get('/api/groups/:groupId/posts', auth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT gp.id, gp.group_id, gp.user_id, gp.text, gp.images, gp.created_at, gp.updated_at,
              up.display_name, up.avatar_url,
              (SELECT COUNT(*) FROM group_post_likes WHERE post_id = gp.id) AS likes_count,
              EXISTS(SELECT 1 FROM group_post_likes WHERE post_id = gp.id AND user_id = ?) AS liked_by_me
       FROM group_posts gp
       JOIN user_profiles up ON up.id = gp.user_id
       WHERE gp.group_id = ?
       ORDER BY gp.created_at DESC
       LIMIT 50`,
      [req.userId, req.params.groupId],
    )
    const posts = []
    for (const row of rows) {
      const [comments] = await pool.query(
        `SELECT gpc.id, gpc.post_id, gpc.user_id, gpc.text, gpc.image_url, gpc.created_at,
                up.display_name, up.avatar_url
         FROM group_post_comments gpc
         JOIN user_profiles up ON up.id = gpc.user_id
         WHERE gpc.post_id = ?
         ORDER BY gpc.created_at ASC
         LIMIT 20`,
        [row.id],
      )
      posts.push({
        id: row.id,
        groupId: row.group_id,
        userId: row.user_id,
        text: row.text,
        images: Array.isArray(row.images) ? row.images : (row.images ? JSON.parse(row.images) : []),
        likes: row.likes_count,
        likedByMe: !!row.liked_by_me,
        comments: comments.map(c => ({
          id: c.id, postId: c.post_id, userId: c.user_id,
          text: c.text, imageUrl: c.image_url, createdAt: c.created_at,
          author: c.display_name, avatar: c.avatar_url,
        })),
        createdAt: row.created_at,
        author: row.display_name,
        avatar: row.avatar_url,
      })
    }
    res.json(posts)
  } catch (err) {
    logger.error('Group posts error:', err)
    res.status(500).json({ message: 'Failed to fetch posts' })
  }
})

router.post('/api/groups/:groupId/posts', auth, async (req, res) => {
  const { text, images } = req.body
  if (!text && (!images || images.length === 0)) {
    return res.status(400).json({ message: 'Text or images required' })
  }
  try {
    const [result] = await pool.query(
      'INSERT INTO group_posts (group_id, user_id, text, images) VALUES (?, ?, ?, ?)',
      [req.params.groupId, req.userId, stripHtml(text) || null, JSON.stringify(images || [])],
    )
    const [[post]] = await pool.query(
      `SELECT gp.id, gp.group_id, gp.user_id, gp.text, gp.images, gp.created_at,
              up.display_name, up.avatar_url
       FROM group_posts gp
       JOIN user_profiles up ON up.id = gp.user_id
       WHERE gp.id = ?`,
      [result.insertId],
    )
    res.status(201).json({
      id: post.id, groupId: post.group_id, userId: post.user_id,
      text: post.text, images: Array.isArray(post.images) ? post.images : (post.images ? JSON.parse(post.images) : []),
      likes: 0, likedByMe: false, comments: [],
      createdAt: post.created_at, author: post.display_name, avatar: post.avatar_url,
    })
  } catch (err) {
    logger.error('Group post create error:', err)
    res.status(500).json({ message: 'Failed to create post' })
  }
})

router.post('/api/groups/:groupId/posts/:postId/like', auth, async (req, res) => {
  try {
    const [existing] = await pool.query(
      'SELECT id FROM group_post_likes WHERE post_id = ? AND user_id = ?',
      [req.params.postId, req.userId],
    )
    if (existing.length > 0) {
      await pool.query('DELETE FROM group_post_likes WHERE id = ?', [existing[0].id])
      return res.json({ liked: false })
    }
    await pool.query('INSERT INTO group_post_likes (post_id, user_id) VALUES (?, ?)', [req.params.postId, req.userId])
    res.json({ liked: true })
  } catch (err) {
    logger.error('Group post like error:', err)
    res.status(500).json({ message: 'Failed to toggle like' })
  }
})

router.post('/api/groups/:groupId/posts/:postId/comments', auth, async (req, res) => {
  const { text, image_url } = req.body
  if (!text && !image_url) return res.status(400).json({ message: 'Text or image required' })
  try {
    const [result] = await pool.query(
      'INSERT INTO group_post_comments (post_id, user_id, text, image_url) VALUES (?, ?, ?, ?)',
      [req.params.postId, req.userId, text || null, image_url || null],
    )
    const [[comment]] = await pool.query(
      `SELECT gpc.id, gpc.post_id, gpc.user_id, gpc.text, gpc.image_url, gpc.created_at,
              up.display_name, up.avatar_url
       FROM group_post_comments gpc
       JOIN user_profiles up ON up.id = gpc.user_id
       WHERE gpc.id = ?`,
      [result.insertId],
    )
    res.status(201).json({
      id: comment.id, postId: comment.post_id, userId: comment.user_id,
      text: comment.text, imageUrl: comment.image_url, createdAt: comment.created_at,
      author: comment.display_name, avatar: comment.avatar_url,
    })
  } catch (err) {
    logger.error('Group post comment error:', err)
    res.status(500).json({ message: 'Failed to add comment' })
  }
})

// ─── Chats ─────────────────────────────────────────────────────
router.get('/api/chats', auth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT c.id, c.last_message, c.last_sender_id, c.updated_at,
              up.display_name, up.avatar_url, up.online, other.user_id AS other_user_id,
              cp.last_read_at,
              (SELECT COUNT(*) FROM messages m2 WHERE m2.chat_id = c.id AND (cp.last_read_at IS NULL OR m2.created_at > cp.last_read_at) AND m2.sender_id != ?) AS unread_count
       FROM chats c
       JOIN chat_participants cp ON cp.chat_id = c.id AND cp.user_id = ?
       JOIN chat_participants other ON other.chat_id = c.id AND other.user_id != ?
       JOIN user_profiles up ON up.id = other.user_id
       WHERE c.is_group = 0
       ORDER BY c.updated_at DESC`,
      [req.userId, req.userId, req.userId],
    )
    res.json(rows)
  } catch (err) {
    logger.error('Chats error:', err)
    res.status(500).json({ message: 'Failed to fetch chats' })
  }
})

router.get('/api/chats/:chatId', auth, async (req, res) => {
  try {
    const [[row]] = await pool.query(
      `SELECT c.id,
              up.id AS user_id,
              up.display_name AS name,
              up.avatar_url AS avatar,
              up.online
       FROM chats c
       JOIN chat_participants cp ON cp.chat_id = c.id AND cp.user_id = ?
       JOIN chat_participants other ON other.chat_id = c.id AND other.user_id != ?
       JOIN user_profiles up ON up.id = other.user_id
       WHERE c.id = ?
       LIMIT 1`,
      [req.userId, req.userId, req.params.chatId],
    )
    if (!row) return res.status(404).json({ message: 'Chat not found or not a participant' })
    res.json(row)
  } catch (err) {
    logger.error('Chat detail error:', err)
    res.status(500).json({ message: 'Failed to fetch chat' })
  }
})

router.put('/api/chats/:chatId/read', auth, async (req, res) => {  try {
    await pool.query(
      'UPDATE chat_participants SET last_read_at = NOW() WHERE chat_id = ? AND user_id = ?',
      [req.params.chatId, req.userId],
    )
    res.json({ message: 'Chat marked as read' })
  } catch (err) {
    logger.error('Chat read error:', err)
    res.status(500).json({ message: 'Failed to mark chat as read' })
  }
})

router.post('/api/chats', auth, async (req, res) => {
  const { participant_id } = req.body
  if (!participant_id) return res.status(400).json({ message: 'participant_id is required' })

  try {
    const [existing] = await pool.query(
      `SELECT c.id FROM chats c
       JOIN chat_participants cp1 ON cp1.chat_id = c.id AND cp1.user_id = ?
       JOIN chat_participants cp2 ON cp2.chat_id = c.id AND cp2.user_id = ?
       WHERE c.is_group = 0
       LIMIT 1`,
      [req.userId, participant_id],
    )
    if (existing.length > 0) return res.json({ id: existing[0].id, existing: true })

    const [result] = await pool.query('INSERT INTO chats (is_group) VALUES (0)')
    const chatId = result.insertId
    await pool.query('INSERT INTO chat_participants (chat_id, user_id) VALUES (?, ?), (?, ?)', [chatId, req.userId, chatId, participant_id])
    res.status(201).json({ id: chatId, existing: false })
  } catch (err) {
    logger.error('Chat create error:', err)
    res.status(500).json({ message: 'Failed to create chat' })
  }
})

router.get('/api/chats/:chatId/messages', auth, async (req, res) => {
  try {
    const [participant] = await pool.query(
      'SELECT chat_id FROM chat_participants WHERE chat_id = ? AND user_id = ?',
      [req.params.chatId, req.userId],
    )
    if (participant.length === 0) return res.status(403).json({ message: 'Not a participant' })

    const [rows] = await pool.query(
      `SELECT m.id, m.sender_id, m.text, m.image_url, m.reply_to, m.ttl_seconds, m.created_at,
              up.display_name as sender_name
       FROM messages m
       JOIN user_profiles up ON m.sender_id = up.id
       WHERE m.chat_id = ?
         AND (m.ttl_seconds IS NULL OR m.created_at > DATE_SUB(NOW(), INTERVAL m.ttl_seconds SECOND))
       ORDER BY m.created_at ASC
       LIMIT 100`,
      [req.params.chatId],
    )

    const [[otherParticipant]] = await pool.query(
      'SELECT user_id, last_read_at FROM chat_participants WHERE chat_id = ? AND user_id != ?',
      [req.params.chatId, req.userId],
    )

    const msgIds = rows.map(r => r.id)
    const reactionsMap = {}
    if (msgIds.length > 0) {
      const [reactions] = await pool.query(
        `SELECT mr.id, mr.message_id, mr.user_id, mr.emoji, mr.created_at,
                up.display_name as user_name
         FROM message_reactions mr
         JOIN user_profiles up ON mr.user_id = up.id
         WHERE mr.message_id IN (?)`,
        [msgIds],
      )
      for (const r of reactions) {
        if (!reactionsMap[r.message_id]) reactionsMap[r.message_id] = []
        reactionsMap[r.message_id].push(r)
      }
    }
    const result = rows.map(msg => ({
      ...msg,
      reactions: reactionsMap[msg.id] || [],
      seen: otherParticipant?.last_read_at ? new Date(msg.created_at) <= new Date(otherParticipant.last_read_at) : false,
    }))
    res.json(result)
  } catch (err) {
    logger.error('Messages error:', err)
    res.status(500).json({ message: 'Failed to fetch messages' })
  }
})

router.post('/api/chats/:chatId/messages', auth, async (req, res) => {
  const { text, image_url, ttl_seconds } = req.body
  if (!text && !image_url) return res.status(400).json({ message: 'Text or image is required' })

  try {
    const bannedWords = await getBannedWords()
    if (containsBannedWord(text, bannedWords)) {
      return res.status(403).json({ message: 'Message contains prohibited content' })
    }
  } catch (err) {
    logger.error('Banned words check error:', err)
  }

  try {
    const [participant] = await pool.query(
      'SELECT chat_id FROM chat_participants WHERE chat_id = ? AND user_id = ?',
      [req.params.chatId, req.userId],
    )
    if (participant.length === 0) return res.status(403).json({ message: 'Not a participant' })

    const ttl = ttl_seconds > 0 ? ttl_seconds : null
    const [result] = await pool.query(
      'INSERT INTO messages (chat_id, sender_id, text, image_url, ttl_seconds) VALUES (?, ?, ?, ?, ?)',
      [req.params.chatId, req.userId, stripHtml(text) || null, image_url || null, ttl],
    )

    const preview = image_url ? '📷 Photo' : (text || '')
    await pool.query(
      `UPDATE chats SET last_message = ?, last_sender_id = ?, updated_at = NOW() WHERE id = ?`,
      [preview, req.userId, req.params.chatId],
    )

    const [[msg]] = await pool.query(
      `SELECT m.id, m.sender_id, m.text, m.image_url, m.reply_to, m.ttl_seconds, m.created_at,
              up.display_name as sender_name
       FROM messages m
       JOIN user_profiles up ON m.sender_id = up.id
       WHERE m.id = ?`,
      [result.insertId],
    )

    const [otherParticipant] = await pool.query(
      'SELECT user_id FROM chat_participants WHERE chat_id = ? AND user_id != ? LIMIT 1',
      [req.params.chatId, req.userId],
    )
    if (otherParticipant.length > 0) {
      const [[sender]] = await pool.query('SELECT display_name FROM user_profiles WHERE id = ?', [req.userId])
      sendPushToUser(otherParticipant[0].user_id, sender?.display_name || 'New message', text.substring(0, 100), `/chats?matchId=${otherParticipant[0].user_id}`)
      try {
        const io = getIO()
        if (io) {
          io.to(`user:${otherParticipant[0].user_id}`).emit('chat:message', {
            chatId: Number(req.params.chatId),
            message: msg,
          })
        }
      } catch {}
    }

    res.status(201).json(msg)
  } catch (err) {
    logger.error('Message send error:', err)
    res.status(500).json({ message: 'Failed to send message' })
  }
})

// ─── Delete message ────────────────────────────────────────────
router.delete('/api/chats/:chatId/messages/:msgId', auth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT sender_id FROM messages WHERE id = ? AND chat_id = ?',
      [req.params.msgId, req.params.chatId],
    )
    if (rows.length === 0) return res.status(404).json({ message: 'Message not found' })
    if (rows[0].sender_id !== req.userId) return res.status(403).json({ message: 'Not your message' })
    await pool.query('DELETE FROM messages WHERE id = ?', [req.params.msgId])
    res.json({ message: 'Message deleted' })
  } catch (err) {
    logger.error('Delete message error:', err)
    res.status(500).json({ message: 'Failed to delete message' })
  }
})

// ─── Message Reactions ────────────────────────────────────────
router.post('/api/chats/:chatId/messages/:msgId/reactions', auth, async (req, res) => {
  const { emoji } = req.body
  if (!emoji) return res.status(400).json({ message: 'emoji is required' })

  try {
    const [participant] = await pool.query(
      'SELECT chat_id FROM chat_participants WHERE chat_id = ? AND user_id = ?',
      [req.params.chatId, req.userId],
    )
    if (participant.length === 0) return res.status(403).json({ message: 'Not a participant' })

    const [existing] = await pool.query(
      'SELECT id FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?',
      [req.params.msgId, req.userId, emoji],
    )
    if (existing.length > 0) {
      await pool.query('DELETE FROM message_reactions WHERE id = ?', [existing[0].id])
      return res.json({ message: 'Reaction removed', action: 'removed' })
    }

    const [result] = await pool.query(
      'INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)',
      [req.params.msgId, req.userId, emoji],
    )

    const [[reaction]] = await pool.query(
      `SELECT mr.id, mr.message_id, mr.user_id, mr.emoji, mr.created_at,
              up.display_name as user_name
       FROM message_reactions mr
       JOIN user_profiles up ON mr.user_id = up.id
       WHERE mr.id = ?`,
      [result.insertId],
    )
    res.status(201).json(reaction)
  } catch (err) {
    logger.error('Reaction error:', err)
    res.status(500).json({ message: 'Failed to add reaction' })
  }
})

// ─── Block / Unblock ──────────────────────────────────────────
// ─── Activity feed ──────────────────────────────────────────────
router.get('/api/activity', auth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT al.id, al.action_type, al.user_id, al.target_id, al.created_at,
              up.display_name as user_name, up.avatar_url as user_avatar
       FROM activity_log al
       LEFT JOIN user_profiles up ON al.user_id = up.id
       WHERE al.target_id = ? AND (up.incognito = 0 OR up.incognito IS NULL)
       ORDER BY al.created_at DESC
       LIMIT 50`,
      [req.userId],
    )
    res.json(rows)
  } catch (err) {
    logger.error('Activity error:', err)
    res.status(500).json({ message: 'Failed to fetch activity' })
  }
})

router.post('/api/block', auth, async (req, res) => {
  const { blocked_id } = req.body
  if (!blocked_id) return res.status(400).json({ message: 'blocked_id is required' })
  if (Number(blocked_id) === req.userId) return res.status(400).json({ message: 'Cannot block yourself' })
  try {
    await pool.query('INSERT IGNORE INTO user_blocks (blocker_id, blocked_id) VALUES (?, ?)', [req.userId, blocked_id])
    await pool.query('DELETE FROM likes WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)', [req.userId, blocked_id, blocked_id, req.userId])
    await pool.query('DELETE FROM matches WHERE (user1_id = ? AND user2_id = ?) OR (user1_id = ? AND user2_id = ?)', [req.userId, blocked_id, blocked_id, req.userId])
    res.json({ message: 'User blocked' })
  } catch (err) {
    logger.error('Block error:', err)
    res.status(500).json({ message: 'Failed to block user' })
  }
})

router.delete('/api/block/:blocked_id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?', [req.userId, req.params.blocked_id])
    res.json({ message: 'User unblocked' })
  } catch (err) {
    logger.error('Unblock error:', err)
    res.status(500).json({ message: 'Failed to unblock user' })
  }
})

router.get('/api/block/list', auth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT ub.blocked_id, up.display_name, up.avatar_url FROM user_blocks ub JOIN user_profiles up ON up.id = ub.blocked_id WHERE ub.blocker_id = ?',
      [req.userId],
    )
    res.json(rows)
  } catch (err) {
    logger.error('Block list error:', err)
    res.status(500).json({ message: 'Failed to fetch block list' })
  }
})

export default router
