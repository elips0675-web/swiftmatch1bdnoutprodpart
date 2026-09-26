import { describe, it, expect, beforeEach, afterEach } from "vitest"
import type { ReactNode } from "react"
import { renderHook, act } from "@testing-library/react"
import { LanguageProvider, useLanguage, translations } from "@/context/language-context"

function wrapper({ children }: { children: ReactNode }) {
  return <LanguageProvider>{children}</LanguageProvider>
}

function renderLanguage() {
  return renderHook(() => useLanguage(), { wrapper })
}

describe("useLanguage: реальный LanguageProvider", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it("по умолчанию RU и возвращает перевод из блока RU", () => {
    const { result } = renderLanguage()
    expect(result.current.language).toBe("RU")
    expect(result.current.t("nav.home")).toBe(translations.RU["nav.home"])
  })

  it("переключение на EN отдаёт английский вариант того же ключа", () => {
    const { result } = renderLanguage()
    expect(result.current.t("nav.home")).toBe(translations.RU["nav.home"])

    act(() => {
      result.current.setLanguage("EN")
    })

    expect(result.current.language).toBe("EN")
    expect(result.current.t("nav.home")).toBe(translations.EN["nav.home"])
    expect(result.current.t("nav.home")).not.toBe(translations.RU["nav.home"])
  })

  it("подставляет плейсхолдеры из options", () => {
    const { result } = renderLanguage()
    const ru = result.current.t("invite.title", { name: "Анна" })
    const en = result.current.t("invite.title", { name: "Anna" })
    expect(ru).toContain("Анна")
    expect(ru).not.toContain("{name}")
    expect(en).toContain("Anna")
    expect(en).not.toContain("{name}")
  })

  it("неизвестный ключ возвращает сам ключ (это ловит i18n-parity.test.ts)", () => {
    const { result } = renderLanguage()
    expect(result.current.t("no.such.key")).toBe("no.such.key")
  })

  it("setLanguage сохраняет выбор в localStorage", () => {
    const { result } = renderLanguage()
    act(() => {
      result.current.setLanguage("EN")
    })
    expect(localStorage.getItem("app_lang")).toBe("EN")
  })

  it("useLanguage вне провайдера бросает понятную ошибку", () => {
    expect(() => renderHook(() => useLanguage())).toThrow(/useLanguage must be used within LanguageProvider/)
  })
})
