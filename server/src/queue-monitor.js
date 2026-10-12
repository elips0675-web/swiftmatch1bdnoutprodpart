import * as live from './queue.js'
import { rootLogger } from './logger.js'
import { sendCustomEmail } from './mail.js'

export const QUEUE_NAMES = ['email', 'push', 'image']

const FAILED_PAGE = 1000

// P2 #21: «очередь забита» — это не единичный ретрай, а завал waiting+delayed.
// Дефолт согласован с QUEUE_KEEP_FAILED и FAILED_PAGE: 1000 накопившихся джоб.
export const QUEUE_ALERT_THRESHOLD =
  Number(process.env.QUEUE_ALERT_THRESHOLD) > 0 ? Number(process.env.QUEUE_ALERT_THRESHOLD) : 1000

const QUEUE_ALERT_COOLDOWN_MS = 60 * 60 * 1000
const BACKPRESSURE_INTERVAL_MS = 5 * 60 * 1000

export function resolveQueues(source = live) {
  return QUEUE_NAMES
    .map((name) => ({ name, queue: source[`${name}Queue`] }))
    .filter((entry) => entry.queue)
}

function serializeFailed(job) {
  return {
    id: job.id,
    name: job.name,
    attemptsMade: job.attemptsMade,
    failedReason: job.failedReason,
    data: job.data,
  }
}

export async function queueStats(source = live) {
  const active = new Map(resolveQueues(source).map((entry) => [entry.name, entry.queue]))
  const stats = []
  for (const name of QUEUE_NAMES) {
    const queue = active.get(name)
    if (!queue) {
      stats.push({ name, enabled: false, counts: null, failed: [] })
      continue
    }
    const counts = await queue.getJobCounts()
    const failed = await queue.getFailed(0, FAILED_PAGE - 1)
    stats.push({ name, enabled: true, counts, failed: failed.map(serializeFailed) })
  }
  return stats
}

export function redisConfigured(source = live) {
  return Boolean(source.redisConfigured)
}

export async function retryFailed(name, source = live) {
  const entry = resolveQueues(source).find((item) => item.name === name)
  if (!entry) return { name, available: false, total: 0, retried: 0, failed: 0 }
  const jobs = await entry.queue.getFailed(0, FAILED_PAGE - 1)
  let retried = 0
  for (const job of jobs) {
    try {
      await job.retry()
      retried += 1
    } catch (err) {
      rootLogger.error(`[queue] retry failed for ${name} job ${job.id}: ${err.message}`)
    }
  }
  return { name, available: true, total: jobs.length, retried, failed: jobs.length - retried }
}

export function queueNames() {
  return QUEUE_NAMES
}

export function backloggedQueues(stats, threshold = QUEUE_ALERT_THRESHOLD) {
  return stats
    .filter((entry) => entry.enabled && entry.counts)
    .map((entry) => ({
      name: entry.name,
      waiting: Number(entry.counts.waiting) || 0,
      delayed: Number(entry.counts.delayed) || 0,
      failed: Number(entry.counts.failed) || 0,
    }))
    .filter((entry) => entry.waiting + entry.delayed >= threshold)
}

export function formatBacklogAlert(queues) {
  const rows = queues
    .map((q) => `<li><strong>${q.name}</strong>: waiting ${q.waiting}, delayed ${q.delayed}, failed ${q.failed}</li>`)
    .join('')
  return {
    subject: 'SwiftMatch: queue backlog',
    html: `<p>Очереди копят джобы быстрее, чем разгребают (порог превышен):</p><ul>${rows}</ul>`,
  }
}

async function sendBacklogAlert(queues) {
  const to = process.env.ADMIN_EMAIL
  if (!to) {
    rootLogger.warn('[queue] backlog detected but ADMIN_EMAIL is not set — alert skipped')
    return
  }
  const { subject, html } = formatBacklogAlert(queues)
  await sendCustomEmail(to, subject, html)
}

export function createBackpressureAlerter({
  source = live,
  threshold = QUEUE_ALERT_THRESHOLD,
  cooldownMs = QUEUE_ALERT_COOLDOWN_MS,
  send = sendBacklogAlert,
  now = Date.now,
  logger = rootLogger,
} = {}) {
  let lastAlertAt = 0

  return async function checkBackpressure() {
    if (!redisConfigured(source)) {
      return { alerted: false, reason: 'disabled', queues: [] }
    }

    let stats
    try {
      stats = await queueStats(source)
    } catch (err) {
      logger.error(`[queue] backpressure check failed: ${err.message}`)
      return { alerted: false, reason: 'error', queues: [] }
    }

    const queues = backloggedQueues(stats, threshold)
    if (queues.length === 0) return { alerted: false, reason: 'ok', queues: [] }
    if (now() - lastAlertAt < cooldownMs) return { alerted: false, reason: 'cooldown', queues }

    try {
      await send(queues)
      lastAlertAt = now()
      logger.warn(`[queue] backlog alert sent: ${queues.map((q) => q.name).join(', ')}`)
      return { alerted: true, reason: 'sent', queues }
    } catch (err) {
      logger.error(`[queue] backlog alert failed: ${err.message}`)
      return { alerted: false, reason: 'error', queues }
    }
  }
}

let backpressureTimer = null

export function startQueueBackpressureMonitor({ intervalMs = BACKPRESSURE_INTERVAL_MS, ...options } = {}) {
  if (backpressureTimer) return backpressureTimer
  const check = createBackpressureAlerter(options)
  backpressureTimer = setInterval(() => {
    check().catch((err) => rootLogger.error(`[queue] backpressure timer failed: ${err.message}`))
  }, intervalMs)
  backpressureTimer.unref?.()
  return backpressureTimer
}

export function stopQueueBackpressureMonitor() {
  if (!backpressureTimer) return
  clearInterval(backpressureTimer)
  backpressureTimer = null
}
