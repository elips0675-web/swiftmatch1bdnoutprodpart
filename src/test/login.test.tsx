import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { renderWithProviders } from "./test-utils"
import LoginPage from "@/pages/login"

const mockPush = vi.fn()
const mockBack = vi.fn()

vi.mock("@/shims/next-navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    pathname: "/login",
    query: {},
    replace: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}))

vi.mock("@/shims/next-link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href?: string; [key: string]: unknown }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))

const mockToast = vi.hoisted(() => vi.fn())
vi.mock("@/hooks/use-toast", () => ({
  toast: mockToast,
}))

const h = vi.hoisted(() => ({
  setToken: vi.fn(),
  getToken: vi.fn(() => null),
  isNative: vi.fn(() => false),
  getSupabase: vi.fn((): unknown => null),
  signInWithOAuth: vi.fn(),
  track: vi.fn(),
}))

vi.mock("@/lib/token", () => ({
  setToken: h.setToken,
  getToken: h.getToken,
}))

vi.mock("@/lib/native", () => ({
  isNative: h.isNative,
}))

vi.mock("@/lib/supabase", () => ({
  getSupabase: h.getSupabase,
}))

vi.mock("@/hooks/useExperiment", () => ({
  useTrackEvent: () => h.track,
  useExperiment: () => ({ variant: null, loading: false }),
}))

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

beforeEach(() => {
  vi.clearAllMocks()
  mockFetch.mockReset()
  h.isNative.mockReturnValue(false)
  h.getSupabase.mockReturnValue(null)
  localStorage.clear()
  sessionStorage.clear()
})

function getByTextContent(text: string): HTMLElement {
  return screen.getByText((content, element) => {
    return element?.textContent?.trim() === text || false
  })
}

function okLogin(payload: Record<string, unknown> = {}) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ token: "test-token", refresh_token: "refresh", email_verified: true, ...payload }),
  })
}

function failLogin(status: number, body: Record<string, unknown> = {}) {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    json: () => Promise.resolve(body),
  })
}

async function submitCredentials(email = "test@test.com", password = "password123") {
  const user = userEvent.setup()
  renderWithProviders(<LoginPage />)
  await user.type(screen.getByPlaceholderText("Email"), email)
  await user.type(screen.getByPlaceholderText("Пароль"), password)
  await user.click(screen.getByText("Продолжить"))
  return user
}

describe("LoginPage", () => {
  it("renders login form with all elements", () => {
    renderWithProviders(<LoginPage />)

    expect(getByTextContent("SwiftMatch")).toBeTruthy()
    expect(screen.getByPlaceholderText("Email")).toBeTruthy()
    expect(screen.getByPlaceholderText("Пароль")).toBeTruthy()
    expect(screen.getByText("Продолжить")).toBeTruthy()
    expect(screen.getByText("Забыли пароль?")).toBeTruthy()
    expect(screen.getByText("Войти с Google")).toBeTruthy()
  })

  it("submits login form successfully", async () => {
    okLogin()

    await submitCredentials()

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/auth/login", expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "test@test.com", password: "password123" }),
      }))
    })

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/")
    })
  })

  it("сохраняет токен, флаг подтверждения email и событие входа", async () => {
    okLogin({ email_verified: true })

    await submitCredentials("anna@test.com", "secret123")

    await waitFor(() => expect(h.setToken).toHaveBeenCalledWith("test-token"))
    expect(localStorage.getItem("email_verified")).toBe("1")
    expect(localStorage.getItem("email")).toBe("anna@test.com")
    expect(h.track).toHaveBeenCalledWith("login_completed", { method: "email" })
    expect(mockToast).toHaveBeenCalledWith({ title: "С возвращением!", description: "Рады видеть вас снова" })
  })

  it("неподтверждённый email сохраняется как ноль", async () => {
    okLogin({ email_verified: false })

    await submitCredentials()

    await waitFor(() => expect(localStorage.getItem("email_verified")).toBe("0"))
  })

  it("на native кладёт refresh_token в sessionStorage", async () => {
    h.isNative.mockReturnValue(true)
    okLogin()

    await submitCredentials()

    await waitFor(() => expect(sessionStorage.getItem("swiftmatch_refresh_token")).toBe("refresh"))
  })

  it("в вебе refresh_token не дублируется в sessionStorage", async () => {
    h.isNative.mockReturnValue(false)
    okLogin()

    await submitCredentials()

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/"))
    expect(sessionStorage.getItem("swiftmatch_refresh_token")).toBeNull()
  })

  it("на native без refresh_token ничего не пишет", async () => {
    h.isNative.mockReturnValue(true)
    okLogin({ refresh_token: undefined })

    await submitCredentials()

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/"))
    expect(sessionStorage.getItem("swiftmatch_refresh_token")).toBeNull()
  })

  it("shows error on failed login", async () => {
    failLogin(401, { message: "Invalid credentials" })

    await submitCredentials("wrong@test.com", "wrong")

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        variant: "destructive",
      }))
    })
  })

  it("сырой английский message сервера не показывается — только ключ перевода", async () => {
    failLogin(401, { message: "Invalid credentials" })

    await submitCredentials()

    await waitFor(() => expect(mockToast).toHaveBeenCalledWith({
      title: "Ошибка входа",
      description: "Проверьте email и пароль",
      variant: "destructive",
    }))
    expect(JSON.stringify(mockToast.mock.calls)).not.toContain("Invalid credentials")
  })

  it("без message сервера показывает переведённое описание по умолчанию", async () => {
    failLogin(400, {})

    await submitCredentials()

    await waitFor(() => expect(mockToast).toHaveBeenCalledWith({
      title: "Ошибка входа",
      description: "Проверьте email и пароль",
      variant: "destructive",
    }))
  })

  it("код TOTP_REQUIRED переводится, а не показывается сырым", async () => {
    failLogin(401, { message: "TOTP_REQUIRED" })

    await submitCredentials()

    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ description: "Введите код двухфакторной аутентификации" })))
    expect(JSON.stringify(mockToast.mock.calls)).not.toContain("TOTP_REQUIRED")
  })

  it("код TOTP_INVALID переводится, а не показывается сырым", async () => {
    failLogin(401, { message: "TOTP_INVALID" })

    await submitCredentials()

    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ description: "Неверный код двухфакторной аутентификации" })))
  })

  it("блокировка после серии неудач (429) показывает отдельный ключ", async () => {
    failLogin(429, { message: "Too many failed attempts. Try again in 15 min" })

    await submitCredentials()

    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      description: "Слишком много попыток входа — попробуйте позже",
    })))
    expect(JSON.stringify(mockToast.mock.calls)).not.toContain("Too many failed attempts")
  })

  it("сетевой сбой показывает ошибку сети и возвращает кнопку в рабочее состояние", async () => {
    mockFetch.mockRejectedValueOnce(new Error("offline"))

    await submitCredentials()

    await waitFor(() => expect(mockToast).toHaveBeenCalledWith({
      title: "Ошибка сети",
      description: "Проверьте подключение",
      variant: "destructive",
    }))
    expect(screen.getByTestId("submit-login")).not.toBeDisabled()
  })

  it("пока запрос в полёте кнопка выключена и подписана «вход...»", async () => {
    mockFetch.mockReturnValueOnce(new Promise(() => {}))

    await submitCredentials()

    await waitFor(() => expect(screen.getByTestId("submit-login")).toBeDisabled())
    expect(screen.getByText("Вход...")).toBeTruthy()
  })

  it("toggles between phone and email login methods", async () => {
    const user = userEvent.setup()
    renderWithProviders(<LoginPage />)

    await user.click(screen.getByText("ТЕЛЕФОН"))
    expect(screen.getByPlaceholderText("+7 (999) 000-00-00")).toBeTruthy()

    await user.click(screen.getByText("Email"))
    expect(screen.getByPlaceholderText("Email")).toBeTruthy()
  })

  it("вход по телефону показывает «скоро» и не ходит в API", async () => {
    const user = userEvent.setup()
    renderWithProviders(<LoginPage />)

    await user.click(screen.getByText("ТЕЛЕФОН"))
    await user.type(screen.getByPlaceholderText("+7 (999) 000-00-00"), "+79990000000")
    await user.click(screen.getByText("Продолжить"))

    await waitFor(() => expect(mockToast).toHaveBeenCalledWith({
      title: "Скоро",
      description: "Вход по телефону будет доступен позже",
    }))
    expect(mockFetch).not.toHaveBeenCalled()
    expect(h.setToken).not.toHaveBeenCalled()
    expect(screen.getByTestId("submit-login")).not.toBeDisabled()
  })

  it("Google без настроенного Supabase даёт переведённый отказ", async () => {
    const user = userEvent.setup()
    renderWithProviders(<LoginPage />)

    await user.click(screen.getByText("Войти с Google"))

    await waitFor(() => expect(mockToast).toHaveBeenCalledWith({
      title: "Вход через Google недоступен",
      variant: "destructive",
    }))
    expect(JSON.stringify(mockToast.mock.calls)).not.toContain("Supabase")
  })

  it("Google с настроенным Supabase запускает OAuth без тоста", async () => {
    h.getSupabase.mockReturnValue({ auth: { signInWithOAuth: h.signInWithOAuth } })
    h.signInWithOAuth.mockResolvedValue({ error: null })
    const user = userEvent.setup()
    renderWithProviders(<LoginPage />)

    await user.click(screen.getByText("Войти с Google"))

    await waitFor(() => expect(h.signInWithOAuth).toHaveBeenCalledWith({ provider: "google" }))
    expect(mockToast).not.toHaveBeenCalled()
  })

  it("ошибка OAuth Google показывается переведённым текстом", async () => {
    h.getSupabase.mockReturnValue({ auth: { signInWithOAuth: h.signInWithOAuth } })
    h.signInWithOAuth.mockResolvedValue({ error: new Error("popup closed") })
    const user = userEvent.setup()
    renderWithProviders(<LoginPage />)

    await user.click(screen.getByText("Войти с Google"))

    await waitFor(() => expect(mockToast).toHaveBeenCalledWith({
      title: "Ошибка входа",
      description: "Ошибка входа через Google",
      variant: "destructive",
    }))
    expect(JSON.stringify(mockToast.mock.calls)).not.toContain("popup closed")
  })

  it("сбой импорта Supabase не оставляет кнопку заблокированной", async () => {
    h.getSupabase.mockImplementation(() => { throw new Error("boom") })
    const user = userEvent.setup()
    renderWithProviders(<LoginPage />)

    await user.click(screen.getByText("Войти с Google"))

    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      description: "Ошибка входа через Google",
    })))
    expect(screen.getByText("Войти с Google").closest("button")).not.toBeDisabled()
  })

  it("кнопки «назад» и «на главную» ведут туда, куда обещают", async () => {
    const user = userEvent.setup()
    renderWithProviders(<LoginPage />)

    await user.click(screen.getByLabelText("common.back"))
    expect(mockBack).toHaveBeenCalledTimes(1)

    await user.click(screen.getByText("НА ГЛАВНУЮ"))
    expect(mockPush).toHaveBeenCalledWith("/")
  })

  it("has link to register page", () => {
    renderWithProviders(<LoginPage />)

    const registerLink = screen.getByText("ЗАРЕГИСТРИРОВАТЬСЯ")
    expect(registerLink.getAttribute("href")).toBe("/register")
  })

  it("has link to forgot password", () => {
    renderWithProviders(<LoginPage />)

    const forgotLink = screen.getByText("Забыли пароль?")
    expect(forgotLink.getAttribute("href")).toBe("/forgot-password")
  })

  it("ссылка демо-онбординга ведёт на /onboarding", () => {
    renderWithProviders(<LoginPage />)

    const demoLink = screen.getByText("ДЕМО-ОНБОРДИНГ")
    expect(demoLink.getAttribute("href")).toBe("/onboarding")
  })
})
