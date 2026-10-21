import { describe, it, expect, vi, afterEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { rootLogger } from '../logger.js'
import { asyncHandler, isAsyncWrapped, wrapApp, wrapRouter } from '../async-handler.js'

const servers = []

function startApp(app) {
  const server = app.listen(0)
  servers.push(server)
  return `http://127.0.0.1:${server.address().port}`
}

function errorMiddleware(err, req, res, _next) {
  res.status(500).json({ error: err.message })
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections?.()
    await new Promise((resolve) => server.close(resolve))
  }
  vi.clearAllMocks()
})

function rejectedHandler() {
  const pending = Promise.reject(new Error('boom'))
  pending.catch(() => {})
  return pending
}

function hangOrAnswer(promise, ms = 400) {
  return Promise.race([
    promise.then(() => 'RESOLVED', () => 'REJECTED'),
    new Promise((resolve) => setTimeout(() => resolve('TIMEOUT'), ms)),
  ])
}

describe('asyncHandler', () => {
  it('синхронный throw уходит в next(err)', () => {
    const next = vi.fn()
    const handler = asyncHandler(() => {
      throw new Error('sync boom')
    })
    handler({}, {}, next)
    expect(next).toHaveBeenCalledTimes(1)
    expect(next.mock.calls[0][0].message).toBe('sync boom')
  })

  it('отклонённый промис уходит в next(err)', async () => {
    const next = vi.fn()
    const handler = asyncHandler(async () => {
      throw new Error('async boom')
    })
    handler({}, {}, next)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(next).toHaveBeenCalledTimes(1)
    expect(next.mock.calls[0][0].message).toBe('async boom')
  })

  it('успешный async-хендлер не вызывает next', async () => {
    const next = vi.fn()
    const handler = asyncHandler(async () => undefined)
    handler({}, {}, next)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(next).not.toHaveBeenCalled()
  })

  it('синхронный хендлер без промиса не трогается лишним next', () => {
    const next = vi.fn()
    asyncHandler((req, res) => res.json({ ok: true }))({}, { json: vi.fn() }, next)
    expect(next).not.toHaveBeenCalled()
  })

  it('error-middleware (4 аргумента) не оборачивается', () => {
    const original = (err, req, res, _next) => res.status(500)
    expect(asyncHandler(original)).toBe(original)
    expect(asyncHandler(original).length).toBe(4)
  })

  it('повторная обёртка возвращает ту же функцию', () => {
    const wrapped = asyncHandler(async () => undefined)
    expect(asyncHandler(wrapped)).toBe(wrapped)
    expect(isAsyncWrapped(wrapped)).toBe(true)
  })

  it('ответ уже отправлен: ошибка логируется и не роняет ответ', async () => {
    const app = express()
    app.get('/late', async (req, res) => {
      res.json({ ok: true })
      throw new Error('late boom')
    })
    app.use(errorMiddleware)
    wrapApp(app)

    const res = await request(startApp(app)).get('/late')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(rootLogger.error).toHaveBeenCalledTimes(1)
    expect(rootLogger.error.mock.calls[0][0]).toContain('late boom')
  })
})

describe('wrapRouter', () => {
  it('async-ошибка роута отдаёт 500, а не висящий запрос', async () => {
    const router = express.Router()
    router.get('/boom', async () => {
      throw new Error('route boom')
    })
    wrapRouter(router)

    const app = express()
    app.use(router)
    app.use(errorMiddleware)

    const res = await request(startApp(app)).get('/boom')
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'route boom' })
  })

  it('middleware-слой роутера с async-ошибкой отдаёт 500', async () => {
    const router = express.Router()
    router.use(async (req, res, next) => {
      if (req.query.fail) throw new Error('mw boom')
      next()
    })
    router.get('/ok', (req, res) => res.json({ ok: true }))
    wrapRouter(router)

    const app = express()
    app.use(router)
    app.use(errorMiddleware)

    const url = startApp(app)

    const failed = await request(url).get('/ok?fail=1')
    expect(failed.status).toBe(500)
    expect(failed.body).toEqual({ error: 'mw boom' })

    const ok = await request(url).get('/ok')
    expect(ok.status).toBe(200)
  })

  it('error-handler внутри роутера сохраняет арность и ловит ошибку', async () => {
    const router = express.Router()
    router.get('/boom', async () => {
      throw new Error('inner boom')
    })
    router.use((err, req, res, _next) => res.status(418).json({ caught: err.message }))
    wrapRouter(router)

    const app = express()
    app.use(router)

    const res = await request(startApp(app)).get('/boom')
    expect(res.status).toBe(418)
    expect(res.body).toEqual({ caught: 'inner boom' })
  })

  it('обёрнутые хендлеры помечены маркером, повторный вызов их не дублирует', () => {
    const router = express.Router()
    router.get('/x', async (req, res) => res.json({}))
    wrapRouter(router)

    const routeLayer = router.stack.find((layer) => layer.route)
    const handler = routeLayer.route.stack[0].handle
    expect(isAsyncWrapped(handler)).toBe(true)

    wrapRouter(router)
    expect(routeLayer.route.stack[0].handle).toBe(handler)
  })

  it('роутер без stack возвращается как есть', () => {
    const fake = () => {}
    expect(wrapRouter(fake)).toBe(fake)
    expect(wrapRouter(null)).toBeNull()
  })
})

describe('wrapApp', () => {
  it('маршрут приложения и смонтированный роутер оба отдают 500', async () => {
    const app = express()
    app.get('/app-boom', async () => {
      throw new Error('app boom')
    })
    const router = express.Router()
    router.get('/router-boom', async () => {
      throw new Error('router boom')
    })
    app.use('/sub', router)
    app.use(errorMiddleware)

    const stats = wrapApp(app)
    expect(stats.wrapped).toBeGreaterThanOrEqual(3)

    const url = startApp(app)
    const appRes = await request(url).get('/app-boom')
    expect(appRes.status).toBe(500)
    expect(appRes.body).toEqual({ error: 'app boom' })

    const routerRes = await request(url).get('/sub/router-boom')
    expect(routerRes.status).toBe(500)
    expect(routerRes.body).toEqual({ error: 'router boom' })
  })

  it('вложенный роутер внутри роутера тоже защищён', async () => {
    const inner = express.Router()
    inner.get('/deep', async () => {
      throw new Error('deep boom')
    })
    const outer = express.Router()
    outer.use('/inner', inner)

    const app = express()
    app.use('/outer', outer)
    app.use(errorMiddleware)
    wrapApp(app)

    const res = await request(startApp(app)).get('/outer/inner/deep')
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'deep boom' })
  })

  it('приложение без внутреннего роутера не падает', () => {
    expect(wrapApp({}).wrapped).toBe(0)
    expect(wrapApp(null).wrapped).toBe(0)
  })
})

describe('регрессия: Express 4 не ловит reject из async-хендлера', () => {
  it('без обёртки запрос не отвечает вовсе', async () => {
    const app = express()
    app.get('/hang', rejectedHandler)
    app.use(errorMiddleware)

    const outcome = await hangOrAnswer(request(startApp(app)).get('/hang'))
    expect(outcome).toBe('TIMEOUT')
  })

  it('с обёрткой тот же запрос отвечает 500', async () => {
    const app = express()
    app.get('/hang', rejectedHandler)
    app.use(errorMiddleware)
    wrapApp(app)

    const res = await request(startApp(app)).get('/hang')
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'boom' })
  })
})
