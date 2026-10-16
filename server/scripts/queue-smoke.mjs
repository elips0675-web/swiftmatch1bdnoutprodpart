/**
 * Смоук очередей на живом Redis (бэклог: «Redis в CI-сервисы + смоук очередей»).
 *
 * Юнит-тесты (`server/src/__tests__/queue-monitor.test.js`) проверяют ветки
 * `getJobCounts`/`getFailed`/`retry` на фейковом источнике — там проверяется
 * модель, а не движок. Здесь те же ветки `queue-monitor.js` идут через
 * настоящий Bull + Redis: джоба дошла, упавшая видна с причиной, `retry`
 * возвращает её в работу. Без сервиса Redis в CI джоба `test-server`
 * пропускала бы это молча, поэтому `REQUIRE_REDIS=1` превращает отсутствие
 * Redis в падение; локально (без флага) смоук честно пропускается.
 */
import Bull from 'bull'
import { queueStats, retryFailed } from '../src/queue-monitor.js'

const requireRedis = process.env.REQUIRE_REDIS === '1' || process.argv.includes('--require')
const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379'

const failures = []
function check(label, ok, extra = '') {
  console.log(`${ok ? 'ok' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`)
  if (!ok) failures.push(label)
}

async function redisReachable(url) {
  const { default: Redis } = await import('ioredis')
  const probe = new Redis(url, {
    lazyConnect: true,
    connectTimeout: 4000,
    retryStrategy: () => null,
    maxRetriesPerRequest: 1,
  })
  probe.on('error', () => {})
  try {
    await probe.connect()
    return (await probe.ping()) === 'PONG'
  } catch {
    return false
  } finally {
    probe.disconnect()
  }
}

async function waitFor(predicate, timeoutMs = 10000) {
  const started = Date.now()
  for (;;) {
    if (await predicate()) return true
    if (Date.now() - started > timeoutMs) return false
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

const reachable = await redisReachable(redisUrl)
if (!reachable) {
  if (requireRedis) {
    console.error(`FAIL: Redis недоступен (${redisUrl}), а REQUIRE_REDIS=1 — смоук очередей обязателен здесь`)
    process.exit(1)
  }
  console.log(`SKIP: Redis недоступен (${redisUrl}) — смоук очередей пропущен (локально это норма)`)
  process.exit(0)
}

const queueName = `smoke-${Date.now()}-${process.pid}`
const q = new Bull(queueName, redisUrl, {
  defaultJobOptions: { attempts: 1, removeOnComplete: false, removeOnFail: false },
})

const failOnce = new Set()
q.process(async (job) => {
  if (job.data.fail && !failOnce.has(String(job.id))) {
    failOnce.add(String(job.id))
    throw new Error('smoke-boom')
  }
  return { ok: true }
})

const source = { redisConfigured: true, emailQueue: q, pushQueue: null, imageQueue: null }

try {
  await q.add({ ok: true })
  check('джоба добавлена → дошла (completed ≥ 1)', await waitFor(async () => (await q.getJobCounts()).completed >= 1))

  await q.add({ fail: true })
  check('упавшая джоба видна (failed ≥ 1)', await waitFor(async () => (await q.getJobCounts()).failed >= 1))

  const stats = await queueStats(source)
  const email = stats.find((entry) => entry.name === 'email')
  check('queueStats: очередь включена и видит упавшую', Boolean(email?.enabled) && email.failed.length >= 1)
  check('queueStats: причина падения сохранена', email?.failed?.[0]?.failedReason === 'smoke-boom', email?.failed?.[0]?.failedReason)

  const retry = await retryFailed('email', source)
  check('retryFailed: джоба поставлена на повтор', retry.retried === 1, JSON.stringify(retry))
  check('после retry джоба дошла (completed ≥ 2)', await waitFor(async () => (await q.getJobCounts()).completed >= 2))
} catch (err) {
  check('смоук выполнился без исключений', false, err.message)
} finally {
  await q.obliterate({ force: true }).catch(() => {})
  await q.close()
}

if (failures.length) {
  console.error(`\nFAIL: смоук очередей на живом Redis не прошёл (${failures.length}): ${failures.join('; ')}`)
  process.exit(1)
}
console.log('\nOK: очереди на живом Redis — джоба дошла, упавшая видна, retry сработал.')
