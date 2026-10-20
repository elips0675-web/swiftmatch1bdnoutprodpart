import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join, sep, dirname } from 'path'
import { fileURLToPath } from 'url'

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

const spawnMock = vi.hoisted(() => vi.fn())
const unlinkMock = vi.hoisted(() => vi.fn())
const statMock = vi.hoisted(() => vi.fn())
const readdirMock = vi.hoisted(() => vi.fn())
const writeFileMock = vi.hoisted(() => vi.fn())
const existsSyncMock = vi.hoisted(() => vi.fn())
const realFs = vi.hoisted(() => ({ unlink: null, stat: null, readdir: null, writeFile: null, existsSync: null }))

vi.mock('child_process', () => ({ spawn: spawnMock }))

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal()
  realFs.existsSync = actual.existsSync
  return { ...actual, existsSync: (...args) => existsSyncMock(...args) }
})

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal()
  realFs.unlink = actual.unlink
  realFs.stat = actual.stat
  realFs.readdir = actual.readdir
  realFs.writeFile = actual.writeFile
  return {
    ...actual,
    unlink: (...args) => unlinkMock(...args),
    stat: (...args) => statMock(...args),
    readdir: (...args) => readdirMock(...args),
    writeFile: (...args) => writeFileMock(...args),
  }
})

import logger from '../logger.js'
import { listBackups, createBackup, createFileBackup, resolveBackupPath } from '../backup.js'

const tmpRoot = mkdtempSync(join(tmpdir(), 'bk-core-'))
let n = 0
function freshDir() {
  const dir = join(tmpRoot, `d${n++}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function setEnv(overrides) {
  const previous = { BACKUP_DIR: process.env.BACKUP_DIR, BACKUP_RETENTION_DAYS: process.env.BACKUP_RETENTION_DAYS, MYSQLDUMP_PATH: process.env.MYSQLDUMP_PATH, DB_PASSWORD: process.env.DB_PASSWORD }
  process.env.BACKUP_DIR = overrides.BACKUP_DIR
  if (overrides.BACKUP_RETENTION_DAYS === undefined) delete process.env.BACKUP_RETENTION_DAYS
  else process.env.BACKUP_RETENTION_DAYS = overrides.BACKUP_RETENTION_DAYS
  if (overrides.MYSQLDUMP_PATH === undefined) delete process.env.MYSQLDUMP_PATH
  else process.env.MYSQLDUMP_PATH = overrides.MYSQLDUMP_PATH
  return previous
}

function restoreEnv(previous) {
  if (previous.BACKUP_DIR === undefined) delete process.env.BACKUP_DIR
  else process.env.BACKUP_DIR = previous.BACKUP_DIR
  if (previous.BACKUP_RETENTION_DAYS === undefined) delete process.env.BACKUP_RETENTION_DAYS
  else process.env.BACKUP_RETENTION_DAYS = previous.BACKUP_RETENTION_DAYS
  if (previous.MYSQLDUMP_PATH === undefined) delete process.env.MYSQLDUMP_PATH
  else process.env.MYSQLDUMP_PATH = previous.MYSQLDUMP_PATH
  if (previous.DB_PASSWORD === undefined) delete process.env.DB_PASSWORD
  else process.env.DB_PASSWORD = previous.DB_PASSWORD
}

let envSnapshot

beforeEach(() => {
  vi.clearAllMocks()
  unlinkMock.mockImplementation((...args) => realFs.unlink(...args))
  statMock.mockImplementation((...args) => realFs.stat(...args))
  readdirMock.mockImplementation((...args) => realFs.readdir(...args))
  writeFileMock.mockImplementation((...args) => realFs.writeFile(...args))
  existsSyncMock.mockImplementation((...args) => realFs.existsSync(...args))
  envSnapshot = { BACKUP_DIR: process.env.BACKUP_DIR, BACKUP_RETENTION_DAYS: process.env.BACKUP_RETENTION_DAYS, MYSQLDUMP_PATH: process.env.MYSQLDUMP_PATH, DB_PASSWORD: process.env.DB_PASSWORD }
})

afterEach(() => {
  restoreEnv(envSnapshot)
})

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe('listBackups', () => {
  it('returns [] when the backup directory does not exist', async () => {
    setEnv({ BACKUP_DIR: join(tmpRoot, 'missing-dir') })
    expect(await listBackups()).toEqual([])
  })

  it('returns [] when the directory exists but has no backups', async () => {
    const dir = freshDir()
    setEnv({ BACKUP_DIR: dir })
    expect(await listBackups()).toEqual([])
  })

  it('skips unrelated names, other extensions and directories', async () => {
    const dir = freshDir()
    setEnv({ BACKUP_DIR: dir })
    writeFileSync(join(dir, 'swiftmatch_keep.sql'), 'a')
    writeFileSync(join(dir, 'swiftmatch_keep.zip'), 'b')
    writeFileSync(join(dir, 'other.sql'), 'c')
    writeFileSync(join(dir, 'swiftmatch_note.txt'), 'd')
    writeFileSync(join(dir, 'swiftmatch_endsql.sql.bak'), 'e')
    mkdirSync(join(dir, 'swiftmatch_dir.sql'), { recursive: true })

    const names = (await listBackups()).map((f) => f.name)
    expect(names.sort()).toEqual(['swiftmatch_keep.sql', 'swiftmatch_keep.zip'])
  })

  it('skips entries whose stat fails (broken symlink / vanished file)', async () => {
    const dir = freshDir()
    setEnv({ BACKUP_DIR: dir })
    writeFileSync(join(dir, 'swiftmatch_gone.sql'), 'x')

    statMock.mockImplementation((target, ...rest) => {
      if (String(target).endsWith('swiftmatch_gone.sql')) return Promise.reject(new Error('ENOENT'))
      return realFs.stat(target, ...rest)
    })

    const names = (await listBackups()).map((f) => f.name)
    expect(names).not.toContain('swiftmatch_gone.sql')
  })

  it('sorts newest first by createdAt', async () => {
    const dir = freshDir()
    setEnv({ BACKUP_DIR: dir })
    writeFileSync(join(dir, 'swiftmatch_old.sql'), 'old')
    writeFileSync(join(dir, 'swiftmatch_new.sql'), 'new')
    const oldTime = new Date('2020-01-01T00:00:00.000Z')
    const newTime = new Date('2026-01-01T00:00:00.000Z')
    const { utimesSync } = await import('fs')
    utimesSync(join(dir, 'swiftmatch_old.sql'), oldTime, oldTime)
    utimesSync(join(dir, 'swiftmatch_new.sql'), newTime, newTime)

    const list = await listBackups()
    expect(list.map((f) => f.name)).toEqual(['swiftmatch_new.sql', 'swiftmatch_old.sql'])
    expect(list[0].size).toBeGreaterThan(0)
  })
})

describe('resolveBackupPath', () => {
  it('returns an absolute path inside the backup dir for a valid name', () => {
    const dir = freshDir()
    setEnv({ BACKUP_DIR: dir })
    const resolved = resolveBackupPath('swiftmatch_2026-01-01T00-00-00-000Z.sql')
    expect(resolved).toBe(join(dir, 'swiftmatch_2026-01-01T00-00-00-000Z.sql'))
  })

  it('rejects a path traversal attempt with ../', () => {
    const dir = freshDir()
    setEnv({ BACKUP_DIR: dir })
    expect(resolveBackupPath('../../etc/passwd')).toBe(null)
    expect(resolveBackupPath(`..${sep}..${sep}passwd`)).toBe(null)
  })

  it('sanitizes a traversal-looking name by taking its basename', () => {
    const dir = freshDir()
    setEnv({ BACKUP_DIR: dir })
    const resolved = resolveBackupPath(`..${sep}..${sep}swiftmatch_evil.sql`)
    expect(resolved).toBe(join(dir, 'swiftmatch_evil.sql'))
    expect(resolved.startsWith(dir + sep)).toBe(true)
  })

  it('rejects names that do not start with swiftmatch_', () => {
    const dir = freshDir()
    setEnv({ BACKUP_DIR: dir })
    expect(resolveBackupPath('users.sql')).toBe(null)
    expect(resolveBackupPath('passwd')).toBe(null)
  })

  it('rejects empty, null and non-string names', () => {
    const dir = freshDir()
    setEnv({ BACKUP_DIR: dir })
    expect(resolveBackupPath('')).toBe(null)
    expect(resolveBackupPath(null)).toBe(null)
    expect(resolveBackupPath(undefined)).toBe(null)
    expect(resolveBackupPath(42)).toBe(null)
    expect(resolveBackupPath({})).toBe(null)
  })
})

describe('createFileBackup', () => {
  it('creates a zip even when the uploads directory is missing', async () => {
    const dir = freshDir()
    setEnv({ BACKUP_DIR: dir })
    const result = await createFileBackup()

    expect(result.name).toMatch(/^swiftmatch_files_.*\.zip$/)
    expect(result.size).toBeGreaterThan(0)
    expect(existsSync(join(dir, result.name))).toBe(true)
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('File backup created (0 files)'))
  })

  it('walks uploads recursively and stores files with forward-slash paths', async () => {
    const dir = freshDir()
    setEnv({ BACKUP_DIR: dir })
    const uploads = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'uploads')
    const wasPresent = existsSync(uploads)
    mkdirSync(join(uploads, 'avatars'), { recursive: true })
    writeFileSync(join(uploads, 'root.txt'), 'root')
    writeFileSync(join(uploads, 'avatars', 'pic.txt'), 'pic')

    try {
      const result = await createFileBackup()
      expect(result.size).toBeGreaterThan(0)
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('File backup created (2 files)'))

      const zip = readFileSync(join(dir, result.name))
      expect(zip.includes(Buffer.from('avatars/pic.txt'))).toBe(true)
      expect(zip.includes(Buffer.from('root.txt'))).toBe(true)
    } finally {
      rmSync(join(uploads, 'avatars'), { recursive: true, force: true })
      rmSync(join(uploads, 'root.txt'), { force: true })
      if (!wasPresent) rmSync(uploads, { recursive: true, force: true })
    }
  })

  it('prunes backups older than the retention window', async () => {
    const dir = freshDir()
    setEnv({ BACKUP_DIR: dir, BACKUP_RETENTION_DAYS: '7' })
    const stale = join(dir, 'swiftmatch_stale.sql')
    writeFileSync(stale, 'x')
    const longAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
    const { utimesSync } = await import('fs')
    utimesSync(stale, longAgo, longAgo)

    await createFileBackup()

    expect(existsSync(stale)).toBe(false)
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Backup pruned: swiftmatch_stale.sql'))
  })
})

function mockSpawn({ code = 0, stdout = [], stderr = '', error = null }) {
  spawnMock.mockImplementation(() => {
    const child = {
      stdout: { on: vi.fn((evt, cb) => { if (evt === 'data') for (const c of stdout) cb(Buffer.from(c)) }) },
      stderr: { on: vi.fn((evt, cb) => { if (evt === 'data' && stderr) cb(Buffer.from(stderr)) }) },
      on: vi.fn((evt, cb) => {
        if (evt === 'error' && error) cb(error)
        if (evt === 'close') cb(code)
      }),
    }
    return child
  })
}

describe('createBackup', () => {
  it('spawns mysqldump, writes output and returns metadata', async () => {
    const dir = freshDir()
    const fakeDump = join(dir, 'mysqldump-stub.exe')
    writeFileSync(fakeDump, '')
    setEnv({ BACKUP_DIR: dir, MYSQLDUMP_PATH: fakeDump })
    mockSpawn({ code: 0, stdout: ['CREATE TABLE users (id INT);'] })

    const result = await createBackup()

    expect(result.name).toMatch(/^swiftmatch_.*\.sql$/)
    expect(result.size).toBeGreaterThan(0)
    expect(existsSync(join(dir, result.name))).toBe(true)
    expect(spawnMock).toHaveBeenCalledWith(fakeDump, expect.any(Array), { stdio: ['ignore', 'pipe', 'pipe'] })
    const args = spawnMock.mock.calls[0][1]
    expect(args).toContain('--single-transaction')
    expect(args).toContain('--default-character-set=utf8mb4')
    expect(args).toContain('--routines')
    expect(args.some((a) => a.startsWith('-p'))).toBe(false)
  })

  it('passes -p<password> when DB_PASSWORD is set', async () => {
    const dir = freshDir()
    setEnv({ BACKUP_DIR: dir, MYSQLDUMP_PATH: 'mysqldump' })
    process.env.DB_PASSWORD = 'secret'
    mockSpawn({ code: 0, stdout: ['dump'] })

    await createBackup()

    const args = spawnMock.mock.calls[0][1]
    expect(args).toContain('-psecret')
  })

  it('rejects when the mysqldump process cannot start', async () => {
    const dir = freshDir()
    setEnv({ BACKUP_DIR: dir, MYSQLDUMP_PATH: 'mysqldump' })
    mockSpawn({ error: new Error('ENOENT') })

    await expect(createBackup()).rejects.toThrow('mysqldump failed to start: ENOENT')
  })

  it('rejects with stderr when mysqldump exits non-zero', async () => {
    const dir = freshDir()
    setEnv({ BACKUP_DIR: dir, MYSQLDUMP_PATH: 'mysqldump' })
    mockSpawn({ code: 2, stderr: 'Access denied' })

    await expect(createBackup()).rejects.toThrow('mysqldump exited with code 2: Access denied')
  })

  it('falls back to "no stderr" when a failed dump prints nothing', async () => {
    const dir = freshDir()
    setEnv({ BACKUP_DIR: dir, MYSQLDUMP_PATH: 'mysqldump' })
    mockSpawn({ code: 1 })

    await expect(createBackup()).rejects.toThrow('mysqldump exited with code 1: no stderr')
  })

  it('autodetects mysqldump when MYSQLDUMP_PATH is not set', async () => {
    const dir = freshDir()
    setEnv({ BACKUP_DIR: dir })
    mockSpawn({ code: 0, stdout: ['dump'] })

    await createBackup()

    const binary = spawnMock.mock.calls[0][0]
    expect(typeof binary).toBe('string')
    expect(binary.length).toBeGreaterThan(0)
  })

  it('rejects when the dump output cannot be written to disk', async () => {
    const dir = freshDir()
    setEnv({ BACKUP_DIR: dir, MYSQLDUMP_PATH: 'mysqldump' })
    mockSpawn({ code: 0, stdout: ['dump'] })
    writeFileMock.mockRejectedValueOnce(new Error('ENOSPC: no space left on device'))

    await expect(createBackup()).rejects.toThrow('ENOSPC: no space left on device')
  })
})

describe('pruneOldBackups retention boundaries', () => {
  it('keeps files within the retention window and ignores unparsable dates', async () => {
    const dir = freshDir()
    setEnv({ BACKUP_DIR: dir, BACKUP_RETENTION_DAYS: '30' })
    writeFileSync(join(dir, 'swiftmatch_recent.sql'), 'x')
    const recent = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const { utimesSync } = await import('fs')
    utimesSync(join(dir, 'swiftmatch_recent.sql'), recent, recent)

    await createFileBackup()

    expect(existsSync(join(dir, 'swiftmatch_recent.sql'))).toBe(true)
  })

  it('defaults retention to 30 days when BACKUP_RETENTION_DAYS is invalid', async () => {
    const dir = freshDir()
    setEnv({ BACKUP_DIR: dir, BACKUP_RETENTION_DAYS: '-5' })
    const stale = join(dir, 'swiftmatch_old.sql')
    writeFileSync(stale, 'x')
    const longAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)
    const { utimesSync } = await import('fs')
    utimesSync(stale, longAgo, longAgo)

    await createFileBackup()

    expect(existsSync(stale)).toBe(false)
  })

  it('logs a warning instead of throwing when a stale file cannot be removed', async () => {
    const dir = freshDir()
    setEnv({ BACKUP_DIR: dir, BACKUP_RETENTION_DAYS: '7' })
    const stale = join(dir, 'swiftmatch_locked.sql')
    writeFileSync(stale, 'x')
    const longAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
    const { utimesSync } = await import('fs')
    utimesSync(stale, longAgo, longAgo)

    unlinkMock.mockRejectedValueOnce(new Error('EBUSY'))

    await createFileBackup()

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to prune backup swiftmatch_locked.sql'))
    expect(existsSync(stale)).toBe(true)
  })
})

describe('backup dir discovery', () => {
  it('creates files in BACKUP_DIR and lists them back', async () => {
    const dir = freshDir()
    setEnv({ BACKUP_DIR: dir })
    mockSpawn({ code: 0, stdout: ['dump'] })

    const created = await createBackup()
    const listed = await listBackups()

    expect(listed.map((f) => f.name)).toContain(created.name)
    expect(readdirSync(dir)).toContain(created.name)
  })

  it('falls back to <repo>/backups when BACKUP_DIR is unset', async () => {
    setEnv({})
    delete process.env.BACKUP_DIR
    mockSpawn({ code: 0, stdout: ['dump'] })

    const created = await createBackup()

    const fallbackDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'backups')
    expect(existsSync(join(fallbackDir, created.name))).toBe(true)
    rmSync(join(fallbackDir, created.name), { force: true })
    if (readdirSync(fallbackDir).length === 0) rmSync(fallbackDir, { recursive: true, force: true })
  })

  it('falls back to the bare "mysqldump" command when no candidate binary exists', async () => {
    const dir = freshDir()
    setEnv({ BACKUP_DIR: dir, MYSQLDUMP_PATH: 'C:\\definitely\\missing\\mysqldump.exe' })
    existsSyncMock.mockReturnValue(false)
    mockSpawn({ code: 0, stdout: ['dump'] })

    await createBackup()

    expect(spawnMock.mock.calls[0][0]).toBe('mysqldump')
  })
})

describe('listBackups error handling', () => {
  it('rethrows a non-ENOENT readdir failure', async () => {
    const dir = freshDir()
    setEnv({ BACKUP_DIR: dir })
    const err = new Error('EACCES: permission denied')
    err.code = 'EACCES'
    readdirMock.mockRejectedValueOnce(err)

    await expect(listBackups()).rejects.toThrow('EACCES: permission denied')
  })
})
