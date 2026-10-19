import { describe, it, expect, vi, afterEach } from "vitest"

type CapacitorStub = { isNativePlatform: () => boolean }

const win = window as unknown as { Capacitor?: CapacitorStub; fetch: typeof globalThis.fetch }

const originalFetch = win.fetch

async function loadNative(opts: { apiUrl?: string; wsUrl?: string; native?: true | "throw" } = {}) {
  vi.resetModules()
  vi.unstubAllEnvs()
  vi.stubEnv("VITE_API_URL", opts.apiUrl ?? "")
  vi.stubEnv("VITE_WS_URL", opts.wsUrl ?? "")
  if (opts.native === true) win.Capacitor = { isNativePlatform: () => true }
  else if (opts.native === "throw") win.Capacitor = { isNativePlatform: () => { throw new Error("boom") } }
  else delete win.Capacitor
  return await import("@/lib/native")
}

afterEach(() => {
  win.fetch = originalFetch
  delete win.Capacitor
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe("src/lib/native.ts", () => {
  it("isNative: false без Capacitor, true на нативной платформе, false при исключении из isNativePlatform", async () => {
    const mod = await loadNative()
    expect(mod.isNative()).toBe(false)
    win.Capacitor = { isNativePlatform: () => true }
    expect(mod.isNative()).toBe(true)
    win.Capacitor = { isNativePlatform: () => { throw new Error("boom") } }
    expect(mod.isNative()).toBe(false)
  })

  it("getApiBase: дефолтный хост без env и при значении '/api'", async () => {
    expect((await loadNative()).getApiBase()).toBe("https://swiftmatch.app")
    expect((await loadNative({ apiUrl: "/api" })).getApiBase()).toBe("https://swiftmatch.app")
  })

  it("getApiBase: отрезает висящие слэши у настроенного хоста", async () => {
    expect((await loadNative({ apiUrl: "https://api.example///" })).getApiBase()).toBe("https://api.example")
  })

  it("getWsUrl: дефолтный адрес и значение из env", async () => {
    expect((await loadNative()).getWsUrl()).toBe("wss://swiftmatch.app")
    expect((await loadNative({ wsUrl: "ws://localhost:3002" })).getWsUrl()).toBe("ws://localhost:3002")
  })

  it("нативная платформа перехватывает fetch: строка /api/ получает базу, чужие URL проходят как есть", async () => {
    const orig = vi.fn().mockResolvedValue({ ok: true })
    win.fetch = orig as unknown as typeof globalThis.fetch
    await loadNative({ native: true, apiUrl: "https://api.example" })
    await window.fetch("/api/chats", { headers: { a: "1" } })
    expect(orig).toHaveBeenLastCalledWith("https://api.example/api/chats", { headers: { a: "1" } })
    await window.fetch("https://other.example/x")
    expect(orig).toHaveBeenLastCalledWith("https://other.example/x", undefined)
  })

  it("нативная платформа: Request с url, начинающимся на /api/, пересобирается с базой", async () => {
    const orig = vi.fn().mockResolvedValue({ ok: true })
    win.fetch = orig as unknown as typeof globalThis.fetch
    await loadNative({ native: true, apiUrl: "https://api.example" })
    const req = Object.create(Request.prototype) as Request
    Object.defineProperty(req, "url", { value: "/api/test" })
    await window.fetch(req)
    const passed = orig.mock.calls[0][0] as Request
    expect(passed).toBeInstanceOf(Request)
    expect(passed.url).toBe("https://api.example/api/test")
  })
})
