import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { AuthProvider, useAuth } from "@/context/auth-context"
import { type ReactNode } from "react"

vi.mock("@/lib/supabase", () => ({
  getSupabase: vi.fn(() => null),
}))

vi.mock("@/lib/token", () => ({
  setToken: vi.fn(),
  getToken: vi.fn(() => null),
  clearToken: vi.fn(),
}))

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

function Wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFetch.mockReset()
})

describe("AuthContext", () => {
  function mockNoCookieSession() {
    // 1-й вызов — /api/auth/me (нет куки), 2-й — dev-login
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401, json: () => Promise.resolve({}) })
    return mockFetch
  }

  it("starts in loading state", () => {
    mockNoCookieSession().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ token: "demo-token" }),
    })

    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper })
    expect(result.current.isLoading).toBe(true)
  })

  it("performs dev-login when supabase is absent", async () => {
    mockNoCookieSession().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ token: "demo-token" }),
    })

    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.isDemo).toBe(true)
    expect(result.current.user).toBeTruthy()
    expect(result.current.user?.name).toBe("Анна")
  })

  it("restores session from cookie via /api/auth/me", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 7, email: "user7@mail.ru", name: "Ольга", avatar: "" }),
    })

    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.user?.id).toBe(7)
    expect(result.current.user?.email).toBe("user7@mail.ru")
  })

  it("handles dev-login failure gracefully", async () => {
    mockNoCookieSession().mockRejectedValueOnce(new Error("Network error"))

    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.user).toBeNull()
    expect(result.current.token).toBeNull()
  })

  it("provides logout function", async () => {
    mockNoCookieSession().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ token: "demo-token" }),
    })

    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    act(() => {
      result.current.logout()
    })

    expect(result.current.user).toBeNull()
    expect(result.current.token).toBeNull()
  })

  it("provides clearError function", () => {
    mockNoCookieSession().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ token: "demo-token" }),
    })

    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper })

    act(() => {
      result.current.clearError()
    })

    expect(result.current.error).toBeNull()
  })

  // Этап 25: api.ts диспатчит 'auth:unauthorized', когда refresh не удался.
  // Подписчика не было — токен стирался, а состояние оставалось «залогинен».
  it("logs out on window event 'auth:unauthorized'", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 7, email: "user7@mail.ru", name: "Ольга", avatar: "" }),
    })

    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.token).not.toBeNull())

    act(() => {
      window.dispatchEvent(new CustomEvent("auth:unauthorized"))
    })

    expect(result.current.user).toBeNull()
    expect(result.current.token).toBeNull()
  })

  it("removes the 'auth:unauthorized' listener on unmount", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 7, email: "user7@mail.ru", name: "Ольга", avatar: "" }),
    })

    const removeSpy = vi.spyOn(window, "removeEventListener")
    const { result, unmount } = renderHook(() => useAuth(), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.token).not.toBeNull())

    unmount()

    const names = removeSpy.mock.calls.map((call) => call[0])
    expect(names).toContain("auth:unauthorized")
    removeSpy.mockRestore()
  })
})
