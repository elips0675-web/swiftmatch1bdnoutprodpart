// Stage 110: добор покрытия `routes/push.js` — FCM-подписка, ветка очереди
// (`pushQueue` есть), прямые FCM/web-отправки со всеми исходами (не
// сконфигурировано, пустой список, `result.sent || 0`, чистка 410/404, сбой
// провайдера) и отсутствие VAPID-ключей. Модули мокаются точечно, чтобы
// дёшево переключать каждое условие.

vi.hoisted(() => {
  process.env.VAPID_PUBLIC_KEY = 'test-public-key'
  process.env.VAPID_PRIVATE_KEY = 'test-private-key'
  process.env.JWT_SECRET = 'test-secret'
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}))

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('web-push', () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() },
}))

const queueControl = vi.hoisted(() => ({ queue: null }))
vi.mock('../queue.js', () => ({
  get pushQueue() {
    return queueControl.queue
  },
}))

const fcmControl = vi.hoisted(() => ({ configured: true, result: { sent: 1 } }))
vi.mock('../fcm.js', () => ({
  isFCMConfigured: () => fcmControl.configured,
  sendFcmToAll: vi.fn(),
}))

vi.mock('../quiet-hours.js', () => ({
  isQuietNow: vi.fn(async () => false),
  quietUserSet: vi.fn(async () => new Set()),
}))

import pool from '../db.js'
import logger from '../logger.js'
import webpush from 'web-push'
import { sendFcmToAll } from '../fcm.js'
import { isQuietNow, quietUserSet } from '../quiet-hours.js'
import { sendPushToUser, sendPushToAll } from '../routes/push.js'

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockReset()
  pool.query.mockResolvedValue([[], []])
  queueControl.queue = null
  fcmControl.configured = true
  fcmControl.result = { sent: 1 }
  sendFcmToAll.mockReset()
  sendFcmToAll.mockImplementation(async () => {
    if (fcmControl.result instanceof Error) throw fcmControl.result
    return { sent: fcmControl.result.sent ?? 1 }
  })
  webpush.sendNotification.mockReset()
  webpush.sendNotification.mockResolvedValue(undefined)
  isQuietNow.mockReset()
  isQuietNow.mockResolvedValue(false)
  quietUserSet.mockReset()
  quietUserSet.mockResolvedValue(new Set())
})

describe('ветка очереди (pushQueue есть)', () => {
  it('sendPushToUser: кладёт задачу с userId и не трогает провайдеров', async () => {
    const add = vi.fn(async () => {})
    queueControl.queue = { add }
    const sent = await sendPushToUser(7, 't', 'b', '/x')
    expect(sent).toBe(1)
    expect(add).toHaveBeenCalledWith({ userId: 7, title: 't', body: 'b', url: '/x' })
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('sendPushToAll: кладёт broadcast-задачу без userId', async () => {
    const add = vi.fn(async () => {})
    queueControl.queue = { add }
    const sent = await sendPushToAll('t', 'b', '/y')
    expect(sent).toBe(1)
    expect(add).toHaveBeenCalledWith({ title: 't', body: 'b', url: '/y' })
    expect(pool.query).not.toHaveBeenCalled()
  })
})

describe('FCM не сконфигурирован', () => {
  it('личная отправка: 0 от FCM, web всё равно уходит', async () => {
    fcmControl.configured = false
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes("platform = 'web'") && sql.includes('user_id = ?')) {
        return [[{ endpoint: 'w-own', p256dh: 'p', auth: 'a' }], []]
      }
      return [[], []]
    })
    const sent = await sendPushToUser(5, 't', 'b')
    expect(sent).toBe(1)
    expect(webpush.sendNotification).toHaveBeenCalledTimes(1)
  })

  it('рассылка: 0 от FCM, web всё равно уходит', async () => {
    fcmControl.configured = false
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes("platform = 'web'")) {
        return [[{ endpoint: 'w1', p256dh: 'p', auth: 'a', user_id: 1 }], []]
      }
      return [[], []]
    })
    const sent = await sendPushToAll('t', 'b')
    expect(sent).toBe(1)
    expect(webpush.sendNotification).toHaveBeenCalledTimes(1)
  })
})

describe('FCM: пустой список подписок', () => {
  it('личная отправка: нет FCM-подписок → от FCM 0', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes("platform = 'fcm'") && sql.includes('user_id = ?')) return [[], []]
      return [[], []]
    })
    const sent = await sendPushToUser(5, 't', 'b')
    expect(sent).toBe(0)
  })

  it('рассылка: нет FCM-подписок → от FCM 0 (тишину не запрашиваем)', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes("platform = 'fcm'")) return [[], []]
      return [[], []]
    })
    const sent = await sendPushToAll('t', 'b')
    expect(sent).toBe(0)
  })

  it('рассылка: все FCM-получатели в тишине → 0', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM fcm_tokens')) return [[{ token: 't1', user_id: 1 }], []]
      if (sql.includes("platform = 'fcm'")) return [[{ endpoint: 'f1', user_id: 1 }], []]
      return [[], []]
    })
    const { quietUserSet } = await import('../quiet-hours.js')
    quietUserSet.mockResolvedValue(new Set([1]))
    const sent = await sendPushToAll('t', 'b')
    expect(sent).toBe(0)
  })
})

describe('FCM: сбой провайдера → 0 и лог', () => {
  it('личная отправка: ошибка sendFcmToAll гасится, возврат 0', async () => {
    fcmControl.result = new Error('fcm boom')
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes("platform = 'fcm'") && sql.includes('user_id = ?')) {
        return [[{ endpoint: 'ep-fcm-own' }], []]
      }
      return [[], []]
    })
    const sent = await sendPushToUser(5, 't', 'b')
    expect(sent).toBe(0)
    expect(logger.error).toHaveBeenCalledWith('FCM push error:', expect.any(Error))
  })

  it('рассылка: ошибка sendFcmToAll гасится, возврат 0', async () => {
    fcmControl.result = new Error('fcm boom')
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM fcm_tokens')) return [[], []]
      if (sql.includes("platform = 'fcm'")) return [[{ endpoint: 'f1', user_id: 1 }], []]
      return [[], []]
    })
    const sent = await sendPushToAll('t', 'b')
    expect(sent).toBe(0)
    expect(logger.error).toHaveBeenCalledWith('FCM push all error:', expect.any(Error))
  })
})

describe('FCM: result.sent отсутствует → 0 (|| 0)', () => {
  it('личная отправка', async () => {
    fcmControl.result = {}
    const sent = await sendPushToUser(5, 't', 'b')
    expect(sent).toBe(0)
  })

  it('рассылка', async () => {
    fcmControl.result = {}
    const sent = await sendPushToAll('t', 'b')
    expect(sent).toBe(0)
  })
})

describe('web-push: удаление мёртвой подписки (410/404)', () => {
  it('личная отправка: 410 удаляет endpoint и не считает отправку', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes("platform = 'fcm'") && sql.includes('user_id = ?')) return [[], []]
      if (sql.includes("platform = 'web'") && sql.includes('user_id = ?')) {
        return [[{ endpoint: 'w-dead', p256dh: 'p', auth: 'a' }], []]
      }
      return [[], []]
    })
    webpush.sendNotification.mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }))
    const sent = await sendPushToUser(5, 't', 'b')
    expect(sent).toBe(0)
    const deleted = pool.query.mock.calls.find((c) => String(c[0]).startsWith('DELETE FROM push_subscriptions'))
    expect(deleted).toBeTruthy()
    expect(deleted[1]).toEqual(['w-dead'])
  })

  it('личная отправка: 404 удаляет endpoint', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes("platform = 'fcm'") && sql.includes('user_id = ?')) return [[], []]
      if (sql.includes("platform = 'web'") && sql.includes('user_id = ?')) {
        return [[{ endpoint: 'w-404', p256dh: 'p', auth: 'a' }], []]
      }
      return [[], []]
    })
    webpush.sendNotification.mockRejectedValueOnce(Object.assign(new Error('nf'), { statusCode: 404 }))
    const sent = await sendPushToUser(5, 't', 'b')
    expect(sent).toBe(0)
    const deleted = pool.query.mock.calls.find((c) => String(c[0]).startsWith('DELETE FROM push_subscriptions'))
    expect(deleted[1]).toEqual(['w-404'])
  })

  it('личная отправка: 500 не удаляет подписку, просто не считает', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes("platform = 'fcm'") && sql.includes('user_id = ?')) return [[], []]
      if (sql.includes("platform = 'web'") && sql.includes('user_id = ?')) {
        return [[{ endpoint: 'w-500', p256dh: 'p', auth: 'a' }], []]
      }
      return [[], []]
    })
    webpush.sendNotification.mockRejectedValueOnce(Object.assign(new Error('srv'), { statusCode: 500 }))
    const sent = await sendPushToUser(5, 't', 'b')
    expect(sent).toBe(0)
    const deleted = pool.query.mock.calls.find((c) => String(c[0]).startsWith('DELETE FROM push_subscriptions'))
    expect(deleted).toBeUndefined()
  })

  it('рассылка: 410 удаляет endpoint', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM fcm_tokens')) return [[], []]
      if (sql.includes("platform = 'web'")) {
        return [[{ endpoint: 'w-dead', p256dh: 'p', auth: 'a', user_id: 1 }], []]
      }
      return [[], []]
    })
    webpush.sendNotification.mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }))
    const sent = await sendPushToAll('t', 'b')
    expect(sent).toBe(0)
    const deleted = pool.query.mock.calls.find((c) => String(c[0]).startsWith('DELETE FROM push_subscriptions'))
    expect(deleted[1]).toEqual(['w-dead'])
  })
})

describe('web-push: сбой выборки подписок → 0 и лог', () => {
  it('личная отправка: ошибка SELECT web-подписок', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes("platform = 'fcm'") && sql.includes('user_id = ?')) return [[], []]
      if (sql.includes("platform = 'web'") && sql.includes('user_id = ?')) throw new Error('select boom')
      return [[], []]
    })
    const sent = await sendPushToUser(5, 't', 'b')
    expect(sent).toBe(0)
    expect(logger.error).toHaveBeenCalledWith('Send push error:', expect.any(Error))
  })

  it('рассылка: ошибка SELECT web-подписок', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM fcm_tokens')) return [[], []]
      if (sql.includes("platform = 'web'")) throw new Error('select boom')
      return [[], []]
    })
    const sent = await sendPushToAll('t', 'b')
    expect(sent).toBe(0)
    expect(logger.error).toHaveBeenCalledWith('Send push all error:', expect.any(Error))
  })
})

describe('subscribe: FCM-платформа и пропуски', () => {
  it('POST без endpoint → 400 endpoint is required', async () => {
    const { default: router } = await import('../routes/push.js')
    const express = (await import('express')).default
    const request = (await import('supertest')).default
    const jwt = (await import('jsonwebtoken')).default
    const app = express()
    app.use(express.json())
    app.use(router)
    const token = jwt.sign({ userId: 5, role: 'user' }, 'test-secret', { expiresIn: '1h' })
    const res = await request(app).post('/api/push/subscribe').set('Authorization', `Bearer ${token}`).send({})
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('endpoint is required')
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('POST с platform=fcm: пишет в БД без p256dh/auth', async () => {
    const { default: router } = await import('../routes/push.js')
    const express = (await import('express')).default
    const request = (await import('supertest')).default
    const jwt = (await import('jsonwebtoken')).default
    const app = express()
    app.use(express.json())
    app.use(router)
    const token = jwt.sign({ userId: 5, role: 'user' }, 'test-secret', { expiresIn: '1h' })
    const res = await request(app)
      .post('/api/push/subscribe')
      .set('Authorization', `Bearer ${token}`)
      .send({ endpoint: 'fcm-token', platform: 'fcm' })
    expect(res.status).toBe(201)
    expect(String(pool.query.mock.calls[0][0])).toContain("platform = 'fcm'")
    expect(pool.query.mock.calls[0][1]).toEqual([5, 'fcm-token'])
  })

  it('DELETE без endpoint: подставляет пустую строку', async () => {
    const { default: router } = await import('../routes/push.js')
    const express = (await import('express')).default
    const request = (await import('supertest')).default
    const jwt = (await import('jsonwebtoken')).default
    const app = express()
    app.use(express.json())
    app.use(router)
    const token = jwt.sign({ userId: 5, role: 'user' }, 'test-secret', { expiresIn: '1h' })
    const res = await request(app).delete('/api/push/subscribe').set('Authorization', `Bearer ${token}`).send({})
    expect(res.status).toBe(200)
    expect(pool.query.mock.calls[0][1]).toEqual([5, ''])
  })
})

describe('result.sent = 0 → ветка || 0', () => {
  it('личная отправка: sendFcmToAll вернул { sent: 0 } → 0', async () => {
    fcmControl.result = { sent: 0 }
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes("platform = 'fcm'") && sql.includes('user_id = ?')) {
        return [[{ endpoint: 'ep-fcm-own' }], []]
      }
      return [[], []]
    })
    const sent = await sendPushToUser(5, 't', 'b')
    expect(sent).toBe(0)
  })

  it('рассылка: sendFcmToAll вернул { sent: 0 } → 0', async () => {
    fcmControl.result = { sent: 0 }
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM fcm_tokens')) return [[], []]
      if (sql.includes("platform = 'fcm'")) return [[{ endpoint: 'f1', user_id: 1 }], []]
      return [[], []]
    })
    const sent = await sendPushToAll('t', 'b')
    expect(sent).toBe(0)
  })
})

describe('рассылка: мёртвая подписка 404 и ошибка без statusCode', () => {
  it('рассылка: 404 удаляет endpoint', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM fcm_tokens')) return [[], []]
      if (sql.includes("platform = 'web'")) {
        return [[{ endpoint: 'w-404', p256dh: 'p', auth: 'a', user_id: 1 }], []]
      }
      return [[], []]
    })
    webpush.sendNotification.mockRejectedValueOnce(Object.assign(new Error('nf'), { statusCode: 404 }))
    const sent = await sendPushToAll('t', 'b')
    expect(sent).toBe(0)
    const deleted = pool.query.mock.calls.find((c) => String(c[0]).startsWith('DELETE FROM push_subscriptions'))
    expect(deleted[1]).toEqual(['w-404'])
  })

  it('рассылка: ошибка без statusCode → подписка не удаляется', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM fcm_tokens')) return [[], []]
      if (sql.includes("platform = 'web'")) {
        return [[{ endpoint: 'w-x', p256dh: 'p', auth: 'a', user_id: 1 }], []]
      }
      return [[], []]
    })
    webpush.sendNotification.mockRejectedValueOnce(new Error('no status'))
    const sent = await sendPushToAll('t', 'b')
    expect(sent).toBe(0)
    const deleted = pool.query.mock.calls.find((c) => String(c[0]).startsWith('DELETE FROM push_subscriptions'))
    expect(deleted).toBeUndefined()
  })
})
