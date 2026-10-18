// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://swiftmatch.test/"}

import { describe, expect, it, vi } from "vitest"
import { renderHook } from "@testing-library/react"

const mockSocket = {
  on: vi.fn(),
  disconnect: vi.fn(),
  connect: vi.fn(),
  removeAllListeners: vi.fn(),
  auth: {} as { token?: string },
}

const mockIo = vi.fn((..._args: unknown[]) => mockSocket)

vi.mock("socket.io-client", () => ({ io: (...args: unknown[]) => mockIo(...args) }))

vi.mock("@/context/auth-context", () => ({
  useAuth: () => ({ token: "test-ws-token", logout: vi.fn() }),
}))

vi.mock("@/lib/auth-refresh", () => ({
  refreshAuthToken: vi.fn(),
  notifyUnauthorized: vi.fn(),
}))

import { useWebSocket } from "@/hooks/use-websocket"

describe("useWebSocket на https-странице", () => {
  it("выбирает wss и хост из window.location (без VITE_WS_URL)", () => {
    expect(window.location.protocol).toBe("https:")
    expect(import.meta.env.VITE_WS_URL).toBeFalsy()

    renderHook(() => useWebSocket())

    expect(mockIo).toHaveBeenCalledTimes(1)
    expect(mockIo).toHaveBeenCalledWith(
      "wss://swiftmatch.test",
      expect.objectContaining({ auth: { token: "test-ws-token" } }),
    )
  })
})
