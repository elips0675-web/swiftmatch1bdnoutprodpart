import { describe, it, expect, vi, beforeEach } from 'vitest'

async function freshIdempotency() {
  vi.resetModules()
  return import('../middleware/idempotency.js')
}

// Мини-мок Express-объектов: рельсы для res.on('finish') и status().json().
function makeReq(headers = {}) {
  return { headers }
}

function makeRes() {
  const listeners = {}
  const res = {
    statusCode: 200,
    body: undefined,
    on: vi.fn((event, cb) => {
      listeners[event] = cb
      return res
    }),
    status: vi.fn((code) => {
      res.statusCode = code
      return res
    }),
    json: vi.fn((payload) => {
      res.body = payload
      return res
    }),
    finish: () => listeners.finish && listeners.finish(),
  }
  return res
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('idempotency', () => {
  it('без заголовка Idempotency-Key сразу пропускает дальше', async () => {
    const { idempotency } = await freshIdempotency()
    const next = vi.fn()
    idempotency(makeReq(), makeRes(), next)
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('первый запрос вызывает next и запоминает ответ после finish (2xx)', async () => {
    const { idempotency } = await freshIdempotency()
    const next = vi.fn()
    const res = makeRes()
    idempotency(makeReq({ 'idempotency-key': 'k1' }), res, next)
    expect(next).toHaveBeenCalledTimes(1)

    res.status(201).json({ ok: true })
    res.finish()

    const replay = makeRes()
    const nextReplay = vi.fn()
    idempotency(makeReq({ 'idempotency-key': 'k1' }), replay, nextReplay)

    expect(nextReplay).not.toHaveBeenCalled()
    expect(replay.status).toHaveBeenCalledWith(201)
    expect(replay.json).toHaveBeenCalledWith({ ok: true })
  })

  it('4xx тоже запоминается (ниже 500)', async () => {
    const { idempotency } = await freshIdempotency()
    const res = makeRes()
    idempotency(makeReq({ 'idempotency-key': 'k2' }), res, vi.fn())
    res.status(400).json({ error: 'bad' })
    res.finish()

    const replay = makeRes()
    idempotency(makeReq({ 'idempotency-key': 'k2' }), replay, vi.fn())
    expect(replay.status).toHaveBeenCalledWith(400)
  })

  it('5xx не запоминается — повторный запрос снова идёт в next', async () => {
    const { idempotency } = await freshIdempotency()
    const res = makeRes()
    idempotency(makeReq({ 'idempotency-key': 'k3' }), res, vi.fn())
    res.status(503).json({ error: 'down' })
    res.finish()

    const next = vi.fn()
    idempotency(makeReq({ 'idempotency-key': 'k3' }), makeRes(), next)
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('разные ключи не мешают друг другу', async () => {
    const { idempotency } = await freshIdempotency()
    const a = makeRes()
    idempotency(makeReq({ 'idempotency-key': 'a' }), a, vi.fn())
    a.status(200).json({ from: 'a' })
    a.finish()

    const next = vi.fn()
    idempotency(makeReq({ 'idempotency-key': 'b' }), makeRes(), next)
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('записи старше часа вычищаются таймером уборки', async () => {
    vi.useFakeTimers()
    try {
      const { idempotency } = await freshIdempotency()
      const res = makeRes()
      idempotency(makeReq({ 'idempotency-key': 'old' }), res, vi.fn())
      res.status(200).json({ ok: true })
      res.finish()

      // Сдвигаем время далеко за час и запускаем уборщик (каждые 60 c).
      await vi.advanceTimersByTimeAsync(2 * 3600 * 1000)

      const next = vi.fn()
      idempotency(makeReq({ 'idempotency-key': 'old' }), makeRes(), next)
      expect(next).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
