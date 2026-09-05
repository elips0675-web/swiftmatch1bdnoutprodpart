import { Router } from 'express'
import crypto from 'crypto'

// CSRF double-submit (этап «вынос API на поддомен»).
// Код готов и покрыт тестами; глобальная активация guard — одной строкой
// в index.js при переносе API на отдельный домен (см. roadmap).
const isProduction = process.env.NODE_ENV === 'production'

export const CSRF_COOKIE = isProduction ? '__Host-csrf' : 'csrf_token'
export const CSRF_HEADER = 'x-csrf-token'

const cookieOptions = {
  httpOnly: false, // double-submit: клиент обязан читать токен и слать его в header
  secure: isProduction,
  sameSite: 'lax',
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000,
}

function makeToken() {
  return crypto.randomBytes(24).toString('hex')
}

// Выдаёт/восстанавливает CSRF-токен (cookie + res.locals.csrfToken).
// Безопасен в любой точке: только записывает cookie, ничего не блокирует.
export function csrf(req, res, next) {
  const existing = req.cookies?.[CSRF_COOKIE]
  const token = typeof existing === 'string' && existing.length >= 16 ? existing : makeToken()
  if (token !== existing) {
    res.cookie(CSRF_COOKIE, token, cookieOptions)
  }
  res.locals.csrfToken = token
  next()
}

// Double-submit guard для state-changing запросов при вынесенном API:
// если браузер прислал CSRF-cookie, мутирующий запрос обязан нести такой же
// заголовок x-csrf-token (cross-site attacker не может прочитать/подделать cookie).
export function csrfGuard(req, res, next) {
  const cookie = req.cookies?.[CSRF_COOKIE]
  if (!cookie) return next() // нет выданной cookie → нечего защищать
  const header = req.headers[CSRF_HEADER]
  if (typeof header !== 'string' || header !== cookie) {
    return res.status(403).json({ error: 'CSRF_MISMATCH' })
  }
  next()
}

export const csrfRouter = Router()
// Токен раздаётся глобальным middleware (app.use(csrf)); роут лишь отдаёт его.
csrfRouter.get('/api/auth/csrf', (req, res) => {
  res.json({ token: res.locals.csrfToken || req.cookies?.[CSRF_COOKIE] || null })
})