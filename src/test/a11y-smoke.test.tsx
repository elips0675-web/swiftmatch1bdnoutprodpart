import { describe, it, expect, vi, beforeEach } from "vitest"
import { act } from "@testing-library/react"
import { renderWithProviders } from "./test-utils"
import { a11yViolations } from "./a11y"

vi.mock("@/shims/next-navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    back: vi.fn(),
    pathname: "/",
    query: {},
    replace: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams("token=tok-1"),
}))

vi.mock("@/shims/next-link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href?: string; [key: string]: unknown }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
  useToast: () => ({ toast: vi.fn(), toasts: [] }),
}))

vi.mock("@/components/layout/app-header", () => ({
  AppHeader: () => null,
}))

import AboutPage from "@/pages/about"
import FaqPage from "@/pages/faq"
import SafetyPage from "@/pages/safety"
import LoginPage from "@/pages/login"
import RegisterPage from "@/pages/register"
import ForgotPasswordPage from "@/pages/forgot-password"
import ResetPasswordPage from "@/pages/reset-password"
import VerifyEmailPage from "@/pages/verify-email"

globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
  const url = String(input)
  const payload = url.startsWith("/api/checkin") ? [] : {}
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload) } as Response)
}) as unknown as typeof fetch

const PAGES: Array<[string, React.ReactElement]> = [
  ["about", <AboutPage />],
  ["faq", <FaqPage />],
  ["safety", <SafetyPage />],
  ["login", <LoginPage />],
  ["register", <RegisterPage />],
  ["forgot-password", <ForgotPasswordPage />],
  ["reset-password", <ResetPasswordPage />],
  ["verify-email", <VerifyEmailPage />],
]

describe("a11y: смоук по ключевым страницам", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(PAGES)("%s — нет нарушений доступности", async (_name, page) => {
    const { container } = renderWithProviders(page)
    await act(async () => {
      await Promise.resolve()
    })

    expect(await a11yViolations(container)).toEqual([])
  })
})
