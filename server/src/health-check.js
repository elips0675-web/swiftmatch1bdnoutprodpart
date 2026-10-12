import pool from './db.js'
import { withRedis } from './redis.js'
import { integrationModes } from './runtime.js'

const CONFIG_SERVICES = [
  { name: 'smtp', modeKey: 'smtp' },
  { name: 'stripe', modeKey: 'stripe' },
  { name: 'openai', modeKey: 'moderation' },
  { name: 'fcm', modeKey: 'fcm' },
]

function configStatus(mode) {
  if (mode === 'live') return 'ok'
  if (mode === 'unavailable') return 'error'
  return 'mock'
}

export async function collectHealth() {
  const modes = integrationModes()
  const services = []

  const dbStart = Date.now()
  try {
    await pool.query('SELECT 1')
    services.push({ name: 'database', kind: 'probe', status: 'ok', mode: 'live', latencyMs: Date.now() - dbStart })
  } catch {
    services.push({ name: 'database', kind: 'probe', status: 'error', mode: 'live', latencyMs: Date.now() - dbStart })
  }

  if (modes.redis !== 'live') {
    services.push({ name: 'redis', kind: 'probe', status: 'mock', mode: 'mock', latencyMs: 0 })
  } else {
    const redisStart = Date.now()
    const pong = await withRedis((c) => c.ping())
    services.push({ name: 'redis', kind: 'probe', status: pong === 'PONG' ? 'ok' : 'error', mode: 'live', latencyMs: Date.now() - redisStart })
  }

  for (const svc of CONFIG_SERVICES) {
    const mode = modes[svc.modeKey]
    services.push({ name: svc.name, kind: 'config', status: configStatus(mode), mode, latencyMs: 0 })
  }

  const status = services.some((s) => s.status === 'error') ? 'degraded' : 'ok'
  return { status, checkedAt: new Date().toISOString(), services }
}
