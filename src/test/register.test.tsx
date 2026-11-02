import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { renderWithProviders } from "./test-utils"
import RegisterPage from "@/pages/register"

const mockPush = vi.fn()
const mockBack = vi.fn()

vi.mock("@/shims/next-navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    pathname: "/register",
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

vi.mock("@/lib/token", () => ({
  getToken: () => "register-test-token",
}))

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

beforeEach(() => {
  vi.clearAllMocks()
  mockFetch.mockReset()
  mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: 1 }) })
})

function getByTextContent(text: string): HTMLElement {
  return screen.getByText((content, element) => {
    return element?.textContent?.trim() === text || false
  })
}

function bodyOf(call = 0): Record<string, unknown> {
  const init = mockFetch.mock.calls[call][1] as { body: string }
  return JSON.parse(init.body) as Record<string, unknown>
}

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByPlaceholderText("Ваше имя"), "Test User")
  await user.type(screen.getByPlaceholderText("Email"), "new@test.com")
  await user.type(screen.getByPlaceholderText("Придумайте пароль"), "password123")
  await user.click(screen.getByTestId("age-checkbox"))
  await user.click(screen.getByTestId("consent-checkbox"))
}

describe("RegisterPage", () => {
  it("renders registration form with all elements", () => {
    renderWithProviders(<RegisterPage />)

    expect(getByTextContent("SwiftMatch")).toBeTruthy()
    expect(screen.getByPlaceholderText("Ваше имя")).toBeTruthy()
    expect(screen.getByPlaceholderText("Email")).toBeTruthy()
    expect(screen.getByPlaceholderText("Придумайте пароль")).toBeTruthy()
    expect(screen.getByText("Создать аккаунт")).toBeTruthy()
  })

  it("submits registration form successfully", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 1 }),
    })

    const user = userEvent.setup()
    renderWithProviders(<RegisterPage />)
    await fillValidForm(user)
    await user.click(screen.getByText("Создать аккаунт"))

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/auth/register", expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "new@test.com", password: "password123", displayName: "Test User", consent: true }),
      }))
    })

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/login")
    })
  })

  it("сообщает об успехе создания аккаунта", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 1 }),
    })

    const user = userEvent.setup()
    renderWithProviders(<RegisterPage />)
    await fillValidForm(user)
    await user.click(screen.getByText("Создать аккаунт"))

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        title: "Успешно",
        description: "Аккаунт создан!",
      }))
    })
  })

  it("отправляет событие register_completed после успешной регистрации", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 1 }),
    })

    const user = userEvent.setup()
    renderWithProviders(<RegisterPage />)
    await fillValidForm(user)
    await user.click(screen.getByText("Создать аккаунт"))

    await waitFor(() => {
      const trackCall = mockFetch.mock.calls.find(([url]) => url === "/api/analytics/track")
      expect(trackCall).toBeDefined()
      expect(JSON.parse((trackCall?.[1] as { body: string }).body)).toMatchObject({
        event_type: "register_completed",
      })
    })
  })

  it("отправляет телефон, если он заполнен", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 1 }),
    })

    const user = userEvent.setup()
    renderWithProviders(<RegisterPage />)
    await fillValidForm(user)
    await user.type(screen.getByPlaceholderText("+7 (999) 123-45-67"), " +7 999 123-45-67 ")
    await user.click(screen.getByText("Создать аккаунт"))

    await waitFor(() => {
      expect(bodyOf()).toMatchObject({ phone: "+7 999 123-45-67" })
    })
  })

  it("не отправляет телефон из одних пробелов", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 1 }),
    })

    const user = userEvent.setup()
    renderWithProviders(<RegisterPage />)
    await fillValidForm(user)
    await user.type(screen.getByPlaceholderText("+7 (999) 123-45-67"), "   ")
    await user.click(screen.getByText("Создать аккаунт"))

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled()
    })
    expect(bodyOf()).not.toHaveProperty("phone")
  })

  it("обрезает пробелы вокруг имени и email перед отправкой", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 1 }),
    })

    const user = userEvent.setup()
    renderWithProviders(<RegisterPage />)
    await user.type(screen.getByPlaceholderText("Ваше имя"), "  Test User  ")
    await user.type(screen.getByPlaceholderText("Email"), "  new@test.com  ")
    await user.type(screen.getByPlaceholderText("Придумайте пароль"), "password123")
    await user.click(screen.getByTestId("age-checkbox"))
    await user.click(screen.getByTestId("consent-checkbox"))
    await user.click(screen.getByText("Создать аккаунт"))

    await waitFor(() => {
      expect(bodyOf()).toMatchObject({ displayName: "Test User", email: "new@test.com" })
    })
  })

  it("не считает имя из одних пробелов заполненным", async () => {
    const user = userEvent.setup()
    renderWithProviders(<RegisterPage />)

    await user.type(screen.getByPlaceholderText("Ваше имя"), "   ")
    await user.type(screen.getByPlaceholderText("Email"), "test@test.com")
    await user.type(screen.getByPlaceholderText("Придумайте пароль"), "password123")
    await user.click(screen.getByText("Создать аккаунт"))

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        description: "Имя обязательно",
      }))
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("validates name is required", async () => {
    const user = userEvent.setup()
    renderWithProviders(<RegisterPage />)

    await user.type(screen.getByPlaceholderText("Email"), "test@test.com")
    await user.type(screen.getByPlaceholderText("Придумайте пароль"), "password123")
    await user.click(screen.getByText("Создать аккаунт"))

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        description: "Имя обязательно",
      }))
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("validates email format", async () => {
    const user = userEvent.setup()
    renderWithProviders(<RegisterPage />)

    await user.type(screen.getByPlaceholderText("Ваше имя"), "Test")
    await user.type(screen.getByPlaceholderText("Email"), "invalid-email")
    await user.type(screen.getByPlaceholderText("Придумайте пароль"), "password123")
    await user.click(screen.getByText("Создать аккаунт"))

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        description: "Введите корректный email",
      }))
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("validates password length", async () => {
    const user = userEvent.setup()
    renderWithProviders(<RegisterPage />)

    await user.type(screen.getByPlaceholderText("Ваше имя"), "Test")
    await user.type(screen.getByPlaceholderText("Email"), "test@test.com")
    await user.type(screen.getByPlaceholderText("Придумайте пароль"), "short")
    await user.click(screen.getByText("Создать аккаунт"))

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        description: "Пароль должен быть минимум 8 символов",
      }))
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("blocks submit without consent checkbox", async () => {
    const user = userEvent.setup()
    renderWithProviders(<RegisterPage />)

    await user.type(screen.getByPlaceholderText("Ваше имя"), "Test")
    await user.type(screen.getByPlaceholderText("Email"), "test@test.com")
    await user.type(screen.getByPlaceholderText("Придумайте пароль"), "password123")
    await user.click(screen.getByTestId("age-checkbox"))
    await user.click(screen.getByText("Создать аккаунт"))

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        description: "Необходимо согласие на обработку персональных данных",
      }))
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("blocks submit without age confirmation", async () => {
    const user = userEvent.setup()
    renderWithProviders(<RegisterPage />)

    await user.type(screen.getByPlaceholderText("Ваше имя"), "Test")
    await user.type(screen.getByPlaceholderText("Email"), "test@test.com")
    await user.type(screen.getByPlaceholderText("Придумайте пароль"), "password123")
    await user.click(screen.getByText("Создать аккаунт"))

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        description: "Подтвердите, что вам есть 18 лет",
      }))
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("shows error on failed registration", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ message: "Email already in use" }),
    })

    const user = userEvent.setup()
    renderWithProviders(<RegisterPage />)
    await user.type(screen.getByPlaceholderText("Ваше имя"), "Test")
    await user.type(screen.getByPlaceholderText("Email"), "exists@test.com")
    await user.type(screen.getByPlaceholderText("Придумайте пароль"), "password123")
    await user.click(screen.getByTestId("age-checkbox"))
    await user.click(screen.getByTestId("consent-checkbox"))
    await user.click(screen.getByText("Создать аккаунт"))

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        title: "Ошибка регистрации",
        description: "Email already in use",
        variant: "destructive",
      }))
    })
    expect(mockPush).not.toHaveBeenCalled()
  })

  it("показывает переведённую ошибку, когда сервер не прислал message", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({}),
    })

    const user = userEvent.setup()
    renderWithProviders(<RegisterPage />)
    await fillValidForm(user)
    await user.click(screen.getByText("Создать аккаунт"))

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        description: "Ошибка создания аккаунта",
        variant: "destructive",
      }))
    })
  })

  it("сообщает о сетевом сбое и оставляет кнопку активной", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network down"))

    const user = userEvent.setup()
    renderWithProviders(<RegisterPage />)
    await fillValidForm(user)
    await user.click(screen.getByText("Создать аккаунт"))

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        title: "Ошибка сети",
        description: "Проверьте подключение",
        variant: "destructive",
      }))
    })
    await waitFor(() => {
      expect(screen.getByTestId("submit-register")).toBeEnabled()
    })
    expect(mockPush).not.toHaveBeenCalled()
  })

  it("блокирует кнопку и меняет подпись, пока идёт запрос", async () => {
    let resolveFetch: (value: unknown) => void = () => {}
    mockFetch.mockImplementationOnce(() => new Promise((resolve) => {
      resolveFetch = resolve
    }))

    const user = userEvent.setup()
    renderWithProviders(<RegisterPage />)
    await fillValidForm(user)
    await user.click(screen.getByText("Создать аккаунт"))

    await waitFor(() => {
      expect(screen.getByTestId("submit-register")).toBeDisabled()
    })
    expect(screen.getByTestId("submit-register").textContent).toContain("Создание аккаунта...")

    resolveFetch({ ok: true, json: () => Promise.resolve({ id: 1 }) })

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/login")
    })
  })

  it("кнопка «назад» уводит на предыдущий экран", async () => {
    const user = userEvent.setup()
    renderWithProviders(<RegisterPage />)

    await user.click(screen.getByLabelText("common.back"))

    expect(mockBack).toHaveBeenCalledTimes(1)
  })

  it("ведёт на документы согласия и связывает их переведённым союзом", () => {
    renderWithProviders(<RegisterPage />)

    expect(screen.getByText("документу об обработке данных").closest("a")).toHaveAttribute("href", "/legal/data-processing")
    expect(screen.getByText("Политике конфиденциальности").closest("a")).toHaveAttribute("href", "/legal/privacy")
    expect(screen.getByText("Пользовательскому соглашению").closest("a")).toHaveAttribute("href", "/legal/terms")

    const label = screen.getByText((_, element) => {
      if (element?.tagName !== "LABEL") return false
      const text = (element.textContent || "").replace(/\s+/g, " ").trim()
      return text === "Я соглашаюсь на обработку моих персональных данных согласно документу об обработке данных и Политике конфиденциальности и Пользовательскому соглашению"
    })
    expect(label).toBeTruthy()
  })

  it("has link to login page", () => {
    renderWithProviders(<RegisterPage />)

    const loginLink = screen.getByText("ВОЙТИ")
    expect(loginLink.getAttribute("href")).toBe("/login")
  })
})
