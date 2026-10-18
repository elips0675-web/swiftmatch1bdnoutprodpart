import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor, act } from "@testing-library/react"

const mockGetToken = vi.fn((): string | null => "test-token")
vi.mock("@/lib/token", () => ({
  getToken: () => mockGetToken(),
}))

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

beforeEach(() => {
  vi.clearAllMocks()
  mockFetch.mockReset()
  mockGetToken.mockReset()
  mockGetToken.mockReturnValue("test-token")
})

describe("usePremium", () => {
  it("returns not premium when no token", async () => {
    mockGetToken.mockReturnValue(null)

    const { usePremium } = await import("@/hooks/use-premium")
    const { result } = renderHook(() => usePremium())

    expect(result.current.isPremium).toBe(false)
    expect(result.current.loading).toBe(false)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("returns subscription data when active", async () => {
    vi.resetModules()
    const subscription = {
      tier: "gold",
      duration_months: 1,
      price: 699,
      started_at: "2025-01-01",
      expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
      is_active: 1,
    }

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(subscription),
    })

    const { usePremium } = await import("@/hooks/use-premium")
    const { result } = renderHook(() => usePremium())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.isPremium).toBe(true)
    expect(result.current.tier).toBe("gold")
    expect(result.current.daysRemaining).toBeGreaterThan(0)
    expect(result.current.subscription).toEqual(subscription)
  })

  it("returns not premium when null response", async () => {
    vi.resetModules()
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(null),
    })

    const { usePremium } = await import("@/hooks/use-premium")
    const { result } = renderHook(() => usePremium())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.isPremium).toBe(false)
    expect(result.current.tier).toBeNull()
  })

  it("handles fetch error gracefully", async () => {
    vi.resetModules()
    mockFetch.mockRejectedValueOnce(new Error("Network error"))

    const { usePremium } = await import("@/hooks/use-premium")
    const { result } = renderHook(() => usePremium())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.isPremium).toBe(false)
    expect(result.current.subscription).toBeNull()
  })

  it("отдаёт ответ из кэша в пределах TTL и не дёргает сеть второй раз", async () => {
    vi.resetModules()
    const premium = { tier: "gold", duration_months: 1, price: 699, started_at: "2025-01-01", expires_at: new Date(Date.now() + 30 * 86400000).toISOString(), is_active: 1 }
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(premium) })

    const { usePremium } = await import("@/hooks/use-premium")

    const first = renderHook(() => usePremium())
    await waitFor(() => {
      expect(first.result.current.loading).toBe(false)
    })
    first.unmount()

    const second = renderHook(() => usePremium())

    expect(second.result.current.loading).toBe(false)
    expect(second.result.current.subscription).toEqual(premium)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it("сбрасывает подписку, когда сервер ответил не-2xx", async () => {
    vi.resetModules()
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ message: "boom" }),
    })

    const { usePremium } = await import("@/hooks/use-premium")
    const { result } = renderHook(() => usePremium())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.isPremium).toBe(false)
    expect(result.current.subscription).toBeNull()
    expect(result.current.tier).toBeNull()
  })

  it("не трогает состояние после размонтирования (поздний успешный ответ)", async () => {
    vi.resetModules()
    let resolveFetch: (value: unknown) => void = () => {}
    mockFetch.mockReturnValueOnce(new Promise((resolve) => { resolveFetch = resolve }))

    const premium = { tier: "silver", duration_months: 1, price: 299, started_at: "2025-01-01", expires_at: new Date(Date.now() + 86400000).toISOString(), is_active: 1 }
    const { usePremium } = await import("@/hooks/use-premium")
    const { unmount } = renderHook(() => usePremium())

    unmount()
    await act(async () => {
      resolveFetch({ ok: true, json: () => Promise.resolve(premium) })
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it("не трогает состояние после размонтирования (поздняя ошибка сети)", async () => {
    vi.resetModules()
    let rejectFetch: (reason: unknown) => void = () => {}
    mockFetch.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectFetch = reject }))

    const { usePremium } = await import("@/hooks/use-premium")
    const { unmount } = renderHook(() => usePremium())

    unmount()
    await act(async () => {
      rejectFetch(new Error("Network error"))
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it("refresh forces cache bypass", async () => {
    vi.resetModules()
    const premium = { tier: "platinum", duration_months: 3, price: 1499, started_at: "2025-01-01", expires_at: new Date(Date.now() + 90 * 86400000).toISOString(), is_active: 1 }
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(premium) })

    const { usePremium } = await import("@/hooks/use-premium")
    const { result } = renderHook(() => usePremium())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)

    act(() => {
      result.current.refresh()
    })

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })
})
