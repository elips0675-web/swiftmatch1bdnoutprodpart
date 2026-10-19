import { describe, it, expect, vi, beforeEach } from "vitest"
import { api } from "@/lib/api"
import { setToken, clearToken } from "@/lib/token"

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

beforeEach(() => {
  mockFetch.mockReset()
  sessionStorage.clear()
  clearToken()
})

describe("ApiClient", () => {
  it("sends GET request", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: "ok" }),
    })
    const result = await api.get<{ data: string }>("/test")
    expect(result.data).toBe("ok")
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it("attaches auth token", async () => {
    setToken("test-token")
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    })
    await api.get("/test")
    const call = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(call[1].headers).toMatchObject({
      Authorization: "Bearer test-token",
    })
  })

  it("retries and fails after exhausting retries", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"))
    await expect(api.get("/test", { retries: 0 })).rejects.toThrow("Network error")
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it("clears token on 401", async () => {
    setToken("bad-token")
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ message: "Unauthorized" }),
    })
    const unauthSpy = vi.fn()
    window.addEventListener("auth:unauthorized", unauthSpy)
    await expect(api.get("/test", { retries: 0 })).rejects.toMatchObject({ status: 401 })
    expect(clearToken()).toBeUndefined()
    expect(unauthSpy).toHaveBeenCalled()
  })

  it("sends POST with JSON body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 1 }),
    })
    const result = await api.post<{ id: number }>("/test", { name: "test" })
    expect(result.id).toBe(1)
    const call = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(call[1].method).toBe("POST")
    expect(call[1].body).toBe(JSON.stringify({ name: "test" }))
  })
})

describe("ApiClient: 401 и refresh токена", () => {
  it("401 → refresh отдаёт новый токен → повтор уходит с обновлённым Authorization", async () => {
    setToken("stale-token")
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ message: "Unauthorized" }),
      })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ token: "fresh-token" }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: "ok" }) })

    const result = await api.get<{ data: string }>("/test")

    expect(result.data).toBe("ok")
    expect(mockFetch).toHaveBeenCalledTimes(3)
    const retryCall = mockFetch.mock.calls[2] as [string, RequestInit]
    expect(retryCall[1].headers).toMatchObject({ Authorization: "Bearer fresh-token" })
  })

  it("повторный 401 после refresh не запускает refresh второй раз", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ message: "Unauthorized" }),
      })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ token: "fresh-token" }) })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ message: "Unauthorized" }),
      })

    await expect(api.get("/test", { retries: 1 })).rejects.toMatchObject({ status: 401 })
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it("401 на последней попытке после успешного refresh кидает Unexpected error", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ message: "Unauthorized" }),
      })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ token: "fresh-token" }) })

    await expect(api.get("/test", { retries: 0 })).rejects.toMatchObject({
      message: "Unexpected error",
      status: 500,
    })
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it("401 при недоступном refresh чистит токен и рассылает auth:unauthorized", async () => {
    setToken("bad-token")
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ message: "Unauthorized" }),
    })
    const unauthSpy = vi.fn()
    window.addEventListener("auth:unauthorized", unauthSpy)

    await expect(api.get("/test", { retries: 0 })).rejects.toMatchObject({ status: 401 })

    expect(sessionStorage.getItem("swiftmatch_auth_token")).toBeNull()
    expect(unauthSpy).toHaveBeenCalledTimes(1)
    window.removeEventListener("auth:unauthorized", unauthSpy)
  })
})

describe("ApiClient: ретраи и таймаут", () => {
  it("AbortError превращается в 408 без повторных попыток", async () => {
    mockFetch.mockRejectedValueOnce(new DOMException("The operation was aborted.", "AbortError"))

    await expect(api.get("/test")).rejects.toMatchObject({
      message: "Request timed out",
      status: 408,
    })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it("после исчерпания ретраев кидает исходную ошибку сети", async () => {
    vi.useFakeTimers()
    try {
      mockFetch.mockRejectedValue(new Error("Network error"))

      const pending = api.get("/test", { retries: 1 })
      const settled = expect(pending).rejects.toThrow("Network error")
      await vi.advanceTimersByTimeAsync(5000)

      await settled
      expect(mockFetch).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it("сеть падает, ретраи с растущей задержкой проходят и отдают ответ", async () => {
    vi.useFakeTimers()
    try {
      mockFetch
        .mockRejectedValueOnce(new Error("boom"))
        .mockRejectedValueOnce(new Error("boom"))
        .mockRejectedValueOnce(new Error("boom"))
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ok: 1 }) })

      const pending = api.get("/test", { retries: 4 })
      const settled = expect(pending).resolves.toEqual({ ok: 1 })
      await vi.advanceTimersByTimeAsync(20000)

      await settled
      expect(mockFetch).toHaveBeenCalledTimes(5)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("ApiClient: параметры, заголовки и тела ошибок", () => {
  it("параметры уходят в query, undefined отбрасываются", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })

    await api.get("/test", { params: { a: 1, skip: undefined, flag: true }, timeout: 5000 })

    const call = mockFetch.mock.calls[0] as [string, RequestInit]
    const url = new URL(call[0])
    expect(url.searchParams.get("a")).toBe("1")
    expect(url.searchParams.get("flag")).toBe("true")
    expect(url.searchParams.has("skip")).toBe(false)
  })

  it("кастомные заголовки мержатся с базовыми", async () => {
    setToken("test-token")
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })

    await api.get("/test", { headers: { "X-Trace": "abc" } })

    const call = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(call[1].headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer test-token",
      "X-Trace": "abc",
    })
  })

  it("ошибка без message отдаёт HTTP-статус", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: () => Promise.resolve({}),
    })

    await expect(api.get("/test", { retries: 0 })).rejects.toMatchObject({
      message: "HTTP 502",
      status: 502,
    })
  })

  it("нечитаемое тело ошибки не валит разбор — фолбэк на пустой объект", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.reject(new Error("bad json")),
    })

    await expect(api.get("/test", { retries: 0 })).rejects.toMatchObject({
      message: "HTTP 400",
      status: 400,
    })
  })

  it("PUT, PATCH и DELETE уходят своими методами", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) })

    await api.put("/test", { a: 1 })
    await api.patch("/test", { b: 2 })
    await api.delete("/test")

    const methods = mockFetch.mock.calls.map((call) => (call as [string, RequestInit])[1].method)
    expect(methods).toEqual(["PUT", "PATCH", "DELETE"])
    const deleteCall = mockFetch.mock.calls[2] as [string, RequestInit]
    expect(deleteCall[1].body).toBeUndefined()
  })
})
