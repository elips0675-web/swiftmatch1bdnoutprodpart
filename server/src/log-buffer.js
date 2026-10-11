/**
 * Кольцевой буфер последних warn/error записей лога (G3 #36).
 *
 * Раздельный модуль, чтобы админ-эндпоинт логов и юнит-тесты не тянули
 * winston: буфер — это просто массив с лимитом, а winston-транспорт
 * (logger.js) наполняет его через pushLogEntry.
 *
 * Лимит 200: диагностика последних 500 не требует 20 КБ записей, а вот
 * гарантированный предел памяти важен — роуты могут массово катать error.
 */

const RECENT_LIMIT = 200
const entries = []

export function pushLogEntry(level, message, meta = {}) {
  entries.push({
    ts: meta.ts || new Date().toISOString(),
    level,
    message,
    error: meta.error != null ? String(meta.error) : null,
    stack: meta.stack != null ? String(meta.stack) : null,
    rid: meta.rid != null ? String(meta.rid) : null,
  })
  if (entries.length > RECENT_LIMIT) entries.splice(0, entries.length - RECENT_LIMIT)
}

export function getRecentLogs() {
  return entries.slice()
}

export function resetRecentLogs() {
  entries.length = 0
}