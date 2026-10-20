// Stage 110: ветка `sendPushWeb` «VAPID не настроен» (`!vapidPublic || !vapidPrivate`).
// Ключи читаются на импорте модуля, поэтому их отсутствие проверяется в отдельном
// файле с пустым окружением — иначе ветка недостижима.

vi.hoisted(() => {
  delete process.env.VAPID_PUBLIC_KEY
  delete process.env.VAPID_PRIVATE_KEY
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }))
vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))
vi.mock('web-push', () => ({ default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() } }))
vi.mock('../queue.js', () => ({ pushQueue: null }))
vi.mock('../fcm.js', () => ({ isFCMConfigured: () => false, sendFcmToAll: vi.fn(async () => ({ sent: 0 })) }))
vi.mock('../quiet-hours.js', () => ({
  isQuietNow: vi.fn(async () => false),
  quietUserSet: vi.fn(async () => new Set()),
}))

import pool from '../db.js'
import webpush from 'web-push'
import { sendPushToUser, sendPushToAll } from '../routes/push.js'

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockReset()
  pool.query.mockResolvedValue([[], []])
})

describe('VAPID без ключей → web-push не отправляется', () => {
  it('личная отправка: SELECT web не выполняется, 0 отправлено', async () => {
    const sent = await sendPushToUser(5, 't', 'b')
    expect(sent).toBe(0)
    expect(webpush.sendNotification).not.toHaveBeenCalled()
    const webQuery = pool.query.mock.calls.find((c) => String(c[0]).includes("platform = 'web'"))
    expect(webQuery).toBeUndefined()
  })

  it('рассылка: web-запрос идёт, но отправки нет (sendPushAllDirect не гейтится VAPID)', async () => {
    const sent = await sendPushToAll('t', 'b')
    expect(sent).toBe(0)
    expect(webpush.sendNotification).not.toHaveBeenCalled()
  })
})
