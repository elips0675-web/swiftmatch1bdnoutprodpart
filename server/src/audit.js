import pool from './db.js'
import logger from './logger.js'

const ALLOWED_TABLES = new Set(['users', 'user_profiles', 'user_photos', 'chats', 'messages'])

function validateTableName(tableName) {
  if (!ALLOWED_TABLES.has(tableName)) {
    throw new Error(`Invalid table name: ${tableName}`)
  }
}

export async function auditLog({ tableName, recordId, action, oldValues, newValues, userId, ipAddress }) {
  try {
    await pool.query(
      'INSERT INTO audit_log (table_name, record_id, action, old_values, new_values, user_id, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [tableName, recordId, action, oldValues ? JSON.stringify(oldValues) : null, newValues ? JSON.stringify(newValues) : null, userId || null, ipAddress || null],
    )
  } catch (err) {
    logger.error('Audit log error:', err.message)
  }
}

/**
 * Пишет 'update'-запись только по фактически изменившимся полям (L7): история
 * изменений профиля не должна быть шумом из «пересохранил то же самое».
 * Сравнение строковое, чтобы mysql2-вые DATE (объект Date) и пришедшие с
 * клиента 'YYYY-MM-DD', числа и их строковые формы на одной строке не считались
 * изменением; undefined в newValues — это «поле не трогали» (COALESCE), такой
 * ключ пропускается.
 */
export async function auditUpdate({ tableName, recordId, oldValues, newValues, userId, ipAddress }) {
  const changedOld = {}
  const changedNew = {}
  for (const [key, next] of Object.entries(newValues)) {
    if (next === undefined) continue
    const prev = oldValues ? oldValues[key] : undefined
    if (String(prev ?? '') !== String(next ?? '')) {
      changedOld[key] = prev ?? null
      changedNew[key] = next
    }
  }
  if (Object.keys(changedNew).length === 0) return
  await auditLog({ tableName, recordId, action: 'update', oldValues: changedOld, newValues: changedNew, userId, ipAddress })
}

export async function softDelete(tableName, id, userId, ipAddress) {
  validateTableName(tableName)
  await pool.query(`UPDATE \`${tableName}\` SET deleted_at = NOW() WHERE id = ?`, [id])
  await auditLog({ tableName, recordId: id, action: 'delete', userId, ipAddress })
}

export async function softDeleteWhere(tableName, whereClause, params, userId, ipAddress) {
  validateTableName(tableName)
  await pool.query(`UPDATE \`${tableName}\` SET deleted_at = NOW() WHERE ${whereClause}`, params)
  await auditLog({ tableName, recordId: null, action: 'delete_bulk', oldValues: { where: whereClause }, userId, ipAddress })
}
