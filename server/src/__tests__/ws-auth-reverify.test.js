import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const verifyTokenMock = vi.hoisted(() => vi.fn())

vi.mock('../middleware.js', () => ({
  verifyToken: verifyTokenMock,
}))

vi.mock('../redis.js', () => ({
  isRedisReady: vi.fn(async () => false),
  getRedisPub: vi.fn(),
  getRedisSub: vi.fn(),
}))

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }))

const metrics = vi.hoisted(() => ({
  wsConnectionsGauge: { inc: vi.fn(), dec: vi.fn(), set: vi.fn() },
  wsRoomsGauge: { set: vi.fn() },
  trackWsMessage: vi.fn(),
}))

vi.mock('../metrics.js', () => ({
  wsConnectionsGauge: metrics.wsConnectionsGauge,
  wsRoomsGauge: metrics.wsRoomsGauge,
  trackWsMessage: metrics.trackWsMessage,
}))

const fakeIo = vi.hoisted(() => ({
  use: vi.fn(),
  on: vi.fn(),
  adapter: vi.fn(),
  to: vi.fn(),
  emit: vi.fn(),
  sockets: { sockets: new Map(), adapter: { rooms: new Map() } },
}))

vi.mock('socket.io', () => ({
  Server: class {
    constructor() {
      return fakeIo
    }
  },
}))

vi.mock('@socket.io/redis-adapter', () => ({ createAdapter: vi.fn() }))

import { rootLogger } from '../logger.js'
import { initIO, reverifySockets, stopWsTimers } from '../ws.js'

// Сокет рождается без token: токен обязан появиться только через настоящий
// handshake-middleware из ws.js. Если фикстура подставит его сама, тесты
// перестанут зависеть от production-кода и будут зелёными на сломанной ревизии.
function makeSocket(token) {
  return {
    handshake: { auth: token ? { token } : {} },
    emit: vi.fn(),
    disconnect: vi.fn(),
    join: vi.fn(),
    leave: vi.fn(),
    on: vi.fn(),
    onAny: vi.fn(),
  }
}

// Один и тот же объект io на весь файл: модуль ws.js держит ссылку на тот
// экземпляр, который вернул конструктор Server, пересоздавать его нельзя —
// достаточно подменить карту сокетов.
function installIo(sockets) {
  const map = new Map()
  sockets.forEach((s, i) => map.set(String(i), s))
  fakeIo.sockets.sockets = map
  fakeIo.to.mockReturnValue({ emit: vi.fn() })
  return fakeIo
}

let handshakeMiddleware = null

// Полный путь подключения: handshake → сокет лежит в io с userId и token.
function connectSocket(token, userId) {
  verifyTokenMock.mockReturnValue({ userId })
  const socket = makeSocket(token)
  const next = vi.fn()
  handshakeMiddleware(socket, next)
  expect(next).toHaveBeenCalledWith()
  expect(socket.userId).toBe(userId)
  return socket
}

beforeEach(async () => {
  vi.clearAllMocks()
  verifyTokenMock.mockReset()
  installIo([])
  await initIO({})
  handshakeMiddleware = fakeIo.use.mock.calls[0]?.[0] ?? null
  vi.clearAllMocks()
})

afterEach(() => {
  stopWsTimers()
})

describe('WS handshake: токен кладётся на сокет для последующей перепроверки', () => {
  it('валидный токен: next() без ошибки, userId и token сохранены на сокете', () => {
    verifyTokenMock.mockReturnValue({ userId: 42 })
    const socket = makeSocket('good')
    const next = vi.fn()

    handshakeMiddleware(socket, next)

    expect(next).toHaveBeenCalledWith()
    expect(socket.userId).toBe(42)
    expect(socket.token).toBe('good')
  })

  it('токен не передан: Authentication required, token на сокет не кладётся', () => {
    const socket = makeSocket()
    const next = vi.fn()

    handshakeMiddleware(socket, next)

    expect(next).toHaveBeenCalledWith(expect.any(Error))
    expect(next.mock.calls[0][0].message).toBe('Authentication required')
    expect(socket.token).toBeUndefined()
  })

  it('невалидный токен: Invalid token, сокет не аутентифицирован', () => {
    verifyTokenMock.mockImplementation(() => { throw new Error('TokenExpiredError') })
    const socket = makeSocket('bad')
    const next = vi.fn()

    handshakeMiddleware(socket, next)

    expect(next.mock.calls[0][0].message).toBe('Invalid token')
    expect(socket.userId).toBeUndefined()
    expect(socket.token).toBeUndefined()
  })
})

describe('reverifySockets: истёкшая сессия теряет realtime (этап 25, P0-B)', () => {
  it('пустой io: возвращает 0 и не падает', () => {
    expect(reverifySockets()).toBe(0)
  })

  it('валидный токен: сокет остаётся подключён', () => {
    const socket = connectSocket('good', 42)
    installIo([socket])

    expect(reverifySockets()).toBe(0)
    expect(socket.disconnect).not.toHaveBeenCalled()
    expect(socket.emit).not.toHaveBeenCalled()
  })

  it('истёкший токен: auth:unauthorized + disconnect(true)', () => {
    const socket = connectSocket('expired', 42)
    installIo([socket])
    verifyTokenMock.mockImplementation(() => {
      const err = new Error('jwt expired')
      err.name = 'TokenExpiredError'
      throw err
    })

    expect(reverifySockets()).toBe(1)
    expect(socket.emit).toHaveBeenCalledWith('auth:unauthorized', {
      reason: 'token-expired-or-invalid',
    })
    expect(socket.disconnect).toHaveBeenCalledWith(true)
  })

  it('подпись сошлась, но subject другой (защита от подмены userId) — тоже рвём', () => {
    const socket = connectSocket('other', 7)
    installIo([socket])
    socket.userId = 42

    expect(reverifySockets()).toBe(1)
    expect(socket.disconnect).toHaveBeenCalledWith(true)
  })

  it('сокет без сохранённого токена пропускается, а не рвётся', () => {
    const socket = makeSocket()
    installIo([socket])

    expect(reverifySockets()).toBe(0)
    expect(socket.disconnect).not.toHaveBeenCalled()
  })

  it('из пяти сокетов рвутся только два невалидных', () => {
    const sockets = ['good', 'expired', 'good2', 'other', 'good3'].map((t) =>
      connectSocket(t, 42)
    )
    installIo(sockets)
    verifyTokenMock.mockImplementation((token) => {
      if (token === 'expired' || token === 'other') throw new Error('jwt expired')
      return { userId: 42 }
    })

    expect(reverifySockets()).toBe(2)
    expect(sockets[1].disconnect).toHaveBeenCalledWith(true)
    expect(sockets[3].disconnect).toHaveBeenCalledWith(true)
    expect(sockets[0].disconnect).not.toHaveBeenCalled()
    expect(sockets[2].disconnect).not.toHaveBeenCalled()
    expect(sockets[4].disconnect).not.toHaveBeenCalled()
  })

  it('метрики не трогаются вручную: их снимет обработчик disconnect', () => {
    const socket = connectSocket('expired', 42)
    installIo([socket])
    verifyTokenMock.mockImplementation(() => { throw new Error('jwt expired') })

    reverifySockets()

    expect(metrics.wsConnectionsGauge.dec).not.toHaveBeenCalled()
  })
})

describe('таймер перепроверки', () => {
  it('initIO поднимает таймер, и он рвёт истёкший сокет по расписанию', async () => {
    const socket = connectSocket('good', 42)
    installIo([socket])
    stopWsTimers()
    vi.useFakeTimers()
    try {
      await initIO({})
      expect(socket.disconnect).not.toHaveBeenCalled()

      verifyTokenMock.mockImplementation(() => { throw new Error('jwt expired') })
      await vi.advanceTimersByTimeAsync(60000)

      expect(socket.disconnect).toHaveBeenCalledWith(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stopWsTimers останавливает таймер', async () => {
    const socket = connectSocket('good', 42)
    installIo([socket])
    stopWsTimers()
    vi.useFakeTimers()
    try {
      await initIO({})
      stopWsTimers()
      verifyTokenMock.mockClear()

      verifyTokenMock.mockImplementation(() => { throw new Error('jwt expired') })
      await vi.advanceTimersByTimeAsync(180000)

      expect(verifyTokenMock).not.toHaveBeenCalled()
      expect(socket.disconnect).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('сбой в таймере логируется, но не роняет процесс', async () => {
    const socket = connectSocket('good', 42)
    installIo([socket])
    fakeIo.sockets.sockets = { values: () => { throw new Error('boom') } }
    stopWsTimers()
    vi.useFakeTimers()
    try {
      await initIO({})
      await vi.advanceTimersByTimeAsync(60000)

      expect(rootLogger.error).toHaveBeenCalledWith('[ws] Token re-verify error:', expect.any(Error))
    } finally {
      vi.useRealTimers()
    }
  })

  it('initIO дважды не плодит таймеры', async () => {
    installIo([])
    stopWsTimers()
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    try {
      await initIO({})
      const callsAfterFirst = setIntervalSpy.mock.calls.length
      await initIO({})

      expect(callsAfterFirst).toBeGreaterThan(0)
      expect(setIntervalSpy).toHaveBeenCalledTimes(callsAfterFirst)
    } finally {
      setIntervalSpy.mockRestore()
      stopWsTimers()
    }
  })
})
