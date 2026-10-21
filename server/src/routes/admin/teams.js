import { Router } from 'express'
import pool from '../../db.js'
import logger from '../../logger.js'
import { wrapRouter } from '../../async-handler.js'

const router = Router()

const NAME_MAX = 120

// Управление командами — функция супер-админа: админ, привязанный к команде,
// видит только её жалобы (P3 #31), и он не должен править состав команд, чтобы
// не выписать себе доступ. Пустой список команд = супер-админ (та же логика,
// что в middleware/adminAuth.js и routes/admin/reports.js).
function superAdminOnly(req, res) {
  const teams = Array.isArray(req.admin?.teams) ? req.admin.teams : []
  if (teams.length > 0) {
    res.status(403).json({ message: 'SUPER_ADMIN_REQUIRED' })
    return false
  }
  return true
}

function parseName(raw) {
  if (typeof raw !== 'string') return null
  const name = raw.trim()
  if (name.length === 0 || name.length > NAME_MAX) return null
  return name
}

function parseId(raw) {
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

/**
 * @openapi
 * /api/admin/teams:
 *   get:
 *     tags: [Admin]
 *     summary: List moderation teams
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: List of teams with member counts }
 */
router.get('/teams', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT t.id, t.name, t.is_active AS isActive,
              (SELECT COUNT(*) FROM moderation_team_members m WHERE m.team_id = t.id) AS memberCount
       FROM moderation_teams t
       ORDER BY t.id`,
    )
    res.json(rows)
  } catch (err) {
    logger.error('Teams list error:', err)
    res.status(500).json({ message: 'Failed to fetch teams' })
  }
})

/**
 * @openapi
 * /api/admin/teams/{id}/members:
 *   get:
 *     tags: [Admin]
 *     summary: List members of a moderation team
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: List of team members }
 */
router.get('/teams/:id/members', async (req, res) => {
  const teamId = parseId(req.params.id)
  if (!teamId) return res.status(400).json({ message: 'Invalid team id' })
  try {
    const [rows] = await pool.query(
      `SELECT u.id, up.display_name AS name, u.email
       FROM moderation_team_members m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN user_profiles up ON up.id = u.id
       WHERE m.team_id = ?
       ORDER BY u.id`,
      [teamId],
    )
    res.json(rows)
  } catch (err) {
    logger.error('Team members error:', err)
    res.status(500).json({ message: 'Failed to fetch team members' })
  }
})

/**
 * @openapi
 * /api/admin/teams:
 *   post:
 *     tags: [Admin]
 *     summary: Create a moderation team
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201: { description: Team created }
 *       400: { description: Invalid name }
 */
router.post('/teams', async (req, res) => {
  if (!superAdminOnly(req, res)) return
  const name = parseName(req.body?.name)
  if (!name) return res.status(400).json({ message: 'Invalid team name' })
  try {
    const [result] = await pool.query('INSERT INTO moderation_teams (name) VALUES (?)', [name])
    res.status(201).json({ id: result.insertId, name, isActive: true, memberCount: 0 })
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Team name already exists' })
    logger.error('Team create error:', err)
    res.status(500).json({ message: 'Failed to create team' })
  }
})

/**
 * @openapi
 * /api/admin/teams/{id}:
 *   patch:
 *     tags: [Admin]
 *     summary: Rename or toggle a moderation team
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Team updated }
 *       400: { description: Invalid payload }
 *       404: { description: Team not found }
 */
router.patch('/teams/:id', async (req, res) => {
  if (!superAdminOnly(req, res)) return
  const teamId = parseId(req.params.id)
  if (!teamId) return res.status(400).json({ message: 'Invalid team id' })

  const sets = []
  const params = []
  if (req.body?.name !== undefined) {
    const name = parseName(req.body.name)
    if (!name) return res.status(400).json({ message: 'Invalid team name' })
    sets.push('name = ?')
    params.push(name)
  }
  if (req.body?.isActive !== undefined) {
    if (typeof req.body.isActive !== 'boolean') return res.status(400).json({ message: 'Invalid isActive' })
    sets.push('is_active = ?')
    params.push(req.body.isActive ? 1 : 0)
  }
  if (sets.length === 0) return res.status(400).json({ message: 'Nothing to update' })

  try {
    const [known] = await pool.query('SELECT id FROM moderation_teams WHERE id = ?', [teamId])
    if (known.length === 0) return res.status(404).json({ message: 'Team not found' })
    await pool.query(`UPDATE moderation_teams SET ${sets.join(', ')} WHERE id = ?`, [...params, teamId])
    res.json({ message: 'Team updated' })
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Team name already exists' })
    logger.error('Team update error:', err)
    res.status(500).json({ message: 'Failed to update team' })
  }
})

/**
 * @openapi
 * /api/admin/teams/{id}:
 *   delete:
 *     tags: [Admin]
 *     summary: Delete a moderation team
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Team deleted }
 *       404: { description: Team not found }
 */
router.delete('/teams/:id', async (req, res) => {
  if (!superAdminOnly(req, res)) return
  const teamId = parseId(req.params.id)
  if (!teamId) return res.status(400).json({ message: 'Invalid team id' })
  try {
    const [known] = await pool.query('SELECT id FROM moderation_teams WHERE id = ?', [teamId])
    if (known.length === 0) return res.status(404).json({ message: 'Team not found' })
    await pool.query('DELETE FROM moderation_teams WHERE id = ?', [teamId])
    res.json({ message: 'Team deleted' })
  } catch (err) {
    logger.error('Team delete error:', err)
    res.status(500).json({ message: 'Failed to delete team' })
  }
})

/**
 * @openapi
 * /api/admin/teams/{id}/members:
 *   post:
 *     tags: [Admin]
 *     summary: Add an admin to a moderation team
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Member added }
 *       400: { description: Invalid user id }
 *       404: { description: User or team not found }
 */
router.post('/teams/:id/members', async (req, res) => {
  if (!superAdminOnly(req, res)) return
  const teamId = parseId(req.params.id)
  const userId = parseId(req.body?.userId)
  if (!teamId) return res.status(400).json({ message: 'Invalid team id' })
  if (!userId) return res.status(400).json({ message: 'Invalid user id' })
  try {
    const [team] = await pool.query('SELECT id FROM moderation_teams WHERE id = ?', [teamId])
    if (team.length === 0) return res.status(404).json({ message: 'Team not found' })
    const [user] = await pool.query('SELECT id, role FROM users WHERE id = ? AND is_active = 1', [userId])
    if (user.length === 0) return res.status(404).json({ message: 'User not found' })
    if (user[0].role !== 'admin') return res.status(400).json({ message: 'Only admins can be team members' })
    await pool.query('INSERT IGNORE INTO moderation_team_members (team_id, user_id) VALUES (?, ?)', [teamId, userId])
    res.json({ message: 'Member added' })
  } catch (err) {
    logger.error('Team member add error:', err)
    res.status(500).json({ message: 'Failed to add member' })
  }
})

/**
 * @openapi
 * /api/admin/teams/{id}/members/{userId}:
 *   delete:
 *     tags: [Admin]
 *     summary: Remove an admin from a moderation team
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Member removed }
 *       400: { description: Invalid id }
 */
router.delete('/teams/:id/members/:userId', async (req, res) => {
  const teamId = parseId(req.params.id)
  const userId = parseId(req.params.userId)
  if (!teamId || !userId) return res.status(400).json({ message: 'Invalid id' })
  // Выход из команды разрешён самому себе: он только сужает свои права (модератор
  // снова становится супер-админом) и не даёт эскалации, но без него админ,
  // которого добавили в команду, не может выйти из неё — все прочие мутации
  // требуют супер-админа, и он оказался бы заперт (сам себя разжаловал, выйти
  // нечем). Добавление себя в команду и правка состава по-прежнему только
  // супер-админ (иначе это была бы эскалация).
  const isSelf = req.admin?.id != null && req.admin.id === userId
  if (!isSelf && !superAdminOnly(req, res)) return
  try {
    await pool.query('DELETE FROM moderation_team_members WHERE team_id = ? AND user_id = ?', [teamId, userId])
    res.json({ message: 'Member removed' })
  } catch (err) {
    logger.error('Team member remove error:', err)
    res.status(500).json({ message: 'Failed to remove member' })
  }
})

/**
 * @openapi
 * /api/admin/reports/{id}/assign:
 *   post:
 *     tags: [Admin]
 *     summary: Assign a report to a moderation team (null to unassign)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Report reassigned }
 *       400: { description: Invalid payload }
 *       404: { description: Report or team not found }
 */
router.post('/reports/:id/assign', async (req, res) => {
  if (!superAdminOnly(req, res)) return
  const reportId = parseId(req.params.id)
  if (!reportId) return res.status(400).json({ message: 'Invalid report id' })

  const raw = req.body?.teamId
  let teamId = null
  if (raw !== null && raw !== undefined) {
    teamId = parseId(raw)
    if (!teamId) return res.status(400).json({ message: 'Invalid team id' })
  }

  try {
    const [report] = await pool.query('SELECT id FROM reports WHERE id = ?', [reportId])
    if (report.length === 0) return res.status(404).json({ message: 'Report not found' })
    if (teamId !== null) {
      const [team] = await pool.query('SELECT id FROM moderation_teams WHERE id = ?', [teamId])
      if (team.length === 0) return res.status(404).json({ message: 'Team not found' })
    }
    await pool.query('UPDATE reports SET team_id = ? WHERE id = ?', [teamId, reportId])
    res.json({ message: 'Report reassigned', teamId })
  } catch (err) {
    logger.error('Report assign error:', err)
    res.status(500).json({ message: 'Failed to assign report' })
  }
})

export default wrapRouter(router)
