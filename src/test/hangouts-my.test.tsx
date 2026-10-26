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

const mockWs = vi.hoisted(() => {
  const handlers: Record<string, (payload?: any) => void> = {};
  const socket = {
    on: vi.fn((ev: string, cb: (payload?: any) => void) => { handlers[ev] = cb; }),
    off: vi.fn(),
    emit: vi.fn(),
  };
  return { socket, handlers };
});

const wsState = { socket: mockWs.socket as unknown };
vi.mock("@/hooks/use-websocket", () => ({
  useWebSocket: () => ({ socket: wsState.socket, connected: false }),
}));

const mockTranslations: Record<string, string> = {
  "hangout.my_listings": "Мои объявления",
  "hangout.my_responses": "Мои отклики",
  "hangout.empty_my_listings": "Вы еще не создавали встречи",
  "hangout.empty_my_responses": "Вы пока никуда не откликались",
  "hangout.action.create": "Создать встречу",
  "hangout.action.details": "Подробнее",
  "hangout.action.open_chat": "Чат",
  "hangout.action.cancel": "Отменить",
  "hangout.label.companions_count": "{count} из {max}",
  "hangout.label.author": "Автор",
  "hangout.status.active": "Активна",
  "hangout.status.cancelled": "Отменена",
  "hangout.status.completed": "Завершена",
  "hangout.category.cinema": "Кино",
  "hangout.category.cafe": "Кафе",
  "hangout.response.pending": "На рассмотрении",
  "hangout.response.accepted": "Принят",
  "hangout.response.declined": "Отклонен",
  "hangout.response.cancelled": "Отменён",
  "hangout.boost.promote": "Продвинуть",
  "hangout.boost.promoted": "Продвинуто",
  "hangout.boost.toast.boosted": "Встреча продвинута",
  "hangout.boost.toast.unboosted": "Продвижение снято",
  "hangout.boost.limit": "Доступно 1 продвижение",
  "hangout.boost.premium_required": "Продвижение — Premium",
  "hangout.toast.cancelled": "Встреча отменена",
  "hangout.error.load": "Не удалось загрузить данные",
  "hangout.error.cancel": "Не удалось отменить встречу",
  "hangout.error.boost": "Не удалось изменить продвижение",
  "button.close": "Закрыть",
};

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
vi.mock("@/context/language-context", () => ({
  useLanguage: () => mockUseLanguage,
}));

const premiumState = { isPremium: false };
vi.mock("@/hooks/use-premium", () => ({
  usePremium: () => ({ isPremium: premiumState.isPremium }),
}));

vi.mock("@/components/layout/app-header", () => ({
  AppHeader: () => <div data-testid="app-header" />,
}));

vi.mock("@/components/navigation/bottom-nav", () => ({
  BottomNav: () => <div data-testid="bottom-nav" />,
}));

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

const tr = (key: string) => mockUseLanguage.t(key);

function listing(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    author_id: 10,
    category: "cinema",
    title: "Иду на Дюну",
    description: null,
    place_name: "Аврора",
    place_address: null,
    city: "Москва",
    event_date: new Date(Date.now() + 86_400_000).toISOString(),
    max_companions: 3,
    status: "active",
    display_name: "Максим",
    avatar_url: null,
    accepted_count: 1,
    boosted: 0,
    chat_id: null,
    ...overrides,
  };
}

function response(overrides: Record<string, unknown> = {}) {
  return {
    id: 5,
    hangout_id: 1,
    title: "Иду на Дюну",
    category: "cinema",
    event_date: new Date(Date.now() + 86_400_000).toISOString(),
    response_status: "pending",
    hangout_status: "active",
    display_name: "Ольга",
    avatar_url: null,
    message: null,
    ...overrides,
  };
}

let listingsData: unknown[] = [listing()];
let responsesData: unknown[] = [];

function routeFetch(url: string, opts?: { method?: string }) {
  const u = String(url);
  if (u === "/api/hangouts/my") return Promise.resolve({ ok: true, json: () => Promise.resolve(listingsData) });
  if (u === "/api/hangouts/responses/my") return Promise.resolve({ ok: true, json: () => Promise.resolve(responsesData) });
  if (u.startsWith("/api/hangouts/") && opts?.method === "DELETE") return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  if (u.includes("/boost") && opts?.method === "POST") return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
}

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname}</div>;
}

async function renderPage() {
  const Page = (await import("@/pages/hangouts-my")).default;
  return render(
    <MemoryRouter initialEntries={["/hangouts/my"]}>
      <Page />
      <LocationProbe />
    </MemoryRouter>,
  );
}

async function openPage() {
  await renderPage();
  await waitFor(() => expect(screen.getByTestId("tab-listings")).toBeTruthy());
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockReset();
  tokenState.value = "test-token";
  premiumState.isPremium = false;
  wsState.socket = mockWs.socket;
  listingsData = [listing()];
  responsesData = [];
  Object.keys(mockWs.handlers).forEach((k) => delete mockWs.handlers[k]);
  mockFetch.mockImplementation((url: string, opts?: { method?: string }) => routeFetch(url, opts));
});

describe("HangoutsMyPage: загрузка", () => {
  it("рисует объявления и отклики из двух запросов", async () => {
    responsesData = [response()];
    await openPage();

    await waitFor(() => expect(screen.getByTestId("my-hangout-1")).toBeTruthy());
    fireEvent.mouseDown(screen.getByTestId("tab-responses"));
    await waitFor(() => expect(screen.getByTestId("my-response-5")).toBeTruthy());
  });

  it("пустые списки дают два разных пустых состояния", async () => {
    listingsData = [];
    responsesData = [];
    await openPage();

    await waitFor(() => expect(screen.getByText(tr("hangout.empty_my_listings"))).toBeTruthy());
    fireEvent.mouseDown(screen.getByTestId("tab-responses"));
    await waitFor(() => expect(screen.getByText(tr("hangout.empty_my_responses"))).toBeTruthy());
  });

  it("отказ API показывает ошибку, а не тихое «у вас ничего нет»", async () => {
    mockFetch.mockImplementation(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }));
    await openPage();

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(tr("hangout.error.load")));
    expect(screen.getByText(tr("hangout.empty_my_listings"))).toBeTruthy();
  });

  it("не-массив в ответе не роняет страницу", async () => {
    listingsData = { items: [listing()], length: 1 };
    responsesData = { items: [], length: 1 };
    await openPage();

    await waitFor(() => expect(screen.getByText(tr("hangout.empty_my_listings"))).toBeTruthy());
  });

  it("сетевой сбой даёт тост ошибки и снимает загрузку", async () => {
    mockFetch.mockImplementation(() => Promise.reject(new Error("offline")));
    await openPage();

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(tr("hangout.error.load")));
    expect(screen.getByText(tr("hangout.empty_my_listings"))).toBeTruthy();
  });

  it("без токена уводит на /login и не запрашивает списки", async () => {
    tokenState.value = null;
    await openPage();

    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/login"));
    expect(mockFetch.mock.calls.some(([url]) => String(url) === "/api/hangouts/my")).toBe(false);
  });

  it("кнопка создания уводит на /hangouts/create", async () => {
    await openPage();

    fireEvent.click(screen.getByTestId("create-hangout-my"));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/hangouts/create"));
  });
});

describe("HangoutsMyPage: карточка объявления", () => {
  it("показывает место, город, счётчик и ссылки на детали и чат", async () => {
    listingsData = [listing({ chat_id: 42 })];
    await openPage();

    await waitFor(() => expect(screen.getByTestId("my-hangout-1")).toBeTruthy());
    const card = screen.getByTestId("my-hangout-1");
    expect(within(card).getByText("Аврора, Москва")).toBeTruthy();
    expect(within(card).getByText("1 из 3")).toBeTruthy();
    expect(within(card).getByText(tr("hangout.action.open_chat"))).toBeTruthy();
    expect(card.querySelector('a[href="/hangouts/1"]')).toBeTruthy();
    expect(card.querySelector('a[href="/chats/42"]')).toBeTruthy();
  });

  it("без принятых участников счётчик показывает ноль", async () => {
    listingsData = [listing({ accepted_count: null })];
    await openPage();

    await waitFor(() => expect(screen.getByTestId("my-hangout-1")).toBeTruthy());
    expect(within(screen.getByTestId("my-hangout-1")).getByText("0 из 3")).toBeTruthy();
  });

  it("без места и города строки адреса нет, без chat_id нет кнопки чата", async () => {
    listingsData = [listing({ place_name: null, city: null, chat_id: null })];
    await openPage();

    await waitFor(() => expect(screen.getByTestId("my-hangout-1")).toBeTruthy());
    const card = screen.getByTestId("my-hangout-1");
    expect(within(card).queryByText(tr("hangout.action.open_chat"))).toBeNull();
    expect(card.textContent).not.toContain("Аврора");
  });

  it("у неактивной встречи нет ни продвижения, ни отмены", async () => {
    listingsData = [listing({ status: "completed", boosted: 1 })];
    await openPage();

    await waitFor(() => expect(screen.getByTestId("my-hangout-1")).toBeTruthy());
    expect(screen.queryByTestId("cancel-hangout-1")).toBeNull();
    expect(screen.queryByTestId("boost-hangout-1")).toBeNull();
    expect(screen.queryByTestId("unboost-hangout-1")).toBeNull();
  });
});

describe("HangoutsMyPage: продвижение", () => {
  it("без премиума кнопка ведёт на /premium", async () => {
    premiumState.isPremium = false;
    await openPage();

    await waitFor(() => expect(screen.getByTestId("boost-upgrade-1")).toBeTruthy());
    const link = screen.getByTestId("boost-upgrade-1").closest("a");
    expect(link?.getAttribute("href")).toBe("/premium");
  });

  it("премиум продвигает встречу и перезагружает список", async () => {
    premiumState.isPremium = true;
    await openPage();
    await waitFor(() => expect(screen.getByTestId("boost-hangout-1")).toBeTruthy());

    const before = mockFetch.mock.calls.filter(([url]) => String(url) === "/api/hangouts/my").length;
    fireEvent.click(screen.getByTestId("boost-hangout-1"));

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith(tr("hangout.boost.toast.boosted")));
    const boostCall = mockFetch.mock.calls.find(([url]) => String(url) === "/api/hangouts/1/boost")!;
    expect((boostCall[1] as { method: string }).method).toBe("POST");
    await waitFor(() =>
      expect(mockFetch.mock.calls.filter(([url]) => String(url) === "/api/hangouts/my").length).toBeGreaterThan(before),
    );
  });

  it("продвинутую встречу можно снять с продвижения", async () => {
    premiumState.isPremium = true;
    listingsData = [listing({ boosted: 1 })];
    await openPage();
    await waitFor(() => expect(screen.getByTestId("unboost-hangout-1")).toBeTruthy());

    fireEvent.click(screen.getByTestId("unboost-hangout-1"));

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith(tr("hangout.boost.toast.unboosted")));
    expect(mockFetch.mock.calls.some(([url]) => String(url) === "/api/hangouts/1/unboost")).toBe(true);
  });

  it("403 PREMIUM_REQUIRED объясняет, что нужен премиум", async () => {
    premiumState.isPremium = true;
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (String(url).includes("/boost")) {
        return Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({ code: "PREMIUM_REQUIRED" }) });
      }
      return routeFetch(url, opts);
    });
    await openPage();
    await waitFor(() => expect(screen.getByTestId("boost-hangout-1")).toBeTruthy());

    fireEvent.click(screen.getByTestId("boost-hangout-1"));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(tr("hangout.boost.premium_required")));
  });

  it("409 BOOST_LIMIT объясняет лимит одного продвижения", async () => {
    premiumState.isPremium = true;
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (String(url).includes("/boost")) {
        return Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({ code: "BOOST_LIMIT" }) });
      }
      return routeFetch(url, opts);
    });
    await openPage();
    await waitFor(() => expect(screen.getByTestId("boost-hangout-1")).toBeTruthy());

    fireEvent.click(screen.getByTestId("boost-hangout-1"));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(tr("hangout.boost.limit")));
  });

  it("прочий отказ не показывает сырой английский message сервера", async () => {
    premiumState.isPremium = true;
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (String(url).includes("/boost")) {
        return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ message: "Internal server error" }) });
      }
      return routeFetch(url, opts);
    });
    await openPage();
    await waitFor(() => expect(screen.getByTestId("boost-hangout-1")).toBeTruthy());

    fireEvent.click(screen.getByTestId("boost-hangout-1"));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(tr("hangout.error.boost")));
    expect(toastMock.error).not.toHaveBeenCalledWith("Internal server error");
  });

  it("тело отказа без JSON не ломает обработку", async () => {
    premiumState.isPremium = true;
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (String(url).includes("/boost")) {
        return Promise.resolve({ ok: false, status: 502, json: () => Promise.reject(new Error("not json")) });
      }
      return routeFetch(url, opts);
    });
    await openPage();
    await waitFor(() => expect(screen.getByTestId("boost-hangout-1")).toBeTruthy());

    fireEvent.click(screen.getByTestId("boost-hangout-1"));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(tr("hangout.error.boost")));
  });

  it("без токена продвижение уходит без заголовка Authorization", async () => {
    premiumState.isPremium = true;
    await openPage();
    await waitFor(() => expect(screen.getByTestId("boost-hangout-1")).toBeTruthy());
    tokenState.value = null;

    fireEvent.click(screen.getByTestId("boost-hangout-1"));

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith(tr("hangout.boost.toast.boosted")));
    const boostCall = mockFetch.mock.calls.find(([url]) => String(url) === "/api/hangouts/1/boost")!;
    expect((boostCall[1] as { headers: Record<string, string> }).headers.Authorization).toBeUndefined();
  });

  it("сетевой сбой продвижения даёт тост и снимает блокировку кнопки", async () => {
    premiumState.isPremium = true;
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (String(url).includes("/boost")) return Promise.reject(new Error("offline"));
      return routeFetch(url, opts);
    });
    await openPage();
    await waitFor(() => expect(screen.getByTestId("boost-hangout-1")).toBeTruthy());

    fireEvent.click(screen.getByTestId("boost-hangout-1"));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(tr("hangout.error.boost")));
    await waitFor(() => expect((screen.getByTestId("boost-hangout-1") as HTMLButtonElement).disabled).toBe(false));
  });
});

describe("HangoutsMyPage: отмена встречи", () => {
  it("диалог спрашивает подтверждение и отменяет встречу", async () => {
    await openPage();
    await waitFor(() => expect(screen.getByTestId("cancel-hangout-1")).toBeTruthy());

    fireEvent.click(screen.getByTestId("cancel-hangout-1"));
    await waitFor(() => expect(screen.getByTestId("confirm-cancel-hangout")).toBeTruthy());

    const before = mockFetch.mock.calls.filter(([url]) => String(url) === "/api/hangouts/my").length;
    fireEvent.click(screen.getByTestId("confirm-cancel-hangout"));

    await waitFor(() => expect(toastMock.info).toHaveBeenCalledWith(tr("hangout.toast.cancelled")));
    const del = mockFetch.mock.calls.find(([url, opts]) => String(url) === "/api/hangouts/1" && (opts as { method?: string })?.method === "DELETE");
    expect(del).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("confirm-cancel-hangout")).toBeNull());
    await waitFor(() =>
      expect(mockFetch.mock.calls.filter(([url]) => String(url) === "/api/hangouts/my").length).toBeGreaterThan(before),
    );
  });

  it("«Закрыть» в диалоге ничего не удаляет", async () => {
    await openPage();
    await waitFor(() => expect(screen.getByTestId("cancel-hangout-1")).toBeTruthy());

    fireEvent.click(screen.getByTestId("cancel-hangout-1"));
    await waitFor(() => expect(screen.getByTestId("confirm-cancel-hangout")).toBeTruthy());
    fireEvent.click(screen.getByText(tr("button.close")));

    await waitFor(() => expect(screen.queryByTestId("confirm-cancel-hangout")).toBeNull());
    expect(mockFetch.mock.calls.some(([, opts]) => (opts as { method?: string })?.method === "DELETE")).toBe(false);
  });

  it("Escape закрывает диалог отмены без удаления", async () => {
    await openPage();
    await waitFor(() => expect(screen.getByTestId("cancel-hangout-1")).toBeTruthy());

    fireEvent.click(screen.getByTestId("cancel-hangout-1"));
    await waitFor(() => expect(screen.getByTestId("confirm-cancel-hangout")).toBeTruthy());

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByTestId("confirm-cancel-hangout")).toBeNull());
    expect(mockFetch.mock.calls.some(([, opts]) => (opts as { method?: string })?.method === "DELETE")).toBe(false);
  });

  it("отказ отмены говорит «не удалось отменить», а не «не удалось загрузить»", async () => {
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (String(url) === "/api/hangouts/1" && opts?.method === "DELETE") {
        return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
      }
      return routeFetch(url, opts);
    });
    await openPage();
    await waitFor(() => expect(screen.getByTestId("cancel-hangout-1")).toBeTruthy());

    fireEvent.click(screen.getByTestId("cancel-hangout-1"));
    await waitFor(() => expect(screen.getByTestId("confirm-cancel-hangout")).toBeTruthy());
    fireEvent.click(screen.getByTestId("confirm-cancel-hangout"));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(tr("hangout.error.cancel")));
    expect(toastMock.error).not.toHaveBeenCalledWith(tr("hangout.error.load"));
    expect(screen.getByTestId("confirm-cancel-hangout")).toBeTruthy();
  });

  it("без токена отмена уходит без заголовка Authorization", async () => {
    await openPage();
    await waitFor(() => expect(screen.getByTestId("cancel-hangout-1")).toBeTruthy());
    tokenState.value = null;

    fireEvent.click(screen.getByTestId("cancel-hangout-1"));
    await waitFor(() => expect(screen.getByTestId("confirm-cancel-hangout")).toBeTruthy());
    fireEvent.click(screen.getByTestId("confirm-cancel-hangout"));

    await waitFor(() => expect(toastMock.info).toHaveBeenCalledWith(tr("hangout.toast.cancelled")));
    const del = mockFetch.mock.calls.find(([url, opts]) => String(url) === "/api/hangouts/1" && (opts as { method?: string })?.method === "DELETE")!;
    expect((del[1] as { headers: Record<string, string> }).headers.Authorization).toBeUndefined();
  });
});

describe("HangoutsMyPage: отклики", () => {
  it("рисует статусы отклика и встречи, аватар и сообщение", async () => {
    responsesData = [
      response({ id: 5, response_status: "accepted", avatar_url: "/uploads/a.jpg", message: "Буду вовремя" }),
      response({ id: 6, response_status: "declined", hangout_status: "cancelled" }),
      response({ id: 7, response_status: "cancelled" }),
    ];
    await openPage();
    fireEvent.mouseDown(screen.getByTestId("tab-responses"));

    await waitFor(() => expect(screen.getByTestId("my-response-5")).toBeTruthy());
    const accepted = screen.getByTestId("my-response-5");
    expect(within(accepted).getByText(tr("hangout.response.accepted"))).toBeTruthy();
    expect(within(accepted).getByText("Буду вовремя")).toBeTruthy();
    expect(accepted.querySelector('img[src="/uploads/a.jpg"]')).toBeTruthy();

    const declined = screen.getByTestId("my-response-6");
    expect(within(declined).getByText(tr("hangout.response.declined"))).toBeTruthy();
    expect(within(declined).getByText(tr("hangout.status.cancelled"))).toBeTruthy();

    const cancelled = screen.getByTestId("my-response-7");
    expect(within(cancelled).getByText(tr("hangout.response.cancelled"))).toBeTruthy();
  });

  it("без аватара показывает первую букву имени, без имени — знак вопроса", async () => {
    responsesData = [response({ id: 5, display_name: "Ольга" }), response({ id: 6, display_name: "" })];
    await openPage();
    fireEvent.mouseDown(screen.getByTestId("tab-responses"));

    await waitFor(() => expect(screen.getByTestId("my-response-5")).toBeTruthy());
    expect(screen.getByTestId("my-response-5").textContent).toContain("О");
    expect(screen.getByTestId("my-response-6").textContent).toContain("?");
  });

  it("у активной встречи бейджа статуса нет, у неактивной — есть", async () => {
    responsesData = [response({ id: 5, hangout_status: "active" })];
    await openPage();
    fireEvent.mouseDown(screen.getByTestId("tab-responses"));

    await waitFor(() => expect(screen.getByTestId("my-response-5")).toBeTruthy());
    expect(within(screen.getByTestId("my-response-5")).queryByText(tr("hangout.status.active"))).toBeNull();
  });

  it("неизвестный статус отклика не даёт пустой бейдж", async () => {
    responsesData = [response({ id: 5, response_status: "unknown" })];
    await openPage();
    fireEvent.mouseDown(screen.getByTestId("tab-responses"));

    await waitFor(() => expect(screen.getByTestId("my-response-5")).toBeTruthy());
    expect(within(screen.getByTestId("my-response-5")).getByText(tr("hangout.response.pending"))).toBeTruthy();
  });
});

describe("HangoutsMyPage: realtime", () => {
  it("события сокета перезагружают списки", async () => {
    await openPage();
    await waitFor(() => expect(screen.getByTestId("my-hangout-1")).toBeTruthy());

    const before = mockFetch.mock.calls.filter(([url]) => String(url) === "/api/hangouts/my").length;
    mockWs.handlers["hangout:new_response"]?.({});
    await waitFor(() =>
      expect(mockFetch.mock.calls.filter(([url]) => String(url) === "/api/hangouts/my").length).toBeGreaterThan(before),
    );

    const afterFirst = mockFetch.mock.calls.filter(([url]) => String(url) === "/api/hangouts/my").length;
    mockWs.handlers["hangout:response_accepted"]?.({});
    await waitFor(() =>
      expect(mockFetch.mock.calls.filter(([url]) => String(url) === "/api/hangouts/my").length).toBeGreaterThan(afterFirst),
    );

    const afterSecond = mockFetch.mock.calls.filter(([url]) => String(url) === "/api/hangouts/my").length;
    mockWs.handlers["hangout:cancelled"]?.({});
    await waitFor(() =>
      expect(mockFetch.mock.calls.filter(([url]) => String(url) === "/api/hangouts/my").length).toBeGreaterThan(afterSecond),
    );
  });

  it("подписки снимаются при размонтировании", async () => {
    const view = await renderPage();
    await waitFor(() => expect(screen.getByTestId("tab-listings")).toBeTruthy());

    view.unmount();

    expect(mockWs.socket.off).toHaveBeenCalledWith("hangout:new_response", expect.any(Function));
    expect(mockWs.socket.off).toHaveBeenCalledWith("hangout:response_accepted", expect.any(Function));
    expect(mockWs.socket.off).toHaveBeenCalledWith("hangout:cancelled", expect.any(Function));
  });

  it("без сокета подписок нет", async () => {
    wsState.socket = null;
    await openPage();

    expect(mockWs.socket.on).not.toHaveBeenCalled();
  });
});
