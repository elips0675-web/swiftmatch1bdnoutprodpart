import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { ACCESS_COOKIE } from './cookies.js'

let devJwtSecretCache = null

function getJwtSecret() {
  if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in environment for production')
  }
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET
  // В dev без JWT_SECRET генерируем и кешируем один секрет на время процесса,
  // чтобы подпись и проверка токенов использовали один и тот же ключ.
  if (!devJwtSecretCache) {
    devJwtSecretCache = crypto.randomBytes(32).toString('hex')
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
