import { Router } from 'express'
import { createReadStream } from 'fs'
import { statSync } from 'fs'
import { basename } from 'path'
import logger from '../../logger.js'
import { listBackups, createBackup, createFileBackup, resolveBackupPath } from '../../backup.js'
import { wrapRouter } from '../../async-handler.js'

const router = Router()

/**
 * @openapi
 * /api/admin/backup:
 *   post:
 *     tags: [Admin]
 *     summary: Create a database backup
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201: { description: Backup created }
 */
router.post('/backup', async (req, res) => {
  try {
    const backup = await createBackup()
    res.status(201).json(backup)
  } catch (err) {
    logger.error('Backup create error:', err)
    const msg = err.message || 'Failed to create backup'
    res.status(500).json({ message: msg.includes('mysqldump') ? 'BACKUP_MYSQLDUMP_NOT_AVAILABLE' : 'Failed to create backup' })
  }
})

/**
 * @openapi
 * /api/admin/backup/files:
 *   post:
 *     tags: [Admin]
 *     summary: Create a file backup
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201: { description: File backup created }
 */
router.post('/backup/files', async (req, res) => {
  try {
    const backup = await createFileBackup()
    res.status(201).json(backup)
  } catch (err) {
    logger.error('File backup create error:', err)
    res.status(500).json({ message: 'Failed to create file backup' })
  }
})

/**
 * @openapi
 * /api/admin/backup:
 *   get:
 *     tags: [Admin]
 *     summary: List all backups
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: List of backups }
 */
router.get('/backup', async (req, res) => {
  try {
    const backups = await listBackups()
    res.json(backups)
  } catch (err) {
    logger.error('Backup list error:', err)
    res.status(500).json({ message: 'Failed to list backups' })
  }
})

/**
 * @openapi
 * /api/admin/backup/{name}/download:
 *   get:
 *     tags: [Admin]
 *     summary: Download a backup by name
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Backup file stream }
 */
router.get('/backup/:name/download', async (req, res) => {
  const full = resolveBackupPath(req.params.name)
  if (!full) {
    return res.status(400).json({ message: 'Invalid backup name' })
  }
  let st
  try {
    st = statSync(full)
  } catch {
    return res.status(404).json({ message: 'Backup not found' })
  }
  const filename = basename(full)
  const isZip = filename.endsWith('.zip')
  res.setHeader('Content-Type', isZip ? 'application/zip' : 'application/sql')
  res.setHeader('Content-Length', st.size)
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  const stream = createReadStream(full)
  stream.on('error', (err) => {
    logger.error('Backup download error:', err.message)
    if (!res.headersSent) res.status(500).end()
    else res.end()
  })
  stream.pipe(res)
})

export default wrapRouter(router)
