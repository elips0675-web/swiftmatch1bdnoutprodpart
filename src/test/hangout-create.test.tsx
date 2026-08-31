import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

vi.mock("@/lib/token", () => ({
  getToken: () => "test-token",
}));

const mockUseLanguage = {
  t: (key: string, options?: Record<string, any>) => {
    let value = (mockTranslations as Record<string, string>)[key] || key;
    if (options) {
      Object.entries(options).forEach(([k, v]) => {
        value = value.replace(`{${k}}`, String(v));
      });
    }
    return value;
  },
  language: "RU",
  setLanguage: vi.fn(),
};

const mockTranslations: Record<string, string> = {
  "hangout.form.type": "Тип встречи",
  "hangout.form.type_date_desc": "Личная встреча",
  "hangout.form.type_company_desc": "Групповое мероприятие",
  "hangout.form.category": "Категория",
  "hangout.form.title": "Что планируете?",
  "hangout.form.title_placeholder": "Например: Иду в кино",
  "hangout.form.description": "Описание",
  "hangout.form.place_name": "Место",
  "hangout.form.place_address": "Адрес",
  "hangout.form.city": "Город",
  "hangout.form.date": "Дата и время",
  "hangout.form.max_companions": "Сколько человек ищете",
  "hangout.form.ticket_price": "Цена билета",
  "hangout.form.ticket_capacity": "Лимит билетов",
  "hangout.form.submit": "Создать",
  "hangout.form.required": "Заполните обязательные поля",
  "hangout.form.step_what": "Что",
  "hangout.form.step_where": "Где",
  "hangout.form.step_when": "Когда",
  "hangout.form.step_tickets": "Билеты",
  "hangout.form.back": "Назад",
  "hangout.form.next": "Далее",
  "hangout.form.date_invalid": "Выберите дату в будущем",
  "hangout.category.cinema": "Кино",
  "hangout.type.date": "Свидание",
  "hangout.type.company": "Компания",
};

vi.mock("@/context/language-context", () => ({
  useLanguage: () => mockUseLanguage,
}));

vi.mock("@/context/feature-flags-context", () => ({
  useFeatureFlags: () => ({ partnerOffersEnabled: false, hangoutsEnabled: true }),
}));

vi.mock("@/hooks/use-premium", () => ({
  usePremium: () => ({ isPremium: false }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/components/layout/app-header", () => ({
  AppHeader: () => <div data-testid="app-header" />,
}));

vi.mock("@/components/navigation/bottom-nav", () => ({
  BottomNav: () => <div data-testid="bottom-nav" />,
}));

async function renderPage() {
  const Page = (await import("@/pages/hangout-create")).default;
  return render(
    <MemoryRouter initialEntries={["/hangouts/create"]}>
      <Page />
    </MemoryRouter>,
  );
}

describe("HangoutCreatePage (wizard)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: false, json: () => Promise.resolve({}) });
  });

  it("prefills city from profile and shows only step 0 fields", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ city: "Екатеринбург" }),
    });
    await renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("hangout-title")).toBeTruthy();
    });

    // шаг 0: город/цена скрыты
    expect(screen.getByTestId("hangout-step-what")).toBeTruthy();
    expect(screen.queryByTestId("hangout-price")).toBeNull();
    expect(screen.queryByTestId("hangout-place")).toBeNull();

    // идём на шаг 1 и проверяем, что город предзаполнен из профиля
    fireEvent.change(screen.getByTestId("hangout-title"), { target: { value: "Поход в кино" } });
    fireEvent.click(screen.getByTestId("hangout-wizard-next"));
    await waitFor(() => {
      expect(screen.getByTestId("hangout-place")).toBeTruthy();
    });
    expect((screen.getByTestId("hangout-city") as HTMLInputElement).value).toBe("Екатеринбург");
  });

  it("blocks advance on step 0 when title is empty", async () => {
    await renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("hangout-title")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("hangout-wizard-next"));

    // остаёмся на шаге 0 — title всё ещё виден, поля шага 1 нет
    expect(screen.getByTestId("hangout-title")).toBeTruthy();
    expect(screen.queryByTestId("hangout-place")).toBeNull();
  });

  it("advances through all steps and shows submit on the last", async () => {
    await renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("hangout-title")).toBeTruthy();
    });

    fireEvent.change(screen.getByTestId("hangout-title"), { target: { value: "Поход в кино" } });
    fireEvent.click(screen.getByTestId("hangout-wizard-next"));

    await waitFor(() => {
      expect(screen.getByTestId("hangout-step-where")).toBeTruthy();
      expect(screen.getByTestId("hangout-place")).toBeTruthy();
      expect(screen.getByTestId("hangout-wizard-prev")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("hangout-wizard-next"));
    await waitFor(() => {
      expect(screen.getByTestId("hangout-step-when")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("hangout-wizard-next"));
    await waitFor(() => {
      expect(screen.getByTestId("hangout-step-tickets")).toBeTruthy();
      expect(screen.getByTestId("submit-hangout")).toBeTruthy();
    });

    // на последнем шаге кнопки «Далее» нет, есть «Создать»
    expect(screen.queryByTestId("hangout-wizard-next")).toBeNull();
  });
});
