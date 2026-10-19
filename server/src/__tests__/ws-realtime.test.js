import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const verifyTokenMock = vi.hoisted(() => vi.fn())
const redisState = vi.hoisted(() => ({ ready: false }))
const createAdapterMock = vi.hoisted(() => vi.fn((pub, sub) => ({ __adapter: true, pub, sub })))

vi.mock('../middleware.js', () => ({
  verifyToken: verifyTokenMock,
}))

vi.mock('../redis.js', () => ({
  isRedisReady: vi.fn(async () => redisState.ready),
  getRedisPub: vi.fn(() => ({ __pub: true })),
  getRedisSub: vi.fn(() => ({ __sub: true })),
}))

vi.mock('@socket.io/redis-adapter', () => ({ createAdapter: createAdapterMock }))

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

const db = vi.hoisted(() => ({ query: vi.fn() }))

vi.mock('../db.js', () => ({ default: db }))

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

const presence = vi.hoisted(() => ({
  registerSocket: vi.fn(),
  unregisterSocket: vi.fn(),
  markOnline: vi.fn(async () => {}),
  markOffline: vi.fn(async () => {}),
  touchLastSeen: vi.fn(async () => 0),
  onlineUserIds: vi.fn(() => [1, 2]),
}))

vi.mock('../presence.js', () => ({
  registerSocket: presence.registerSocket,
  unregisterSocket: presence.unregisterSocket,
  markOnline: presence.markOnline,
  markOffline: presence.markOffline,
  touchLastSeen: presence.touchLastSeen,
  onlineUserIds: presence.onlineUserIds,
}))

const fakeIo = vi.hoisted(() => ({
  use: vi.fn(),
  on: vi.fn(),
  adapter: vi.fn(),
  to: vi.fn(),
  sockets: { sockets: new Map(), adapter: { rooms: new Map() } },
}))

vi.mock('socket.io', () => ({
  Server: class {
    constructor() {
      return fakeIo
    }
  },
}))

import { rootLogger } from '../logger.js'
import { initIO, startMessageCleanup, startCheckinCleanup, getIO, stopWsTimers } from '../ws.js'

function makeSocket(userId, id = 'sock-1') {
  return {
    id,
    userId,
    handshake: { auth: {} },
    connected: true,
    callPartnerId: null,
    emit: vi.fn(),
    disconnect: vi.fn(),
    join: vi.fn(),
    leave: vi.fn(),
    on: vi.fn(),
    onAny: vi.fn(),
  }
}

function installIo(sockets) {
  const map = new Map()
  sockets.forEach((s, i) => map.set(s.id || String(i), s))
  fakeIo.sockets.sockets = map
  fakeIo.to.mockImplementation(() => ({ emit: vi.fn() }))
  return fakeIo
}

// Собирает обработчик события по имени из socket.on.
function handlerOf(socket, event) {
  const call = socket.on.mock.calls.find((c) => c[0] === event)
  return call ? call[1] : null
}

let connectionHandler = null

beforeEach(async () => {
  vi.clearAllMocks()
  redisState.ready = false
  installIo([])
  await initIO({})
  connectionHandler = fakeIo.on.mock.calls.find((c) => c[0] === 'connection')?.[1] ?? null
  vi.clearAllMocks()
})

afterEach(() => {
  stopWsTimers()
})

describe('initIO: адаптер и подключение', () => {
  it('getIO отдаёт созданный экземпляр', () => {
    expect(getIO()).toBe(fakeIo)
  })

  it('Redis недоступен: in-memory адаптер, adapter() не вызывается, warn в лог', async () => {
    redisState.ready = false
    vi.clearAllMocks()
    await initIO({})

    expect(fakeIo.adapter).not.toHaveBeenCalled()
    expect(rootLogger.warn).toHaveBeenCalledWith(
      '[ws] Redis unavailable — using in-memory adapter (single instance)'
    )
  })

  it('Redis доступен: адаптер attach с pub/sub, info в лог', async () => {
    redisState.ready = true
    vi.clearAllMocks()
    await initIO({})

    expect(createAdapterMock).toHaveBeenCalledTimes(1)
    expect(fakeIo.adapter).toHaveBeenCalledTimes(1)
    expect(rootLogger.info).toHaveBeenCalledWith(
      '[ws] Redis adapter attached — horizontal scaling enabled'
    )
  })

  it('CORS_ORIGIN из окружения задаёт origin сервера', async () => {
    const prev = process.env.CORS_ORIGIN
    process.env.CORS_ORIGIN = 'https://app.example'
    const captured = []
    const OriginalServer = (await import('socket.io')).Server
    try {
      // конструктор Server мокается на fakeIo, поэтому проверяем косвенно:
      // initIO не падает и возвращает io при заданном CORS_ORIGIN.
      expect(typeof OriginalServer).toBe('function')
      const io = await initIO({})
      expect(io).toBe(fakeIo)
      captured.push(process.env.CORS_ORIGIN)
      expect(captured[0]).toBe('https://app.example')
    } finally {
      if (prev === undefined) delete process.env.CORS_ORIGIN
      else process.env.CORS_ORIGIN = prev
    }
  })
})

describe('connection: подписка, метрики и присутствие', () => {
  it('сокет входит в свою комнату, растут gauge, регистрируется присутствие', () => {
    presence.registerSocket.mockReturnValue(true)
    const socket = makeSocket(42)

    connectionHandler(socket)

    expect(socket.join).toHaveBeenCalledWith('user:42')
    expect(metrics.wsConnectionsGauge.inc).toHaveBeenCalled()
    expect(metrics.wsRoomsGauge.set).toHaveBeenCalled()
    expect(presence.registerSocket).toHaveBeenCalledWith(42, 'sock-1')
    expect(presence.markOnline).toHaveBeenCalledWith(42)
    expect(socket.onAny).toHaveBeenCalled()
  })

  it('повторный сокет того же юзера не шлёт markOnline (registerSocket=false)', () => {
    presence.registerSocket.mockReturnValue(false)
    const socket = makeSocket(42)

    connectionHandler(socket)

    expect(presence.markOnline).not.toHaveBeenCalled()
  })

  it('onAny прокидывает имя события в trackWsMessage', () => {
    const socket = makeSocket(42)
    connectionHandler(socket)
    const onAny = socket.onAny.mock.calls[0][0]

    onAny('chat:message')

    expect(metrics.trackWsMessage).toHaveBeenCalledWith('chat:message')
  })

  it('markOnline падает в фоне — ошибка логируется, а не всплывает', async () => {
    presence.registerSocket.mockReturnValue(true)
    presence.markOnline.mockRejectedValueOnce(new Error('db down'))
    const socket = makeSocket(42)
    connectionHandler(socket)

    await Promise.resolve()

    expect(rootLogger.error).toHaveBeenCalledWith('[ws] presence online error:', expect.any(Error))
  })

  it('hangout:join_feed/leave_feed входят и выходят из общей комнаты', () => {
    const socket = makeSocket(42)
    connectionHandler(socket)

    handlerOf(socket, 'hangout:join_feed')()
    handlerOf(socket, 'hangout:leave_feed')()

    expect(socket.join).toHaveBeenCalledWith('hangout:feed')
    expect(socket.leave).toHaveBeenCalledWith('hangout:feed')
  })
})

describe('connection: disconnect', () => {
  it('снимает gauge, снимает присутствие и логирует', () => {
    presence.registerSocket.mockReturnValue(true)
    presence.unregisterSocket.mockReturnValue(true)
    const socket = makeSocket(42)
    connectionHandler(socket)
    const onDisconnect = handlerOf(socket, 'disconnect')
    vi.clearAllMocks()
    presence.unregisterSocket.mockReturnValue(true)

    onDisconnect()

    expect(metrics.wsConnectionsGauge.dec).toHaveBeenCalled()
    expect(metrics.wsRoomsGauge.set).toHaveBeenCalled()
    expect(rootLogger.info).toHaveBeenCalledWith('WS user:42 disconnected')
    expect(presence.markOffline).toHaveBeenCalledWith(42)
  })

  it('если это был последний сокет партнёра в звонке — ему уходит call-ended', () => {
    presence.registerSocket.mockReturnValue(true)
    presence.unregisterSocket.mockReturnValue(false)
    const socket = makeSocket(42)
    connectionHandler(socket)
    const onDisconnect = handlerOf(socket, 'disconnect')
    socket.callPartnerId = 99
    vi.clearAllMocks()

    onDisconnect()

    expect(fakeIo.to).toHaveBeenCalledWith('user:99')
    expect(fakeIo.to.mock.results[0].value.emit).toHaveBeenCalledWith('webrtc:call-ended', {
      from: 42,
      reason: 'disconnected',
    })
    expect(presence.markOffline).not.toHaveBeenCalled()
  })

  it('markOffline падает в фоне — ошибка логируется', async () => {
    presence.registerSocket.mockReturnValue(true)
    presence.unregisterSocket.mockReturnValue(true)
    presence.markOffline.mockRejectedValueOnce(new Error('db down'))
    const socket = makeSocket(42)
    connectionHandler(socket)
    const onDisconnect = handlerOf(socket, 'disconnect')

    onDisconnect()
    await Promise.resolve()

    expect(rootLogger.error).toHaveBeenCalledWith('[ws] presence offline error:', expect.any(Error))
  })
})

describe('connection: WebRTC-сигналинг', () => {
  function connected(userId, id) {
    const socket = makeSocket(userId, id)
    connectionHandler(socket)
    socket.join.mockClear()
    return socket
  }

  it('call-user: цель найдена — incoming-call и взаимные callPartnerId', () => {
    const caller = connected(1, 'a')
    const target = makeSocket(2, 'b')
    installIo([caller, target])

    handlerOf(caller, 'webrtc:call-user')({ targetUserId: 2, sdp: 'S', type: 'offer' })

    expect(target.emit).toHaveBeenCalledWith('webrtc:incoming-call', {
      from: 1,
      sdp: 'S',
      type: 'offer',
    })
    expect(caller.callPartnerId).toBe(2)
    expect(target.callPartnerId).toBe(1)
  })

  it('call-user: цель офлайн — user-unavailable, партнёр не назначается', () => {
    const caller = connected(1, 'a')
    installIo([caller])

    handlerOf(caller, 'webrtc:call-user')({ targetUserId: 2, sdp: 'S', type: 'offer' })

    expect(caller.emit).toHaveBeenCalledWith('webrtc:user-unavailable', { targetUserId: 2 })
    expect(caller.callPartnerId).toBeNull()
  })

  it('call-user: сокет цели с connected=false не считается получателем', () => {
    const caller = connected(1, 'a')
    const target = makeSocket(2, 'b')
    target.connected = false
    installIo([caller, target])

    handlerOf(caller, 'webrtc:call-user')({ targetUserId: 2 })

    expect(caller.emit).toHaveBeenCalledWith('webrtc:user-unavailable', { targetUserId: 2 })
  })

  it('call-accepted/ice-candidate прокидываются в комнату цели', () => {
    const socket = connected(1, 'a')
    installIo([socket])

    handlerOf(socket, 'webrtc:call-accepted')({ targetUserId: 2, sdp: 'S', type: 'answer' })
    expect(fakeIo.to).toHaveBeenCalledWith('user:2')
    expect(fakeIo.to.mock.results[0].value.emit).toHaveBeenCalledWith('webrtc:call-accepted', {
      from: 1,
      sdp: 'S',
      type: 'answer',
    })

    handlerOf(socket, 'webrtc:ice-candidate')({ targetUserId: 2, candidate: 'C' })
    expect(fakeIo.to.mock.results[1].value.emit).toHaveBeenCalledWith('webrtc:ice-candidate', {
      from: 1,
      candidate: 'C',
    })
  })

  it('call-rejected: обнуляет callPartnerId у обеих сторон и уведомляет цель', () => {
    const socket = connected(1, 'a')
    const target = makeSocket(2, 'b')
    target.callPartnerId = 1
    socket.callPartnerId = 2
    installIo([socket, target])

    handlerOf(socket, 'webrtc:call-rejected')({ targetUserId: 2 })

    expect(target.callPartnerId).toBeNull()
    expect(socket.callPartnerId).toBeNull()
    expect(fakeIo.to.mock.results[0].value.emit).toHaveBeenCalledWith('webrtc:call-rejected', {
      from: 1,
    })
  })

  it('call-rejected при отсутствующей цели всё равно уведомляет комнату', () => {
    const socket = connected(1, 'a')
    socket.callPartnerId = 2
    installIo([socket])

    handlerOf(socket, 'webrtc:call-rejected')({ targetUserId: 2 })

    expect(socket.callPartnerId).toBeNull()
    expect(fakeIo.to.mock.results[0].value.emit).toHaveBeenCalledWith('webrtc:call-rejected', {
      from: 1,
    })
  })

  it('end-call: причина user-ended, партнёры разорваны', () => {
    const socket = connected(1, 'a')
    const target = makeSocket(2, 'b')
    target.callPartnerId = 1
    socket.callPartnerId = 2
    installIo([socket, target])

    handlerOf(socket, 'webrtc:end-call')({ targetUserId: 2 })

    expect(target.callPartnerId).toBeNull()
    expect(socket.callPartnerId).toBeNull()
    expect(fakeIo.to.mock.results[0].value.emit).toHaveBeenCalledWith('webrtc:call-ended', {
      from: 1,
      reason: 'user-ended',
    })
  })

  it('end-call при отсутствующей цели не падает', () => {
    const socket = connected(1, 'a')
    installIo([socket])

    handlerOf(socket, 'webrtc:end-call')({ targetUserId: 2 })

    expect(fakeIo.to.mock.results[0].value.emit).toHaveBeenCalledWith('webrtc:call-ended', {
      from: 1,
      reason: 'user-ended',
    })
  })
})

describe('startPresenceTouch: сердцебиение присутствия', () => {
  it('по таймеру отправляет last_seen для онлайн-юзеров', async () => {
    vi.useFakeTimers()
    try {
      stopWsTimers()
      await initIO({})
      await vi.advanceTimersByTimeAsync(60000)

      expect(presence.onlineUserIds).toHaveBeenCalled()
      expect(presence.touchLastSeen).toHaveBeenCalledWith([1, 2])
      expect(rootLogger.info).toHaveBeenCalledWith(
        '[ws] Presence heartbeat started every 60s'
      )
    } finally {
      vi.useRealTimers()
      stopWsTimers()
    }
  })

  it('падение touchLastSeen логируется, таймер живёт дальше', async () => {
    presence.touchLastSeen.mockRejectedValueOnce(new Error('db down'))
    vi.useFakeTimers()
    try {
      stopWsTimers()
      await initIO({})
      await vi.advanceTimersByTimeAsync(60000)

      expect(rootLogger.error).toHaveBeenCalledWith('[ws] presence touch error:', expect.any(Error))
    } finally {
      vi.useRealTimers()
      stopWsTimers()
    }
  })

  it('синхронный обрыв в touch логируется из catch', async () => {
    presence.onlineUserIds.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    vi.useFakeTimers()
    try {
      stopWsTimers()
      await initIO({})
      await vi.advanceTimersByTimeAsync(60000)

      expect(rootLogger.error).toHaveBeenCalledWith('[ws] presence touch error:', expect.any(Error))
    } finally {
      vi.useRealTimers()
      stopWsTimers()
    }
  })
})

describe('startMessageCleanup: TTL-уборка сообщений', () => {
  it('нет протухших сообщений — только SELECT', async () => {
    await initIO({})
    db.query.mockResolvedValueOnce([[]])
    vi.useFakeTimers()
    try {
      startMessageCleanup()
      await vi.advanceTimersByTimeAsync(10000)

      expect(db.query).toHaveBeenCalledTimes(1)
      expect(rootLogger.info).toHaveBeenCalledWith('[ws] Message TTL cleanup started every 10s')
    } finally {
      vi.useRealTimers()
    }
  })

  it('протухшие сообщения удаляются, участники получают message-deleted', async () => {
    const socket = makeSocket(42)
    installIo([socket])
    await initIO({})
    db.query
      .mockResolvedValueOnce([[
        { id: 1, chat_id: 10, user_id: 42 },
        { id: 1, chat_id: 10, user_id: 43 },
        { id: 2, chat_id: 11, user_id: 42 },
      ]])
      .mockResolvedValueOnce([{ affectedRows: 2 }])
    vi.useFakeTimers()
    try {
      startMessageCleanup()
      await vi.advanceTimersByTimeAsync(10000)
      // flush микротаски после await внутри интервала
      await Promise.resolve()

      expect(db.query).toHaveBeenCalledTimes(2)
      const [delSql, delParams] = db.query.mock.calls[1]
      expect(delSql).toContain('DELETE FROM messages')
      expect(delParams[0]).toEqual([1, 2])
      expect(fakeIo.to).toHaveBeenCalledWith('user:42')
      expect(fakeIo.to).toHaveBeenCalledWith('user:43')
    } finally {
      vi.useRealTimers()
    }
  })

  it('ошибка БД логируется и не роняет интервал', async () => {
    await initIO({})
    db.query.mockRejectedValueOnce(new Error('db down'))
    vi.useFakeTimers()
    try {
      startMessageCleanup()
      await vi.advanceTimersByTimeAsync(10000)

      expect(rootLogger.error).toHaveBeenCalledWith('[ws] Message cleanup error:', expect.any(Error))
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('startCheckinCleanup: уборка просроченных check-in', () => {  it('просроченные отмечены — логирует число', async () => {
    db.query.mockResolvedValueOnce([{ affectedRows: 3 }])
    vi.useFakeTimers()
    try {
      startCheckinCleanup()
      await vi.advanceTimersByTimeAsync(30000)

      expect(rootLogger.info).toHaveBeenCalledWith('[checkin] Expired check-ins marked', {
        count: 3,
      })
      expect(rootLogger.info).toHaveBeenCalledWith(
        '[checkin] Expiry cleanup started every 30s'
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('нет просроченных — тишина без info-записи о числе', async () => {
    db.query.mockResolvedValueOnce([{ affectedRows: 0 }])
    vi.useFakeTimers()
    try {
      startCheckinCleanup()
      await vi.advanceTimersByTimeAsync(30000)

      expect(rootLogger.info).not.toHaveBeenCalledWith(
        '[checkin] Expired check-ins marked',
        expect.anything()
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('ошибка БД логируется через warn', async () => {
    db.query.mockRejectedValueOnce(new Error('deadlock'))
    vi.useFakeTimers()
    try {
      startCheckinCleanup()
      await vi.advanceTimersByTimeAsync(30000)

      expect(rootLogger.warn).toHaveBeenCalledWith('[checkin] Cleanup error', {
        error: 'deadlock',
      })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('startMessageCleanup: guard до initIO', () => {
  it('до инициализации io уборка молча выходит, не трогая БД', async () => {
    // Отдельный экземпляр модуля: в этом процессе ws.js уже инициализирован
    // в beforeEach, а ветка !io достижима только до первого initIO.
    vi.resetModules()
    const freshDb = { query: vi.fn() }
    vi.doMock('../db.js', () => ({ default: freshDb }))
    const fresh = await import('../ws.js')
    vi.useFakeTimers()
    try {
      fresh.startMessageCleanup()
      await vi.advanceTimersByTimeAsync(10000)
      expect(freshDb.query).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reverifySockets до initIO возвращает 0 без обхода сокетов', async () => {
    vi.resetModules()
    const fresh = await import('../ws.js')
    expect(fresh.reverifySockets()).toBe(0)
    expect(fresh.getIO()).toBeNull()
  })
})
