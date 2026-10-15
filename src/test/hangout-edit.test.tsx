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
  "hangout.series.title": "Серия встреч",
  "hangout.series.hint": "Объедините повторяющиеся встречи в серию",
  "hangout.series.none": "Без серии",
  "hangout.series.new": "Новая серия",
  "hangout.series.name_placeholder": "Название серии",
  "hangout.series.create": "Создать серию",
  "hangout.series.create_error": "Не удалось создать серию",
  "hangout.series.save_error": "Не удалось обновить серию",
  "hangout.series.saved": "Серия обновлена",
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

  function primeFetch(overrides: { hangout?: Record<string, unknown>; series?: unknown[] } = {}) {
    const hangout = overrides.hangout ?? ownHangout;
    const series = overrides.series ?? [];
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u === "/api/hangouts/series") {
        if (init?.method === "POST") {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 42, title: "Новая" }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve(series) });
      }
      if (u.endsWith("/series")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      if (init?.method === "PUT" && u === "/api/hangouts/7") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(hangout) });
    });
  }

  it("prefills form for author of active hangout", async () => {
    primeFetch();
    const Page = (await import("@/pages/hangout-edit")).default;

    renderPage(<Page />);

    await waitFor(() => {
      expect((screen.getByTestId("hangout-title") as HTMLInputElement).value).toBe("Кофе в центре");
    });
    expect((screen.getByTestId("hangout-city") as HTMLInputElement).value).toBe("Москва");
    expect(String(screen.getByTestId("hangout-max-companions").textContent)).toContain("3");
  });

  it("submits PUT with edited fields", async () => {
    primeFetch();
    const Page = (await import("@/pages/hangout-edit")).default;

    renderPage(<Page />);
    await waitFor(() => {
      expect((screen.getByTestId("hangout-title") as HTMLInputElement).value).toBe("Кофе в центре");
    });

    fireEvent.change(screen.getByTestId("hangout-title"), { target: { value: "Новое название" } });
    fireEvent.click(screen.getByTestId("submit-hangout-edit"));

    await waitFor(() => {
      const putCall = mockFetch.mock.calls.find(([url, opts]) => String(url) === "/api/hangouts/7" && opts?.method === "PUT");
      if (!putCall) throw new Error("PUT call not found");
      const body = JSON.parse(putCall[1].body);
      expect(body.title).toBe("Новое название");
      expect(body.max_companions).toBe(3);
    });

    await waitFor(() => {
      expect(screen.getByTestId("detail-page")).toBeTruthy();
    });
  });

  it("shows forbidden state for non-author", async () => {
    primeFetch({ hangout: { ...ownHangout, is_author: false } });
    const Page = (await import("@/pages/hangout-edit")).default;

    renderPage(<Page />);

    await waitFor(() => {
      expect(screen.getByTestId("edit-forbidden")).toBeTruthy();
    });
  });

  it("shows forbidden state for cancelled hangout", async () => {
    primeFetch({ hangout: { ...ownHangout, status: "cancelled" } });
    const Page = (await import("@/pages/hangout-edit")).default;

    renderPage(<Page />);

    await waitFor(() => {
      expect(screen.getByTestId("edit-forbidden")).toBeTruthy();
    });
  });

  it("attaches an existing own series via PUT /api/hangouts/:id/series", async () => {
    primeFetch({ series: [{ id: 3, title: "Кофейные пятницы", hangout_count: 2 }] });
    const Page = (await import("@/pages/hangout-edit")).default;

    renderPage(<Page />);
    const attach = await screen.findByTestId("attach-series-3");
    fireEvent.click(attach);

    await waitFor(() => {
      const putCall = mockFetch.mock.calls.find(
        ([url, opts]) => String(url) === "/api/hangouts/7/series" && opts?.method === "PUT",
      );
      if (!putCall) throw new Error("PUT series call not found");
      expect(JSON.parse(putCall[1].body)).toEqual({ series_id: 3 });
    });
    await waitFor(() => {
      expect(screen.getByTestId("detach-series")).toBeTruthy();
    });
  });

  it("creates a series and attaches the hangout to it", async () => {
    primeFetch();
    const Page = (await import("@/pages/hangout-edit")).default;

    renderPage(<Page />);
    fireEvent.click(await screen.findByTestId("open-new-series"));
    fireEvent.change(screen.getByTestId("new-series-title"), { target: { value: "Киновечера" } });
    fireEvent.click(screen.getByTestId("create-series"));

    await waitFor(() => {
      const postCall = mockFetch.mock.calls.find(
        ([url, opts]) => String(url) === "/api/hangouts/series" && opts?.method === "POST",
      );
      if (!postCall) throw new Error("POST series call not found");
      expect(JSON.parse(postCall[1].body)).toEqual({ title: "Киновечера" });
    });
    await waitFor(() => {
      const putCall = mockFetch.mock.calls.find(
        ([url, opts]) => String(url) === "/api/hangouts/7/series" && opts?.method === "PUT",
      );
      if (!putCall) throw new Error("PUT series call not found");
      expect(JSON.parse(putCall[1].body)).toEqual({ series_id: 42 });
    });
  });

  it("detaches the hangout from its series", async () => {
    primeFetch({
      hangout: { ...ownHangout, series_id: 3 },
      series: [{ id: 3, title: "Кофейные пятницы" }],
    });
    const Page = (await import("@/pages/hangout-edit")).default;

    renderPage(<Page />);
    const detach = await screen.findByTestId("detach-series");
    fireEvent.click(detach);

    await waitFor(() => {
      const putCall = mockFetch.mock.calls.find(
        ([url, opts]) => String(url) === "/api/hangouts/7/series" && opts?.method === "PUT",
      );
      if (!putCall) throw new Error("PUT series call not found");
      expect(JSON.parse(putCall[1].body)).toEqual({ series_id: null });
    });
  });
});
