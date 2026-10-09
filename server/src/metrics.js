import client from 'prom-client'

const register = new client.Registry()

client.collectDefaultMetrics({ register })

const httpRequestCount = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
})

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  registers: [register],
})

const dbQueryDuration = new client.Histogram({
  name: 'db_query_duration_seconds',
  help: 'Database query duration in seconds',
  labelNames: ['query'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
  registers: [register],
})

export const wsConnectionsGauge = new client.Gauge({
  name: 'ws_connections_active',
  help: 'Active WebSocket connections',
  registers: [register],
})

export const wsRoomsGauge = new client.Gauge({
  name: 'ws_rooms_active',
  help: 'Active WebSocket rooms',
  registers: [register],
})

const wsMessagesTotal = new client.Counter({
  name: 'ws_messages_total',
  help: 'Total WebSocket messages sent',
  labelNames: ['event'],
  registers: [register],
})

export const queueJobsGauge = new client.Gauge({
  name: 'queue_jobs',
  help: 'Bull queue jobs by state (email/push/image)',
  labelNames: ['queue', 'state'],
  registers: [register],
  async collect() {
    try {
      const { queueStats } = await import('./queue-monitor.js')
      const stats = await queueStats()
      for (const { name, counts } of stats) {
        for (const [state, value] of Object.entries(counts)) {
          this.set({ queue: name, state }, value)
        }
      }
    } catch {
      // недоступный Redis не должен ронять /metrics
    }
  },
})

const cacheHits = new client.Counter({
  name: 'cache_hits_total',
  help: 'Total cache hits',
  registers: [register],
})

const cacheMisses = new client.Counter({
  name: 'cache_misses_total',
  help: 'Total cache misses',
  registers: [register],
})

export function metricsMiddleware(req, res, next) {
  const start = Date.now()
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000
    const route = req.route?.path || req.path
    httpRequestCount.inc({ method: req.method, route, status: res.statusCode })
    httpRequestDuration.observe({ method: req.method, route, status: res.statusCode }, duration)
  })
  next()
}

export function metricsRoute(req, res) {
  res.set('Content-Type', register.contentType)
  register.metrics().then(data => res.send(data)).catch(() => res.status(500).end())
}

export function trackDbQuery(query, duration) {
  dbQueryDuration.observe({ query: query.substring(0, 50) }, duration)
}

export function trackWsMessage(event) {
  wsMessagesTotal.inc({ event })
}

export function trackCacheHit() {
  cacheHits.inc()
}

export function trackCacheMiss() {
  cacheMisses.inc()
}

export default register
