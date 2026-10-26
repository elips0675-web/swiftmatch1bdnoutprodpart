import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import React from "react";
import { MemoryRouter, useLocation } from "react-router-dom";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

const tokenState = { value: "test-token" as string | null };
vi.mock("@/lib/token", () => ({
  getToken: () => tokenState.value,
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
  "hangout.form.price_invalid": "Цена — от 1 ₽; 0 или пустое поле — бесплатно",
  "hangout.form.capacity_invalid": "Лимит билетов — целое число от 1 до 1000",
  "hangout.category.cinema": "Кино",
  "hangout.type.date": "Свидание",
  "hangout.type.company": "Компания",
  "hangout.error.create": "Не удалось создать встречу",
  "hangout.error.load": "Не удалось загрузить данные",
  "hangout.toast.created": "Встреча создана!",
  "hangout.toast.daily_limit": "Лимит: одна встреча в день",
  "hangout.upsell.title": "Нужен Premium",
  "hangout.upsell.subtitle": "Без лимита встреч",
  "hangout.upsell.cta": "Оформить",
  "hangout.action.cancel": "Отмена",
  "partner.select_offer": "Выбрать из афиши",
  "partner.select_offer_desc": "Идеи встреч от партнёров",
  "partner.no_offers": "Пока нет предложений",
  "partner.category.cinema": "Кино",
  "partner.category.restaurant": "Столик",
  "partner.category.event": "События",
  "hangout.form.companions_premium_hint": "Премиум — до 20 участников",
};

vi.mock("@/context/language-context", () => ({
  useLanguage: () => mockUseLanguage,
}));

const flagsState = { partnerOffersEnabled: false, hangoutsEnabled: true };
vi.mock("@/context/feature-flags-context", () => ({
  useFeatureFlags: () => flagsState,
}));

const premiumState = { isPremium: false };
vi.mock("@/hooks/use-premium", () => ({
  usePremium: () => premiumState,
}));

const sonnerMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: sonnerMock }));

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
  SelectTrigger: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => (
    <option value="" disabled>
      {placeholder}
    </option>
  ),
  SelectContent: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children?: React.ReactNode }) => <option value={value}>{children}</option>,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open?: boolean; children?: React.ReactNode }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

const tr = (key: string) => mockUseLanguage.t(key);

function localInput(offsetMs: number): string {
  const d = new Date(Date.now() + offsetMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const OFFERS = [
  { id: 7, category: "cinema", title: "Премьера «Дюны»", description: "Два билета в подарок", partner_name: "Кинотеатр «Аврора»" },
];

function routeFetch(url: string, opts?: { method?: string }) {
  const u = String(url);
  if (u === "/api/profile/me") {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ city: "Екатеринбург" }) });
  }
  if (u === "/api/hangouts" && opts?.method === "POST") {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 101 }) });
  }
  if (u.startsWith("/api/partners/offers")) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
  }
  if (u === "/api/partners/track") {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  }
  return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
}

function postBody() {
  const calls = mockFetch.mock.calls.filter(
    ([url, opts]) => String(url) === "/api/hangouts" && (opts as { method?: string })?.method === "POST",
  );
  const call = calls[calls.length - 1];
  return call ? JSON.parse((call[1] as { body: string }).body) : null;
}

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname}</div>;
}

async function renderPage() {
  const Page = (await import("@/pages/hangout-create")).default;
  return render(
    <MemoryRouter initialEntries={["/hangouts/create"]}>
      <Page />
      <LocationProbe />
    </MemoryRouter>,
  );
}

const STEP_IDS = ["what", "where", "when", "tickets"];

async function openPage() {
  await renderPage();
  await waitFor(() => {
    expect(screen.getByTestId("hangout-title")).toBeTruthy();
  });
}

async function goToStep(target: number) {
  if (target > 0) {
    fireEvent.change(screen.getByTestId("hangout-title"), { target: { value: "Поход в кино" } });
  }
  for (let i = 0; i < target; i++) {
    fireEvent.click(screen.getByTestId("hangout-wizard-next"));
  }
  await waitFor(() => expect(screen.getByTestId(`hangout-step-${STEP_IDS[target]}`)).toBeTruthy());
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockReset();
  tokenState.value = "test-token";
  flagsState.partnerOffersEnabled = false;
  premiumState.isPremium = false;
  mockFetch.mockImplementation((url: string, opts?: { method?: string }) => routeFetch(url, opts));
  Reflect.deleteProperty(navigator, "geolocation");
});

describe("HangoutCreatePage (wizard)", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => routeFetch(url, opts));
  });

  it("prefills city from profile and shows only step 0 fields", async () => {
    await renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("hangout-title")).toBeTruthy();
    });

    expect(screen.getByTestId("hangout-step-what")).toBeTruthy();
    expect(screen.queryByTestId("hangout-price")).toBeNull();
    expect(screen.queryByTestId("hangout-place")).toBeNull();

    fireEvent.change(screen.getByTestId("hangout-title"), { target: { value: "Поход в кино" } });
    fireEvent.click(screen.getByTestId("hangout-wizard-next"));
    await waitFor(() => {
      expect(screen.getByTestId("hangout-place")).toBeTruthy();
    });
    expect((screen.getByTestId("hangout-city") as HTMLInputElement).value).toBe("Екатеринбург");
  });

  it("blocks advance on step 0 when title is empty", async () => {
    await openPage();

    fireEvent.click(screen.getByTestId("hangout-wizard-next"));

    expect(screen.getByTestId("hangout-title")).toBeTruthy();
    expect(screen.queryByTestId("hangout-place")).toBeNull();
    expect(sonnerMock.error).toHaveBeenCalledWith(tr("hangout.form.required"));
  });

  it("advances through all steps and shows submit on the last", async () => {
    await openPage();

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

    expect(screen.queryByTestId("hangout-wizard-next")).toBeNull();
  });

  it("кнопка «Назад» возвращает на предыдущий шаг, но не ниже первого", async () => {
    await openPage();
    await goToStep(2);

    fireEvent.click(screen.getByTestId("hangout-wizard-prev"));
    await waitFor(() => expect(screen.getByTestId("hangout-step-where")).toBeTruthy());

    fireEvent.click(screen.getByTestId("hangout-wizard-prev"));
    await waitFor(() => expect(screen.getByTestId("hangout-step-what")).toBeTruthy());

    expect(screen.queryByTestId("hangout-wizard-prev")).toBeNull();
  });

  it("пилюля шага возвращает назад, но не прыгает вперёд", async () => {
    await openPage();
    await goToStep(2);

    fireEvent.click(screen.getByTestId("hangout-step-pill-tickets"));
    expect(screen.getByTestId("hangout-step-when")).toBeTruthy();

    fireEvent.click(screen.getByTestId("hangout-step-pill-what"));
    await waitFor(() => expect(screen.getByTestId("hangout-step-what")).toBeTruthy());

    fireEvent.click(screen.getByTestId("hangout-step-pill-tickets"));
    expect(screen.getByTestId("hangout-step-what")).toBeTruthy();
  });

  it("тип «компания» и категория из селекта уходят в тело запроса", async () => {
    await openPage();

    fireEvent.click(screen.getByTestId("hangout-type-company"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "cafe" } });
    await goToStep(3);

    fireEvent.click(screen.getByTestId("submit-hangout"));
    await waitFor(() => expect(postBody()).toBeTruthy());

    expect(postBody().hangout_type).toBe("company");
    expect(postBody().category).toBe("cafe");
  });
});

describe("HangoutCreatePage: дата и время", () => {
  it("встреча через час проходит дальше — ограничение «не раньше чем через сутки» снято", async () => {
    await openPage();
    fireEvent.change(screen.getByTestId("hangout-title"), { target: { value: "Кофе" } });
    fireEvent.click(screen.getByTestId("hangout-wizard-next"));
    fireEvent.click(screen.getByTestId("hangout-wizard-next"));
    await waitFor(() => expect(screen.getByTestId("hangout-step-when")).toBeTruthy());

    fireEvent.change(screen.getByTestId("hangout-date"), { target: { value: localInput(60 * 60 * 1000) } });
    fireEvent.click(screen.getByTestId("hangout-wizard-next"));

    await waitFor(() => expect(screen.getByTestId("hangout-step-tickets")).toBeTruthy());
    expect(sonnerMock.error).not.toHaveBeenCalledWith(tr("hangout.form.date_invalid"));
  });

  it("прошедшая дата не пропускает дальше и объясняет почему", async () => {
    await openPage();
    fireEvent.change(screen.getByTestId("hangout-title"), { target: { value: "Кофе" } });
    fireEvent.click(screen.getByTestId("hangout-wizard-next"));
    fireEvent.click(screen.getByTestId("hangout-wizard-next"));
    await waitFor(() => expect(screen.getByTestId("hangout-step-when")).toBeTruthy());

    fireEvent.change(screen.getByTestId("hangout-date"), { target: { value: localInput(-60 * 60 * 1000) } });
    fireEvent.click(screen.getByTestId("hangout-wizard-next"));

    expect(sonnerMock.error).toHaveBeenCalledWith(tr("hangout.form.date_invalid"));
    expect(screen.getByTestId("hangout-step-when")).toBeTruthy();
    expect(screen.queryByTestId("hangout-step-tickets")).toBeNull();
  });
});

describe("HangoutCreatePage: отправка", () => {
  it("успешное создание: поля уходят в POST, тост и переход на /hangouts/my", async () => {
    await openPage();
    await goToStep(3);

    fireEvent.change(screen.getByTestId("hangout-price"), { target: { value: "500" } });
    fireEvent.change(screen.getByTestId("hangout-capacity"), { target: { value: "10" } });
    fireEvent.change(screen.getByTestId("hangout-description"), { target: { value: "  Ищу компанию  " } });
    fireEvent.click(screen.getByTestId("submit-hangout"));

    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/hangouts/my"));

    const body = postBody();
    expect(body.title).toBe("Поход в кино");
    expect(body.price).toBe(500);
    expect(body.capacity).toBe(10);
    expect(body.description).toBe("Ищу компанию");
    expect(body.max_companions).toBe(1);
    expect(new Date(body.event_date).getTime()).toBeGreaterThan(Date.now());
    expect(sonnerMock.success).toHaveBeenCalledWith(tr("hangout.toast.created"));
  });

  it("пустые необязательные поля не уходят в тело запроса", async () => {
    await openPage();
    await goToStep(3);
    fireEvent.click(screen.getByTestId("submit-hangout"));

    await waitFor(() => expect(postBody()).toBeTruthy());

    const body = postBody();
    expect(body.description).toBeUndefined();
    expect(body.place_name).toBeUndefined();
    expect(body.place_address).toBeUndefined();
    expect(body.price).toBeUndefined();
    expect(body.capacity).toBeUndefined();
    expect(body.partner_offer_id).toBeUndefined();
  });

  it("цена 0 означает «бесплатно» и в тело не уходит", async () => {
    await openPage();
    await goToStep(3);

    fireEvent.change(screen.getByTestId("hangout-price"), { target: { value: "0" } });
    fireEvent.click(screen.getByTestId("submit-hangout"));

    await waitFor(() => expect(postBody()).toBeTruthy());
    expect(postBody().price).toBeUndefined();
    expect(sonnerMock.error).not.toHaveBeenCalledWith(tr("hangout.form.price_invalid"));
  });

  it("дробная цена меньше рубля не проходит", async () => {
    await openPage();
    await goToStep(3);

    fireEvent.change(screen.getByTestId("hangout-price"), { target: { value: "0.5" } });
    fireEvent.click(screen.getByTestId("submit-hangout"));

    expect(sonnerMock.error).toHaveBeenCalledWith(tr("hangout.form.price_invalid"));
    expect(postBody()).toBeNull();
  });

  it("лимит билетов 0 отбивается до сервера", async () => {
    await openPage();
    await goToStep(3);

    fireEvent.change(screen.getByTestId("hangout-capacity"), { target: { value: "0" } });
    fireEvent.click(screen.getByTestId("submit-hangout"));

    expect(sonnerMock.error).toHaveBeenCalledWith(tr("hangout.form.capacity_invalid"));
    expect(postBody()).toBeNull();
  });

  it("лимит билетов больше 1000 отбивается до сервера", async () => {
    await openPage();
    await goToStep(3);

    fireEvent.change(screen.getByTestId("hangout-capacity"), { target: { value: "2000" } });
    fireEvent.click(screen.getByTestId("submit-hangout"));

    expect(sonnerMock.error).toHaveBeenCalledWith(tr("hangout.form.capacity_invalid"));
    expect(postBody()).toBeNull();
  });

  it("дневной лимит показывает апселл и не уводит со страницы", async () => {
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (String(url) === "/api/hangouts" && opts?.method === "POST") {
        return Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({ code: "HANGOUT_DAILY_LIMIT" }) });
      }
      return routeFetch(url, opts);
    });
    await openPage();
    await goToStep(3);

    fireEvent.click(screen.getByTestId("submit-hangout"));

    await waitFor(() => expect(screen.getByTestId("hangout-daily-limit")).toBeTruthy());
    expect(sonnerMock.error).toHaveBeenCalledWith(tr("hangout.toast.daily_limit"));
    expect(screen.getByTestId("location").textContent).toBe("/hangouts/create");

    fireEvent.click(screen.getByTestId("hangout-upsell-go"));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/premium"));
  });

  it("отмена апселла прячет блок", async () => {
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (String(url) === "/api/hangouts" && opts?.method === "POST") {
        return Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({ code: "HANGOUT_DAILY_LIMIT" }) });
      }
      return routeFetch(url, opts);
    });
    await openPage();
    await goToStep(3);
    fireEvent.click(screen.getByTestId("submit-hangout"));
    await waitFor(() => expect(screen.getByTestId("hangout-daily-limit")).toBeTruthy());

    fireEvent.click(screen.getByTestId("hangout-upsell-dismiss"));

    expect(screen.queryByTestId("hangout-daily-limit")).toBeNull();
  });

  it("прочий отказ сервера даёт «не удалось создать», а не «не удалось загрузить»", async () => {
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (String(url) === "/api/hangouts" && opts?.method === "POST") {
        return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ message: "boom" }) });
      }
      return routeFetch(url, opts);
    });
    await openPage();
    await goToStep(3);

    fireEvent.click(screen.getByTestId("submit-hangout"));

    await waitFor(() => expect(sonnerMock.error).toHaveBeenCalledWith(tr("hangout.error.create")));
    expect(sonnerMock.error).not.toHaveBeenCalledWith(tr("hangout.error.load"));
    expect(screen.getByTestId("location").textContent).toBe("/hangouts/create");
  });

  it("не-JSON тело ошибки не ломает обработку", async () => {
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (String(url) === "/api/hangouts" && opts?.method === "POST") {
        return Promise.resolve({ ok: false, status: 502, json: () => Promise.reject(new Error("not json")) });
      }
      return routeFetch(url, opts);
    });
    await openPage();
    await goToStep(3);

    fireEvent.click(screen.getByTestId("submit-hangout"));

    await waitFor(() => expect(sonnerMock.error).toHaveBeenCalledWith(tr("hangout.error.create")));
  });

  it("без токена уводит на /login и не отправляет POST", async () => {
    await openPage();
    await goToStep(3);
    tokenState.value = null;

    fireEvent.click(screen.getByTestId("submit-hangout"));

    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/login"));
    expect(postBody()).toBeNull();
  });

  it("координаты геолокации уходят с точностью до 8 знаков", async () => {
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition: (ok: (pos: { coords: { latitude: number; longitude: number } }) => void) =>
          ok({ coords: { latitude: 55.751244123, longitude: 37.618423456 } }),
      },
      configurable: true,
    });
    await openPage();
    await goToStep(3);

    fireEvent.click(screen.getByTestId("submit-hangout"));
    await waitFor(() => expect(postBody()).toBeTruthy());

    expect(postBody().lat).toBe(55.75124412);
    expect(postBody().lng).toBe(37.61842346);
  });

  it("отказ геолокации не мешает создать встречу", async () => {
    Object.defineProperty(navigator, "geolocation", {
      value: { getCurrentPosition: (_ok: unknown, fail: () => void) => fail() },
      configurable: true,
    });
    await openPage();
    await goToStep(3);

    fireEvent.click(screen.getByTestId("submit-hangout"));
    await waitFor(() => expect(postBody()).toBeTruthy());

    expect(postBody().lat).toBeNull();
    expect(postBody().lng).toBeNull();
  });

  it("правки места, адреса и города уходят в тело", async () => {
    await openPage();
    await goToStep(1);

    fireEvent.change(screen.getByTestId("hangout-place"), { target: { value: "Кинотеатр «Аврора»" } });
    fireEvent.change(screen.getByTestId("hangout-address"), { target: { value: "ул. Ленина, 5" } });
    fireEvent.change(screen.getByTestId("hangout-city"), { target: { value: "Казань" } });
    fireEvent.click(screen.getByTestId("hangout-wizard-next"));
    fireEvent.click(screen.getByTestId("hangout-wizard-next"));
    await waitFor(() => expect(screen.getByTestId("submit-hangout")).toBeTruthy());

    fireEvent.click(screen.getByTestId("submit-hangout"));
    await waitFor(() => expect(postBody()).toBeTruthy());

    const body = postBody();
    expect(body.place_name).toBe("Кинотеатр «Аврора»");
    expect(body.place_address).toBe("ул. Ленина, 5");
    expect(body.city).toBe("Казань");
  });

  it("пустой город не уходит в тело", async () => {
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (String(url) === "/api/profile/me") return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) });
      return routeFetch(url, opts);
    });
    await openPage();
    await goToStep(3);

    fireEvent.click(screen.getByTestId("submit-hangout"));
    await waitFor(() => expect(postBody()).toBeTruthy());

    expect(postBody().city).toBeUndefined();
  });

  it("сетевой сбой профиля не ломает страницу", async () => {
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (String(url) === "/api/profile/me") return Promise.reject(new Error("offline"));
      return routeFetch(url, opts);
    });
    await openPage();
    await goToStep(1);

    expect((screen.getByTestId("hangout-city") as HTMLInputElement).value).toBe("");
  });

  it("недоступный профиль не ломает предзаполнение города", async () => {
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (String(url) === "/api/profile/me") return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) });
      return routeFetch(url, opts);
    });
    await openPage();
    await goToStep(1);

    expect((screen.getByTestId("hangout-city") as HTMLInputElement).value).toBe("");
  });

  it("без токена профиль не запрашивается", async () => {
    tokenState.value = null;
    await openPage();

    expect(mockFetch.mock.calls.some(([url]) => String(url) === "/api/profile/me")).toBe(false);
  });
});

describe("HangoutCreatePage: афиша партнёров", () => {
  it("без флага кнопки выбора из афиши нет", async () => {
    await openPage();
    expect(screen.queryByTestId("pick-from-listings")).toBeNull();
  });

  it("пустой ответ афиши даёт честный «нет предложений», а не «что-то пошло не так»", async () => {
    flagsState.partnerOffersEnabled = true;
    await openPage();

    fireEvent.click(screen.getByTestId("pick-from-listings"));

    await waitFor(() => expect(screen.getByTestId("listings-empty")).toBeTruthy());
    expect(screen.getByTestId("listings-empty").textContent).toBe(tr("partner.no_offers"));
  });

  it("не-массив в ответе афиши не роняет диалог", async () => {
    flagsState.partnerOffersEnabled = true;
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (String(url).startsWith("/api/partners/offers")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: OFFERS }) });
      }
      return routeFetch(url, opts);
    });
    await openPage();

    fireEvent.click(screen.getByTestId("pick-from-listings"));

    await waitFor(() => expect(screen.getByTestId("listings-empty")).toBeTruthy());
  });

  it("отказ афиши тоже даёт пустой список, а не падение", async () => {
    flagsState.partnerOffersEnabled = true;
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (String(url).startsWith("/api/partners/offers")) {
        return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
      }
      return routeFetch(url, opts);
    });
    await openPage();

    fireEvent.click(screen.getByTestId("pick-from-listings"));

    await waitFor(() => expect(screen.getByTestId("listings-empty")).toBeTruthy());
  });

  it("сетевой сбой афиши даёт пустой список, а не падение", async () => {
    flagsState.partnerOffersEnabled = true;
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (String(url).startsWith("/api/partners/offers")) {
        return Promise.reject(new Error("offline"));
      }
      return routeFetch(url, opts);
    });
    await openPage();

    fireEvent.click(screen.getByTestId("pick-from-listings"));

    await waitFor(() => expect(screen.getByTestId("listings-empty")).toBeTruthy());
  });

  it("без токена афиша запрашивается без заголовка Authorization", async () => {
    flagsState.partnerOffersEnabled = true;
    tokenState.value = null;
    await openPage();

    fireEvent.click(screen.getByTestId("pick-from-listings"));
    await waitFor(() => expect(screen.getByTestId("listings-empty")).toBeTruthy());

    const call = mockFetch.mock.calls.find(([url]) => String(url).startsWith("/api/partners/offers"))!;
    expect((call[1] as { headers: Record<string, string> }).headers.Authorization).toBeUndefined();
  });

  it("неизвестная категория оффера даёт категорию «другое»", async () => {
    flagsState.partnerOffersEnabled = true;
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (String(url).startsWith("/api/partners/offers")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([{ ...OFFERS[0], category: "spa" }]) });
      }
      return routeFetch(url, opts);
    });
    await openPage();

    fireEvent.click(screen.getByTestId("pick-from-listings"));
    await waitFor(() => expect(screen.getByTestId("listing-offer-spa")).toBeTruthy());
    fireEvent.click(screen.getByTestId("listing-offer-spa"));
    await waitFor(() => expect(sonnerMock.success).toHaveBeenCalledWith(tr("partner.select_offer")));

    await goToStep(3);
    fireEvent.click(screen.getByTestId("submit-hangout"));
    await waitFor(() => expect(postBody()).toBeTruthy());
    expect(postBody().category).toBe("other");
  });

  it("без токена трекинг уходит без Authorization и не мешает выбору", async () => {
    flagsState.partnerOffersEnabled = true;
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (String(url).startsWith("/api/partners/offers")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(OFFERS) });
      }
      return routeFetch(url, opts);
    });
    await openPage();
    fireEvent.click(screen.getByTestId("pick-from-listings"));
    await waitFor(() => expect(screen.getByTestId("listing-offer-cinema")).toBeTruthy());

    tokenState.value = null;
    fireEvent.click(screen.getByTestId("listing-offer-cinema"));
    await waitFor(() => expect(sonnerMock.success).toHaveBeenCalledWith(tr("partner.select_offer")));

    const track = mockFetch.mock.calls.find(([url]) => String(url) === "/api/partners/track")!;
    expect((track[1] as { headers: Record<string, string> }).headers.Authorization).toBeUndefined();
    expect((screen.getByTestId("hangout-title") as HTMLInputElement).value).toBe("Премьера «Дюны»");
  });

  it("сбой трекинга не мешает выбрать оффер", async () => {
    flagsState.partnerOffersEnabled = true;
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (String(url).startsWith("/api/partners/offers")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(OFFERS) });
      }
      if (String(url) === "/api/partners/track") return Promise.reject(new Error("offline"));
      return routeFetch(url, opts);
    });
    await openPage();

    fireEvent.click(screen.getByTestId("pick-from-listings"));
    await waitFor(() => expect(screen.getByTestId("listing-offer-cinema")).toBeTruthy());
    fireEvent.click(screen.getByTestId("listing-offer-cinema"));

    await waitFor(() => expect(sonnerMock.success).toHaveBeenCalledWith(tr("partner.select_offer")));
    expect((screen.getByTestId("hangout-title") as HTMLInputElement).value).toBe("Премьера «Дюны»");
  });

  it("выбор оффера заполняет поля, шлёт трекинг и тост", async () => {
    flagsState.partnerOffersEnabled = true;
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (String(url).startsWith("/api/partners/offers")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(OFFERS) });
      }
      return routeFetch(url, opts);
    });
    await openPage();

    fireEvent.click(screen.getByTestId("pick-from-listings"));
    await waitFor(() => expect(screen.getByTestId("listing-offer-cinema")).toBeTruthy());
    fireEvent.click(screen.getByTestId("listing-offer-cinema"));

    await waitFor(() => expect(sonnerMock.success).toHaveBeenCalledWith(tr("partner.select_offer")));
    expect((screen.getByTestId("hangout-title") as HTMLInputElement).value).toBe("Премьера «Дюны»");
    expect(screen.queryByTestId("listing-offer-cinema")).toBeNull();

    const track = mockFetch.mock.calls.find(([url]) => String(url) === "/api/partners/track")!;
    expect(JSON.parse((track[1] as { body: string }).body)).toEqual({ offer_id: 7, conversion_type: "lead" });
  });

  it("выбранный оффер уходит в тело как partner_offer_id, а его имя — в место", async () => {
    flagsState.partnerOffersEnabled = true;
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (String(url).startsWith("/api/partners/offers")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(OFFERS) });
      }
      return routeFetch(url, opts);
    });
    await openPage();

    fireEvent.click(screen.getByTestId("pick-from-listings"));
    await waitFor(() => expect(screen.getByTestId("listing-offer-cinema")).toBeTruthy());
    fireEvent.click(screen.getByTestId("listing-offer-cinema"));
    await waitFor(() => expect(sonnerMock.success).toHaveBeenCalled());

    await goToStep(3);
    fireEvent.click(screen.getByTestId("submit-hangout"));
    await waitFor(() => expect(postBody()).toBeTruthy());

    expect(postBody().partner_offer_id).toBe(7);
    expect(postBody().place_name).toBe("Кинотеатр «Аврора»");
    expect(postBody().description).toBe("Два билета в подарок");
  });
});

describe("HangoutCreatePage: премиум", () => {
  it("без премиума доступно 10 компаньонов и видна подсказка", async () => {
    await openPage();
    await goToStep(2);

    const select = screen.getByRole("combobox");
    expect(within(select).getByText("10")).toBeTruthy();
    expect(within(select).queryByText("20")).toBeNull();
    expect(screen.getByText(tr("hangout.form.companions_premium_hint"))).toBeTruthy();
  });

  it("премиум открывает 20 компаньонов и убирает подсказку", async () => {
    premiumState.isPremium = true;
    await openPage();
    await goToStep(2);

    const select = screen.getByRole("combobox");
    expect(within(select).getByText("20")).toBeTruthy();
    expect(screen.queryByText(tr("hangout.form.companions_premium_hint"))).toBeNull();

    fireEvent.change(select, { target: { value: "20" } });
    fireEvent.click(screen.getByTestId("hangout-wizard-next"));
    await waitFor(() => expect(screen.getByTestId("submit-hangout")).toBeTruthy());

    fireEvent.click(screen.getByTestId("submit-hangout"));
    await waitFor(() => expect(postBody()).toBeTruthy());
    expect(postBody().max_companions).toBe(20);
  });
});
