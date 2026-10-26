import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

const h = vi.hoisted(() => ({
  language: "RU" as "RU" | "EN",
}));

vi.mock("@/context/language-context", () => ({
  useLanguage: () => ({ t: (key: string) => key, language: h.language, setLanguage: vi.fn() }),
}));

vi.mock("@/components/layout/app-header", () => ({
  AppHeader: () => <header data-testid="app-header" />,
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <div data-testid="scroll-area" className={className}>
      {children}
    </div>
  ),
}));

import PrivacyPolicyPage from "@/pages/legal-privacy";
import TermsOfServicePage from "@/pages/legal-terms";
import DataProcessingConsentPage from "@/pages/legal-data-processing";

function headings() {
  return Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6")).map((el) => ({
    level: Number(el.tagName.slice(1)),
    text: el.textContent ?? "",
  }));
}

function renderPage(page: React.ReactElement) {
  return render(page);
}

beforeEach(() => {
  h.language = "RU";
});

describe("Правовые страницы: общая оболочка", () => {
  it.each([
    ["политика конфиденциальности", <PrivacyPolicyPage key="privacy" />],
    ["пользовательское соглашение", <TermsOfServicePage key="terms" />],
    ["согласие на обработку данных", <DataProcessingConsentPage key="data" />],
  ])("%s рисует шапку и прокручиваемую область", (_name, page) => {
    renderPage(page);

    expect(screen.getByTestId("app-header")).toBeTruthy();
    expect(screen.getByTestId("scroll-area")).toBeTruthy();
    expect(document.querySelector("main")).toBeTruthy();
  });

  it.each([
    ["политика конфиденциальности", <PrivacyPolicyPage key="privacy" />],
    ["пользовательское соглашение", <TermsOfServicePage key="terms" />],
    ["согласие на обработку данных", <DataProcessingConsentPage key="data" />],
  ])("%s держит один h1 и не прыгает через уровень", (_name, page) => {
    renderPage(page);

    const list = headings();
    expect(list.filter((item) => item.level === 1)).toHaveLength(1);
    expect(list[0].level).toBe(1);
    expect(list.some((item) => item.level > 2)).toBe(false);
    expect(list.filter((item) => item.level === 2).length).toBeGreaterThan(0);
  });
});

describe("Политика конфиденциальности", () => {
  it("по-русски показывает заголовок, дату и пять разделов", () => {
    renderPage(<PrivacyPolicyPage />);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Политика конфиденциальности");
    expect(screen.getByText("Последнее обновление: 7 марта 2024")).toBeTruthy();
    expect(screen.getByText("1. Общие положения")).toBeTruthy();
    expect(screen.getByText("5. Хранение и удаление")).toBeTruthy();
    expect(headings().filter((item) => item.level === 2)).toHaveLength(5);
  });

  it("по-английски переводит заголовок, дату и разделы", () => {
    h.language = "EN";
    renderPage(<PrivacyPolicyPage />);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Privacy Policy");
    expect(screen.getByText("Last Updated: March 7, 2024")).toBeTruthy();
    expect(screen.getByText("1. General Provisions")).toBeTruthy();
    expect(screen.getByText("5. Storage and Deletion")).toBeTruthy();
    expect(screen.queryByText("Политика конфиденциальности")).toBeNull();
    expect(screen.queryByText("1. Общие положения")).toBeNull();
  });

  it("перечисляет собираемые данные списком", () => {
    renderPage(<PrivacyPolicyPage />);

    expect(screen.getByText("Данные о местоположении для поиска людей рядом;")).toBeTruthy();
    expect(document.querySelectorAll("li").length).toBe(8);
    expect(document.querySelectorAll("ul").length).toBe(2);
  });
});

describe("Пользовательское соглашение", () => {
  it("по-русски показывает заголовок, дату и пять разделов", () => {
    renderPage(<TermsOfServicePage />);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Пользовательское соглашение");
    expect(screen.getByText("Последнее обновление: 7 марта 2024")).toBeTruthy();
    expect(screen.getByText("1. Принятие условий")).toBeTruthy();
    expect(screen.getByText("5. Отказ от ответственности")).toBeTruthy();
    expect(headings().filter((item) => item.level === 2)).toHaveLength(5);
  });

  it("по-английски переводит заголовок, дату и разделы", () => {
    h.language = "EN";
    renderPage(<TermsOfServicePage />);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Terms of Service");
    expect(screen.getByText("Last Updated: March 7, 2024")).toBeTruthy();
    expect(screen.getByText("1. Acceptance of Terms")).toBeTruthy();
    expect(screen.getByText("5. Disclaimer")).toBeTruthy();
    expect(screen.queryByText("Пользовательское соглашение")).toBeNull();
  });

  it("держит возрастное ограничение 18 лет и запреты списком", () => {
    renderPage(<TermsOfServicePage />);

    expect(screen.getByText(/не менее 18 лет/)).toBeTruthy();
    expect(document.querySelectorAll("li").length).toBe(4);
    expect(screen.getByText("Размещать контент сексуального характера;")).toBeTruthy();
  });
});

describe("Согласие на обработку данных", () => {
  it("по-русски показывает заголовок, соответствие законам и три раздела", () => {
    renderPage(<DataProcessingConsentPage />);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Согласие на обработку данных");
    expect(screen.getByText("Соответствие 152-ФЗ и GDPR")).toBeTruthy();
    expect(screen.getByText("Что мы обрабатываем:")).toBeTruthy();
    expect(screen.getByText("Ваши права:")).toBeTruthy();
    expect(headings().filter((item) => item.level === 2)).toHaveLength(3);
  });

  it("по-английски переводит заголовок и разделы", () => {
    h.language = "EN";
    renderPage(<DataProcessingConsentPage />);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Data Processing Consent");
    expect(screen.getByText("GDPR & 152-FZ Compliance")).toBeTruthy();
    expect(screen.getByText("What we process:")).toBeTruthy();
    expect(screen.getByText("Your rights:")).toBeTruthy();
    expect(screen.queryByText("Согласие на обработку данных")).toBeNull();
  });

  it("начинается с согласия перед разделами и перечисляет данные", () => {
    renderPage(<DataProcessingConsentPage />);

    const firstParagraph = document.querySelector('[data-testid="scroll-area"] p');
    expect(firstParagraph?.textContent).toContain("Нажимая кнопку «Продолжить»");
    expect(document.querySelectorAll("li").length).toBe(4);
  });
});
