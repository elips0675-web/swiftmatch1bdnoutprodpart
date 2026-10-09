export function createGracefulShutdown({
  httpServer,
  stopWsTimers,
  closeQueues,
  disconnectRedis,
  closePool,
  logger,
  timeoutMs = 10000,
  exit = (code) => process.exit(code),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  let started = false

  return async function shutdown(signal) {
    if (started) return false
    started = true
    logger.info(`${signal} received — shutting down`)

    const deadline = setTimer(() => {
      logger.warn(`Graceful shutdown timed out after ${timeoutMs}ms — forcing exit`)
      exit(1)
    }, timeoutMs)
    if (deadline && typeof deadline.unref === 'function') deadline.unref()

    try {
      stopWsTimers()
      await closeQueues()
      await disconnectRedis()
      await closePool()
      await new Promise((resolve) => httpServer.close(resolve))
      clearTimer(deadline)
      exit(0)
      return true
    } catch (err) {
      clearTimer(deadline)
      logger.error('Graceful shutdown failed: ' + (err && err.message ? err.message : err))
      exit(1)
      return false
    }
  }
}
