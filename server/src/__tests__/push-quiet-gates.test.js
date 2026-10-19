vi.hoisted(() => {
  process.env.VAPID_PUBLIC_KEY = 'test-public-key'
  process.env.VAPID_PRIVATE_KEY = 'test-private-key'
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}))

vi.mock('web-push', () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() },
}))

vi.mock('../queue.js', () => ({
  pushQueue: null,
}))

const fcmControl = vi.hoisted(() => ({ configured: true }))

vi.mock('../fcm.js', () => ({
  isFCMConfigured: () => fcmControl.configured,
  sendFcmToAll: vi.fn(async (tokens) => ({ sent: tokens.length })),
}))

vi.mock('../quiet-hours.js', () => ({
  isQuietNow: vi.fn(async () => false),
  quietUserSet: vi.fn(async () => new Set()),
}))

import pool from '../db.js'
import webpush from 'web-push'
import { sendFcmToAll } from '../fcm.js'
import { isQuietNow, quietUserSet } from '../quiet-hours.js'
import { sendPushToUser, sendPushToAll } from '../routes/push.js'
import processPush from '../jobs/push.job.js'

function routePoolImpl() {
  pool.query.mockImplementation(async (sql) => {
    if (sql.includes("platform = 'fcm'") && sql.includes('user_id = ?')) {
      return [[{ endpoint: 'ep-fcm-own' }], []]
    }
    if (sql.includes('FROM fcm_tokens WHERE user_id = ?')) {
      return [[{ token: 'tok-own' }], []]
    }
    if (sql.includes("platform = 'fcm'")) {
      return [[{ endpoint: 'f1', user_id: 1 }, { endpoint: 'f2', user_id: 2 }], []]
    }
    if (sql.includes('FROM fcm_tokens')) {
      return [[{ token: 't1', user_id: 1 }, { token: 't2', user_id: 2 }], []]
    }
    if (sql.includes("platform = 'web'") && sql.includes('user_id = ?')) {
      return [[{ endpoint: 'w-own', p256dh: 'p', auth: 'a' }], []]
    }
    if (sql.includes("platform = 'web'")) {
      return [[
        { endpoint: 'w1', p256dh: 'p', auth: 'a', user_id: 1 },
        { endpoint: 'w2', p256dh: 'p', auth: 'a', user_id: 2 },
      ], []]
    }
    return [[], []]
  })
}

function sentEndpoints() {
  return webpush.sendNotification.mock.calls.map((c) => c[0].endpoint)
}

beforeEach(() => {
  vi.clearAllMocks()
  fcmControl.configured = true
  isQuietNow.mockResolvedValue(false)
  quietUserSet.mockResolvedValue(new Set())
  routePoolImpl()
})

describe('sendPushToUser — гейт тишины для личной отправки', () => {
  it('в окне тишины: 0 отправлено, ни одного запроса в БД и ни одного вызова провайдера', async () => {
    isQuietNow.mockResolvedValue(true)
    const sent = await sendPushToUser(5, 'title', 'body')
    expect(sent).toBe(0)
    expect(pool.query).not.toHaveBeenCalled()
    expect(sendFcmToAll).not.toHaveBeenCalled()
    expect(webpush.sendNotification).not.toHaveBeenCalled()
  })

  it('вне тишины: уходят и FCM, и web-push', async () => {
    const sent = await sendPushToUser(5, 'title', 'body')
    expect(sent).toBe(2)
    expect(sendFcmToAll).toHaveBeenCalledWith(['ep-fcm-own'], 'title', 'body', { url: '/' })
    expect(sentEndpoints()).toEqual(['w-own'])
  })

  it('личная отправка не делает пакетную проверку — тишина решается isQuietNow', async () => {
    await sendPushToUser(5, 'title', 'body')
    expect(quietUserSet).not.toHaveBeenCalled()
    expect(isQuietNow).toHaveBeenCalledWith(5)
  })
})

describe('sendPushToAll — гейт тишины для рассылки', () => {
  it('пользователи в тишине пропускаются в обоих каналах', async () => {
    quietUserSet.mockResolvedValue(new Set([2]))
    const sent = await sendPushToAll('title', 'body')
    expect(sent).toBe(2)
    expect(quietUserSet).toHaveBeenCalledWith([1, 2])
    expect(sendFcmToAll).toHaveBeenCalledWith(['f1'], 'title', 'body', { url: '/' })
    expect(sentEndpoints()).toEqual(['w1'])
  })

  it('все в тишине = 0, провайдеры не вызываются', async () => {
    quietUserSet.mockResolvedValue(new Set([1, 2]))
    const sent = await sendPushToAll('title', 'body')
    expect(sent).toBe(0)
    expect(sendFcmToAll).not.toHaveBeenCalled()
    expect(webpush.sendNotification).not.toHaveBeenCalled()
  })
})

describe('processPush — job рассылки фильтрует тихих', () => {
  it('broadcast: web и FCM получатели в тишине отфильтрованы', async () => {
    quietUserSet.mockResolvedValue(new Set([2]))
    const result = await processPush({ data: { title: 't', body: 'b' } })
    expect(quietUserSet).toHaveBeenCalledWith([1, 2])
    expect(sentEndpoints()).toEqual(['w1'])
    expect(sendFcmToAll).toHaveBeenCalledWith(['t1'], 't', 'b', { url: '/' })
    expect(result).toEqual({ sent: 1, fcmSent: 1 })
  })

  it('broadcast, когда все в тишине: 0 отправлено', async () => {
    quietUserSet.mockResolvedValue(new Set([1, 2]))
    const result = await processPush({ data: { title: 't', body: 'b' } })
    expect(result).toEqual({ sent: 0, fcmSent: 0 })
    expect(webpush.sendNotification).not.toHaveBeenCalled()
    expect(sendFcmToAll).not.toHaveBeenCalled()
  })

  it('targeted job: пакетная проверка не вызывается — тишина проверена до постановки в очередь', async () => {
    await processPush({ data: { userId: 5, title: 't', body: 'b' } })
    expect(quietUserSet).not.toHaveBeenCalled()
    expect(sentEndpoints()).toEqual(['w-own'])
    expect(sendFcmToAll).toHaveBeenCalledWith(['tok-own'], 't', 'b', { url: '/' })
  })
})
