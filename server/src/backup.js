import { spawn } from 'child_process'
import { mkdir, readdir, stat, unlink, writeFile, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join, normalize, basename, resolve, sep, relative } from 'path'
import path from 'path'
import { fileURLToPath } from 'url'
import logger from './logger.js'
import { buildZip } from './zip.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function getBackupDir() {
  if (process.env.BACKUP_DIR) return resolve(process.env.BACKUP_DIR)
  return resolve(__dirname, '..', '..', 'backups')
}

function getRetentionDays() {
  const n = Number(process.env.BACKUP_RETENTION_DAYS)
  return Number.isFinite(n) && n > 0 ? n : 30
}

function detectMysqldumpPath() {
  const candidates = []
  if (process.env.MYSQLDUMP_PATH) candidates.push(process.env.MYSQLDUMP_PATH)
  if (process.platform === 'win32') {
    candidates.push(
      'C:\\laragon\\bin\\mysql\\mysql-8.4.3-winx64\\bin\\mysqldump.exe',
      'C:\\laragon\\bin\\mysql\\mysql-8.0.30-winx64\\bin\\mysqldump.exe',
      'C:\\laragon\\bin\\mysql\\mysql-8.0.28-winx64\\bin\\mysqldump.exe',
      `${process.env.ProgramFiles}\\MySQL\\MySQL Server 8.4\\bin\\mysqldump.exe`,
      `${process.env.ProgramFiles}\\MySQL\\MySQL Server 8.0\\bin\\mysqldump.exe`,
    )
  }
  for (const c of candidates) {
    if (c && existsSync(c)) return c
  }
  return 'mysqldump'
}

function buildArgs() {
  const dbName = process.env.DB_NAME || 'swiftmatch'
  const args = [
    `-h${process.env.DB_HOST || 'localhost'}`,
    `-P${process.env.DB_PORT || 3306}`,
    `-u${process.env.DB_USER || 'root'}`,
  ]
  if (process.env.DB_PASSWORD) args.push(`-p${process.env.DB_PASSWORD}`)
  args.push(dbName, '--routines', '--triggers', '--single-transaction', '--default-character-set=utf8mb4')
  return args
}

function getUploadsDir() {
  return resolve(__dirname, '..', 'uploads')
}

async function collectUploadFiles(dir) {
  const files = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      const sub = await collectUploadFiles(full)
      files.push(...sub)
    } else if (entry.isFile()) {
      files.push(full)
    }
  }
  return files
}

export async function createFileBackup() {
  const dir = getBackupDir()
  await mkdir(dir, { recursive: true })

  const uploadsDir = getUploadsDir()
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const filename = `swiftmatch_files_${ts}.zip`
  const filepath = join(dir, filename)

  let files = []
  if (existsSync(uploadsDir)) {
    const raw = await collectUploadFiles(uploadsDir)
    for (const full of raw) {
      const rel = relative(uploadsDir, full).split(sep).join('/')
      files.push({ path: rel, data: await readFile(full) })
    }
  }

  const zip = buildZip(files)
  await writeFile(filepath, zip)

  logger.info(`File backup created (${files.length} files): ${filename}`)

  await pruneOldBackups()

  const st = await stat(filepath)
  return { name: filename, size: st.size, createdAt: st.mtime.toISOString() }
}

export async function listBackups() {
  const dir = getBackupDir()
  let entries = []
  try {
    entries = await readdir(dir)
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
  const files = []
  for (const name of entries) {
    if (!name.startsWith('swiftmatch_')) continue
    if (!name.endsWith('.sql') && !name.endsWith('.zip')) continue
    const full = join(dir, name)
    let st
    try {
      st = await stat(full)
    } catch {
      continue
    }
    if (!st.isFile()) continue
    files.push({ name, size: st.size, createdAt: st.mtime.toISOString() })
  }
  files.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  return files
}

export async function createBackup() {
  const dir = getBackupDir()
  await mkdir(dir, { recursive: true })

  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const filename = `swiftmatch_${ts}.sql`
  const filepath = join(dir, filename)

  const mysqldump = detectMysqldumpPath()
  const startedAt = Date.now()

  await new Promise((resolveExec, rejectExec) => {
    const child = spawn(mysqldump, buildArgs(), { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    const out = []
    child.stdout.on('data', (c) => out.push(c))
    child.stderr.on('data', (c) => {
      stderr += c.toString()
    })
    child.on('error', (err) => {
      rejectExec(new Error(`mysqldump failed to start: ${err.message}`))
    })
    child.on('close', async (code) => {
      if (code !== 0) {
        rejectExec(new Error(`mysqldump exited with code ${code}: ${stderr.trim() || 'no stderr'}`))
        return
      }
      try {
        await writeFile(filepath, Buffer.concat(out))
        resolveExec()
      } catch (err) {
        rejectExec(err)
      }
    })
  })

  logger.info(`Backup created in ${Date.now() - startedAt}ms: ${filename}`)

  await pruneOldBackups()

  const st = await stat(filepath)
  return { name: filename, size: st.size, createdAt: st.mtime.toISOString() }
}

async function pruneOldBackups() {
  const dir = getBackupDir()
  const retention = getRetentionDays()
  const cutoff = Date.now() - retention * 24 * 60 * 60 * 1000
  const files = await listBackups()
  for (const f of files) {
    const created = Date.parse(f.createdAt)
    if (Number.isNaN(created) || created >= cutoff) continue
    try {
      await unlink(join(dir, f.name))
      logger.info(`Backup pruned: ${f.name}`)
    } catch (err) {
      logger.warn(`Failed to prune backup ${f.name}: ${err.message}`)
    }
  }
}

export function resolveBackupPath(name) {
  if (!name || typeof name !== 'string') return null
  const dir = getBackupDir()
  const clean = normalize(basename(name))
  if (!clean.startsWith('swiftmatch_')) return null
  const full = resolve(dir, clean)
  if (!full.startsWith(resolve(dir) + sep)) return null
  return full
}
