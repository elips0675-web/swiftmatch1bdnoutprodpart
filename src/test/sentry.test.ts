import { describe, it, expect, vi } from "vitest"

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
  setUser: vi.fn(),
  addBreadcrumb: vi.fn(),
  captureMessage: vi.fn(),
  browserTracingIntegration: vi.fn(() => ({ name: "tracing" })),
  replayIntegration: vi.fn(() => ({ name: "replay" })),
}))

vi.mock("@sentry/react", () => sentry)

const DSN = "https://key@o0.ingest.sentry.io/1"

async function loadSentry(env: Record<string, string>) {
  vi.resetModules()
  vi.unstubAllEnvs()
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
  return await import("@/lib/sentry")
}

describe("src/lib/sentry.ts", () => {
  it("без DSN: initSentry false, Sentry.init не вызывается, все отправки — no-op", async () => {
    const mod = await loadSentry({ VITE_SENTRY_DSN: "" })
    expect(mod.initSentry()).toBe(false)
    mod.captureError(new Error("boom"))
    mod.setSentryUser(7, "a@b.c")
    mod.clearSentryUser()
    mod.captureTiming("feed", 12)
    mod.captureMessage("hi")
    expect(sentry.init).not.toHaveBeenCalled()
    expect(sentry.captureException).not.toHaveBeenCalled()
    expect(sentry.setUser).not.toHaveBeenCalled()
    expect(sentry.addBreadcrumb).not.toHaveBeenCalled()
    expect(sentry.captureMessage).not.toHaveBeenCalled()
  })

  it("с DSN: initSentry собирает init с ожидаемыми параметрами", async () => {
    const mod = await loadSentry({ VITE_SENTRY_DSN: DSN })
    expect(mod.initSentry()).toBe(true)
    expect(sentry.init).toHaveBeenCalledTimes(1)
    expect(sentry.init).toHaveBeenCalledWith({
      dsn: DSN,
      environment: "test",
      release: "swiftmatch@0.0.0",
      integrations: [{ name: "tracing" }, { name: "replay" }],
      tracesSampleRate: 1.0,
      replaysSessionSampleRate: 0.1,
      replaysOnErrorSampleRate: 1.0,
    })
  })

  it("PROD снижает tracesSampleRate, VITE_APP_VERSION попадает в release", async () => {
    const mod = await loadSentry({ VITE_SENTRY_DSN: DSN, PROD: "true", VITE_APP_VERSION: "1.2.3" })
    mod.initSentry()
    expect(sentry.init).toHaveBeenCalledWith(expect.objectContaining({
      release: "swiftmatch@1.2.3",
      tracesSampleRate: 0.1,
    }))
  })

  it("пустой MODE даёт фолбэк development", async () => {
    const mod = await loadSentry({ VITE_SENTRY_DSN: DSN, MODE: "" })
    mod.initSentry()
    expect(sentry.init).toHaveBeenCalledWith(expect.objectContaining({ environment: "development" }))
  })

  it("captureError/setSentryUser/clearSentryUser прокидывают данные в Sentry", async () => {
    const mod = await loadSentry({ VITE_SENTRY_DSN: DSN })
    const err = new Error("boom")
    mod.captureError(err, { page: "feed" })
    expect(sentry.captureException).toHaveBeenLastCalledWith(err, { extra: { page: "feed" } })
    mod.captureError(err)
    expect(sentry.captureException).toHaveBeenLastCalledWith(err, { extra: undefined })
    mod.setSentryUser(7, "a@b.c")
    expect(sentry.setUser).toHaveBeenLastCalledWith({ id: "7", email: "a@b.c" })
    mod.setSentryUser("42")
    expect(sentry.setUser).toHaveBeenLastCalledWith({ id: "42", email: undefined })
    mod.clearSentryUser()
    expect(sentry.setUser).toHaveBeenLastCalledWith(null)
  })

  it("captureTiming: breadcrumb с округлением, нефинитные ms и падение addBreadcrumb не критичны", async () => {
    const mod = await loadSentry({ VITE_SENTRY_DSN: DSN })
    mod.captureTiming("feed", 123.4)
    expect(sentry.addBreadcrumb).toHaveBeenLastCalledWith({
      category: "performance",
      message: "feed: 123ms",
      level: "info",
    })
    const calls = sentry.addBreadcrumb.mock.calls.length
    mod.captureTiming("nan", Number.NaN)
    mod.captureTiming("inf", Number.POSITIVE_INFINITY)
    expect(sentry.addBreadcrumb.mock.calls.length).toBe(calls)
    sentry.addBreadcrumb.mockImplementationOnce(() => { throw new Error("sentry down") })
    expect(() => mod.captureTiming("boom", 5)).not.toThrow()
  })

  it("captureMessage: уровень по умолчанию, контекст и падение не критичны", async () => {
    const mod = await loadSentry({ VITE_SENTRY_DSN: DSN })
    mod.captureMessage("boom")
    expect(sentry.captureMessage).toHaveBeenLastCalledWith("boom", { level: "error", extra: {} })
    mod.captureMessage("ticket", "warning", { orderId: 1 })
    expect(sentry.captureMessage).toHaveBeenLastCalledWith("ticket", { level: "warning", extra: { orderId: 1 } })
    sentry.captureMessage.mockImplementationOnce(() => { throw new Error("sentry down") })
    expect(() => mod.captureMessage("boom2")).not.toThrow()
  })
})
