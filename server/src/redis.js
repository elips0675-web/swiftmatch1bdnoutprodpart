import Redis from 'ioredis'
import logger from './logger.js'

const REDIS_URL = process.env.REDIS_URL

let client = null
let pubClient = null
let subClient = null
let connected = false

function createRedisClient() {
  if (!REDIS_URL) return null
  const opts = {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      return Math.min(times * 200, 10_000)
    },
    connectTimeout: 3000,
  }
  if (process.env.NODE_ENV !== 'test') {
    opts.lazyConnect = true
  }
  return new Redis(REDIS_URL, opts)
}

function attachListeners(redisClient, label) {
  redisClient.on('error', (err) => {
    logger.error(`[redis] ${label} connection error`, err)
  })
  redisClient.on('connect', () => {
    logger.info(`[redis] ${label} connected`)
  })
  redisClient.on('close', () => {
    logger.info(`[redis] ${label} connection closed`)
  })
}

export function getRedis() {
  if (!REDIS_URL) {
    if (!connected) {
      logger.info('Redis not configured — skipping')
      connected = true
    }
    return null
  }
  if (client) return client

  client = createRedisClient()
  attachListeners(client, 'client')
  return client
}

export function getRedisPub() {
  if (!REDIS_URL) return null
  if (pubClient) return pubClient
  pubClient = createRedisClient()
  attachListeners(pubClient, 'pub')
  return pubClient
}

export function getRedisSub() {
  if (!REDIS_URL) return null
  if (subClient) return subClient
  subClient = createRedisClient()
  attachListeners(subClient, 'sub')
  return subClient
}

export async function isRedisReady(timeoutMs = 1500) {
  if (!REDIS_URL) return false
  const pub = getRedisPub()
  const sub = getRedisSub()
  if (pub.status === 'ready' && sub.status === 'ready') return true
  try {
    await Promise.race([
      Promise.all([
        pub.connect().catch(() => {}),
        sub.connect().catch(() => {}),
      ]),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ])
  } catch {
    /* ignored — Redis unreachable */
  }
  return pub.status === 'ready' && sub.status === 'ready'
}

export async function withRedis(fn) {
  const r = getRedis()
  if (!r) return null
  try {
    return await fn(r)
  } catch (err) {
    logger.error('[redis] operation failed', err)
    return null
  }
}

export async function disconnectRedis() {
  for (const [label, c] of [['client', client], ['pub', pubClient], ['sub', subClient]]) {
    if (c) {
      await c.quit().catch(() => {})
      logger.info(`[redis] ${label} disconnected`)
    }
  }
  client = null
  pubClient = null
  subClient = null
  connected = false
}
