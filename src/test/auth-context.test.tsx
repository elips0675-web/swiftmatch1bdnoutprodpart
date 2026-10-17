import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { AuthProvider, useAuth } from "@/context/auth-context"
import { type ReactNode } from "react"

const supabaseRef = vi.hoisted(() => ({ client: null as unknown }))

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => supabaseRef.client,
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
  supabaseRef.client = null
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

  it("login отклоняется, когда Supabase не сконфигурирован", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401, json: () => Promise.resolve({}) })

    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isDemo).toBe(true))

    await act(async () => {
      await expect(result.current.login("a@b.c", "pw")).rejects.toThrow("Supabase not configured")
    })

    expect(result.current.error).toBe(
      "Supabase not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.",
    )
  })
})

function createSupabaseClient() {
  return {
    auth: {
      onAuthStateChange: vi.fn((cb: (event: string, session: unknown) => void) => {
        authCbRef.current = cb
        return { data: { subscription: { unsubscribe: unsubscribeSpy } } }
      }),
      getSession: vi.fn(
        (): Promise<{ data: { session: unknown } }> => Promise.resolve({ data: { session: null } }),
      ),
      signInWithPassword: vi.fn(
        (): Promise<{ error: { message: string } | null }> => Promise.resolve({ error: null }),
      ),
      signInWithOAuth: vi.fn(
        (): Promise<{ error: { message: string } | null }> => Promise.resolve({ error: null }),
      ),
      signUp: vi.fn(
        (): Promise<{ error: { message: string } | null }> => Promise.resolve({ error: null }),
      ),
      signOut: vi.fn(
        (): Promise<{ error: { message: string } | null }> => Promise.resolve({ error: null }),
      ),
    },
  }
}

const authCbRef: { current: ((event: string, session: unknown) => void) | null } = { current: null }
const unsubscribeSpy = vi.fn()

describe("AuthContext (с Supabase)", () => {
  let client: ReturnType<typeof createSupabaseClient>

  beforeEach(() => {
    authCbRef.current = null
    client = createSupabaseClient()
    supabaseRef.client = client
  })

  it("применяет SIGNED_IN из onAuthStateChange", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper })
    await waitFor(() => expect(client.auth.onAuthStateChange).toHaveBeenCalled())

    act(() => {
      authCbRef.current?.("SIGNED_IN", {
        user: { id: "7", email: "u@mail.ru", user_metadata: { name: "Оля", avatar_url: "a.png" } },
        access_token: "tok",
      })
    })

    expect(result.current.isDemo).toBe(false)
    expect(result.current.user).toEqual({ id: 7, name: "Оля", email: "u@mail.ru", avatar: "a.png" })
    expect(result.current.token).toBe("tok")
  })

  it("разлогинивает по SIGNED_OUT", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper })
    await waitFor(() => expect(client.auth.onAuthStateChange).toHaveBeenCalled())

    act(() => {
      authCbRef.current?.("SIGNED_IN", {
        user: { id: "7", email: "u@mail.ru", user_metadata: {} },
        access_token: "tok",
      })
    })
    expect(result.current.user).toBeTruthy()

    act(() => {
      authCbRef.current?.("SIGNED_OUT", null)
    })
    expect(result.current.user).toBeNull()
    expect(result.current.token).toBeNull()
  })

  it("восстанавливает сессию из getSession", async () => {
    client.auth.getSession.mockResolvedValueOnce({
      data: {
        session: {
          user: { id: "9", email: "s@mail.ru", user_metadata: {} },
          access_token: "t9",
        },
      },
    })

    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.token).toBe("t9"))

    expect(result.current.user?.id).toBe(9)
    expect(result.current.user?.email).toBe("s@mail.ru")
    expect(result.current.user?.name).toBe("s")
  })

  it("разлогинивает, если в getSession сессии нет", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.user).toBeNull()
    expect(result.current.token).toBeNull()
  })

  it("отписывается от onAuthStateChange при размонтировании", async () => {
    const { unmount } = renderHook(() => useAuth(), { wrapper: Wrapper })
    await waitFor(() => expect(client.auth.onAuthStateChange).toHaveBeenCalled())

    unmount()

    expect(unsubscribeSpy).toHaveBeenCalled()
  })

  it("login: успех не поднимает ошибку", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.login("a@b.c", "pw")
    })

    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({ email: "a@b.c", password: "pw" })
    expect(result.current.error).toBeNull()
  })

  it("loginWithGoogle: успех", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.loginWithGoogle()
    })

    expect(client.auth.signInWithOAuth).toHaveBeenCalledWith({ provider: "google" })
  })

  it("register: успех", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.register("e@mail.ru", "pw", "Имя")
    })

    expect(client.auth.signUp).toHaveBeenCalledWith({
      email: "e@mail.ru",
      password: "pw",
      options: { data: { name: "Имя" } },
    })
  })

  it("login: ошибка Supabase даёт error и пробрасывает исключение", async () => {
    client.auth.signInWithPassword.mockResolvedValueOnce({ error: { message: "bad creds" } })

    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await expect(result.current.login("a@b.c", "pw")).rejects.toThrow("bad creds")
    })

    expect(result.current.error).toBe("bad creds")
  })

  it("loginWithGoogle: ошибка Supabase даёт error", async () => {
    client.auth.signInWithOAuth.mockResolvedValueOnce({ error: { message: "oauth fail" } })

    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await expect(result.current.loginWithGoogle()).rejects.toThrow("oauth fail")
    })

    expect(result.current.error).toBe("oauth fail")
  })

  it("register: ошибка Supabase даёт error", async () => {
    client.auth.signUp.mockResolvedValueOnce({ error: { message: "email taken" } })

    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await expect(result.current.register("e@mail.ru", "pw", "Имя")).rejects.toThrow("email taken")
    })

    expect(result.current.error).toBe("email taken")
  })

  it("logout зовёт signOut и POST /api/auth/logout", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.logout()
    })

    expect(client.auth.signOut).toHaveBeenCalled()
    expect(mockFetch).toHaveBeenCalledWith("/api/auth/logout", { method: "POST" })
    expect(result.current.user).toBeNull()
  })
})
