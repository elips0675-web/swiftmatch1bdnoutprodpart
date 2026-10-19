import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

const AUTH_TOKEN_KEY = "swiftmatch_auth_token"

async function freshModule() {
  vi.resetModules()
  return await import("@/hooks/useExperiment")
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFetch.mockReset()
  sessionStorage.clear()
  localStorage.clear()
})

afterEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  vi.resetModules()
})

describe("useExperiment", () => {
  it("применяет вариант из ответа, снимает loading и кодирует ключ в URL", async () => {
    const mod = await freshModule()
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ variant: "treatment" }) })
    const { result } = renderHook(() => mod.useExperiment("a/b"))
    expect(result.current.loading).toBe(true)
    expect(mockFetch).toHaveBeenCalledWith("/api/experiments/a%2Fb", { headers: {} })
    await waitFor(() => expect(result.current.variant).toBe("treatment"))
    expect(result.current.loading).toBe(false)
  })

  it("вариант из кэша: повторный монитор без сети и сразу без loading", async () => {
    const mod = await freshModule()
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ variant: "treatment" }) })
    const first = renderHook(() => mod.useExperiment("feature_x"))
    await waitFor(() => expect(first.result.current.variant).toBe("treatment"))
    first.unmount()
    const second = renderHook(() => mod.useExperiment("feature_x"))
    expect(second.result.current.loading).toBe(false)
    expect(second.result.current.variant).toBe("treatment")
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
  })

  it("!ok-ответ не применяется и не попадает в кэш", async () => {
    const mod = await freshModule()
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) })
    const first = renderHook(() => mod.useExperiment("f2"))
    await waitFor(() => expect(first.result.current.loading).toBe(false))
    expect(first.result.current.variant).toBeNull()
    first.unmount()
    const second = renderHook(() => mod.useExperiment("f2"))
    await waitFor(() => expect(second.result.current.loading).toBe(false))
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it("пустый variant уходит в контрольную группу", async () => {
    const mod = await freshModule()
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ variant: "" }) })
    const { result } = renderHook(() => mod.useExperiment("f3"))
    await waitFor(() => expect(result.current.variant).toBe("control"))
  })

  it("отклонённый fetch оставляет вариант пустым и снимает loading", async () => {
    const mod = await freshModule()
    mockFetch.mockRejectedValueOnce(new Error("network down"))
    const { result } = renderHook(() => mod.useExperiment("f4"))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.variant).toBeNull()
  })

  it("ответ после размонтирования не применяется и не попадает в кэш", async () => {
    const mod = await freshModule()
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ variant: "late" }) })
    const first = renderHook(() => mod.useExperiment("f5"))
    first.unmount()
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 0))
    const second = renderHook(() => mod.useExperiment("f5"))
    await waitFor(() => expect(second.result.current.variant).toBe("late"))
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it("с сохранённым токеном запрос уходит с Bearer", async () => {
    const mod = await freshModule()
    sessionStorage.setItem(AUTH_TOKEN_KEY, "tok123")
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ variant: "v" }) })
    const { result } = renderHook(() => mod.useExperiment("f6"))
    await waitFor(() => expect(result.current.variant).toBe("v"))
    expect(mockFetch).toHaveBeenCalledWith("/api/experiments/f6", {
      headers: { Authorization: "Bearer tok123" },
    })
  })
})

describe("useTrackEvent", () => {
  it("без токена не ходит в сеть", async () => {
    const mod = await freshModule()
    const { result } = renderHook(() => mod.useTrackEvent())
    act(() => {
      result.current("click", { page: "feed" })
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("с токеном шлёт POST с Bearer, метаданными и фолбэком пустого объекта", async () => {
    const mod = await freshModule()
    sessionStorage.setItem(AUTH_TOKEN_KEY, "tok123")
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
    const { result } = renderHook(() => mod.useTrackEvent())
    act(() => {
      result.current("click", { page: "feed" })
    })
    expect(mockFetch).toHaveBeenCalledWith("/api/analytics/track", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer tok123" },
      body: JSON.stringify({ event_type: "click", metadata: { page: "feed" } }),
    })
    act(() => {
      result.current("click")
    })
    expect(mockFetch).toHaveBeenLastCalledWith(
      "/api/analytics/track",
      expect.objectContaining({ body: JSON.stringify({ event_type: "click", metadata: {} }) }),
    )
  })
})
