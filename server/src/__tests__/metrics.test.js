import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../logger.js', () => {
  const mock = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  return { default: mock, createLogger: () => ({ ...mock }), rootLogger: mock }
})

const { queueStatsMock } = vi.hoisted(() => ({ queueStatsMock: vi.fn() }))
vi.mock('../queue-monitor.js', () => ({ queueStats: queueStatsMock }))

import register, {
  metricsMiddleware,
  metricsRoute,
  trackDbQuery,
  trackWsMessage,
  trackCacheHit,
  trackCacheMiss,
  queueJobsGauge,
  wsConnectionsGauge,
  wsRoomsGauge,
  integrationModeGauge,
} from '../metrics.js'

/** Мини-мок ответа Express: собирает обработчики `finish`, статус и тело. */
function makeRes() {
  const listeners = {}
  return {
    statusCode: 200,
    headers: {},
    sent: null,
    ended: false,
    set(name, value) {
      this.headers[name] = value
    },
    on(event, cb) {
      listeners[event] = cb
    },
    emitFinish() {
      listeners.finish?.()
    },
    status(code) {
      this.statusCode = code
      return this
    },
    send(body) {
      this.sent = body
    },
    end() {
      this.ended = true
    },
  }
}

const flush = () => new Promise((resolve) => setImmediate(resolve))

beforeEach(() => {
  queueStatsMock.mockReset()
})

describe('metricsMiddleware — счётчик и гистограмма на finish', () => {
  it('зовёт next и на finish пишет метрики с route из req.route.path', async () => {
    const res = makeRes()
    const next = vi.fn()
    const req = { method: 'GET', path: '/x', route: { path: '/api/users/:id' } }
    const before = register.getSingleMetric('http_requests_total')

    metricsMiddleware(req, res, next)
    expect(next).toHaveBeenCalledTimes(1)

    res.statusCode = 404
    res.emitFinish()

    const counter = register.getSingleMetric('http_requests_total')
    expect(counter).toBe(before)
    const value = (await counter.get()).values.find(
      (v) => v.labels.method === 'GET' && v.labels.route === '/api/users/:id' && v.labels.status === 404,
    )
    expect(value.value).toBeGreaterThanOrEqual(1)
  })

  it('без req.route берёт req.path', async () => {
    const res = makeRes()
    const next = vi.fn()
    metricsMiddleware({ method: 'POST', path: '/fallback' }, res, next)
    res.statusCode = 201
    res.emitFinish()

    const counter = register.getSingleMetric('http_requests_total')
    const value = (await counter.get()).values.find(
      (v) => v.labels.method === 'POST' && v.labels.route === '/fallback' && v.labels.status === 201,
    )
    expect(value.value).toBeGreaterThanOrEqual(1)
  })
})

describe('metricsRoute — отдача скрейпа', () => {
  it('успех: Content-Type из реестра и тело скрейпа', async () => {
    const res = makeRes()
    await metricsRoute({}, res)
    await flush()
    expect(res.headers['Content-Type']).toBe(register.contentType)
    expect(typeof res.sent).toBe('string')
    expect(res.sent).toContain('http_requests_total')
  })

  it('падение реестра — 500 через catch', async () => {
    const spy = vi.spyOn(register, 'metrics').mockRejectedValueOnce(new Error('boom'))
    const res = makeRes()
    await metricsRoute({}, res)
    await flush()
    expect(res.ended).toBe(true)
    expect(res.statusCode).toBe(500)
    spy.mockRestore()
  })
})

describe('точечные трекеры', () => {
  it('trackDbQuery обрезает запрос до 50 символов', async () => {
    const long = 'SELECT * FROM ' + 'x'.repeat(80)
    trackDbQuery(long, 0.02)
    const hist = register.getSingleMetric('db_query_duration_seconds')
    const value = (await hist.get()).values.find((v) => v.labels.query === long.substring(0, 50))
    expect(value).toBeDefined()
    expect(value.labels.query).toHaveLength(50)
  })

  it('trackWsMessage инкрементирует метку event', async () => {
    trackWsMessage('chat:message')
    const counter = register.getSingleMetric('ws_messages_total')
    const value = (await counter.get()).values.find((v) => v.labels.event === 'chat:message')
    expect(value.value).toBeGreaterThanOrEqual(1)
  })

  it('trackCacheHit/trackCacheMiss инкрементируют свои счётчики', async () => {
    trackCacheHit()
    trackCacheMiss()
    trackCacheMiss()
    expect((await register.getSingleMetric('cache_hits_total').get()).values[0].value).toBeGreaterThanOrEqual(1)
    expect((await register.getSingleMetric('cache_misses_total').get()).values[0].value).toBeGreaterThanOrEqual(2)
  })
})

describe('queueJobsGauge.collect — динамический сбор очередей', () => {
  it('раскладывает counts по метке queue/state', async () => {
    queueStatsMock.mockResolvedValue([
      { name: 'email', enabled: true, counts: { waiting: 3, active: 1 } },
      { name: 'push', enabled: true, counts: { failed: 2 } },
    ])

    await queueJobsGauge.collect.call(queueJobsGauge)
    const values = (await queueJobsGauge.get()).values
    const waiting = values.find((v) => v.labels.queue === 'email' && v.labels.state === 'waiting')
    const failed = values.find((v) => v.labels.queue === 'push' && v.labels.state === 'failed')
    expect(waiting.value).toBe(3)
    expect(failed.value).toBe(2)
  })

  it('падение queueStats (недоступный Redis) молча глотается', async () => {
    queueStatsMock.mockRejectedValue(new Error('redis down'))
    await expect(queueJobsGauge.collect.call(queueJobsGauge)).resolves.toBeUndefined()
  })

  it('пустой список очередей не падает (counts null у выключенных)', async () => {
    queueStatsMock.mockResolvedValue([
      { name: 'email', enabled: false, counts: null },
      { name: 'push', enabled: false, counts: null },
    ])
    await expect(queueJobsGauge.collect.call(queueJobsGauge)).resolves.toBeUndefined()
  })
})

describe('integrationModeGauge.collect — env-метка', () => {
  it('без NODE_ENV метка env = unknown', async () => {
    const original = process.env.NODE_ENV
    delete process.env.NODE_ENV
    try {
      const metric = await integrationModeGauge.get()
      for (const entry of metric.values) expect(entry.labels.env).toBe('unknown')
    } finally {
      if (original === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = original
    }
  })
})

describe('зарегистрированные метрики и порядок', () => {
  it('каждая публичная метрика доступна в реестре по имени', () => {
    expect(register.getSingleMetric('ws_connections_active')).toBe(wsConnectionsGauge)
    expect(register.getSingleMetric('ws_rooms_active')).toBe(wsRoomsGauge)
    expect(register.getSingleMetric('queue_jobs')).toBe(queueJobsGauge)
    expect(register.getSingleMetric('integration_mode')).toBe(integrationModeGauge)
  })
})
