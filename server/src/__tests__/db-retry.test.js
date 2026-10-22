import { describe, it, expect, vi } from 'vitest'
import { isDeadlockError, withDeadlockRetry } from '../db-retry.js'

function deadlock() {
  const err = new Error('Deadlock found when trying to get lock; try restarting transaction')
  err.code = 'ER_LOCK_DEADLOCK'
  err.errno = 1213
  return err
}

describe('isDeadlockError', () => {
  it('узнаёт ER_LOCK_DEADLOCK по коду', () => {
    expect(isDeadlockError(deadlock())).toBe(true)
  })

  it('узнаёт дедлок по errno 1213 без кода', () => {
    expect(isDeadlockError({ errno: 1213 })).toBe(true)
  })

  it('не считает дедлоком дубликат ключа', () => {
    expect(isDeadlockError({ code: 'ER_DUP_ENTRY', errno: 1062 })).toBe(false)
  })

  it('возвращает false на null и undefined', () => {
    expect(isDeadlockError(null)).toBe(false)
    expect(isDeadlockError(undefined)).toBe(false)
  })
})

describe('withDeadlockRetry', () => {
  it('возвращает результат с первой попытки и не спит', async () => {
    const run = vi.fn(async () => 'ok')
    const sleep = vi.fn(async () => {})

    await expect(withDeadlockRetry(run, { sleep })).resolves.toBe('ok')
    expect(run).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('повторяет вставку после дедлока и отдаёт результат второй попытки', async () => {
    const run = vi.fn()
      .mockRejectedValueOnce(deadlock())
      .mockResolvedValueOnce('ok')
    const sleep = vi.fn(async () => {})

    await expect(withDeadlockRetry(run, { sleep })).resolves.toBe('ok')
    expect(run).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(10)
  })

  it('пас за попытками — бросает последний дедлок, спит с растущей паузой', async () => {
    const err = deadlock()
    const run = vi.fn(async () => { throw err })
    const sleep = vi.fn(async () => {})

    await expect(withDeadlockRetry(run, { sleep })).rejects.toBe(err)
    expect(run).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls).toEqual([[10], [20]])
  })

  it('не повторяет не-дедлок и не спит', async () => {
    const err = Object.assign(new Error('boom'), { code: 'ER_NO_SUCH_TABLE' })
    const run = vi.fn(async () => { throw err })
    const sleep = vi.fn(async () => {})

    await expect(withDeadlockRetry(run, { sleep })).rejects.toBe(err)
    expect(run).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('уважает attempts: 1 — дедлок бросается сразу', async () => {
    const err = deadlock()
    const run = vi.fn(async () => { throw err })
    const sleep = vi.fn(async () => {})

    await expect(withDeadlockRetry(run, { sleep, attempts: 1 })).rejects.toBe(err)
    expect(run).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('уважает baseDelayMs и attempts из опций', async () => {
    const run = vi.fn()
      .mockRejectedValueOnce(deadlock())
      .mockRejectedValueOnce(deadlock())
      .mockResolvedValueOnce('ok')
    const sleep = vi.fn(async () => {})

    await expect(withDeadlockRetry(run, { sleep, attempts: 3, baseDelayMs: 5 })).resolves.toBe('ok')
    expect(run).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls).toEqual([[5], [10]])
  })

  it('некорректные опции не ломают ретрай: attempts=0 → три попытки, baseDelayMs=NaN → 10 мс', async () => {
    const run = vi.fn(async () => { throw deadlock() })
    const sleep = vi.fn(async () => {})

    await expect(withDeadlockRetry(run, { sleep, attempts: 0, baseDelayMs: Number.NaN })).rejects.toBeTruthy()
    expect(run).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls).toEqual([[10], [20]])
  })
})
