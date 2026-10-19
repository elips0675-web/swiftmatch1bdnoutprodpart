import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

const AUTH_TOKEN_KEY = "swiftmatch_auth_token"

async function freshModule() {
  vi.resetModules()
  return await import("@/lib/token")
}

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
})

afterEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  vi.resetModules()
})

describe("src/lib/token.ts", () => {
  it("пустое хранилище → null", async () => {
    const mod = await freshModule()
    expect(mod.getToken()).toBeNull()
  })

  it("значение из sessionStorage кэшируется в память и переживает очистку хранилища", async () => {
    const mod = await freshModule()
    sessionStorage.setItem(AUTH_TOKEN_KEY, "s-tok")
    expect(mod.getToken()).toBe("s-tok")
    sessionStorage.removeItem(AUTH_TOKEN_KEY)
    expect(mod.getToken()).toBe("s-tok")
  })

  it("legacy-носители: localStorage с прежним ключом и ключ 'token'", async () => {
    const withOldKey = await freshModule()
    localStorage.setItem(AUTH_TOKEN_KEY, "l1")
    expect(withOldKey.getToken()).toBe("l1")

    localStorage.removeItem(AUTH_TOKEN_KEY)
    const withLegacyKey = await freshModule()
    localStorage.setItem("token", "l2")
    expect(withLegacyKey.getToken()).toBe("l2")
  })

  it("setToken пишет оба хранилища, setToken(null) стирает их и память", async () => {
    const mod = await freshModule()
    mod.setToken("abc")
    expect(sessionStorage.getItem(AUTH_TOKEN_KEY)).toBe("abc")
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBe("abc")
    expect(mod.getToken()).toBe("abc")
    mod.setToken(null)
    expect(sessionStorage.getItem(AUTH_TOKEN_KEY)).toBeNull()
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull()
    expect(mod.getToken()).toBeNull()
  })

  it("память важнее хранилища после setToken", async () => {
    const mod = await freshModule()
    mod.setToken("m1")
    sessionStorage.clear()
    localStorage.clear()
    expect(mod.getToken()).toBe("m1")
  })

  it("clearToken стирает токены и все служебные ключи", async () => {
    const mod = await freshModule()
    sessionStorage.setItem(AUTH_TOKEN_KEY, "a")
    sessionStorage.setItem("swiftchat_salt", "s")
    sessionStorage.setItem("swiftmatch_refresh_token", "r")
    localStorage.setItem(AUTH_TOKEN_KEY, "a")
    localStorage.setItem("token", "t")
    localStorage.setItem("authToken", "at")
    localStorage.setItem("userProfile", "p")
    mod.clearToken()
    for (const key of [AUTH_TOKEN_KEY, "swiftchat_salt", "swiftmatch_refresh_token"]) {
      expect(sessionStorage.getItem(key)).toBeNull()
    }
    for (const key of [AUTH_TOKEN_KEY, "token", "authToken", "userProfile"]) {
      expect(localStorage.getItem(key)).toBeNull()
    }
    expect(mod.getToken()).toBeNull()
  })

  it("после clearToken чтение снова идёт из хранилища", async () => {
    const mod = await freshModule()
    mod.setToken("x1")
    mod.clearToken()
    sessionStorage.setItem(AUTH_TOKEN_KEY, "fresh")
    expect(mod.getToken()).toBe("fresh")
  })
})
