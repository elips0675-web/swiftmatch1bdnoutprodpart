import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

const tokenMock = vi.hoisted(() => ({ value: "test-token" as string | null }))

vi.mock("@/lib/token", () => ({ getToken: () => tokenMock.value }))

import { useApi, useApiMutation } from "@/hooks/useApi"

function json(body: unknown, ok = true) {
  return { ok, json: () => Promise.resolve(body) }
}

describe("useApi", () => {
  beforeEach(() => {
    mockFetch.mockReset()
    tokenMock.value = "test-token"
  })

  it("skip не делает запрос и сразу снимает loading", () => {
    const { result } = renderHook(() => useApi("/api/thing", { skip: true }))

    expect(result.current.loading).toBe(false)
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("без токена ставит ошибку и не ходит в сеть", async () => {
    tokenMock.value = null
    const { result } = renderHook(() => useApi("/api/thing"))

    await waitFor(() => expect(result.current.error).toBe("No authentication token found."))
    expect(result.current.loading).toBe(false)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("успешный GET кладёт ответ в data и шлёт Bearer-токен", async () => {
    mockFetch.mockResolvedValueOnce(json({ hello: "world" }))

    const { result } = renderHook(() => useApi<{ hello: string }>("/api/thing"))

    await waitFor(() => expect(result.current.data).toEqual({ hello: "world" }))
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(mockFetch).toHaveBeenCalledWith("/api/thing", {
      method: "GET",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: null,
    })
  })

  it("POST сериализует тело запроса в JSON", async () => {
    mockFetch.mockResolvedValueOnce(json({ id: 7 }))

    const { result } = renderHook(() => useApi("/api/thing", { method: "POST", body: { a: 1 } }))

    await waitFor(() => expect(result.current.data).toEqual({ id: 7 }))
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/thing",
      expect.objectContaining({ method: "POST", body: '{"a":1}' }),
    )
  })

  it("ошибка сервера берёт message из тела ответа", async () => {
    mockFetch.mockResolvedValueOnce(json({ message: "нет доступа" }, false))

    const { result } = renderHook(() => useApi("/api/thing"))

    await waitFor(() => expect(result.current.error).toBe("нет доступа"))
    expect(result.current.data).toBeNull()
    expect(result.current.loading).toBe(false)
  })

  it("ошибка без message падает на общий текст", async () => {
    mockFetch.mockResolvedValueOnce(json({}, false))

    const { result } = renderHook(() => useApi("/api/thing"))

    await waitFor(() => expect(result.current.error).toBe("API request failed"))
  })

  it("обрыв сети показывает текст ошибки и не роняет хук", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    mockFetch.mockRejectedValueOnce(new Error("network down"))

    const { result } = renderHook(() => useApi("/api/thing"))

    await waitFor(() => expect(result.current.error).toBe("network down"))
    expect(result.current.loading).toBe(false)
    expect(result.current.data).toBeNull()
    errorSpy.mockRestore()
  })

  it("reject не-Error превращается в общую ошибку", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    mockFetch.mockRejectedValueOnce("boom")

    const { result } = renderHook(() => useApi("/api/thing"))

    await waitFor(() => expect(result.current.error).toBe("An unexpected error occurred."))
    expect(result.current.loading).toBe(false)
    errorSpy.mockRestore()
  })

  it("refetch повторяет запрос", async () => {
    mockFetch.mockResolvedValue(json({ n: 1 }))

    const { result } = renderHook(() => useApi("/api/thing"))

    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }))
    act(() => result.current.refetch())
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2))
    expect(result.current.loading).toBe(false)
  })
})

describe("useApiMutation", () => {
  beforeEach(() => {
    mockFetch.mockReset()
    tokenMock.value = "test-token"
  })

  it("успешная мутация возвращает результат и снимает loading", async () => {
    mockFetch.mockResolvedValueOnce(json({ id: 3 }))

    const { result } = renderHook(() => useApiMutation<{ id: number }>())

    let out: unknown = null
    await act(async () => {
      out = await result.current.mutate("/api/thing", "POST", { a: 1 })
    })

    expect(out).toEqual({ id: 3 })
    expect(result.current.data).toEqual({ id: 3 })
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/thing",
      expect.objectContaining({ method: "POST", body: '{"a":1}' }),
    )
  })

  it("ошибка сервера превращается в reject с её message", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    mockFetch.mockResolvedValueOnce(json({ message: "нельзя" }, false))

    const { result } = renderHook(() => useApiMutation())

    let caught: unknown = null
    await act(async () => {
      caught = await result.current.mutate("/api/thing", "PUT", { a: 1 }).catch(e => e)
    })

    expect((caught as Error).message).toBe("нельзя")
    expect(result.current.error).toBe("нельзя")
    expect(result.current.loading).toBe(false)
    expect(result.current.data).toBeNull()
    errorSpy.mockRestore()
  })

  it("ошибка без message падает на штатный текст с методом", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    mockFetch.mockResolvedValueOnce(json({}, false))

    const { result } = renderHook(() => useApiMutation())

    let caught: unknown = null
    await act(async () => {
      caught = await result.current.mutate("/api/thing", "DELETE", null).catch(e => e)
    })

    expect((caught as Error).message).toBe("API DELETE request to /api/thing failed")
    expect(result.current.error).toBe("API DELETE request to /api/thing failed")
    errorSpy.mockRestore()
  })

  it("без токена мутация отклоняется и не ходит в сеть", async () => {
    tokenMock.value = null

    const { result } = renderHook(() => useApiMutation())

    let caught: unknown = null
    await act(async () => {
      caught = await result.current.mutate("/api/thing", "POST", {}).catch(e => e)
    })

    expect((caught as Error).message).toBe("No authentication token found.")
    expect(result.current.error).toBe("No authentication token found.")
    expect(result.current.loading).toBe(false)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("обрыв сети при мутации отклоняет и красит error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    mockFetch.mockRejectedValueOnce(new Error("network down"))

    const { result } = renderHook(() => useApiMutation())

    let caught: unknown = null
    await act(async () => {
      caught = await result.current.mutate("/api/thing", "POST", {}).catch(e => e)
    })

    expect((caught as Error).message).toBe("network down")
    expect(result.current.error).toBe("network down")
    expect(result.current.loading).toBe(false)
    errorSpy.mockRestore()
  })

  it("reject не-Error при мутации превращается в общую ошибку", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    mockFetch.mockRejectedValueOnce("boom")

    const { result } = renderHook(() => useApiMutation())

    let caught: unknown = null
    await act(async () => {
      caught = await result.current.mutate("/api/thing", "POST", {}).catch(e => e)
    })

    expect((caught as Error).message).toBe("An unexpected error occurred.")
    expect(result.current.error).toBe("An unexpected error occurred.")
    errorSpy.mockRestore()
  })
})
