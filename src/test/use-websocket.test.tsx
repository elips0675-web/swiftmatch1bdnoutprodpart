import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"

const mockSocket = {
  on: vi.fn(),
  disconnect: vi.fn(),
  connect: vi.fn(),
  removeAllListeners: vi.fn(),
  auth: {} as { token?: string },
}
const mockIo = vi.fn(() => mockSocket)

vi.mock("socket.io-client", () => ({ io: (...args: unknown[]) => mockIo(...args) }))

interface MockAuth { token: string | null; logout: ReturnType<typeof vi.fn> }
const mockAuth = vi.hoisted((): MockAuth => ({ token: "test-ws-token", logout: vi.fn() }))

vi.mock("@/context/auth-context", () => ({
  useAuth: () => mockAuth,
}))

const mockRefresh = vi.hoisted(() => ({
  refreshAuthToken: vi.fn<() => Promise<string | null>>(),
  notifyUnauthorized: vi.fn(),
}))

vi.mock("@/lib/auth-refresh", () => mockRefresh)

const events = new Map<string, (arg?: unknown) => void>()

function setupSocketHandlers() {
  events.clear()
  mockSocket.on.mockImplementation((event: string, cb: (arg?: unknown) => void) => {
    events.set(event, cb)
    return mockSocket
  })
}

function trigger(event: string, arg?: unknown) {
  events.get(event)?.(arg)
}

describe("useWebSocket", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.token = "test-ws-token"
    mockAuth.logout.mockReset()
    mockSocket.on.mockReset()
    mockSocket.disconnect.mockReset()
    mockSocket.connect.mockReset()
    mockSocket.removeAllListeners.mockReset()
    mockSocket.auth = {}
    mockRefresh.refreshAuthToken.mockReset()
    mockRefresh.notifyUnauthorized.mockReset()
    setupSocketHandlers()
  })

  it("connects when token is present", async () => {
    mockAuth.token = "test-ws-token"
    const { useWebSocket } = await import("@/hooks/use-websocket")
    const { result } = renderHook(() => useWebSocket())

    expect(mockIo).toHaveBeenCalledTimes(1)
    expect(mockIo).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ auth: { token: "test-ws-token" }, reconnection: true })
    )
    act(() => trigger("connect"))
    expect(result.current.connected).toBe(true)
  })

  it("sets reconnection with exponential backoff (1s → max 30s, randomization)", async () => {
    mockAuth.token = "test-ws-token"
    const { useWebSocket } = await import("@/hooks/use-websocket")
    renderHook(() => useWebSocket())

    const opts = mockIo.mock.calls[0][1]
    expect(opts).toMatchObject({
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      randomizationFactor: 0.5,
    })
  })

  it("turns connected=false on disconnect (эмуляция обрыва) and reconnects", async () => {
    mockAuth.token = "test-ws-token"
    const { useWebSocket } = await import("@/hooks/use-websocket")
    const { result } = renderHook(() => useWebSocket())

    act(() => trigger("connect"))
    expect(result.current.connected).toBe(true)

    act(() => trigger("disconnect"))
    expect(result.current.connected).toBe(false)
  })

  it("calls logout on user:banned", async () => {
    mockAuth.token = "test-ws-token"
    const { useWebSocket } = await import("@/hooks/use-websocket")
    renderHook(() => useWebSocket())

    trigger("user:banned")
    expect(mockAuth.logout).toHaveBeenCalledTimes(1)
  })

  it("returns null socket when no token", async () => {
    mockAuth.token = null
    const { useWebSocket } = await import("@/hooks/use-websocket")
    const { result } = renderHook(() => useWebSocket())

    expect(mockIo).not.toHaveBeenCalled()
    expect(result.current.socket).toBeNull()
    expect(result.current.connected).toBe(false)
  })

  it("disconnects on unmount", async () => {
    mockAuth.token = "test-ws-token"
    const { useWebSocket } = await import("@/hooks/use-websocket")
    const { unmount } = renderHook(() => useWebSocket())

    act(() => unmount())
    expect(mockSocket.disconnect).toHaveBeenCalledTimes(1)
  })

  // --- этап 25, P0-B: истёкший токен больше не оставляет WS мёртвым навсегда ---

  it("connect_error с auth-ошибкой: обновляет токен и переподключается с новым", async () => {
    mockRefresh.refreshAuthToken.mockResolvedValue("fresh-token")
    const { useWebSocket } = await import("@/hooks/use-websocket")
    const { result } = renderHook(() => useWebSocket())

    act(() => trigger("connect"))
    expect(result.current.connected).toBe(true)

    await act(async () => {
      trigger("connect_error", new Error("Invalid token"))
    })

    await waitFor(() => expect(mockSocket.connect).toHaveBeenCalledTimes(1))
    expect(mockSocket.auth).toEqual({ token: "fresh-token" })
    expect(mockAuth.logout).not.toHaveBeenCalled()
    expect(mockRefresh.notifyUnauthorized).not.toHaveBeenCalled()
  })

  it("connect_error с auth-ошибкой и неудачным refresh: разлогин, а не бесконечный круг", async () => {
    mockRefresh.refreshAuthToken.mockResolvedValue(null)
    const { useWebSocket } = await import("@/hooks/use-websocket")
    renderHook(() => useWebSocket())

    await act(async () => {
      trigger("connect_error", new Error("Invalid token"))
    })

    await waitFor(() => expect(mockAuth.logout).toHaveBeenCalledTimes(1))
    expect(mockRefresh.notifyUnauthorized).toHaveBeenCalledTimes(1)
    expect(mockSocket.connect).not.toHaveBeenCalled()
  })

  it("сетевая ошибка не разлогинивает — обрыв Wi-Fi не должен выкидывать из аккаунта", async () => {
    mockRefresh.refreshAuthToken.mockResolvedValue("fresh-token")
    const { useWebSocket } = await import("@/hooks/use-websocket")
    renderHook(() => useWebSocket())

    await act(async () => {
      trigger("connect_error", new Error("xhr poll error"))
    })

    expect(mockAuth.logout).not.toHaveBeenCalled()
    expect(mockRefresh.refreshAuthToken).not.toHaveBeenCalled()
    expect(mockSocket.connect).not.toHaveBeenCalled()
  })

  it("не запускает refresh второй раз, пока первый ещё идёт", async () => {
    let resolveRefresh: (value: string | null) => void = () => {}
    mockRefresh.refreshAuthToken.mockReturnValue(
      new Promise<string | null>((resolve) => {
        resolveRefresh = resolve
      })
    )
    const { useWebSocket } = await import("@/hooks/use-websocket")
    renderHook(() => useWebSocket())

    await act(async () => {
      trigger("connect_error", new Error("Invalid token"))
      trigger("connect_error", new Error("Invalid token"))
      trigger("connect_error", new Error("Invalid token"))
    })

    expect(mockRefresh.refreshAuthToken).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveRefresh("fresh-token")
    })
    await waitFor(() => expect(mockSocket.connect).toHaveBeenCalledTimes(1))
  })

  it("auth:unauthorized от сервера (истёк токен на живом сокете) → logout", async () => {
    const { useWebSocket } = await import("@/hooks/use-websocket")
    renderHook(() => useWebSocket())

    trigger("auth:unauthorized")
    expect(mockAuth.logout).toHaveBeenCalledTimes(1)
  })
})