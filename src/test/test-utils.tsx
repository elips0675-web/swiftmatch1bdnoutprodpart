import { type ReactNode } from "react"
import { render, type RenderOptions } from "@testing-library/react"
import { BrowserRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { vi } from "vitest"

vi.mock("@/context/language-context", () => ({
  useLanguage: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "auth.tagline": "Найди свою идеальную пару",
        "auth.continue": "Продолжить",
        "auth.logging_in": "Вход...",
        "auth.phone_tab": "ТЕЛЕФОН",
        "auth.forgot_password": "Забыли пароль?",
        "auth.or": "ИЛИ",
        "auth.google_login": "Войти с Google",
        "auth.no_account": "Нет аккаунта?",
        "auth.register_link": "ЗАРЕГИСТРИРОВАТЬСЯ",
        "auth.demo_onboarding": "ДЕМО-ОНБОРДИНГ",
        "auth.private": "100% ПРИВАТНОСТЬ",
        "auth.login_error": "Ошибка входа",
        "auth.login_error_desc": "Проверьте email и пароль",
        "auth.network_error": "Ошибка сети",
        "auth.network_error_desc": "Проверьте подключение",
        "auth.welcome_back": "С возвращением!",
        "auth.welcome_back_desc": "Рады видеть вас снова",
        "auth.password_placeholder": "Пароль",
        "auth.phone_coming_soon": "Скоро",
        "auth.phone_coming_soon_desc": "Вход по телефону будет доступен позже",
        "auth.login_link": "ВОЙТИ",
        "auth.google_unavailable": "Вход через Google недоступен",
        "auth.google_login_error": "Ошибка входа через Google",
        "auth.totp_required": "Введите код двухфакторной аутентификации",
        "auth.totp_invalid": "Неверный код двухфакторной аутентификации",
        "auth.too_many_attempts": "Слишком много попыток входа — попробуйте позже",
        "button.go_home": "НА ГЛАВНУЮ",
        "register.tagline": "Создайте аккаунт",
        "register.name_placeholder": "Имя",
        "register.password_placeholder": "Пароль (мин. 8 символов)",
        "register.create_account": "СОЗДАТЬ АККАУНТ",
        "register.creating": "СОЗДАНИЕ...",
        "register.has_account": "Уже есть аккаунт?",
        "register.account_created": "Аккаунт создан",
        "register.registration_error": "Ошибка регистрации",
        "register.create_account_failed": "Не удалось создать аккаунт",
        "register.invalid_email": "Неверный email",
        "register.password_length": "Пароль должен быть минимум 8 символов",
        "register.name_required": "Имя обязательно",
        "register.consent_required": "Необходимо согласие на обработку персональных данных",
        "register.consent_label": "Я соглашаюсь на обработку моих персональных данных согласно",
        "register.consent_doc": "документу об обработке данных",
        "register.consent_privacy": "Политике конфиденциальности",
        "register.consent_terms": "Пользовательскому соглашению",
        "register.age_label": "Мне есть 18 лет или больше",
        "register.age_required": "Подтвердите, что вам есть 18 лет",
        "register.safe": "ВАШИ ДАННЫЕ В БЕЗОПАСНОСТИ",
        "common.error": "Ошибка",
        "common.success": "Успешно",
      }
      return map[key] || key
    },
    language: "RU",
    setLanguage: vi.fn(),
  }),
  LanguageProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: 0 } },
})

interface WrapperOptions {
  initialEntries?: string[]
}

export function renderWithProviders(
  ui: ReactNode,
  options?: RenderOptions & WrapperOptions,
) {
  const { initialEntries = ["/"], ...renderOptions } = options || {}

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          {children}
        </BrowserRouter>
      </QueryClientProvider>
    )
  }

  return render(ui, { wrapper: Wrapper, ...renderOptions })
}
