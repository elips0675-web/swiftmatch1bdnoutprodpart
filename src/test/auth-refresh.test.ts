import { beforeEach, describe, expect, it, vi } from "vitest"

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

const nativeMock = vi.hoisted(() => ({ isNative: vi.fn(() => false) }))

vi.mock("@/lib/native", () => ({
  isNative: nativeMock.isNative,
  getApiBase: () => "https://swiftmatch.app",
  getWsUrl: () => "wss://swiftmatch.app",
}))

const tokenMock = vi.hoisted(() => ({ setToken: vi.fn() }))

vi.mock("@/lib/token", () => ({ setToken: tokenMock.setToken }))

import { notifyUnauthorized, refreshAuthToken } from "@/lib/auth-refresh"

describe("refreshAuthToken", () => {
  beforeEach(() => {
    mockFetch.mockReset()
    tokenMock.setToken.mockClear()
    nativeMock.isNative.mockReturnValue(false)
    sessionStorage.clear()
    localStorage.clear()
  })

  it("веб: продлевает сессию и не шлёт refresh-токен в теле запроса", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ token: "new-access" }) })

    const token = await refreshAuthToken()

    expect(token).toBe("new-access")
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/auth/refresh",
      expect.objectContaining({ method: "POST", headers: { "Content-Type": "application/json" } }),
    )
    const init = mockFetch.mock.calls[0][1] as RequestInit
    expect(init.body).toBeUndefined()
    expect(tokenMock.setToken).toHaveBeenCalledWith("new-access")
  })

  it("натив: шлёт refresh-токен из sessionStorage и сохраняет ротированный", async () => {
    nativeMock.isNative.mockReturnValue(true)
    sessionStorage.setItem("swiftmatch_refresh_token", "old-refresh")
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ token: "native-access", refresh_token: "rotated-refresh" }),
    })

    const token = await refreshAuthToken()

    expect(token).toBe("native-access")
    const init = mockFetch.mock.calls[0][1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({ refresh_token: "old-refresh" })
    expect(sessionStorage.getItem("swiftmatch_refresh_token")).toBe("rotated-refresh")
    expect(tokenMock.setToken).toHaveBeenCalledWith("native-access")
  })

  it("натив без сохранённого refresh-токена шлёт запрос без тела", async () => {
    nativeMock.isNative.mockReturnValue(true)
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ token: "access" }) })

    const token = await refreshAuthToken()

    expect(token).toBe("access")
    const init = mockFetch.mock.calls[0][1] as RequestInit
    expect(init.body).toBeUndefined()
    expect(sessionStorage.getItem("swiftmatch_refresh_token")).toBeNull()
  })

  it("ответ без ротации не затирает сохранённый refresh-токен", async () => {
    nativeMock.isNative.mockReturnValue(true)
    sessionStorage.setItem("swiftmatch_refresh_token", "old-refresh")
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ token: "access" }) })

    const token = await refreshAuthToken()

    expect(token).toBe("access")
    expect(sessionStorage.getItem("swiftmatch_refresh_token")).toBe("old-refresh")
  })

  it("401 от сервера означает: сессию продлить нельзя", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401, json: () => Promise.resolve({}) })

    expect(await refreshAuthToken()).toBeNull()
    expect(tokenMock.setToken).not.toHaveBeenCalled()
  })

  it("тело без валидного access-токена не считается успехом", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(null) })
    expect(await refreshAuthToken()).toBeNull()

    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ token: 42 }) })
    expect(await refreshAuthToken()).toBeNull()

    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ token: "" }) })
    expect(await refreshAuthToken()).toBeNull()

    expect(tokenMock.setToken).not.toHaveBeenCalled()
  })

  it("обрыв сети возвращает null, а не бросает", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network down"))

    expect(await refreshAuthToken()).toBeNull()
    expect(tokenMock.setToken).not.toHaveBeenCalled()
  })
})

describe("notifyUnauthorized", () => {
  it("ширит событие auth:unauthorized", () => {
    const handler = vi.fn()
    window.addEventListener("auth:unauthorized", handler)

    notifyUnauthorized()

    expect(handler).toHaveBeenCalledTimes(1)
    window.removeEventListener("auth:unauthorized", handler)
  })
})
