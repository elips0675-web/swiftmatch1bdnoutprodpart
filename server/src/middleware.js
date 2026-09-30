import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { ACCESS_COOKIE } from './cookies.js'

const DEV_SECRET_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.jwt-dev-secret')

let devJwtSecretCache = null

// В dev без JWT_SECRET секрет обязан переживать перезапуск процесса: иначе
// каждый рестарт API перестаёт проверять ранее выданные токены, и все сессии
// молча умирают (пользователь видит пустые приватные страницы вместо входа).
// Поэтому секрет хранится в git-игнорируемом файле рядом с server/.
function loadOrCreateDevSecret() {
  try {
    const saved = fs.readFileSync(DEV_SECRET_FILE, 'utf8').trim()
    if (saved) return saved
  } catch { /* файла ещё нет — создаём ниже */ }
  const secret = crypto.randomBytes(32).toString('hex')
  try {
    fs.writeFileSync(DEV_SECRET_FILE, secret, { mode: 0o600 })
    console.warn(`[auth] JWT_SECRET не задан: создан dev-секрет ${DEV_SECRET_FILE}. Сессии переживут перезапуск.`)
  } catch { /* ФС только для чтения — остаёмся на секрете в памяти процесса */ }
  return secret
}

// Плейсхолдеры из .env.example / .env / docker-compose.yml. Пока JWT_SECRET
// равно одному из них, ключ лежит в публичном репозитории:anyone может подписать
// себе admin-токен. Пустой секрет проверялся (строка ниже), плейсхолдерный — нет,
// а именно он и получается, когда прод-`.env` потерян и пересоздан из примера
// (этап 20, P0-C: rsync --delete стирал .env на VPS, дальше шла строка
// `test -f .env || cp .env.example .env`).
const INSECURE_JWT_SECRETS = new Set([
  'change-me-to-a-long-random-secret',
  'change-this-to-a-random-256-bit-secret',
  'change-me-in-production',
  'change-me',
  'secret',
  'test',
])

function isInsecureJwtSecret(value) {
  if (typeof value !== 'string') return false
  const normalized = value.trim().toLowerCase()
  if (INSECURE_JWT_SECRETS.has(normalized)) return true
  return normalized.length < 32
}

function getJwtSecret() {
  if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in environment for production')
  }
  if (process.env.JWT_SECRET) {
    if (process.env.NODE_ENV === 'production' && isInsecureJwtSecret(process.env.JWT_SECRET)) {
      throw new Error(
        'JWT_SECRET is a known placeholder from .env.example or is shorter than 32 chars. '
        + 'Set a random secret (openssl rand -hex 32) before starting in production.',
      )
    }
    return process.env.JWT_SECRET
  }
  if (!devJwtSecretCache) {
    devJwtSecretCache = loadOrCreateDevSecret()
  }
  return devJwtSecretCache
}

function getPreviousJwtSecrets() {
  return (process.env.JWT_SECRET_PREV || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => s !== process.env.JWT_SECRET)
}

// jsonwebtoken 9 НЕ умеет принимать массив секретов (verify.js:120-130 tries
// createPublicKey/createSecretKey от массива и падает с 'not valid key
// material'), поэтому перебор ключей делаем сами. Это graceful rotation: при
// смене JWT_SECRET токены, подписанные ключом из JWT_SECRET_PREV, остаются
// валидными, а новые подписываются только текущим. Без этого смена секрета
// разлогинивает всех пользователей сразу.
function verifyToken(token) {
  const previous = getPreviousJwtSecrets()
  if (previous.length === 0) return jwt.verify(token, getJwtSecret())

  let lastError = null
  for (const secret of [getJwtSecret(), ...previous]) {
    try {
      return jwt.verify(token, secret)
    } catch (err) {
      // Подпись совпала, но TTL вышел — такой токен expired при любом ключе,
      // поэтому сохраняем именно эту ошибку вместо 'invalid signature'.
      if (err && err.name === 'TokenExpiredError') throw err
      lastError = err
    }
  }
  throw lastError
}

function decodeAny(...tokens) {
  // Cookie — приоритетный источник: легаси-Bearer из storage может принадлежать
  // другому пользователю и не должен перекрывать актуальную веб-сессию
  for (const token of tokens) {
    if (!token) continue
    try {
      return verifyToken(token)
    } catch { /* невалидный токен — проверяем следующий источник */ }
  }
  return null
}

function getTokens(req) {
  const header = req.headers?.authorization
  const headerToken = header && header.startsWith('Bearer ') ? header.split(' ')[1] : null
  return [headerToken, req.cookies?.[ACCESS_COOKIE]]
}

export function auth(req, res, next) {
  const [headerToken, cookieToken] = getTokens(req)
  const decoded = decodeAny(cookieToken, headerToken)
  if (!decoded) {
    const hasAny = Boolean(headerToken || cookieToken)
    return res.status(401).json({ message: hasAny ? 'Invalid or expired token' : 'Authentication required' })
  }
  // Бан: WEB-сессия разлогинивается мгновенно через WS-событие user:banned
  // (emit + принудительный disconnect сокетов, см. admin/users.js:notifyBanned),
  // а клиент (use-websocket.ts) слушает событие и вызывает logout().
  req.userId = decoded.userId
  next()
}

export function optionalAuth(req, res, next) {
  const [headerToken, cookieToken] = getTokens(req)
  const decoded = decodeAny(cookieToken, headerToken)
  req.userId = decoded ? decoded.userId : null
  next()
}

export { getJwtSecret as JWT_SECRET, verifyToken }
