const DEADLOCK_ERRNO = 1213

export function isDeadlockError(err) {
  return Boolean(err) && (err.code === 'ER_LOCK_DEADLOCK' || err.errno === DEADLOCK_ERRNO)
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export async function withDeadlockRetry(run, options = {}) {
  const attempts = Number.isInteger(options.attempts) && options.attempts > 0 ? options.attempts : 3
  const sleep = options.sleep || defaultSleep
  const baseDelayMs = Number.isFinite(options.baseDelayMs) ? options.baseDelayMs : 10

  for (let attempt = 1; ; attempt++) {
    try {
      return await run(attempt)
    } catch (err) {
      if (!isDeadlockError(err) || attempt >= attempts) throw err
      await sleep(baseDelayMs * attempt)
    }
  }
}
