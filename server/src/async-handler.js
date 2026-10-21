import { rootLogger } from './logger.js'

const WRAPPED = Symbol.for('swiftmatch.asyncHandler')

export function isAsyncWrapped(fn) {
  return typeof fn === 'function' && fn[WRAPPED] === true
}

export function asyncHandler(fn) {
  if (typeof fn !== 'function') return fn
  if (fn.length > 3) return fn
  if (isAsyncWrapped(fn)) return fn
  const wrapped = function asyncSafe(req, res, next) {
    let result
    try {
      result = fn(req, res, next)
    } catch (err) {
      next(err)
      return
    }
    if (result && typeof result.then === 'function') {
      result.then(undefined, (err) => {
        if (res.headersSent) {
          rootLogger.error('Async route error after response sent: ' + (err?.stack || err))
          return
        }
        next(err)
      })
    }
  }
  Object.defineProperty(wrapped, WRAPPED, { value: true })
  return wrapped
}

function wrapLayer(layer, stats) {
  if (!layer) return
  const route = layer.route
  if (route && Array.isArray(route.stack)) {
    for (const routeLayer of route.stack) {
      stats.total += 1
      const before = routeLayer.handle
      const after = asyncHandler(before)
      if (after !== before) {
        routeLayer.handle = after
        stats.wrapped += 1
      }
    }
    return
  }
  const handle = layer.handle
  if (handle && Array.isArray(handle.stack)) {
    for (const sub of handle.stack) wrapLayer(sub, stats)
    return
  }
  if (typeof handle === 'function') {
    stats.total += 1
    const before = handle
    const after = asyncHandler(before)
    if (after !== before) {
      layer.handle = after
      stats.wrapped += 1
    }
  }
}

export function wrapRouter(router) {
  if (!router || !Array.isArray(router.stack)) return router
  const stats = { total: 0, wrapped: 0 }
  for (const layer of router.stack) wrapLayer(layer, stats)
  return router
}

export function wrapApp(app) {
  const stats = { total: 0, wrapped: 0 }
  const stack = app?._router?.stack || app?.router?.stack
  if (!Array.isArray(stack)) return stats
  for (const layer of stack) wrapLayer(layer, stats)
  return stats
}
