import Bull from 'bull'
import { rootLogger } from './logger.js'

const REDIS_URL = process.env.REDIS_URL
const DEFAULT_TTL = 60_000
// removeOnFail=50 молча вытеснял упавшие джобы: письмо/пуш терялись без следа.
// Держим больше (настраиваемо), чтобы их было видно в /api/admin/queues и можно было повторить.
const KEEP_FAILED = Number(process.env.QUEUE_KEEP_FAILED) > 0 ? Number(process.env.QUEUE_KEEP_FAILED) : 1000

export let emailQueue = null
export let pushQueue = null
export let imageQueue = null

const queues = []

function createQueue(name) {
  if (!REDIS_URL) {
    rootLogger.info(`[queue] Redis not configured — ${name} queue disabled`)
    return null
  }
  const q = new Bull(name, REDIS_URL, {
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 100,
      removeOnFail: KEEP_FAILED,
    },
    settings: {
      lockDuration: DEFAULT_TTL,
      stalledInterval: 30_000,
      maxStalledCount: 2,
    },
  })

  q.on('completed', (job) => {
    rootLogger.info(`[queue] ${name} job ${job.id} completed`, { jobName: name, jobId: job.id })
  })

  q.on('failed', (job, err) => {
    rootLogger.error(`[queue] ${name} job ${job.id} failed: ${err.message}`, { jobName: name, jobId: job.id, error: err.message })
  })

  q.on('error', (err) => {
    rootLogger.error(`[queue] ${name} error: ${err.message}`, { jobName: name, error: err.message })
  })

  queues.push(q)
  return q
}

export function initQueues() {
  // Этап 42 (аудит kimi 2.3): если REDIS_URL задан, но Redis недостижим,
  // ioredis внутри Bull падает фатальным "Connection is closed" и роняет процесс.
  // Контракт graceful degradation: очередь отключается, mail.js уходит в fallback.
  redisReachable().then((ok) => {
    try {
      if (!ok) {
        rootLogger.warn('[queue] Redis unreachable — all queues disabled, jobs will use direct fallback')
        return
      }

      emailQueue = createQueue('email')
      pushQueue = createQueue('push')
      imageQueue = createQueue('image')

      if (emailQueue) {
        emailQueue.process(async (job) => {
          const { default: processEmail } = await import('./jobs/email.job.js')
          await processEmail(job)
        })
      }

      if (pushQueue) {
        pushQueue.process(async (job) => {
          const { default: processPush } = await import('./jobs/push.job.js')
          await processPush(job)
        })
      }

      if (imageQueue) {
        imageQueue.process(async (job) => {
          const { default: processImage } = await import('./jobs/image.job.js')
          await processImage(job)
        })
      }

      rootLogger.info('[queue] Queues initialized')
    } catch (err) {
      rootLogger.error(`[queue] init failed — queues disabled: ${err.message}`)
      emailQueue = null
      pushQueue = null
      imageQueue = null
    }
  })
}

// Одноразовый probe-клиент: проверяем достижимость Redis до создания Bull-очередей
async function redisReachable() {
  if (!REDIS_URL) return false
  const { default: Redis } = await import('ioredis')
  const probe = new Redis(REDIS_URL, {
    lazyConnect: true,
    connectTimeout: 4000,
    retryStrategy: () => null,
    maxRetriesPerRequest: 1,
  })
  probe.on('error', () => {})
  try {
    await probe.connect()
    return (await probe.ping()) === 'PONG'
  } catch (err) {
    rootLogger.warn(`[queue] Redis probe failed: ${err.message}`)
    return false
  } finally {
    probe.disconnect()
  }
}

export async function closeQueues() {
  if (queues.length === 0) return
  rootLogger.info('[queue] Closing queues...')
  await Promise.allSettled(queues.map(q => q.close()))
  rootLogger.info('[queue] All queues closed')
}

export default { emailQueue, pushQueue, imageQueue, initQueues, closeQueues }
