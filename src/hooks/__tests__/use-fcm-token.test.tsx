import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { StrictMode } from 'react'

type Listener = (payload: unknown) => void | Promise<void>

const mockListeners = new Map<string, Listener>()

const mockAddListener = vi.fn((event: string, callback: Listener) => {
  mockListeners.set(event, callback)
  return Promise.resolve({ remove: vi.fn() })
})
const mockRequestPermissions = vi.fn()
const mockRegister = vi.fn()
const mockToken = vi.hoisted(() => ({ value: null as string | null }))

vi.mock('@/lib/token', () => ({ getToken: () => mockToken.value }))

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    requestPermissions: mockRequestPermissions,
    register: mockRegister,
    addListener: mockAddListener,
    removeAllListeners: vi.fn(),
  },
}))

import { useFcmToken } from '@/hooks/use-fcm-token'

const fetchMock = vi.fn()

function TestComponent() {
  useFcmToken()
  return <div>test</div>
}

const goNative = () => {
  window.Capacitor = { isNativePlatform: () => true, registerPlugin: vi.fn() }
}

const waitForListeners = async () => {
  await vi.waitFor(() => {
    expect(mockListeners.has('registration')).toBe(true)
  })
}

const okJson = () => ({ ok: true, json: async () => ({}) })

beforeEach(() => {
  vi.clearAllMocks()
  mockListeners.clear()
  mockToken.value = 'jwt-token'
  delete window.Capacitor
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  mockRequestPermissions.mockResolvedValue({ receive: 'granted' })
  mockRegister.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useFcmToken', () => {
  it('skips registration when not native platform', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    render(<TestComponent />)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mockRequestPermissions).not.toHaveBeenCalled()
    expect(mockRegister).not.toHaveBeenCalled()
    expect(consoleSpy).toHaveBeenCalledWith('[FCM] Not native platform — skipping FCM registration')
    consoleSpy.mockRestore()
  })

  it('requests permissions and registers on native platform', async () => {
    goNative()
    mockRequestPermissions.mockResolvedValueOnce({ receive: 'granted' })
    mockRegister.mockResolvedValueOnce(undefined)

    render(<TestComponent />)

    await vi.waitFor(() => {
      expect(mockRequestPermissions).toHaveBeenCalled()
      expect(mockRegister).toHaveBeenCalled()
    })
  })

  it('does not register when permission denied', async () => {
    goNative()
    mockRequestPermissions.mockResolvedValueOnce({ receive: 'denied' })

    render(<TestComponent />)

    await vi.waitFor(() => {
      expect(mockRequestPermissions).toHaveBeenCalled()
      expect(mockRegister).not.toHaveBeenCalled()
    })
  })

  it('в StrictMode регистрация запускается один раз', async () => {
    goNative()
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    render(
      <StrictMode>
        <TestComponent />
      </StrictMode>,
    )

    await waitForListeners()
    expect(mockRequestPermissions).toHaveBeenCalledTimes(1)
    consoleSpy.mockRestore()
  })

  it('отправляет FCM-токен на сервер с Bearer и platform=fcm', async () => {
    goNative()
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    fetchMock.mockResolvedValueOnce(okJson())

    render(<TestComponent />)
    await waitForListeners()
    await mockListeners.get('registration')!({ value: 'fcm-token-abc' })

    const [url, request] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/push/subscribe')
    expect(request.method).toBe('POST')
    expect(request.headers.Authorization).toBe('Bearer jwt-token')
    expect(JSON.parse(request.body)).toEqual({ endpoint: 'fcm-token-abc', platform: 'fcm' })
    expect(consoleSpy).toHaveBeenCalledWith('[FCM] Token registered successfully')
    consoleSpy.mockRestore()
  })

  it('без auth-токена регистрация откладывается и сеть не дёргается', async () => {
    goNative()
    mockToken.value = null
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    render(<TestComponent />)
    await waitForListeners()
    await mockListeners.get('registration')!({ value: 'fcm-token-abc' })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(consoleSpy).toHaveBeenCalledWith('[FCM] No auth token — delaying registration')
    consoleSpy.mockRestore()
  })

  it('пустой FCM-токен не отправляется', async () => {
    goNative()

    render(<TestComponent />)
    await waitForListeners()
    await mockListeners.get('registration')!({ value: '' })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('после размонтирования поздний FCM-токен игнорируется', async () => {
    goNative()

    const view = render(<TestComponent />)
    await waitForListeners()
    view.unmount()
    await mockListeners.get('registration')!({ value: 'fcm-token-abc' })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('сбой отправки токена логируется и не роняет приложение', async () => {
    goNative()
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock.mockRejectedValueOnce(new Error('offline'))

    render(<TestComponent />)
    await waitForListeners()
    await mockListeners.get('registration')!({ value: 'fcm-token-abc' })

    expect(consoleSpy).toHaveBeenCalledWith('[FCM] Token registration failed:', expect.any(Error))
    consoleSpy.mockRestore()
  })

  it('отказ сервера не выдаёт «успешно зарегистрирован»', async () => {
    goNative()
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) })

    render(<TestComponent />)
    await waitForListeners()
    await mockListeners.get('registration')!({ value: 'fcm-token-abc' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(consoleSpy).not.toHaveBeenCalledWith('[FCM] Token registered successfully')
    consoleSpy.mockRestore()
  })

  it('в продакшене успешная регистрация не пишет в консоль', async () => {
    goNative()
    vi.stubEnv('DEV', false)
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    fetchMock.mockResolvedValueOnce(okJson())

    render(<TestComponent />)
    await waitForListeners()
    await mockListeners.get('registration')!({ value: 'fcm-token-abc' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(consoleSpy).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
    consoleSpy.mockRestore()
  })

  it('полученное уведомление логируется', async () => {
    goNative()
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    render(<TestComponent />)
    await vi.waitFor(() => {
      expect(mockListeners.has('pushNotificationReceived')).toBe(true)
    })
    mockListeners.get('pushNotificationReceived')!({ title: 'Привет' })

    expect(consoleSpy).toHaveBeenCalledWith('[FCM] Notification received:', { title: 'Привет' })
    consoleSpy.mockRestore()
  })

  it('переход по уведомлению открывает url из data', async () => {
    goNative()
    const originalLocation = window.location
    const fakeLocation = { href: '' }
    Object.defineProperty(window, 'location', { configurable: true, value: fakeLocation })

    render(<TestComponent />)
    await vi.waitFor(() => {
      expect(mockListeners.has('pushNotificationActionPerformed')).toBe(true)
    })
    mockListeners.get('pushNotificationActionPerformed')!({ notification: { data: { url: '/chats/42' } } })

    expect(fakeLocation.href).toBe('/chats/42')

    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
  })

  it('уведомление без url ничего не открывает', async () => {
    goNative()

    render(<TestComponent />)
    await vi.waitFor(() => {
      expect(mockListeners.has('pushNotificationActionPerformed')).toBe(true)
    })

    expect(() => mockListeners.get('pushNotificationActionPerformed')!({ notification: { data: {} } })).not.toThrow()
    expect(() => mockListeners.get('pushNotificationActionPerformed')!({ notification: {} })).not.toThrow()
  })
})

describe('useFcmToken: пакет недоступен', () => {
  it('ошибка импорта пакета логируется и не роняет приложение', async () => {
    goNative()
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.resetModules()
    vi.doMock('@capacitor/push-notifications', () => {
      throw new Error('missing package')
    })

    const { useFcmToken: useBrokenFcm } = await import('@/hooks/use-fcm-token')
    const Broken = () => {
      useBrokenFcm()
      return <div>broken</div>
    }

    expect(() => render(<Broken />)).not.toThrow()
    await vi.waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('[FCM] Initialization error:', expect.any(Error))
    })

    vi.doUnmock('@capacitor/push-notifications')
    consoleSpy.mockRestore()
  })
})
