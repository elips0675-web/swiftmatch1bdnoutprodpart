// P3 #28 (qwen #28): еженедельная сводка админу — новые юзеры/мэтчи/выручка/жалобы.
// Письмо — на ADMIN_EMAIL (как алерт очереди, server/src/queue-monitor.js:95), таймер
// недельный с unref() (как startNotificationCleanup, server/src/cleanup.js:46).
import pool from './db.js'
import { rootLogger } from './logger.js'
import { sendCustomEmail } from './mail.js'

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000

function isoDay(date) {
  return date.toISOString().slice(0, 10)
}

export function resolveRecipient(env = process.env) {
  const to = env.ADMIN_EMAIL
  return to && to.trim() ? to.trim() : null
}

export async function buildWeeklySummary(db = pool, { since, until = new Date() } = {}) {
  const to = until instanceof Date ? until : new Date(until)
  const from = since instanceof Date ? since : since ? new Date(since) : new Date(to.getTime() - WEEK_MS)

  const [[users]] = await db.query(
    'SELECT COUNT(*) AS count FROM users WHERE created_at >= ? AND created_at < ?',
    [from, to],
  )
  const [[matches]] = await db.query(
    'SELECT COUNT(*) AS count FROM matches WHERE matched = 1 AND created_at >= ? AND created_at < ?',
    [from, to],
  )
  const [[revenue]] = await db.query(
    'SELECT COALESCE(SUM(price), 0) AS amount FROM subscriptions WHERE started_at >= ? AND started_at < ?',
    [from, to],
  )
  const [[complaints]] = await db.query(
    'SELECT COUNT(*) AS count FROM reports WHERE created_at >= ? AND created_at < ?',
    [from, to],
  )

  return {
    from: isoDay(from),
    to: isoDay(to),
    newUsers: Number(users?.count) || 0,
    matches: Number(matches?.count) || 0,
    revenue: Math.round((Number(revenue?.amount) || 0) * 100) / 100,
    complaints: Number(complaints?.count) || 0,
  }
}

export function formatWeeklyReport(summary) {
  const subject = `SwiftMatch: недельная сводка ${summary.from} — ${summary.to}`
  const html = [
    `<p>Сводка за период ${summary.from} — ${summary.to}:</p>`,
    '<ul>',
    `<li>Новые пользователи: <strong>${summary.newUsers}</strong></li>`,
    `<li>Мэтчи: <strong>${summary.matches}</strong></li>`,
    `<li>Выручка: <strong>${summary.revenue}</strong></li>`,
    `<li>Жалобы: <strong>${summary.complaints}</strong></li>`,
    '</ul>',
  ].join('')
  return { subject, html }
}

export async function sendWeeklyReport({
  db = pool,
  send = sendCustomEmail,
  logger = rootLogger,
  env = process.env,
  now = () => new Date(),
} = {}) {
  const to = resolveRecipient(env)
  if (!to) {
    logger.warn('[weekly-report] ADMIN_EMAIL is not set — weekly report skipped')
    return { sent: false, reason: 'no-recipient' }
  }

  let summary
  try {
    summary = await buildWeeklySummary(db, { until: now() })
  } catch (err) {
    logger.error(`[weekly-report] summary build failed: ${err.message}`)
    return { sent: false, reason: 'error' }
  }

  const { subject, html } = formatWeeklyReport(summary)
  try {
    await send(to, subject, html)
  } catch (err) {
    logger.error(`[weekly-report] send failed: ${err.message}`)
    return { sent: false, reason: 'error', summary }
  }

  logger.info(`[weekly-report] weekly summary sent to ${to}`)
  return { sent: true, reason: 'sent', summary }
}

let weeklyTimer = null

export function startWeeklyReportMonitor({ intervalMs = WEEK_MS, ...options } = {}) {
  if (weeklyTimer) return weeklyTimer
  weeklyTimer = setInterval(() => {
    sendWeeklyReport(options).catch((err) =>
      rootLogger.error(`[weekly-report] timer failed: ${err.message}`),
    )
  }, intervalMs)
  weeklyTimer.unref?.()
  return weeklyTimer
}

// Безопасен без предварительного запуска: graceful shutdown зовёт его и на путях,
// где таймер не поднимался (как stopQueueBackpressureMonitor, queue-monitor.js:156).
export function stopWeeklyReportMonitor() {
  if (!weeklyTimer) return
  clearInterval(weeklyTimer)
  weeklyTimer = null
}
