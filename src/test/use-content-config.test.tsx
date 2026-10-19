import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { INTEREST_OPTIONS, DATING_GOALS, EDUCATION_OPTIONS, CAPITALS } from "@/lib/constants"
import { FORBIDDEN_WORDS_DEFAULT } from "@/lib/admin-mock-data"

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

beforeEach(() => {
  vi.clearAllMocks()
  mockFetch.mockReset()
})

async function freshModule() {
  vi.resetModules()
  return await import("@/lib/useContentConfig")
}

function okResponse(data: Record<string, unknown>) {
  return { ok: true, json: () => Promise.resolve(data) }
}

function expectFallback(interests: string[], banned: string[]) {
  expect(interests).toEqual([...INTEREST_OPTIONS].sort())
  expect(banned).toEqual([...FORBIDDEN_WORDS_DEFAULT])
}

describe("useContentConfig", () => {
  it("getContentConfig мапит ключи интересов/целей/образования, дедуплицирует и сортирует", async () => {
    const mod = await freshModule()
    mockFetch.mockResolvedValueOnce(okResponse({
      interests: ["sport", "technology", "interest.music", "sport"],
      dating_goals: ["serious", "funny"],
      education: ["high"],
      banned_words: ["spam"],
      cities: ["Москва"],
    }))
    const config = await mod.getContentConfig()
    expect(mockFetch).toHaveBeenCalledWith("/api/content")
    expect(config.interests).toEqual(["interest.music", "interest.sport", "interest.tech"])
    expect(config.dating_goals).toEqual(["goal.funny", "goal.serious"])
    expect(config.education).toEqual(["education.high"])
    expect(config.banned_words).toEqual(["spam"])
    expect(config.cities).toEqual(["Москва"])
  })

  it("отсутствующие списки в ответе дают пустые массивы, а не падение", async () => {
    const mod = await freshModule()
    mockFetch.mockResolvedValueOnce(okResponse({}))
    const config = await mod.getContentConfig()
    expect(config.interests).toEqual([])
    expect(config.dating_goals).toEqual([])
    expect(config.education).toEqual([])
    expect(config.banned_words).toEqual([])
    expect(config.cities).toEqual([])
  })

  it("не-ok ответ уходит в дефолтный конфиг", async () => {
    const mod = await freshModule()
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve({}) })
    const config = await mod.getContentConfig()
    expectFallback(config.interests, config.banned_words)
    expect(config.dating_goals).toEqual([...DATING_GOALS])
    expect(config.education).toEqual([...EDUCATION_OPTIONS])
    expect(config.cities).toEqual([...CAPITALS])
  })

  it("отклонённый fetch уходит в дефолтный конфиг", async () => {
    const mod = await freshModule()
    mockFetch.mockRejectedValueOnce(new Error("network down"))
    const config = await mod.getContentConfig()
    expectFallback(config.interests, config.banned_words)
  })

  it("кэш живёт между вызовами: второй запрос не ходит в сеть", async () => {
    const mod = await freshModule()
    mockFetch.mockResolvedValueOnce(okResponse({ interests: ["sport"] }))
    const first = await mod.getContentConfig()
    const second = await mod.getContentConfig()
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)
  })

  it("параллельные вызовы делят один запрос", async () => {
    const mod = await freshModule()
    mockFetch.mockResolvedValueOnce(okResponse({ interests: ["sport"] }))
    const [a, b] = await Promise.all([mod.getContentConfig(), mod.getContentConfig()])
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(b).toBe(a)
  })

  it("хук без кэша стартует с дефолта и подтягивает серверный конфиг", async () => {
    const mod = await freshModule()
    mockFetch.mockResolvedValueOnce(okResponse({ interests: ["sport"] }))
    const { result } = renderHook(() => mod.useContentConfig())
    expect(result.current.interests).toEqual([...INTEREST_OPTIONS].sort())
    await waitFor(() => expect(result.current.interests).toEqual(["interest.sport"]))
  })

  it("хук с прогретым кэшем не ходит в сеть", async () => {
    const mod = await freshModule()
    mockFetch.mockResolvedValueOnce(okResponse({ interests: ["sport"] }))
    await mod.getContentConfig()
    const { result } = renderHook(() => mod.useContentConfig())
    expect(result.current.interests).toEqual(["interest.sport"])
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it("invalidateContentCache сбрасывает кэш и будит слушателей", async () => {
    const mod = await freshModule()
    mockFetch.mockResolvedValueOnce(okResponse({ interests: ["sport"] }))
    await mod.getContentConfig()
    const { result } = renderHook(() => mod.useContentConfig())
    mockFetch.mockResolvedValueOnce(okResponse({ interests: ["music"] }))
    await act(async () => { mod.invalidateContentCache() })
    await waitFor(() => expect(result.current.interests).toEqual(["interest.music"]))
    expect(mockFetch).toHaveBeenCalledTimes(2)
    const again = await mod.getContentConfig()
    expect(again.interests).toEqual(["interest.music"])
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
})
