// P3 #29 (qwen #29): GDPR-экспорт данных пользователя одним ZIP — data.json +
// локальные фото + README. JSON-ответ `GET /api/data/export` остаётся как был
// (на него завязаны фронт и E2E), ZIP включается опцией `?format=zip`.
import { readFile } from 'fs/promises'
import { dirname, basename, resolve, sep } from 'path'
import { fileURLToPath } from 'url'
import { buildZip } from './zip.js'
import { dateOnly } from './date-only.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEFAULT_UPLOADS_DIR = resolve(__dirname, '..', 'uploads')

export const PHOTOS_PREFIX = 'photos/'

export const EXPORT_README = [
  'Экспорт данных SwiftMatch (GDPR).',
  '',
  'data.json — профиль, фото (метаданные), лайки, мэтчи, чаты, сообщения,',
  'подписки, согласия и журнал активности.',
  'photos/ — файлы фото, загруженных на сервер SwiftMatch.',
  'Фото во внешнем хранилище (S3/CDN) в архив не вложены — их адреса есть',
  'в data.json (поле photos[].url).',
  '',
].join('\n')

export async function buildExportPayload(db, userId, { now = () => new Date() } = {}) {
  const [[user]] = await db.query('SELECT id, email, is_active, created_at FROM users WHERE id = ?', [userId])
  if (!user) return null

  const [[profileRow]] = await db.query('SELECT * FROM user_profiles WHERE id = ?', [userId])
  const profile = profileRow ? { ...profileRow, birth_date: dateOnly(profileRow.birth_date) } : undefined
  const [photos] = await db.query('SELECT id, url, sort_order, is_avatar, created_at FROM user_photos WHERE user_id = ?', [userId])
  const [likes] = await db.query('SELECT id, from_user_id, to_user_id, type, created_at FROM likes WHERE from_user_id = ? OR to_user_id = ?', [userId, userId])
  const [matches] = await db.query('SELECT id, user1_id, user2_id, created_at FROM matches WHERE user1_id = ? OR user2_id = ?', [userId, userId])
  const [chats] = await db.query(
    `SELECT c.id, c.created_at FROM chats c
     JOIN chat_participants cp ON cp.chat_id = c.id
     WHERE cp.user_id = ?`,
    [userId],
  )
  const [messages] = await db.query(
    `SELECT m.id, m.chat_id, m.text, m.created_at FROM messages m
     JOIN chat_participants cp ON cp.chat_id = m.chat_id AND cp.user_id = ?
     WHERE m.sender_id = ?`,
    [userId, userId],
  )
  const [subscriptions] = await db.query('SELECT id, tier, duration_months, price, started_at, expires_at, is_active FROM subscriptions WHERE user_id = ?', [userId])
  const [consents] = await db.query('SELECT id, consent_type, granted, ip_address, created_at FROM consent_log WHERE user_id = ?', [userId])
  const [activity] = await db.query('SELECT id, action_type, target_id, created_at FROM activity_log WHERE user_id = ?', [userId])

  return {
    exported_at: now().toISOString(),
    user: { id: user.id, email: user.email, registered_at: user.created_at },
    profile,
    photos,
    likes,
    matches,
    chats,
    messages,
    subscriptions,
    consents,
    activity,
  }
}

// Разрешает локальный путь фото только внутри uploads-каталога. S3/внешние URL
// (http…), вложенные пути и любые выходы за каталог (`../`, абсолютный путь)
// возвращают null — иначе экспорт превратился бы в чтение произвольных файлов
// сервера. Загрузчик кладёт фото плоско (uploads/<имя>), поэтому путь с «/» или
// «\» — уже аномалия.
export function resolveLocalPhotoPath(url, uploadsDir = DEFAULT_UPLOADS_DIR) {
  if (typeof url !== 'string' || !url.startsWith('/uploads/')) return null
  const name = url.slice('/uploads/'.length)
  if (!name || name === '.' || name === '..') return null
  if (name.includes('/') || name.includes('\\')) return null
  const full = resolve(uploadsDir, name)
  const root = resolve(uploadsDir) + sep
  return full.startsWith(root) ? full : null
}

export async function buildExportArchive({ db, userId, uploadsDir = DEFAULT_UPLOADS_DIR, now = () => new Date() } = {}) {
  const payload = await buildExportPayload(db, userId, { now })
  if (!payload) return null

  const files = [{ path: 'data.json', data: Buffer.from(JSON.stringify(payload, null, 2), 'utf8') }]

  for (const photo of payload.photos ?? []) {
    const full = resolveLocalPhotoPath(photo.url, uploadsDir)
    if (!full) continue
    try {
      files.push({ path: `${PHOTOS_PREFIX}${photo.id}_${basename(full)}`, data: await readFile(full) })
    } catch {
      // Файла нет на диске — метаданные остались в data.json, архив не падает.
    }
  }

  files.push({ path: 'README.txt', data: Buffer.from(EXPORT_README, 'utf8') })

  const buffer = buildZip(files)
  const ts = now().toISOString().replace(/[:.]/g, '-')
  return { buffer, filename: `swiftmatch-data-${ts}.zip`, payload }
}
