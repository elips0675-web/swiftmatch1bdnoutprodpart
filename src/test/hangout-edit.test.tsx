import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import React from "react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

const tokenState = vi.hoisted(() => ({ value: "test-token" as string | null }));

vi.mock("@/lib/token", () => ({
  getToken: () => tokenState.value,
}));

const premiumState = vi.hoisted(() => ({ isPremium: false }));

vi.mock("@/hooks/use-premium", () => ({
  usePremium: () => ({ isPremium: premiumState.isPremium, tier: null, subscription: null, loading: false, daysRemaining: 0, refresh: vi.fn() }),
}));

const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock("sonner", () => ({ toast: toastMock }));

const mockUseLanguage = {
  t: (key: string, options?: Record<string, unknown>) => {
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
  "hangout.edit.load_error": "Не удалось загрузить встречу",
  "hangout.edit.retry": "Повторить",
  "hangout.form.title": "Что планируете?",
  "hangout.form.description": "Описание",
  "hangout.form.place_name": "Место",
  "hangout.form.place_address": "Адрес",
  "hangout.form.city": "Город",
  "hangout.form.date": "Дата и время",
  "hangout.form.max_companions": "Сколько человек ищете",
  "hangout.form.required": "Заполните обязательные поля",
  "hangout.toast.updated": "Встреча обновлена!",
  "hangout.error.save": "Не удалось сохранить встречу — попробуйте ещё раз",
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

vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: { value?: string; onValueChange?: (value: string) => void; children?: React.ReactNode }) => (
    <select value={value || ""} onChange={(event) => onValueChange?.(event.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: ({ placeholder }: { placeholder?: string }) =>
    placeholder ? <option value="" disabled>{placeholder}</option> : null,
  SelectContent: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children?: React.ReactNode }) => <option value={value}>{children}</option>,
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

type PrimeOptions = {
  hangout?: Record<string, unknown>;
  series?: unknown;
  loadStatus?: number;
  putStatus?: number;
  seriesPutStatus?: number;
  seriesPostStatus?: number;
  createSeries?: unknown;
};

function renderPage(ui: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={["/hangouts/7/edit"]}>
      <Routes>
        <Route path="/hangouts/:id/edit" element={ui} />
        <Route path="/hangouts/:id" element={<div data-testid="detail-page" />} />
        <Route path="/login" element={<div data-testid="login-page" />} />
      </Routes>
    </MemoryRouter>,
  );
}

const ok = (body: unknown) => ({ ok: true, json: () => Promise.resolve(body) });
const fail = (status = 500) => ({ ok: false, status, json: () => Promise.resolve({}) });

describe("HangoutEditPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    tokenState.value = "test-token";
    premiumState.isPremium = false;
  });

  function primeFetch(overrides: PrimeOptions = {}) {
    const hangout = overrides.hangout ?? ownHangout;
    const series = overrides.series ?? [];
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u === "/api/hangouts/series") {
        if (init?.method === "POST") {
          if (overrides.seriesPostStatus && overrides.seriesPostStatus >= 400) {
            return Promise.resolve(fail(overrides.seriesPostStatus));
          }
          return Promise.resolve(ok(overrides.createSeries ?? { id: 42, title: "Новая" }));
        }
        return Promise.resolve(ok(series));
      }
      if (u.endsWith("/series")) {
        return Promise.resolve(overrides.seriesPutStatus && overrides.seriesPutStatus >= 400 ? fail(overrides.seriesPutStatus) : ok({}));
      }
      if (init?.method === "PUT" && u === "/api/hangouts/7") {
        return Promise.resolve(overrides.putStatus && overrides.putStatus >= 400 ? fail(overrides.putStatus) : ok({}));
      }
      return Promise.resolve(overrides.loadStatus && overrides.loadStatus >= 400 ? fail(overrides.loadStatus) : ok(hangout));
    });
  }

  const loadPage = async () => {
    const Page = (await import("@/pages/hangout-edit")).default;
    renderPage(<Page />);
  };

  it("prefills form for author of active hangout", async () => {
    primeFetch();
    await loadPage();

    await waitFor(() => {
      expect((screen.getByTestId("hangout-title") as HTMLInputElement).value).toBe("Кофе в центре");
    });
    expect((screen.getByTestId("hangout-city") as HTMLInputElement).value).toBe("Москва");
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("3");
  });

  it("submits PUT with edited fields", async () => {
    primeFetch();
    await loadPage();
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
    expect(toastMock.success).toHaveBeenCalledWith("Встреча обновлена!");
  });

  it("shows forbidden state for non-author", async () => {
    primeFetch({ hangout: { ...ownHangout, is_author: false } });
    await loadPage();

    await waitFor(() => {
      expect(screen.getByTestId("edit-forbidden")).toBeTruthy();
    });
  });

  it("shows forbidden state for cancelled hangout", async () => {
    primeFetch({ hangout: { ...ownHangout, status: "cancelled" } });
    await loadPage();

    await waitFor(() => {
      expect(screen.getByTestId("edit-forbidden")).toBeTruthy();
    });
  });

  it("отправляет изменённые описание, место, адрес, город, дату, цену и вместимость", async () => {
    primeFetch();
    await loadPage();
    await waitFor(() => {
      expect((screen.getByTestId("hangout-title") as HTMLInputElement).value).toBe("Кофе в центре");
    });

    fireEvent.change(screen.getByTestId("hangout-description"), { target: { value: "  Новое описание  " } });
    fireEvent.change(screen.getByTestId("hangout-place"), { target: { value: "  Новая кофейня  " } });
    fireEvent.change(screen.getByTestId("hangout-address"), { target: { value: "  ул. Мира, 7  " } });
    fireEvent.change(screen.getByTestId("hangout-city"), { target: { value: "  Казань  " } });
    fireEvent.change(screen.getByTestId("hangout-date"), { target: { value: "2026-12-01T18:30" } });
    fireEvent.change(screen.getByTestId("hangout-price"), { target: { value: "750" } });
    fireEvent.change(screen.getByTestId("hangout-capacity"), { target: { value: "15" } });
    fireEvent.click(screen.getByTestId("submit-hangout-edit"));

    await waitFor(() => {
      const putCall = mockFetch.mock.calls.find(([url, opts]) => String(url) === "/api/hangouts/7" && opts?.method === "PUT");
      if (!putCall) throw new Error("PUT call not found");
      const body = JSON.parse(putCall[1].body);
      expect(body.description).toBe("Новое описание");
      expect(body.place_name).toBe("Новая кофейня");
      expect(body.place_address).toBe("ул. Мира, 7");
      expect(body.city).toBe("Казань");
      expect(body.event_date).toBe(new Date("2026-12-01T18:30").toISOString());
      expect(body.price).toBe(750);
      expect(body.capacity).toBe(15);
    });
    expect(screen.getByTestId("detail-page")).toBeTruthy();
  });

  it("отправляет null вместо цены и вместимости, если поля очищены", async () => {
    primeFetch({ hangout: { ...ownHangout, price: 500, capacity: 12 } });
    await loadPage();
    await waitFor(() => {
      expect((screen.getByTestId("hangout-price") as HTMLInputElement).value).toBe("500");
    });

    fireEvent.change(screen.getByTestId("hangout-price"), { target: { value: "" } });
    fireEvent.change(screen.getByTestId("hangout-capacity"), { target: { value: "" } });
    fireEvent.change(screen.getByTestId("hangout-description"), { target: { value: "   " } });
    fireEvent.change(screen.getByTestId("hangout-city"), { target: { value: "   " } });
    fireEvent.change(screen.getByTestId("hangout-place"), { target: { value: "   " } });
    fireEvent.change(screen.getByTestId("hangout-address"), { target: { value: "   " } });
    fireEvent.click(screen.getByTestId("submit-hangout-edit"));

    await waitFor(() => {
      const putCall = mockFetch.mock.calls.find(([url, opts]) => String(url) === "/api/hangouts/7" && opts?.method === "PUT");
      if (!putCall) throw new Error("PUT call not found");
      const body = JSON.parse(putCall[1].body);
      expect(body.price).toBeNull();
      expect(body.capacity).toBeNull();
      expect(body.description).toBeUndefined();
      expect(body.city).toBeUndefined();
    });
  });

  it("не падает, если список серий падает сетевым сбоем", async () => {
    mockFetch.mockImplementation((url: string) => {
      const u = String(url);
      if (u === "/api/hangouts/series") return Promise.reject(new Error("network down"));
      return Promise.resolve(ok(ownHangout));
    });
    await loadPage();
    await waitFor(() => {
      expect((screen.getByTestId("hangout-title") as HTMLInputElement).value).toBe("Кофе в центре");
    });
    expect(screen.getByTestId("open-new-series")).toBeTruthy();
  });

  it("меняет число спутников и отправляет выбранное значение", async () => {
    primeFetch();
    await loadPage();
    await waitFor(() => {
      expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("3");
    });

    const options = Array.from((screen.getByRole("combobox") as HTMLSelectElement).options).map((o) => o.value);
    expect(options).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "10" } });
    fireEvent.click(screen.getByTestId("submit-hangout-edit"));

    await waitFor(() => {
      const putCall = mockFetch.mock.calls.find(([url, opts]) => String(url) === "/api/hangouts/7" && opts?.method === "PUT");
      if (!putCall) throw new Error("PUT call not found");
      expect(JSON.parse(putCall[1].body).max_companions).toBe(10);
    });
  });

  it("подставляет одного спутника, если в ответе null", async () => {
    primeFetch({ hangout: { ...ownHangout, max_companions: null } });
    await loadPage();
    await waitFor(() => {
      expect(screen.getByTestId("submit-hangout-edit")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("submit-hangout-edit"));

    await waitFor(() => {
      const putCall = mockFetch.mock.calls.find(([url, opts]) => String(url) === "/api/hangouts/7" && opts?.method === "PUT");
      if (!putCall) throw new Error("PUT call not found");
      expect(JSON.parse(putCall[1].body).max_companions).toBe(1);
    });
  });

  it("не обновляет состояние после размонтирования во время загрузки", async () => {
    let resolveHangout: (value: unknown) => void = () => undefined;
    mockFetch.mockImplementation((url: string) => {
      const u = String(url);
      if (u === "/api/hangouts/series") return Promise.resolve(ok([]));
      return new Promise((resolve) => {
        resolveHangout = resolve;
      });
    });

    const Page = (await import("@/pages/hangout-edit")).default;
    const { unmount } = renderPage(<Page />);
    unmount();
    resolveHangout(ok(ownHangout));
    await Promise.resolve();

    expect(screen.queryByTestId("hangout-title")).toBeNull();
    expect(screen.queryByTestId("edit-load-error")).toBeNull();
  });

  it("показывает ошибку загрузки вместо «только автор» и повторяет запрос", async () => {
    let attempts = 0;
    mockFetch.mockImplementation((url: string) => {
      const u = String(url);
      if (u === "/api/hangouts/series") return Promise.resolve(ok([]));
      attempts += 1;
      return Promise.resolve(attempts === 1 ? fail(500) : ok(ownHangout));
    });

    await loadPage();

    await waitFor(() => {
      expect(screen.getByTestId("edit-load-error")).toBeTruthy();
    });
    expect(screen.queryByTestId("edit-forbidden")).toBeNull();
    expect(screen.queryByTestId("submit-hangout-edit")).toBeNull();
    expect(screen.getByText("Не удалось загрузить встречу")).toBeTruthy();

    fireEvent.click(screen.getByTestId("edit-retry"));

    await waitFor(() => {
      expect((screen.getByTestId("hangout-title") as HTMLInputElement).value).toBe("Кофе в центре");
    });
    expect(screen.queryByTestId("edit-load-error")).toBeNull();
  });

  it("показывает ошибку загрузки при сетевом сбое", async () => {
    mockFetch.mockImplementation((url: string) => {
      const u = String(url);
      if (u === "/api/hangouts/series") return Promise.resolve(ok([]));
      return Promise.reject(new Error("network down"));
    });

    await loadPage();

    await waitFor(() => {
      expect(screen.getByTestId("edit-load-error")).toBeTruthy();
    });
    expect(screen.queryByTestId("edit-forbidden")).toBeNull();
  });

  it("уводит на вход, если токена нет при загрузке", async () => {
    tokenState.value = null;
    primeFetch();
    await loadPage();

    await waitFor(() => {
      expect(screen.getByTestId("login-page")).toBeTruthy();
    });
  });

  it("не отправляет форму без названия и даты", async () => {
    primeFetch({ hangout: { ...ownHangout, title: "", event_date: null } });
    await loadPage();
    await waitFor(() => {
      expect(screen.getByTestId("submit-hangout-edit")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("submit-hangout-edit"));

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith("Заполните обязательные поля");
    });
    expect(mockFetch.mock.calls.find(([, opts]) => opts?.method === "PUT")).toBeUndefined();
  });

  it("показывает ошибку сохранения, а не загрузки", async () => {
    primeFetch({ putStatus: 500 });
    await loadPage();
    await waitFor(() => {
      expect((screen.getByTestId("hangout-title") as HTMLInputElement).value).toBe("Кофе в центре");
    });

    fireEvent.click(screen.getByTestId("submit-hangout-edit"));

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith("Не удалось сохранить встречу — попробуйте ещё раз");
    });
    expect(toastMock.error).not.toHaveBeenCalledWith("hangout.error.load");
    expect(screen.getByTestId("submit-hangout-edit")).toBeTruthy();
  });

  it("уводит на вход, если токена нет при сохранении", async () => {
    primeFetch();
    await loadPage();
    await waitFor(() => {
      expect((screen.getByTestId("hangout-title") as HTMLInputElement).value).toBe("Кофе в центре");
    });

    tokenState.value = null;
    fireEvent.click(screen.getByTestId("submit-hangout-edit"));

    await waitFor(() => {
      expect(screen.getByTestId("login-page")).toBeTruthy();
    });
  });

  it("оставляет поля пустыми, если в ответе null и битая дата", async () => {
    primeFetch({
      hangout: {
        ...ownHangout,
        title: null,
        description: null,
        place_name: null,
        place_address: null,
        city: null,
        event_date: "не дата",
        price: null,
        capacity: null,
        series_id: null,
      },
    });
    await loadPage();
    await waitFor(() => {
      expect(screen.getByTestId("hangout-title")).toBeTruthy();
    });

    expect((screen.getByTestId("hangout-title") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("hangout-description") as HTMLTextAreaElement).value).toBe("");
    expect((screen.getByTestId("hangout-place") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("hangout-address") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("hangout-city") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("hangout-date") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("hangout-price") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("hangout-capacity") as HTMLInputElement).value).toBe("");
    expect(screen.getByTestId("current-series").textContent).toBe("Без серии");
  });

  it("показывает цену и вместимость из ответа", async () => {
    primeFetch({ hangout: { ...ownHangout, price: 500, capacity: 12 } });
    await loadPage();
    await waitFor(() => {
      expect((screen.getByTestId("hangout-price") as HTMLInputElement).value).toBe("500");
    });
    expect((screen.getByTestId("hangout-capacity") as HTMLInputElement).value).toBe("12");
  });

  it("скрывает подсказку о Premium для премиум-пользователя", async () => {
    premiumState.isPremium = true;
    primeFetch();
    await loadPage();
    await waitFor(() => {
      expect((screen.getByTestId("hangout-title") as HTMLInputElement).value).toBe("Кофе в центре");
    });
    expect(screen.queryByText("hangout.form.companions_premium_hint")).toBeNull();
    expect((screen.getByRole("combobox") as HTMLSelectElement).options).toHaveLength(20);
  });

  it("показывает подсказку о Premium для обычного пользователя", async () => {
    premiumState.isPremium = false;
    primeFetch();
    await loadPage();
    await waitFor(() => {
      expect((screen.getByTestId("hangout-title") as HTMLInputElement).value).toBe("Кофе в центре");
    });
    expect(screen.getByText("hangout.form.companions_premium_hint")).toBeTruthy();
  });

  it("не падает на не-массиве серий", async () => {
    primeFetch({ series: { rows: [] } });
    await loadPage();
    await waitFor(() => {
      expect((screen.getByTestId("hangout-title") as HTMLInputElement).value).toBe("Кофе в центре");
    });
    expect(screen.queryByTestId("attach-series-3")).toBeNull();
    expect(screen.getByTestId("current-series").textContent).toBe("Без серии");
  });

  it("не падает, если список серий недоступен", async () => {
    mockFetch.mockImplementation((url: string) => {
      const u = String(url);
      if (u === "/api/hangouts/series") return Promise.resolve(fail(500));
      return Promise.resolve(ok(ownHangout));
    });
    await loadPage();
    await waitFor(() => {
      expect((screen.getByTestId("hangout-title") as HTMLInputElement).value).toBe("Кофе в центре");
    });
    expect(screen.getByTestId("open-new-series")).toBeTruthy();
  });

  it("не создаёт серию без id в ответе", async () => {
    primeFetch({ createSeries: {} });
    await loadPage();
    fireEvent.click(await screen.findByTestId("open-new-series"));
    fireEvent.change(screen.getByTestId("new-series-title"), { target: { value: "Киновечера" } });
    fireEvent.click(screen.getByTestId("create-series"));

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith("Не удалось создать серию");
    });
    expect(mockFetch.mock.calls.find(([url, opts]) => String(url) === "/api/hangouts/7/series" && opts?.method === "PUT")).toBeUndefined();
  });

  it("не создаёт серию с пустым названием", async () => {
    primeFetch();
    await loadPage();
    fireEvent.click(await screen.findByTestId("open-new-series"));
    fireEvent.change(screen.getByTestId("new-series-title"), { target: { value: "   " } });
    fireEvent.click(screen.getByTestId("create-series"));

    expect(mockFetch.mock.calls.find(([url, opts]) => String(url) === "/api/hangouts/series" && opts?.method === "POST")).toBeUndefined();
  });

  it("показывает ошибку создания серии при отказе сервера", async () => {
    primeFetch({ seriesPostStatus: 500 });
    await loadPage();
    fireEvent.click(await screen.findByTestId("open-new-series"));
    fireEvent.change(screen.getByTestId("new-series-title"), { target: { value: "Киновечера" } });
    fireEvent.click(screen.getByTestId("create-series"));

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith("Не удалось создать серию");
    });
    expect(mockFetch.mock.calls.find(([url, opts]) => String(url) === "/api/hangouts/7/series" && opts?.method === "PUT")).toBeUndefined();
  });

  it("уводит на вход, если токена нет при привязке серии", async () => {
    primeFetch({ series: [{ id: 3, title: "Кофейные пятницы" }] });
    await loadPage();
    const attach = await screen.findByTestId("attach-series-3");

    tokenState.value = null;
    fireEvent.click(attach);

    await waitFor(() => {
      expect(screen.getByTestId("login-page")).toBeTruthy();
    });
    expect(mockFetch.mock.calls.find(([url, opts]) => String(url) === "/api/hangouts/7/series" && opts?.method === "PUT")).toBeUndefined();
  });

  it("показывает ошибку сохранения серии", async () => {
    primeFetch({ series: [{ id: 3, title: "Кофейные пятницы" }], seriesPutStatus: 500 });
    await loadPage();
    fireEvent.click(await screen.findByTestId("attach-series-3"));

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith("Не удалось обновить серию");
    });
    expect(screen.queryByTestId("detach-series")).toBeNull();
  });

  it("уводит на вход, если токена нет при создании серии", async () => {
    primeFetch();
    await loadPage();
    fireEvent.click(await screen.findByTestId("open-new-series"));
    fireEvent.change(screen.getByTestId("new-series-title"), { target: { value: "Киновечера" } });

    tokenState.value = null;
    fireEvent.click(screen.getByTestId("create-series"));

    await waitFor(() => {
      expect(screen.getByTestId("login-page")).toBeTruthy();
    });
  });

  it("аттачит существующую серию и показывает её название", async () => {
    primeFetch({ series: [{ id: 3, title: "Кофейные пятницы", hangout_count: 2 }] });
    await loadPage();
    const attach = await screen.findByTestId("attach-series-3");
    fireEvent.click(attach);

    await waitFor(() => {
      expect(screen.getByTestId("current-series").textContent).toBe("Кофейные пятницы");
    });
    expect(toastMock.success).toHaveBeenCalledWith("Серия обновлена");
  });

  it("attaches an existing own series via PUT /api/hangouts/:id/series", async () => {
    primeFetch({ series: [{ id: 3, title: "Кофейные пятницы", hangout_count: 2 }] });
    await loadPage();
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
    await loadPage();
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
    await loadPage();
    const detach = await screen.findByTestId("detach-series");
    fireEvent.click(detach);

    await waitFor(() => {
      const putCall = mockFetch.mock.calls.find(
        ([url, opts]) => String(url) === "/api/hangouts/7/series" && opts?.method === "PUT",
      );
      if (!putCall) throw new Error("PUT series call not found");
      expect(JSON.parse(putCall[1].body)).toEqual({ series_id: null });
    });
    await waitFor(() => {
      expect(screen.getByTestId("current-series").textContent).toBe("Без серии");
    });
  });
});
