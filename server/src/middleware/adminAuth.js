import pool from '../db.js'
import { rootLogger } from '../logger.js'
import { verifyToken } from '../middleware.js'
import { ACCESS_COOKIE } from '../cookies.js'

function decodeAny(...tokens) {
  // Cookie — приоритетный источник: легаси-Bearer из storage может принадлежать
  // не-админу и не должен перекрывать актуальную админскую сессию
  for (const token of tokens) {
    if (!token) continue
    try {
      return verifyToken(token)
    } catch { /* невалидный токен — проверяем следующий источник */ }
  }
  return null
}

export async function adminAuth(req, res, next) {
  const header = req.headers?.authorization
  const headerToken = header && header.startsWith('Bearer ') ? header.split(' ')[1] : null
  const decoded = decodeAny(req.cookies?.[ACCESS_COOKIE], headerToken)
  if (!decoded) {
    return res.status(401).json({ message: 'ADMIN_REQUIRED' })
  }

  try {
    const [rows] = await pool.query(
      'SELECT id, email, role FROM users WHERE id = ? AND role = ? AND is_active = 1',
      [decoded.userId, 'admin'],
    )
    if (rows.length === 0) {
      return res.status(403).json({ message: 'ADMIN_REQUIRED' })
    }
    req.admin = rows[0]
    next()
  } catch (err) {
    rootLogger.error('adminAuth DB error:', err)
    return res.status(500).json({ message: 'ADMIN_CHECK_FAILED' })
  }
}
