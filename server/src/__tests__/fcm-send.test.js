// Stage 115 (DEPS-03): `firebase-admin` 13 → 14.5.0. В v14 удалён legacy
// namespace: `import * as admin from 'firebase-admin'` больше не несёт
// `apps`/`credential`/`messaging` (остались только `initializeApp`/`getApps`),
// а API переехали в ESM-энтрипоинты `firebase-admin/app` (`getApps`,
// `initializeApp`, `cert`, `applicationDefault`) и `firebase-admin/messaging`
// (`getMessaging`). Мок повторяет именно этот шейп, поэтому реализация на
// старом API упала бы на первом же тесте (`getApps`/`cert` — undefined).
vi.hoisted(() => {
  delete process.env.FCM_SERVER_KEY
  delete process.env.FCM_SERVICE_ACCOUNT
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { appMock, messagingMock, rootLog, fetchMock, sendMock } = vi.hoisted(() => ({
  appMock: {
    getApps: vi.fn(() => []),
    initializeApp: vi.fn(),
    cert: vi.fn(),
    applicationDefault: vi.fn(),
  },
  messagingMock: {
    getMessaging: vi.fn(),
  },
  rootLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  fetchMock: vi.fn(),
  sendMock: vi.fn(),
}))

const appsList = []

vi.mock('firebase-admin/app', () => ({
  getApps: appMock.getApps,
  initializeApp: appMock.initializeApp,
  cert: appMock.cert,
  applicationDefault: appMock.applicationDefault,
}))

vi.mock('firebase-admin/messaging', () => ({
  getMessaging: messagingMock.getMessaging,
}))

vi.mock('../logger.js', () => ({
  default: rootLog,
  createLogger: () => rootLog,
  rootLogger: rootLog,
}))

let savedEnv = {}

async function freshFcm(env = {}) {
  vi.resetModules()
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  return import('../fcm.js')
}

beforeEach(() => {
  vi.clearAllMocks()
  savedEnv = {
    FCM_SERVER_KEY: process.env.FCM_SERVER_KEY,
    FCM_SERVICE_ACCOUNT: process.env.FCM_SERVICE_ACCOUNT,
    FCM_ENDPOINT: process.env.FCM_ENDPOINT,
  }
  delete process.env.FCM_SERVER_KEY
  delete process.env.FCM_SERVICE_ACCOUNT
  delete process.env.FCM_ENDPOINT
  appsList.length = 0
  appMock.getApps.mockImplementation(() => appsList)
  appMock.initializeApp.mockImplementation(() => ({ name: '[DEFAULT]' }))
  appMock.cert.mockImplementation((sa) => sa)
  appMock.applicationDefault.mockImplementation(() => ({}))
  messagingMock.getMessaging.mockImplementation(() => ({ send: sendMock }))
  sendMock.mockResolvedValue('message-id-1')
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  vi.unstubAllGlobals()
})

describe('sendFcmToUser/sendFcmToAll без ключей — mock-режим', () => {
  it('sendFcmToUser отдаёт {success, mock} и не трогает ни fetch, ни firebase', async () => {
    const fcm = await freshFcm()
    const res = await fcm.sendFcmToUser('tok-abcdef1234', 'Title', 'Body', { a: 1 })
    expect(res).toEqual({ success: true, mock: true })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(messagingMock.getMessaging).not.toHaveBeenCalled()
    expect(rootLog.info).toHaveBeenCalledWith('[FCM MOCK] Would send to token', 'tok-abcdef', 'Title')
  })

  it('sendFcmToAll в mock-режиме логирует число токенов и не шлёт ничего', async () => {
    const fcm = await freshFcm()
    const res = await fcm.sendFcmToAll(['a', 'b'], 'T', 'B')
    expect(res).toEqual({ success: true, mock: true })
    expect(rootLog.info).toHaveBeenCalledWith('[FCM MOCK] Would send to', 2, 'tokens')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('isFCMConfigured без переменных — false', async () => {
    const fcm = await freshFcm()
    expect(fcm.isFCMConfigured()).toBe(false)
  })
})

describe('sendFcmToUser — service account, firebase-admin', () => {
  it('успех: cert из JSON, data стрингифицируется, android/apns payload собирается', async () => {
    const fcm = await freshFcm({ FCM_SERVICE_ACCOUNT: '{"project_id":"p1"}' })
    const res = await fcm.sendFcmToUser('tok', 'T', 'B', { count: 5, flag: true })
    expect(res).toEqual({ success: true, messageId: 'message-id-1' })
    expect(appMock.cert).toHaveBeenCalledWith({ project_id: 'p1' })
    expect(appMock.initializeApp).toHaveBeenCalledTimes(1)
    const message = sendMock.mock.calls[0][0]
    expect(message.token).toBe('tok')
    expect(message.notification).toEqual({ title: 'T', body: 'B' })
    expect(message.data).toEqual({ count: '5', flag: 'true' })
    expect(message.android).toEqual({ priority: 'high', notification: { sound: 'default' } })
    expect(message.apns).toEqual({ payload: { aps: { sound: 'default' } } })
    expect(fcm.isFCMConfigured()).toBe(true)
  })

  it('повторный вызов переиспользует закэшированный app — initializeApp один раз', async () => {
    const fcm = await freshFcm({ FCM_SERVICE_ACCOUNT: '{"project_id":"p1"}' })
    await fcm.sendFcmToUser('tok1', 'T', 'B')
    await fcm.sendFcmToUser('tok2', 'T', 'B')
    expect(appMock.initializeApp).toHaveBeenCalledTimes(1)
    expect(sendMock).toHaveBeenCalledTimes(2)
  })

  it('default app уже создан вне модуля (guard-ветка): локального app нет → отказ без legacy-ключа', async () => {
    appsList.push({ name: '[DEFAULT]' })
    const fcm = await freshFcm({ FCM_SERVICE_ACCOUNT: '{"project_id":"p1"}' })
    const res = await fcm.sendFcmToUser('tok', 'T', 'B')
    expect(appMock.initializeApp).not.toHaveBeenCalled()
    expect(res).toEqual({ success: false, error: 'FCM_SERVER_KEY not set' })
  })

  it('default app уже создан, но legacy-ключ есть → уход в HTTP-ветку', async () => {
    appsList.push({ name: '[DEFAULT]' })
    fetchMock.mockResolvedValue({ json: async () => ({}) })
    const fcm = await freshFcm({
      FCM_SERVICE_ACCOUNT: '{"project_id":"p1"}',
      FCM_SERVER_KEY: 'legacy-key',
    })
    const res = await fcm.sendFcmToUser('tok', 'T', 'B')
    expect(res).toEqual({ success: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('init падает: warn + отказ без legacy-ключа (app не создан)', async () => {
    appMock.initializeApp.mockImplementation(() => { throw new Error('bad credential') })
    const fcm = await freshFcm({ FCM_SERVICE_ACCOUNT: '{"project_id":"p1"}' })
    const res = await fcm.sendFcmToUser('tok', 'T', 'B')
    expect(res).toEqual({ success: false, error: 'FCM_SERVER_KEY not set' })
    expect(rootLog.warn).toHaveBeenCalledWith(
      'FCM: firebase-admin init (service account) failed:',
      'bad credential',
    )
  })

  it('init падает, но legacy-ключ есть → HTTP-ветка', async () => {
    appMock.initializeApp.mockImplementation(() => { throw new Error('bad credential') })
    fetchMock.mockResolvedValue({ json: async () => ({}) })
    const fcm = await freshFcm({
      FCM_SERVICE_ACCOUNT: '{"project_id":"p1"}',
      FCM_SERVER_KEY: 'legacy-key',
    })
    const res = await fcm.sendFcmToUser('tok', 'T', 'B')
    expect(res).toEqual({ success: true })
    expect(rootLog.warn).toHaveBeenCalled()
  })

  it('send падает: {success:false, error} и ошибка в лог', async () => {
    sendMock.mockRejectedValue(new Error('quota exceeded'))
    const fcm = await freshFcm({ FCM_SERVICE_ACCOUNT: '{"project_id":"p1"}' })
    const res = await fcm.sendFcmToUser('tok', 'T', 'B')
    expect(res).toEqual({ success: false, error: 'quota exceeded' })
    expect(rootLog.error).toHaveBeenCalledWith('FCM firebase-admin send failed:', expect.any(Error))
  })
})

describe('sendFcmToUser — только FCM_SERVER_KEY (applicationDefault)', () => {
  it('applicationDefault init успешен → отправка через firebase-admin', async () => {
    const fcm = await freshFcm({ FCM_SERVER_KEY: 'legacy-key' })
    const res = await fcm.sendFcmToUser('tok', 'T', 'B')
    expect(res).toEqual({ success: true, messageId: 'message-id-1' })
    expect(appMock.applicationDefault).toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('applicationDefault init падает → warn и уход в HTTP', async () => {
    appMock.initializeApp.mockImplementation(() => { throw new Error('no adc') })
    fetchMock.mockResolvedValue({ json: async () => ({}) })
    const fcm = await freshFcm({ FCM_SERVER_KEY: 'legacy-key' })
    const res = await fcm.sendFcmToUser('tok', 'T', 'B')
    expect(res).toEqual({ success: true })
    expect(rootLog.warn).toHaveBeenCalledWith('FCM: firebase-admin init failed:', 'no adc')
  })
})

describe('sendFcmToUser — legacy HTTP-ветка', () => {
  async function freshHttp() {
    appMock.initializeApp.mockImplementation(() => { throw new Error('no firebase') })
    return freshFcm({ FCM_SERVER_KEY: 'legacy-key' })
  }

  it('успех: POST с key-авторизацией, тело без стрингификации data', async () => {
    fetchMock.mockResolvedValue({ json: async () => ({ success: 1 }) })
    const fcm = await freshHttp()
    const res = await fcm.sendFcmToUser('tok', 'T', 'B', { count: 5 })
    expect(res).toEqual({ success: true })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://fcm.googleapis.com/fcm/send')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.headers.Authorization).toBe('key=legacy-key')
    expect(JSON.parse(init.body)).toEqual({
      to: 'tok',
      notification: { title: 'T', body: 'B', sound: 'default' },
      data: { count: 5 },
    })
  })

  it('failure в ответе: {success:false, error} из results[0] и лог', async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({ failure: 1, results: [{ error: 'InvalidRegistration' }] }),
    })
    const fcm = await freshHttp()
    const res = await fcm.sendFcmToUser('tok', 'T', 'B')
    expect(res).toEqual({ success: false, error: 'InvalidRegistration' })
    expect(rootLog.error).toHaveBeenCalledWith('FCM HTTP send failed:', expect.any(Object))
  })

  it('обрыв сети: {success:false, error} и лог', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))
    const fcm = await freshHttp()
    const res = await fcm.sendFcmToUser('tok', 'T', 'B')
    expect(res).toEqual({ success: false, error: 'network down' })
    expect(rootLog.error).toHaveBeenCalledWith('FCM HTTP send error:', expect.any(Error))
  })

  it('FCM_ENDPOINT переопределяет адрес (контрактный смоук — ловушка вместо fcm.googleapis.com)', async () => {
    fetchMock.mockResolvedValue({ json: async () => ({ success: 1 }) })
    appMock.initializeApp.mockImplementation(() => { throw new Error('no firebase') })
    const fcm = await freshFcm({ FCM_SERVER_KEY: 'legacy-key', FCM_ENDPOINT: 'http://127.0.0.1:9999/fcm/send' })
    await fcm.sendFcmToUser('tok', 'T', 'B')
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:9999/fcm/send')
  })
})

describe('sendFcmToAll с настроенными ключами', () => {
  it('считает успешные отправки: два успеха из трёх → sent: 2', async () => {
    appMock.initializeApp.mockImplementation(() => { throw new Error('no firebase') })
    fetchMock
      .mockResolvedValueOnce({ json: async () => ({ success: 1 }) })
      .mockResolvedValueOnce({ json: async () => ({ success: 1 }) })
      .mockResolvedValueOnce({ json: async () => ({ failure: 1, results: [{ error: 'Bad' }] }) })
    const fcm = await freshFcm({ FCM_SERVER_KEY: 'legacy-key' })
    const res = await fcm.sendFcmToAll(['a', 'b', 'c'], 'T', 'B')
    expect(res).toEqual({ success: true, sent: 2 })
  })

  it('ни одной успешной → success: false, sent: 0', async () => {
    appMock.initializeApp.mockImplementation(() => { throw new Error('no firebase') })
    fetchMock.mockResolvedValue({ json: async () => ({ failure: 1, results: [{ error: 'Bad' }] }) })
    const fcm = await freshFcm({ FCM_SERVER_KEY: 'legacy-key' })
    const res = await fcm.sendFcmToAll(['a', 'b'], 'T', 'B')
    expect(res).toEqual({ success: false, sent: 0 })
  })
})
