import * as live from './queue.js'
import { rootLogger } from './logger.js'

export const QUEUE_NAMES = ['email', 'push', 'image']

const FAILED_PAGE = 1000

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
  const stats = []
  for (const { name, queue } of resolveQueues(source)) {
    const counts = await queue.getJobCounts()
    const failed = await queue.getFailed(0, FAILED_PAGE - 1)
    stats.push({ name, counts, failed: failed.map(serializeFailed) })
  }
  return stats
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
