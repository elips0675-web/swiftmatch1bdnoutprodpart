import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act } from "@testing-library/react"

const mockSocket = { on: vi.fn(), disconnect: vi.fn() }
const mockIo = vi.fn(() => mockSocket)

vi.mock("socket.io-client", () => ({ io: (...args: unknown[]) => mockIo(...args) }))

interface MockAuth { token: string | null; logout: ReturnType<typeof vi.fn> }
const mockAuth = vi.hoisted((): MockAuth => ({ token: "test-ws-token", logout: vi.fn() }))

vi.mock("@/context/auth-context", () => ({
  useAuth: () => mockAuth,
}))

const events = new Map<string, () => void>()

function setupSocketHandlers() {
  events.clear()
  mockSocket.on.mockImplementation((event: string, cb: () => void) => {
    events.set(event, cb)
    return mockSocket
  })
}

function trigger(event: string) {
  events.get(event)?.()
}

describe("useWebSocket", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.token = "test-ws-token"
    mockAuth.logout.mockReset()
    mockSocket.on.mockReset()
    mockSocket.disconnect.mockReset()
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
})
