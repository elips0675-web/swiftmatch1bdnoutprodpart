import { Router } from 'express'
import pool from '../../db.js'
import logger from '../../logger.js'
import { FieldError, intField } from '../../profile-fields.js'

const router = Router()

/**
 * @openapi
 * /api/admin/features:
 *   get:
 *     tags: [Admin]
 *     summary: Get feature flags
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Feature flags }
 */
router.get('/features', async (req, res) => {
  try {
    const [[row]] = await pool.query('SELECT * FROM feature_flags WHERE id = 1')
    if (!row) {
      return res.json({
        videoCalls: true, aiIcebreakers: true, aiCompatibility: true,
        groupsPage: true, contest: true, showAds: false, autosearch: true,
        hangouts: true, partnerOffers: false, profileActivity: true,
        openingLines: true,
        rolloutPercent: 100,
      })
    }
    res.json({
      videoCalls: Boolean(row.video_calls_enabled),
      aiIcebreakers: Boolean(row.ai_icebreakers_enabled),
      aiCompatibility: Boolean(row.ai_compatibility_enabled),
      groupsPage: Boolean(row.groups_page_enabled),
      contest: Boolean(row.contest_enabled),
      showAds: Boolean(row.show_ads),
      autosearch: Boolean(row.autosearch_enabled),
      hangouts: Boolean(row.hangouts_enabled),
      partnerOffers: Boolean(row.partner_offers_enabled),
      profileActivity: Boolean(row.profile_activity_enabled ?? true),
      openingLines: Boolean(row.opening_lines_enabled ?? true),
      rolloutPercent: Number(row.rollout_percent ?? 100),
    })
  } catch (err) {
    logger.error('Features fetch error:', err)
    res.status(500).json({ message: 'Failed to fetch features' })
  }
})

/**
 * @openapi
 * /api/admin/features:
 *   put:
 *     tags: [Admin]
 *     summary: Update feature flags
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Feature flags updated }
 */
router.put('/features', async (req, res) => {
  try {
    const flags = req.body
    const knownKeys = ['videoCalls', 'aiIcebreakers', 'aiCompatibility', 'groupsPage', 'contest', 'showAds', 'autosearch', 'hangouts', 'partnerOffers', 'profileActivity', 'openingLines', 'rolloutPercent']
    if (!flags || Object.keys(flags).length === 0 || !knownKeys.some(k => k in flags)) {
      return res.status(400).json({ message: 'At least one known flag key required' })
    }
    const rolloutValue = (flags.rolloutPercent === undefined || flags.rolloutPercent === null || flags.rolloutPercent === '')
      ? 100
      : intField(flags.rolloutPercent, 'rolloutPercent', { min: 0, max: 100 })
    await pool.query(
      `UPDATE feature_flags SET
        video_calls_enabled = ?, ai_icebreakers_enabled = ?,
        ai_compatibility_enabled = ?, groups_page_enabled = ?,
        contest_enabled = ?, show_ads = ?, autosearch_enabled = ?,
        hangouts_enabled = ?, partner_offers_enabled = ?,
        profile_activity_enabled = ?, rollout_percent = ?,
        opening_lines_enabled = ?
       WHERE id = 1`,
      [
        Boolean(flags.videoCalls), Boolean(flags.aiIcebreakers),
        Boolean(flags.aiCompatibility), Boolean(flags.groupsPage),
        Boolean(flags.contest), Boolean(flags.showAds), Boolean(flags.autosearch),
        Boolean(flags.hangouts), Boolean(flags.partnerOffers),
        Boolean(flags.profileActivity), rolloutValue,
        Boolean(flags.openingLines),
      ],
    )
    res.json({ message: 'Feature flags updated' })
  } catch (err) {
    if (err instanceof FieldError) {
      return res.status(400).json({ message: err.message })
    }
    logger.error('Features update error:', err)
    res.status(500).json({ message: 'Failed to update features' })
  }
})

export default router
