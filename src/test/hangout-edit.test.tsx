import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import React from "react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

vi.mock("@/lib/token", () => ({
  getToken: () => "test-token",
}));

vi.mock("@/hooks/use-premium", () => ({
  usePremium: () => ({ isPremium: false, tier: null, subscription: null, loading: false, daysRemaining: 0, refresh: vi.fn() }),
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
  "hangout.action.edit": "Редактировать",
  "hangout.edit.only_author": "Редактировать можно только своё активное объявление",
  "hangout.form.title": "Что планируете?",
  "hangout.form.description": "Описание",
  "hangout.form.place_name": "Место",
  "hangout.form.place_address": "Адрес",
  "hangout.form.city": "Город",
  "hangout.form.date": "Дата и время",
  "hangout.form.max_companions": "Сколько человек ищете",
  "hangout.form.required": "Заполните обязательные поля",
  "hangout.toast.updated": "Встреча обновлена!",
  "button.save": "Сохранить",
  "hangout.action.back": "Назад",
};

vi.mock("@/context/language-context", () => ({
  useLanguage: () => mockUseLanguage,
}));

vi.mock("@/components/layout/app-header", () => ({
  AppHeader: () => <div data-testid="app-header" />,
}));

vi.mock("@/components/navigation/bottom-nav", () => ({
  BottomNav: () => <div data-testid="bottom-nav" />,
}));

const ownHangout = {
  id: 7,
  is_author: true,
  status: "active",
  category: "cafe",
  title: "Кофе в центре",
  description: "Ищу компанию",
  place_name: "Аврора",
  place_address: "ул. Ленина, 1",
  city: "Москва",
  event_date: new Date(Date.now() + 86_400_000).toISOString(),
  max_companions: 3,
};

function renderPage(ui: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={["/hangouts/7/edit"]}>
      <Routes>
        <Route path="/hangouts/:id/edit" element={ui} />
        <Route path="/hangouts/:id" element={<div data-testid="detail-page" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("HangoutEditPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it("prefills form for author of active hangout", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(ownHangout) });
    const Page = (await import("@/pages/hangout-edit")).default;

    renderPage(<Page />);

    await waitFor(() => {
      expect((screen.getByTestId("hangout-title") as HTMLInputElement).value).toBe("Кофе в центре");
    });
    expect((screen.getByTestId("hangout-city") as HTMLInputElement).value).toBe("Москва");
    expect(String(screen.getByTestId("hangout-max-companions").textContent)).toContain("3");
  });

  it("submits PUT with edited fields", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(ownHangout) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });
    const Page = (await import("@/pages/hangout-edit")).default;

    renderPage(<Page />);
    await waitFor(() => {
      expect((screen.getByTestId("hangout-title") as HTMLInputElement).value).toBe("Кофе в центре");
    });

    fireEvent.change(screen.getByTestId("hangout-title"), { target: { value: "Новое название" } });
    fireEvent.click(screen.getByTestId("submit-hangout-edit"));

    await waitFor(() => {
      const putCall = mockFetch.mock.calls.find(([url, opts]) => String(url) === "/api/hangouts/7" && opts?.method === "PUT");
      expect(putCall).toBeTruthy();
      const body = JSON.parse(putCall[1].body);
      expect(body.title).toBe("Новое название");
      expect(body.max_companions).toBe(3);
    });

    await waitFor(() => {
      expect(screen.getByTestId("detail-page")).toBeTruthy();
    });
  });

  it("shows forbidden state for non-author", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ...ownHangout, is_author: false }),
    });
    const Page = (await import("@/pages/hangout-edit")).default;

    renderPage(<Page />);

    await waitFor(() => {
      expect(screen.getByTestId("edit-forbidden")).toBeTruthy();
    });
  });

  it("shows forbidden state for cancelled hangout", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ...ownHangout, status: "cancelled" }),
    });
    const Page = (await import("@/pages/hangout-edit")).default;

    renderPage(<Page />);

    await waitFor(() => {
      expect(screen.getByTestId("edit-forbidden")).toBeTruthy();
    });
  });
});
