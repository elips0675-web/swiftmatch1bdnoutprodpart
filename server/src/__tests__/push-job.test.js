vi.hoisted(() => {
  process.env.VAPID_PUBLIC_KEY = 'pub-key'
  process.env.VAPID_PRIVATE_KEY = 'priv-key'
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }))

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('web-push', () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() },
}))

vi.mock('../fcm.js', () => ({
  isFCMConfigured: vi.fn(() => false),
  sendFcmToAll: vi.fn(),
}))

import processPush from '../jobs/push.job.js'
import pool from '../db.js'
import webpush from 'web-push'
import { rootLogger } from '../logger.js'
import { isFCMConfigured, sendFcmToAll } from '../fcm.js'

function subsQuery(rows) {
  pool.query.mockImplementation(async (sql) => {
    if (/FROM push_subscriptions/.test(String(sql))) return [rows, []]
    if (/FROM fcm_tokens/.test(String(sql))) return [[], []]
    return [{ affectedRows: 1 }, []]
  })
}

describe('processPush (job очереди push)', () => {
  beforeEach(() => {
    pool.query.mockReset()
    pool.query.mockResolvedValue([[{ endpoint: 'https://push.example/1', p256dh: 'p', auth: 'a' }], []])
    webpush.sendNotification.mockReset().mockResolvedValue({ statusCode: 201 })
    isFCMConfigured.mockReset().mockReturnValue(false)
    sendFcmToAll.mockReset().mockResolvedValue({ sent: 0 })
    rootLogger.error.mockReset()
  })

  it('VAPID-ключи заданы на импорте → webpush.setVapidDetails вызван', () => {
    expect(webpush.setVapidDetails).toHaveBeenCalled()
  })

  it('userId → подписки одного пользователя, отправка каждой', async () => {
    subsQuery([
      { endpoint: 'https://push.example/1', p256dh: 'p1', auth: 'a1' },
      { endpoint: 'https://push.example/2', p256dh: 'p2', auth: 'a2' },
    ])
    const result = await processPush({ data: { userId: 7, title: 'T', body: 'B' } })
    expect(result.sent).toBe(2)
    expect(webpush.sendNotification).toHaveBeenCalledTimes(2)
    const [sql, params] = pool.query.mock.calls[0]
    expect(String(sql)).toContain('user_id = ?')
    expect(params).toEqual([7])
  })

  it('userIds → пачка через IN (?)', async () => {
    subsQuery([{ endpoint: 'https://push.example/1', p256dh: 'p', auth: 'a' }])
    const result = await processPush({ data: { userIds: [1, 2, 3], title: 'T', body: 'B' } })
    expect(result.sent).toBe(1)
    const [sql] = pool.query.mock.calls[0]
    expect(String(sql)).toContain('user_id IN (?)')
  })

  it('без userId/userIds → рассылка по всем web-подпискам', async () => {
    subsQuery([])
    const result = await processPush({ data: { title: 'T', body: 'B' } })
    expect(result.sent).toBe(0)
    const [sql] = pool.query.mock.calls[0]
    expect(String(sql)).toMatch(/FROM push_subscriptions WHERE platform = 'web'/)
  })

  it('410/404 от push-сервиса удаляют мёртвую подписку и не считаются отправкой', async () => {
    subsQuery([
      { endpoint: 'https://push.example/dead', p256dh: 'p', auth: 'a' },
      { endpoint: 'https://push.example/live', p256dh: 'p', auth: 'a' },
    ])
    webpush.sendNotification
      .mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }))
      .mockResolvedValueOnce({ statusCode: 201 })
    const result = await processPush({ data: { userId: 7, title: 'T', body: 'B' } })
    expect(result.sent).toBe(1)
    const deleteCall = pool.query.mock.calls.find(([sql]) => /DELETE FROM push_subscriptions/.test(String(sql)))
    expect(deleteCall[1]).toEqual(['https://push.example/dead'])
  })

  it('прочая ошибка отправки не удаляет подписку и не роняет джобу', async () => {
    subsQuery([{ endpoint: 'https://push.example/1', p256dh: 'p', auth: 'a' }])
    webpush.sendNotification.mockRejectedValueOnce(Object.assign(new Error('boom'), { statusCode: 500 }))
    const result = await processPush({ data: { userId: 7, title: 'T', body: 'B' } })
    expect(result.sent).toBe(0)
    expect(pool.query.mock.calls.some(([sql]) => /DELETE FROM push_subscriptions/.test(String(sql)))).toBe(false)
  })

  it('FCM настроен → токены читаются и уходят через sendFcmToAll', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (/FROM push_subscriptions/.test(String(sql))) return [[{ endpoint: 'e', p256dh: 'p', auth: 'a' }], []]
      if (/FROM fcm_tokens/.test(String(sql))) return [[{ token: 'tok-1' }, { token: 'tok-2' }], []]
      return [{ affectedRows: 0 }, []]
    })
    isFCMConfigured.mockReturnValue(true)
    sendFcmToAll.mockResolvedValue({ sent: 2 })
    const result = await processPush({ data: { userId: 7, title: 'T', body: 'B' } })
    expect(result.fcmSent).toBe(2)
    expect(sendFcmToAll).toHaveBeenCalledWith(['tok-1', 'tok-2'], 'T', 'B', { url: '/' })
  })

  it('FCM не настроен → таблица токенов не читается', async () => {
    subsQuery([])
    await processPush({ data: { userId: 7, title: 'T', body: 'B' } })
    expect(sendFcmToAll).not.toHaveBeenCalled()
    expect(pool.query.mock.calls.some(([sql]) => /FROM fcm_tokens/.test(String(sql)))).toBe(false)
  })

  it('ошибка БД логируется и пробрасывается (джоба уходит в failed)', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'))
    await expect(processPush({ data: { userId: 7, title: 'T', body: 'B' } })).rejects.toThrow('db down')
    expect(rootLogger.error).toHaveBeenCalledWith('[push-job] Error:', expect.any(Error))
  })

  it('без VAPID-ключей web-пуши пропускаются, подписки всё равно читаются', async () => {
    vi.resetModules()
    delete process.env.VAPID_PUBLIC_KEY
    delete process.env.VAPID_PRIVATE_KEY
    const freshPool = (await import('../db.js')).default
    const freshWebpush = (await import('web-push')).default
    freshPool.query.mockResolvedValue([[{ endpoint: 'e', p256dh: 'p', auth: 'a' }], []])
    const { default: freshProcessPush } = await import('../jobs/push.job.js')
    const result = await freshProcessPush({ data: { title: 'T', body: 'B' } })
    expect(result.sent).toBe(0)
    expect(freshWebpush.sendNotification).not.toHaveBeenCalled()
    process.env.VAPID_PUBLIC_KEY = 'pub-key'
    process.env.VAPID_PRIVATE_KEY = 'priv-key'
  })
})
