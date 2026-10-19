vi.hoisted(() => {
  delete process.env.REDIS_URL
  delete process.env.AUTH_LOCKOUT_MAX_ATTEMPTS
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { getRedisMock, redisMock, rootLog } = vi.hoisted(() => ({
  getRedisMock: vi.fn(),
  redisMock: {
    get: vi.fn(),
    ttl: vi.fn(),
    incr: vi.fn(),
    expire: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  },
  rootLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../redis.js', () => ({
  getRedis: (...args) => getRedisMock(...args),
}))

vi.mock('../logger.js', () => ({
  default: rootLog,
  createLogger: () => rootLog,
  rootLogger: rootLog,
}))

import { isLocked, recordFailure, recordSuccess, _resetLockout } from '../lockout.js'

let savedMaxAttempts

beforeEach(() => {
  vi.clearAllMocks()
  savedMaxAttempts = process.env.AUTH_LOCKOUT_MAX_ATTEMPTS
  delete process.env.AUTH_LOCKOUT_MAX_ATTEMPTS
  getRedisMock.mockReturnValue(redisMock)
  redisMock.get.mockResolvedValue(null)
  redisMock.ttl.mockResolvedValue(900)
  redisMock.incr.mockResolvedValue(1)
  redisMock.expire.mockResolvedValue(1)
  redisMock.set.mockResolvedValue('OK')
  redisMock.del.mockResolvedValue(1)
  _resetLockout()
})

afterEach(() => {
  if (savedMaxAttempts === undefined) delete process.env.AUTH_LOCKOUT_MAX_ATTEMPTS
  else process.env.AUTH_LOCKOUT_MAX_ATTEMPTS = savedMaxAttempts
})

describe('lockout в режиме Redis', () => {
  it('isLocked: ключ в блокировке → минуты из TTL (округление вверх)', async () => {
    redisMock.get.mockResolvedValue('1')
    expect(await isLocked('a@test.com')).toBe(15)
    expect(redisMock.get).toHaveBeenCalledWith('lockout:a@test.com')
    expect(redisMock.ttl).toHaveBeenCalledWith('lockout:a@test.com')
  })

  it('isLocked: TTL меньше минуты → минимум 1', async () => {
    redisMock.get.mockResolvedValue('1')
    redisMock.ttl.mockResolvedValue(30)
    expect(await isLocked('a@test.com')).toBe(1)
  })

  it('isLocked: ключа нет → null, TTL не спрашивается', async () => {
    expect(await isLocked('a@test.com')).toBeNull()
    expect(redisMock.ttl).not.toHaveBeenCalled()
  })

  it('isLocked: ошибка Redis → null, а не исключение', async () => {
    redisMock.get.mockRejectedValue(new Error('conn refused'))
    expect(await isLocked('a@test.com')).toBeNull()
  })

  it('recordFailure: первая попытка ставит expire на окно 900s', async () => {
    redisMock.incr.mockResolvedValue(1)
    await recordFailure('a@test.com')
    expect(redisMock.incr).toHaveBeenCalledWith('lockout:attempts:a@test.com')
    expect(redisMock.expire).toHaveBeenCalledWith('lockout:attempts:a@test.com', 900)
    expect(redisMock.set).not.toHaveBeenCalled()
  })

  it('recordFailure: повторный incr не продлевает окно', async () => {
    redisMock.incr.mockResolvedValue(3)
    await recordFailure('a@test.com')
    expect(redisMock.expire).not.toHaveBeenCalled()
    expect(redisMock.set).not.toHaveBeenCalled()
  })

  it('recordFailure: N-я попытка ставит блокировку и пишет warn', async () => {
    redisMock.incr.mockResolvedValue(5)
    await recordFailure('a@test.com')
    expect(redisMock.set).toHaveBeenCalledWith('lockout:a@test.com', '1', 'EX', 900)
    expect(rootLog.warn).toHaveBeenCalledWith(
      '[lockout] Redis: locked a@test.com for 900s after 5 failures',
    )
  })

  it('AUTH_LOCKOUT_MAX_ATTEMPTS=2: блокировка ставится на второй попытке', async () => {
    process.env.AUTH_LOCKOUT_MAX_ATTEMPTS = '2'
    redisMock.incr.mockResolvedValue(2)
    await recordFailure('a@test.com')
    expect(redisMock.set).toHaveBeenCalled()
  })

  it('нечисловое AUTH_LOCKOUT_MAX_ATTEMPTS → дефолт 5, вторая попытка не блокирует', async () => {
    process.env.AUTH_LOCKOUT_MAX_ATTEMPTS = 'abc'
    redisMock.incr.mockResolvedValue(4)
    await recordFailure('a@test.com')
    expect(redisMock.set).not.toHaveBeenCalled()
  })

  it('expire падает → попытка уходит в memory-fallback, оттуда блокировка видна', async () => {
    redisMock.incr.mockResolvedValue(1)
    redisMock.expire.mockRejectedValue(new Error('conn refused'))
    for (let i = 0; i < 5; i++) await recordFailure('a@test.com')

    getRedisMock.mockReturnValue(null)
    expect(await isLocked('a@test.com')).toBeGreaterThanOrEqual(14)
  })

  it('recordSuccess: снимает и счётчик попыток, и саму блокировку', async () => {
    await recordSuccess('a@test.com')
    expect(redisMock.del).toHaveBeenCalledWith('lockout:attempts:a@test.com')
    expect(redisMock.del).toHaveBeenCalledWith('lockout:a@test.com')
  })

  it('recordSuccess: падение del уходит в memory-fallback и сбрасывает память', async () => {
    getRedisMock.mockReturnValue(null)
    for (let i = 0; i < 5; i++) await recordFailure('a@test.com')
    expect(await isLocked('a@test.com')).not.toBeNull()

    getRedisMock.mockReturnValue(redisMock)
    redisMock.del.mockRejectedValue(new Error('conn refused'))
    await recordSuccess('a@test.com')

    getRedisMock.mockReturnValue(null)
    expect(await isLocked('a@test.com')).toBeNull()
  })

  it('recordSuccess без Redis: память очищается, блокировка снимается', async () => {
    getRedisMock.mockReturnValue(null)
    for (let i = 0; i < 5; i++) await recordFailure('a@test.com')
    expect(await isLocked('a@test.com')).not.toBeNull()

    await recordSuccess('a@test.com')
    expect(await isLocked('a@test.com')).toBeNull()
  })
})

describe('lockout в режиме in-memory (Redis недоступен)', () => {
  beforeEach(() => {
    getRedisMock.mockReturnValue(null)
  })

  it('блокировка истекает по окну 15 минут', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      for (let i = 0; i < 5; i++) await recordFailure('a@test.com')
      expect(await isLocked('a@test.com')).not.toBeNull()

      vi.advanceTimersByTime(16 * 60 * 1000)
      expect(await isLocked('a@test.com')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('после истечения окна счётчик начинается заново', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      for (let i = 0; i < 4; i++) await recordFailure('a@test.com')
      vi.advanceTimersByTime(16 * 60 * 1000)
      await recordFailure('a@test.com')
      expect(await isLocked('a@test.com')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('превышение лимита карты в 10000 вычищает протухшие записи, новые ключи продолжают работать', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      for (let i = 0; i < 6000; i++) await recordFailure(`old${i}`)
      vi.advanceTimersByTime(16 * 60 * 1000)
      for (let i = 0; i < 4001; i++) await recordFailure(`new${i}`)

      expect(await isLocked('old0')).toBeNull()
      expect(await isLocked('new0')).toBeNull()
      for (let i = 0; i < 5; i++) await recordFailure('fresh@test.com')
      expect(await isLocked('fresh@test.com')).not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('изоляция ключей: чужой email не подхватывает чужую блокировку', async () => {
    for (let i = 0; i < 5; i++) await recordFailure('a@test.com')
    expect(await isLocked('b@test.com')).toBeNull()
  })
})
