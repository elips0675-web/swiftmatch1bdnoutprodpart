import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { requestNotificationPermission, subscribeToPush, unsubscribeFromPush } from '@/lib/push-notifications'

const tokenState = vi.hoisted(() => ({ value: null as string | null }))
vi.mock('@/lib/token', () => ({ getToken: () => tokenState.value }))

const fetchMock = vi.fn()

const subscription = {
  endpoint: 'https://push.example/abc',
  toJSON: () => ({ endpoint: 'https://push.example/abc', keys: { p256dh: 'pk', auth: 'auth-secret' } }),
  unsubscribe: vi.fn(async () => true),
}
type SubscriptionStub = typeof subscription

const pushManager = {
  subscribe: vi.fn(async (_options: PushSubscriptionOptionsInit) => subscription),
  getSubscription: vi.fn(async (): Promise<SubscriptionStub | null> => subscription),
}
const registration = { pushManager }

const sw = {
  ready: null as unknown,
}

const readyAccess = { count: 0 }

const withServiceWorker = (ready: unknown = Promise.resolve(registration)) => {
  sw.ready = ready
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      get ready() {
        readyAccess.count += 1
        return sw.ready
      },
    },
  })
}

const withoutServiceWorker = () => {
  delete (navigator as unknown as Record<string, unknown>).serviceWorker
}

const withPushManager = () => {
  Object.defineProperty(window, 'PushManager', { configurable: true, value: function PushManager() {} })
}

const withoutPushManager = () => {
  delete (window as unknown as Record<string, unknown>).PushManager
}

const withNotification = (permission: string | null) => {
  Object.defineProperty(window, 'Notification', {
    configurable: true,
    value: { requestPermission: vi.fn(async () => permission) },
  })
}

const withoutNotification = () => {
  delete (window as unknown as Record<string, unknown>).Notification
}

const okJson = (body: unknown) => ({ ok: true, json: async () => body, text: async () => JSON.stringify(body) })
const failJson = (body: unknown = {}) => ({ ok: false, json: async () => body, text: async () => 'server error' })

describe('push-notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock.mockReset()
    tokenState.value = 'jwt-token'
    vi.stubGlobal('fetch', fetchMock)
    subscription.unsubscribe.mockReset()
    subscription.unsubscribe.mockResolvedValue(true)
    pushManager.subscribe.mockClear()
    pushManager.getSubscription.mockReset()
    pushManager.getSubscription.mockResolvedValue(subscription)
    readyAccess.count = 0
    withServiceWorker()
    withPushManager()
    withNotification('granted')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    withoutServiceWorker()
    withoutPushManager()
    withoutNotification()
    vi.restoreAllMocks()
  })

  describe('requestNotificationPermission', () => {
    it('без Notification API разрешение не выдаётся', async () => {
      withoutNotification()
      await expect(requestNotificationPermission()).resolves.toBe(false)
    })

    it('granted — true, denied — false', async () => {
      await expect(requestNotificationPermission()).resolves.toBe(true)
      withNotification('denied')
      await expect(requestNotificationPermission()).resolves.toBe(false)
    })
  })

  describe('subscribeToPush', () => {
    it('без serviceWorker подписка не создаётся и сеть не дёргается', async () => {
      withoutServiceWorker()
      await expect(subscribeToPush()).resolves.toBe(false)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('без PushManager подписка не создаётся', async () => {
      withoutPushManager()
      await expect(subscribeToPush()).resolves.toBe(false)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('без разрешения на уведомления — false до запроса VAPID', async () => {
      withNotification('denied')
      await expect(subscribeToPush()).resolves.toBe(false)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('сервер без VAPID-ключа — false, подписка не создаётся', async () => {
      fetchMock.mockResolvedValueOnce(okJson({}))
      await expect(subscribeToPush()).resolves.toBe(false)
      expect(pushManager.subscribe).not.toHaveBeenCalled()
      expect(readyAccess.count).toBe(0)
    })

    it('подписывает с декодированным base64url-ключом и отправляет endpoint на сервер', async () => {
      fetchMock
        .mockResolvedValueOnce(okJson({ publicKey: 'a-b_' }))
        .mockResolvedValueOnce(okJson({ ok: true }))

      await expect(subscribeToPush()).resolves.toBe(true)

      expect(pushManager.subscribe).toHaveBeenCalledTimes(1)
      const init = pushManager.subscribe.mock.calls[0][0]
      expect(init.userVisibleOnly).toBe(true)
      expect(Array.from(init.applicationServerKey as Uint8Array)).toEqual([107, 230, 255])

      const [url, request] = fetchMock.mock.calls[1]
      expect(url).toBe('/api/push/subscribe')
      expect(request.method).toBe('POST')
      expect(request.headers.Authorization).toBe('Bearer jwt-token')
      expect(JSON.parse(request.body)).toEqual({
        endpoint: 'https://push.example/abc',
        p256dh: 'pk',
        auth: 'auth-secret',
      })
    })

    it('без токена подписка уходит без Authorization', async () => {
      tokenState.value = null
      fetchMock
        .mockResolvedValueOnce(okJson({ publicKey: 'a-b_' }))
        .mockResolvedValueOnce(okJson({ ok: true }))

      await expect(subscribeToPush()).resolves.toBe(true)

      expect(fetchMock.mock.calls[1][1].headers.Authorization).toBeUndefined()
    })

    it('отказ сервера на подписку — false', async () => {
      fetchMock
        .mockResolvedValueOnce(okJson({ publicKey: 'a-b_' }))
        .mockResolvedValueOnce(failJson())

      await expect(subscribeToPush()).resolves.toBe(false)
    })

    it('сетевой сбой — false, а не исключение наружу', async () => {
      fetchMock.mockRejectedValueOnce(new Error('offline'))

      await expect(subscribeToPush()).resolves.toBe(false)
    })
  })

  describe('unsubscribeFromPush', () => {
    it('без serviceWorker отписка молча выходит', async () => {
      withoutServiceWorker()
      await expect(unsubscribeFromPush()).resolves.toBeUndefined()
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('без подписки сеть не дёргается', async () => {
      pushManager.getSubscription.mockResolvedValueOnce(null)
      await expect(unsubscribeFromPush()).resolves.toBeUndefined()
      expect(fetchMock).not.toHaveBeenCalled()
      expect(subscription.unsubscribe).not.toHaveBeenCalled()
    })

    it('удаляет endpoint на сервере и снимает подписку в браузере', async () => {
      fetchMock.mockResolvedValueOnce(okJson({ ok: true }))

      await expect(unsubscribeFromPush()).resolves.toBeUndefined()

      const [url, request] = fetchMock.mock.calls[0]
      expect(url).toBe('/api/push/subscribe')
      expect(request.method).toBe('DELETE')
      expect(request.headers.Authorization).toBe('Bearer jwt-token')
      expect(JSON.parse(request.body)).toEqual({ endpoint: 'https://push.example/abc' })
      expect(subscription.unsubscribe).toHaveBeenCalledTimes(1)
    })

    it('сервер недоступен — браузерная подписка всё равно снимается', async () => {
      fetchMock.mockRejectedValueOnce(new Error('offline'))

      await expect(unsubscribeFromPush()).resolves.toBeUndefined()

      expect(subscription.unsubscribe).toHaveBeenCalledTimes(1)
    })

    it('без токена отписка уходит без Authorization', async () => {
      tokenState.value = null
      fetchMock.mockResolvedValueOnce(okJson({ ok: true }))

      await expect(unsubscribeFromPush()).resolves.toBeUndefined()

      expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined()
    })

    it('serviceWorker.ready упал — исключение не выходит наружу', async () => {
      withServiceWorker(Promise.reject(new Error('sw dead')))
      await expect(unsubscribeFromPush()).resolves.toBeUndefined()
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })
})
