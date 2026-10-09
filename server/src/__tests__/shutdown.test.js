import { describe, it, expect, vi, afterEach } from 'vitest'
import { createGracefulShutdown } from '../shutdown.js'

function makeDeps(overrides = {}) {
  const calls = []
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const deps = {
    httpServer: {
      close: (cb) => {
        calls.push('httpServer.close')
        if (cb) cb()
      },
    },
    stopWsTimers: () => calls.push('stopWsTimers'),
    closeQueues: async () => {
      calls.push('closeQueues')
    },
    disconnectRedis: async () => {
      calls.push('disconnectRedis')
    },
    closePool: async () => {
      calls.push('closePool')
    },
    logger,
    exit: vi.fn(),
    ...overrides,
  }
  return { deps, calls, logger }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('createGracefulShutdown', () => {
  it('SIGTERM: закрывает ресурсы по порядку и выходит с кодом 0', async () => {
    const { deps, calls } = makeDeps()
    const shutdown = createGracefulShutdown(deps)

    expect(await shutdown('SIGTERM')).toBe(true)
    expect(calls).toEqual([
      'stopWsTimers',
      'closeQueues',
      'disconnectRedis',
      'closePool',
      'httpServer.close',
    ])
    expect(deps.exit).toHaveBeenCalledTimes(1)
    expect(deps.exit).toHaveBeenCalledWith(0)
  })

  it('SIGINT обрабатывается так же, как SIGTERM (раньше сигнал игнорировался)', async () => {
    const { deps } = makeDeps()
    const shutdown = createGracefulShutdown(deps)

    expect(await shutdown('SIGINT')).toBe(true)
    expect(deps.logger.info).toHaveBeenCalledWith('SIGINT received — shutting down')
    expect(deps.exit).toHaveBeenCalledWith(0)
  })

  it('повторный сигнал не запускает очистку дважды', async () => {
    const { deps, calls } = makeDeps()
    const shutdown = createGracefulShutdown(deps)

    expect(await shutdown('SIGTERM')).toBe(true)
    expect(await shutdown('SIGTERM')).toBe(false)
    expect(calls.filter((c) => c === 'closeQueues')).toHaveLength(1)
    expect(deps.exit).toHaveBeenCalledTimes(1)
  })

  it('не закрывшийся сервер доводится до выхода по deadline', async () => {
    vi.useFakeTimers()
    const { deps } = makeDeps({ httpServer: { close: () => {} }, timeoutMs: 10000 })
    const shutdown = createGracefulShutdown(deps)

    void shutdown('SIGTERM')
    await vi.advanceTimersByTimeAsync(9999)
    expect(deps.exit).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(deps.logger.warn).toHaveBeenCalledTimes(1)
    expect(deps.exit).toHaveBeenCalledWith(1)
  })

  it('ошибка при закрытии → выход с кодом 1', async () => {
    const { deps, logger } = makeDeps({
      closeQueues: async () => {
        throw new Error('redis down')
      },
    })
    const shutdown = createGracefulShutdown(deps)

    expect(await shutdown('SIGTERM')).toBe(false)
    expect(logger.error).toHaveBeenCalled()
    expect(deps.exit).toHaveBeenCalledWith(1)
  })
})
