import { Router } from 'express'
import pool from '../db.js'
import { auth } from '../middleware.js'
import logger from '../logger.js'
import { cacheRoute, invalidate } from '../cache.js'
import { stripHtml } from '../sanitize.js'

const router = Router()

/**
 * @openapi
 * /api/profile/{id}:
 *   get:
 *     tags: [Profile]
 *     summary: Get user profile by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Profile data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Profile'
 *       404:
 *         description: Profile not found
 *   put:
 *     tags: [Profile]
 *     summary: Update user profile
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               display_name: { type: string }
 *               age: { type: integer }
 *               bio: { type: string }
 *               gender: { type: string }
 *               city: { type: string }
 *               interests: { type: array, items: { type: integer } }
 *     responses:
 *       200:
 *         description: Updated profile
 *       500:
 *         description: Failed to update profile
 *
 * /api/profile/me:
 *   delete:
 *     tags: [Profile]
 *     summary: Delete own account (soft delete)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Account deleted
 *       401:
 *         description: Authentication required
 */

function parseJsonField(val, fallback) {
  if (Array.isArray(val)) return val
  if (typeof val === 'string') { try { return JSON.parse(val) } catch { return fallback || [] } }
  return fallback || []
}

const PROFILE_TEXT_FIELDS = ['display_name', 'name', 'bio', 'city', 'country', 'passport_city']

function sanitizeProfileText(profile) {
  for (const field of PROFILE_TEXT_FIELDS) {
    if (typeof profile[field] === 'string') profile[field] = stripHtml(profile[field])
  }
  return profile
}

router.get('/api/profile/me', auth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT up.id, up.display_name, up.name, up.age, up.bio, up.avatar_url,
              up.gender, up.looking_for, up.dating_goal, up.height,
              up.city, up.country, up.lat, up.lng,
              up.zodiac, up.circadian, up.attachment_style, up.education,
              up.super_likes, up.boost_until, up.incognito, up.passport_mode,
              up.passport_city, up.passport_lat, up.passport_lng,
              up.online, up.last_seen, up.created_at, up.updated_at,
              u.email
       FROM user_profiles up
       JOIN users u ON u.id = up.id
       WHERE up.id = ?`,
      [req.userId],
    )
    if (rows.length === 0) return res.status(404).json({ message: 'Profile not found' })

    const [photos] = await pool.query(
      'SELECT id, url, sort_order, is_avatar FROM user_photos WHERE user_id = ? ORDER BY sort_order',
      [req.userId],
    )
    const [interests] = await pool.query(
      `SELECT i.id, i.name_ru, i.name_en FROM interests i
       JOIN user_interests ui ON ui.interest_id = i.id
       WHERE ui.user_id = ?`,
      [req.userId],
    )

    const { location, ...profile } = rows[0]
    res.json({ ...sanitizeProfileText(profile), photos, interests })
  } catch (err) {
    logger.error('Profile GET /me error:', err)
    res.status(500).json({ message: 'Failed to fetch profile' })
  }
})

router.put('/api/profile/score', auth, async (req, res) => {
  try {
    const [[profile]] = await pool.query(
      `SELECT p.display_name, p.bio, p.city, p.lat, p.lng, p.zodiac, p.education, p.dating_goal,
              p.height, p.attachment_style, p.gender
       FROM user_profiles p WHERE p.id = ?`,
      [req.userId],
    )
    if (!profile) return res.status(404).json({ message: 'Profile not found' })

    const [photos] = await pool.query(
      'SELECT COUNT(*) as cnt FROM user_photos WHERE user_id = ? AND moderation_status = ?',
      [req.userId, 'approved'],
    )
    const photoCount = photos[0]?.cnt || 0

    const [interests] = await pool.query(
      'SELECT COUNT(*) as cnt FROM user_interests WHERE user_id = ?',
      [req.userId],
    )
    const interestCount = interests[0]?.cnt || 0

    let score = 0
    if (profile.display_name) score += 10
    if (profile.bio) score += Math.min(15, Math.floor(profile.bio.length / 15))
    if (profile.gender) score += 5
    if (profile.city || profile.lat) score += 10
    if (profile.zodiac) score += 5
    if (profile.education) score += 5
    if (profile.dating_goal) score += 10
    if (profile.height) score += 5
    if (profile.attachment_style) score += 5
    score += Math.min(15, photoCount * 5)
    score += Math.min(15, interestCount * 3)
    score = Math.min(100, Math.round(score))

    await pool.query(
      'UPDATE user_profiles SET profile_score = ?, profile_score_updated_at = NOW() WHERE id = ?',
      [score, req.userId],
    )

    res.json({ score, photoCount, interestCount })
  } catch (err) {
    logger.error('Profile score error:', err)
    res.status(500).json({ message: 'Failed to calculate profile score' })
  }
})

// ─── Account deletion ──────────────────────────────────────────
router.delete('/api/profile/me', auth, async (req, res) => {
  try {
    await pool.query('UPDATE users SET is_active = 0, email = CONCAT(email, \'.deleted\', UNIX_TIMESTAMP()) WHERE id = ?', [req.userId])
    res.json({ message: 'Account deleted' })
  } catch (err) {
    logger.error('Delete account error:', err)
    res.status(500).json({ message: 'Failed to delete account' })
  }
})

// ─── Privacy settings ───────────────────────────────────────────
router.get('/api/settings/privacy', auth, async (req, res) => {
  try {
    const [[profile]] = await pool.query(
      'SELECT incognito, passport_mode, passport_city, passport_lat, passport_lng FROM user_profiles WHERE id = ?',
      [req.userId],
    )
    if (!profile) return res.status(404).json({ message: 'Profile not found' })
    res.json({
      incognito: Boolean(profile.incognito),
      passport_mode: Boolean(profile.passport_mode),
      passport_city: profile.passport_city,
      passport_lat: profile.passport_lat,
      passport_lng: profile.passport_lng,
    })
  } catch (err) {
    logger.error('Privacy GET error:', err)
    res.status(500).json({ message: 'Failed to fetch privacy settings' })
  }
})

router.put('/api/settings/privacy', auth, async (req, res) => {
  try {
    const { incognito, passport_mode, passport_city, passport_lat, passport_lng } = req.body

    if (incognito || passport_mode) {
      const [subRows] = await pool.query(
        "SELECT id FROM subscriptions WHERE user_id = ? AND is_active = 1 AND expires_at > NOW() LIMIT 1",
        [req.userId],
      )
      if (subRows.length === 0) {
        return res.status(403).json({ message: 'Premium subscription required for this feature', code: 'PREMIUM_REQUIRED' })
      }
    }

    await pool.query(
      `UPDATE user_profiles SET
        incognito = COALESCE(?, incognito),
        passport_mode = COALESCE(?, passport_mode),
        passport_city = COALESCE(?, passport_city),
        passport_lat = COALESCE(?, passport_lat),
        passport_lng = COALESCE(?, passport_lng)
      WHERE id = ?`,
      [incognito, passport_mode, passport_city, passport_lat, passport_lng, req.userId],
    )
    invalidate(`route:/api/profile/${req.userId}*`).catch(() => {})
    res.json({ message: 'Privacy settings updated' })
  } catch (err) {
    logger.error('Privacy PUT error:', err)
    res.status(500).json({ message: 'Failed to update privacy settings' })
  }
})

// ─── Aliases (псевдонимы) ────────────────────────────────────

router.get('/api/profile/aliases', auth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, alias, is_primary, created_at FROM user_aliases WHERE user_id = ? ORDER BY is_primary DESC, created_at ASC',
      [req.userId],
    )
    res.json(rows)
  } catch (err) {
    logger.error('Aliases GET error:', err)
    res.status(500).json({ message: 'Failed to fetch aliases' })
  }
})

router.post('/api/profile/aliases', auth, async (req, res) => {
  const { alias } = req.body || {}
  const trimmed = String(alias || '').trim()
  if (!trimmed || trimmed.length < 2 || trimmed.length > 50) {
    return res.status(400).json({ message: 'Alias must be 2-50 characters' })
  }
  if (/[<>"'`;\\]/.test(trimmed)) {
    return res.status(400).json({ message: 'Alias contains forbidden characters' })
  }
  try {
    const [[{ count }]] = await pool.query(
      'SELECT COUNT(*) AS count FROM user_aliases WHERE user_id = ?',
      [req.userId],
    )
    if (count >= 5) {
      return res.status(400).json({ message: 'Maximum 5 aliases allowed' })
    }
    const isPrimary = count === 0 ? 1 : 0
    const [result] = await pool.query(
      'INSERT INTO user_aliases (user_id, alias, is_primary) VALUES (?, ?, ?)',
      [req.userId, trimmed, isPrimary],
    )
    res.status(201).json({ id: result.insertId, alias: trimmed, is_primary: !!isPrimary })
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Alias already exists' })
    }
    logger.error('Aliases POST error:', err)
    res.status(500).json({ message: 'Failed to create alias' })
  }
})

router.put('/api/profile/aliases/:aliasId/primary', auth, async (req, res) => {
  const { aliasId } = req.params
  if (!/^\d+$/.test(aliasId)) return res.status(400).json({ message: 'Invalid alias id' })
  try {
    await pool.query('UPDATE user_aliases SET is_primary = 0 WHERE user_id = ?', [req.userId])
    const [result] = await pool.query(
      'UPDATE user_aliases SET is_primary = 1 WHERE id = ? AND user_id = ?',
      [aliasId, req.userId],
    )
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Alias not found' })
    res.json({ message: 'Primary alias updated' })
  } catch (err) {
    logger.error('Aliases PUT primary error:', err)
    res.status(500).json({ message: 'Failed to update primary alias' })
  }
})

router.delete('/api/profile/aliases/:aliasId', auth, async (req, res) => {
  const { aliasId } = req.params
  if (!/^\d+$/.test(aliasId)) return res.status(400).json({ message: 'Invalid alias id' })
  try {
    const [[alias]] = await pool.query(
      'SELECT id, is_primary FROM user_aliases WHERE id = ? AND user_id = ?',
      [aliasId, req.userId],
    )
    if (!alias) return res.status(404).json({ message: 'Alias not found' })
    await pool.query('DELETE FROM user_aliases WHERE id = ?', [aliasId])
    if (alias.is_primary) {
      const [[first]] = await pool.query(
        'SELECT id FROM user_aliases WHERE user_id = ? ORDER BY created_at ASC LIMIT 1',
        [req.userId],
      )
      if (first) {
        await pool.query('UPDATE user_aliases SET is_primary = 1 WHERE id = ?', [first.id])
      }
    }
    res.json({ message: 'Alias deleted' })
  } catch (err) {
    logger.error('Aliases DELETE error:', err)
    res.status(500).json({ message: 'Failed to delete alias' })
  }
})

// ─── Photo verification (anti-cat) ────────────────────────────
router.get('/api/profile/verification', auth, async (req, res) => {
  try {
    const [[profile]] = await pool.query('SELECT photo_verified FROM user_profiles WHERE id = ?', [req.userId])
    const [submissions] = await pool.query(
      'SELECT id, photo_url, status, created_at, reviewed_at FROM user_verifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 5',
      [req.userId],
    )
    res.json({ verified: profile?.photo_verified || false, submissions })
  } catch (err) {
    logger.error('Verification GET error:', err)
    res.status(500).json({ message: 'Failed to get verification status' })
  }
})

router.post('/api/profile/verification', auth, async (req, res) => {
  const { photo_url } = req.body || {}
  if (!photo_url) return res.status(400).json({ message: 'photo_url is required' })
  try {
    const [[existing]] = await pool.query(
      "SELECT id FROM user_verifications WHERE user_id = ? AND status = 'pending' LIMIT 1",
      [req.userId],
    )
    if (existing) return res.status(409).json({ message: 'Verification already pending' })

    const [result] = await pool.query(
      'INSERT INTO user_verifications (user_id, photo_url) VALUES (?, ?)',
      [req.userId, photo_url],
    )
    res.status(201).json({ id: result.insertId, status: 'pending' })
  } catch (err) {
    logger.error('Verification POST error:', err)
    res.status(500).json({ message: 'Failed to submit verification' })
  }
})

router.get('/api/profile/:id', cacheRoute(60), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT up.*, u.email FROM user_profiles up
       JOIN users u ON u.id = up.id
       WHERE up.id = ?`,
      [req.params.id],
    )
    if (rows.length === 0) return res.status(404).json({ message: 'Profile not found' })

    const [photos] = await pool.query(
      'SELECT id, url, sort_order, is_avatar FROM user_photos WHERE user_id = ? ORDER BY sort_order',
      [req.params.id],
    )
    const [interests] = await pool.query(
      `SELECT i.id, i.name_ru, i.name_en FROM interests i
       JOIN user_interests ui ON ui.interest_id = i.id
       WHERE ui.user_id = ?`,
      [req.params.id],
    )

    res.json({ ...sanitizeProfileText(rows[0]), photos, interests })
  } catch (err) {
    logger.error('Profile GET error:', err)
    res.status(500).json({ message: 'Failed to fetch profile' })
  }
})

router.put('/api/profile/:id', async (req, res) => {
  try {
    const { display_name, name, age, bio, gender, looking_for, dating_goal, height, city, country, zodiac, circadian, attachment_style, education, interests, incognito, passport_mode, passport_city, passport_lat, passport_lng } = req.body

    const clean = {
      display_name: stripHtml(display_name),
      name: stripHtml(name),
      bio: stripHtml(bio),
      city: stripHtml(city),
      country: stripHtml(country),
      education: stripHtml(education),
      dating_goal: stripHtml(dating_goal),
    }

    await pool.query(
      `UPDATE user_profiles SET
        display_name = COALESCE(?, display_name),
        name = COALESCE(?, name),
        age = COALESCE(?, age),
        bio = COALESCE(?, bio),
        gender = COALESCE(?, gender),
        looking_for = COALESCE(?, looking_for),
        dating_goal = COALESCE(?, dating_goal),
        height = COALESCE(?, height),
        city = COALESCE(?, city),
        incognito = COALESCE(?, incognito),
        passport_mode = COALESCE(?, passport_mode),
        passport_city = COALESCE(?, passport_city),
        passport_lat = COALESCE(?, passport_lat),
        passport_lng = COALESCE(?, passport_lng),
        country = COALESCE(?, country),
        zodiac = COALESCE(?, zodiac),
        circadian = COALESCE(?, circadian),
        attachment_style = COALESCE(?, attachment_style),
        education = COALESCE(?, education)
      WHERE id = ?`,
      [clean.display_name, clean.name, age, clean.bio, gender, looking_for, clean.dating_goal, height, clean.city, incognito, passport_mode, passport_city, passport_lat, passport_lng, clean.country, zodiac, circadian, attachment_style, clean.education, req.params.id],
    )

    if (interests && Array.isArray(interests)) {
      await pool.query('DELETE FROM user_interests WHERE user_id = ?', [req.params.id])
      for (const interestId of interests) {
        await pool.query('INSERT IGNORE INTO user_interests (user_id, interest_id) VALUES (?, ?)', [req.params.id, interestId])
      }
    }

    invalidate(`route:/api/profile/${req.params.id}*`).catch(() => {})

    const [rows] = await pool.query('SELECT * FROM user_profiles WHERE id = ?', [req.params.id])
    res.json(rows[0])
  } catch (err) {
    logger.error('Profile PUT error:', err)
    res.status(500).json({ message: 'Failed to update profile' })
  }
})

export default router
