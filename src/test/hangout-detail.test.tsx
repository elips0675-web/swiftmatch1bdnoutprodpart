import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import React from "react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { toast } from "sonner";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

const authState = vi.hoisted(() => ({ token: "test-token" as string | null }));

vi.mock("@/lib/token", () => ({
  getToken: () => authState.token,
}));

const flagsState = vi.hoisted(() => ({ value: { hangoutRelationsEnabled: true } }));

vi.mock("@/context/feature-flags-context", () => ({
  useFeatureFlags: () => flagsState.value,
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("@/hooks/use-premium", () => ({
  usePremium: () => ({ isPremium: false, tier: null, subscription: null, loading: false, daysRemaining: 0, refresh: vi.fn() }),
}));

const mockWs = vi.hoisted(() => {
  const handlers: Record<string, (payload?: any) => void> = {};
  const socket = {
    on: vi.fn((ev: string, cb: (payload?: any) => void) => { handlers[ev] = cb }),
    off: vi.fn(),
    emit: vi.fn(),
  };
  return { socket, handlers };
});

vi.mock("@/hooks/use-websocket", () => ({
  useWebSocket: () => ({ socket: mockWs.socket, connected: false }),
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
  "hangout.action.respond": "Пойдем!",
  "hangout.action.open_chat": "Открыть чат",
  "hangout.action.message_organizer": "Написать организатору",
  "hangout.action.like": "Нравится",
  "hangout.action.skip": "Пропустить",
  "hangout.response.pending": "На рассмотрении",
  "hangout.response.pending_note": "Ваш отклик на рассмотрении.",
  "hangout.label.responses": "Отклики",
  "hangout.status.active": "Активна",
  "hangout.category.cinema": "Кино",
  "hangout.type.date": "Свидание",
  "hangout.watch.subscribe": "Следить",
  "hangout.watch.subscribed": "Вы следите",
  "hangout.watch.count": "Следят: {count}",
  "hangout.watch.toast_subscribed": "Вы следите за встречей",
  "hangout.watch.toast_unsubscribed": "Вы больше не следите за встречей",
  "hangout.watch.error": "Не удалось изменить подписку",
  "hangout.related.same_series": "Та же серия",
  "hangout.related.similar": "Похожие встречи",
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

const baseHangout = {
  id: 5,
  author_id: 10,
  category: "cinema",
  hangout_type: "date",
  title: "Иду на Дюну",
  description: null,
  place_name: "Аврора",
  place_address: null,
  city: "Москва",
  lat: "55.751",
  lng: "37.618",
  event_date: new Date(Date.now() + 86400000).toISOString(),
  max_companions: 1,
  status: "active",
  created_at: new Date().toISOString(),
  display_name: "Максим",
  avatar_url: null,
  is_author: false,
  my_like_status: null,
  my_response_status: null,
  like_count: 0,
  participant_count: 0,
};

function renderDetail(ui: React.ReactElement) {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={["/hangouts/5"]}>
        <Routes>
          <Route path="/hangouts/:id" element={ui} />
          <Route path="/chats/:chatId" element={<div data-testid="chat-page" />} />
          <Route path="/login" element={<div data-testid="login-page" />} />
          <Route path="/hangouts" element={<div data-testid="hangouts-list" />} />
        </Routes>
      </MemoryRouter>
    </HelmetProvider>
  );
}

function renderBare(ui: React.ReactElement) {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={["/bare"]}>
        <Routes>
          <Route path="/bare" element={ui} />
        </Routes>
      </MemoryRouter>
    </HelmetProvider>
  );
}

beforeEach(() => {
  authState.token = "test-token";
  flagsState.value = { hangoutRelationsEnabled: true };
});

describe("HangoutDetailPage (H3 pre-accept chat)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it("shows 'message organizer' button to a pending respondent with a chat", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (String(url).includes("/api/hangouts/5")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ...baseHangout, my_response_status: "pending", chat_id: 300 }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;
    renderDetail(<HangoutDetail />);

    await waitFor(() => {
      expect(screen.getByTestId("message-organizer")).toBeTruthy();
    });
    expect(screen.getByText("Написать организатору")).toBeTruthy();
  })

  it("does not show the message-organizer button when there is no chat yet", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (String(url).includes("/api/hangouts/5")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ...baseHangout, my_response_status: "pending", chat_id: null }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;
    renderDetail(<HangoutDetail />);

    await waitFor(() => {
      expect(screen.getByTestId("response-pending-note")).toBeTruthy();
    });
    expect(screen.queryByTestId("message-organizer")).toBeNull();
  })
});

describe("HangoutDetailPage (P3 #26 watchers/relations)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it("shows the follow button to a non-author and toggles the subscription", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/related")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ sameSeries: [], similar: [] }) });
      }
      if (u.includes("/watch")) {
        expect(init?.method).toBe("POST");
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ watching: true, watcher_count: 1 }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ...baseHangout, watcher_count: 0, is_watching: false }) });
    });
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;
    renderDetail(<HangoutDetail />);

    const button = await screen.findByTestId("watch-hangout");
    expect(button.textContent).toContain("Следить");

    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByTestId("watch-hangout").textContent).toContain("Вы следите");
    });
    expect(toast.success).toHaveBeenCalledWith("Вы следите за встречей");
  });

  it("renders same-series and similar blocks from /related", async () => {
    const related = {
      sameSeries: [{ ...baseHangout, id: 6, title: "Дюна, часть вторая" }],
      similar: [{ ...baseHangout, id: 7, title: "Оппенгеймер" }],
    };
    mockFetch.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/related")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(related) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(baseHangout) });
    });
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;
    renderDetail(<HangoutDetail />);

    await waitFor(() => {
      expect(screen.getByTestId("related-same-series")).toBeTruthy();
    });
    expect(screen.getByTestId("related-similar")).toBeTruthy();
    expect(screen.getByText("Дюна, часть вторая")).toBeTruthy();
    expect(screen.getByText("Оппенгеймер")).toBeTruthy();
  });

  it("does not show the follow button to the author", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (String(url).includes("/related")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ sameSeries: [], similar: [] }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ...baseHangout, is_author: true }) });
    });
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;
    renderDetail(<HangoutDetail />);

    await waitFor(() => {
      expect(screen.getByText("Иду на Дюну")).toBeTruthy();
    });
    expect(screen.queryByTestId("watch-hangout")).toBeNull();
  });
});

interface ApiResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

type RouteHandler = (url: string, init?: RequestInit) => ApiResponse | Promise<ApiResponse> | undefined;

function ok(body: unknown, status = 200): ApiResponse {
  return { ok: true, status, json: () => Promise.resolve(body) };
}

function fail(status: number, body: unknown): ApiResponse {
  return { ok: false, status, json: () => Promise.resolve(body) };
}

function mockApi(data: Record<string, unknown>, extra: RouteHandler[] = []) {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    const u = String(url);
    for (const handler of extra) {
      const result = handler(u, init);
      if (result) return Promise.resolve(result);
    }
    if (u.includes("/related")) return Promise.resolve(ok({ sameSeries: [], similar: [] }));
    if (/\/api\/hangouts\/5$/.test(u)) return Promise.resolve(ok(data));
    return Promise.resolve(ok({}));
  });
}

function stubGeolocation(impl: (success: (position: unknown) => void, error: (err: unknown) => void) => void) {
  Object.defineProperty(globalThis.navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition: vi.fn(impl) },
  });
}

describe("HangoutDetailPage (COV-02: состояния и действия)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it("показывает спиннер, пока встреча грузится", async () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    const { container } = renderDetail(<HangoutDetail />);

    expect(container.querySelector(".animate-spin")).toBeTruthy();
    expect(screen.queryByText("Иду на Дюну")).toBeNull();
  });

  it("404 → состояние «встреча не найдена»", async () => {
    mockFetch.mockImplementation(() => Promise.resolve(fail(404, {})));
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    renderDetail(<HangoutDetail />);

    expect(await screen.findByText("hangout.empty")).toBeTruthy();
  });

  it("ошибка загрузки → toast.error", async () => {
    mockFetch.mockImplementation(() => Promise.resolve(fail(500, {})));
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    renderDetail(<HangoutDetail />);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("hangout.error.load"));
  });

  it("отклик: открывает диалог, отправляет сообщение и уходит в созданный чат", async () => {
    mockApi({ ...baseHangout, my_response_status: null }, [
      (u, init) => {
        if (u.includes("/respond")) {
          expect(init?.method).toBe("POST");
          return ok({ chat_id: 300 });
        }
        return undefined;
      },
    ]);
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    renderDetail(<HangoutDetail />);

    fireEvent.click(await screen.findByTestId("respond-hangout"));
    fireEvent.change(await screen.findByTestId("response-message"), { target: { value: "Возьми меня с собой" } });
    fireEvent.click(screen.getByTestId("submit-response"));

    expect(await screen.findByTestId("chat-page")).toBeTruthy();
    expect(toast.success).toHaveBeenCalledWith("hangout.toast.response_sent");

    const posted = mockFetch.mock.calls.find((c) => String(c[0]).includes("/respond"));
    expect(String((posted?.[1] as RequestInit)?.body)).toContain("Возьми меня с собой");
  });

  it("отклик без chat_id перезагружает встречу", async () => {
    mockApi({ ...baseHangout, my_response_status: null }, [
      (u) => (u.includes("/respond") ? ok({}) : undefined),
    ]);
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    renderDetail(<HangoutDetail />);

    fireEvent.click(await screen.findByTestId("respond-hangout"));
    fireEvent.click(screen.getByTestId("submit-response"));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("hangout.toast.response_sent"));
    const gets = mockFetch.mock.calls.filter((c) => /\/api\/hangouts\/5$/.test(String(c[0])));
    expect(gets.length).toBeGreaterThanOrEqual(2);
  });

  it("отмена отклика вызывает DELETE /respond", async () => {
    let method: string | undefined;
    mockApi({ ...baseHangout, my_response_status: "pending", chat_id: null, status: "active" }, [
      (u, init) => {
        if (u.includes("/respond")) {
          method = init?.method;
          return ok({});
        }
        return undefined;
      },
    ]);
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    renderDetail(<HangoutDetail />);

    fireEvent.click(await screen.findByTestId("cancel-response"));

    await waitFor(() => expect(toast.info).toHaveBeenCalledWith("hangout.toast.response_cancelled"));
    expect(method).toBe("DELETE");
  });

  it("взаимный лайк показывает тост про мэтч", async () => {
    let method: string | undefined;
    mockApi({ ...baseHangout, my_like_status: null }, [
      (u, init) => {
        if (u.includes("/like")) {
          method = init?.method;
          return ok({ mutual: true });
        }
        return undefined;
      },
    ]);
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    renderDetail(<HangoutDetail />);

    fireEvent.click(await screen.findByTestId("like-hangout"));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("hangout.toast.mutual_like"));
    expect(method).toBe("POST");
  });

  it("пропуск отправляет POST /skip", async () => {
    let method: string | undefined;
    mockApi({ ...baseHangout, my_like_status: null }, [
      (u, init) => {
        if (u.includes("/skip")) {
          method = init?.method;
          return ok({});
        }
        return undefined;
      },
    ]);
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    renderDetail(<HangoutDetail />);

    fireEvent.click(await screen.findByTestId("skip-hangout"));

    await waitFor(() => expect(method).toBe("POST"));
  });

  it("company: присоединение отправляет POST /join", async () => {
    let method: string | undefined;
    mockApi({ ...baseHangout, hangout_type: "company", my_participant_status: null, participants: [] }, [
      (u, init) => {
        if (u.includes("/join")) {
          method = init?.method;
          return ok({});
        }
        return undefined;
      },
    ]);
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    renderDetail(<HangoutDetail />);

    fireEvent.click(await screen.findByTestId("join-hangout"));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("hangout.toast.joined"));
    expect(method).toBe("POST");
  });

  it("company: участник проходит чек-ин и покидает встречу", async () => {
    const calls: Array<[string, string | undefined]> = [];
    mockApi(
      {
        ...baseHangout,
        hangout_type: "company",
        my_participant_status: "joined",
        participants: [{ id: 10, user_id: 10, display_name: "Максим", role: "organizer" }],
      },
      [
        (u, init) => {
          if (u.includes("/checkin")) {
            calls.push(["checkin", init?.method]);
            return ok({});
          }
          if (u.includes("/join")) {
            calls.push(["join", init?.method]);
            return ok({});
          }
          return undefined;
        },
      ],
    );
    stubGeolocation((success) => success({ coords: { latitude: 55.75, longitude: 37.61 } }));
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    renderDetail(<HangoutDetail />);

    fireEvent.click(await screen.findByTestId("checkin-hangout"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("hangout.toast.checked_in"));
    expect(calls).toContainEqual(["checkin", "POST"]);

    fireEvent.click(screen.getByTestId("leave-hangout"));
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith("hangout.toast.left"));
    expect(calls).toContainEqual(["join", "DELETE"]);
  });

  it("company: отказ геолокации → тост про неудачный чек-ин", async () => {
    mockApi({ ...baseHangout, hangout_type: "company", my_participant_status: "joined" });
    stubGeolocation((_success, error) => error(new Error("denied")));
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    renderDetail(<HangoutDetail />);

    fireEvent.click(await screen.findByTestId("checkin-hangout"));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("hangout.error.checkin_failed"));
  });

  it("company без участников показывает пустое состояние", async () => {
    mockApi({ ...baseHangout, hangout_type: "company", participants: [] });
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    renderDetail(<HangoutDetail />);

    expect(await screen.findByText("hangout.label.no_participants")).toBeTruthy();
  });

  it("платный билет: покупка подтверждается тостом", async () => {
    let method: string | undefined;
    mockApi({ ...baseHangout, price: 500, my_ticket_status: null }, [
      (u, init) => {
        if (u.includes("/purchase")) {
          method = init?.method;
          return ok({ paid: true });
        }
        return undefined;
      },
    ]);
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    renderDetail(<HangoutDetail />);

    fireEvent.click(await screen.findByTestId("buy-hangout-ticket"));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("hangout.ticket.purchased"));
    expect(method).toBe("POST");
  });

  it("билеты распроданы → тост вместо ошибки", async () => {
    mockApi({ ...baseHangout, price: 500, my_ticket_status: null }, [
      (u) => (u.includes("/purchase") ? fail(409, { message: "CAPACITY_FULL" }) : undefined),
    ]);
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    renderDetail(<HangoutDetail />);

    fireEvent.click(await screen.findByTestId("buy-hangout-ticket"));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("hangout.ticket.full"));
  });

  it("оплаченный билет помечается бейджем", async () => {
    mockApi({ ...baseHangout, price: 500, my_ticket_status: "paid" });
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    renderDetail(<HangoutDetail />);

    expect(await screen.findByTestId("hangout-ticket-paid")).toBeTruthy();
  });

  it("автор принимает и отклоняет отклики", async () => {
    const decisions: string[] = [];
    mockApi(
      {
        ...baseHangout,
        is_author: true,
        responses: [
          { id: 1, user_id: 2, display_name: "Оля", status: "pending", message: "Хочу с вами" },
          { id: 2, user_id: 3, display_name: "Ника", status: "pending", message: null },
        ],
      },
      [
        (u, init) => {
          if (/\/responses\/\d+$/.test(u)) {
            decisions.push(JSON.parse(String(init?.body)).status);
            return ok({});
          }
          return undefined;
        },
      ],
    );
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    renderDetail(<HangoutDetail />);

    expect(await screen.findByTestId("edit-hangout")).toBeTruthy();
    expect(screen.getByText("Хочу с вами")).toBeTruthy();

    fireEvent.click(screen.getByTestId("accept-response-1"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("hangout.toast.accepted"));

    fireEvent.click(screen.getByTestId("decline-response-2"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("hangout.toast.declined"));

    expect(decisions).toEqual(["accepted", "declined"]);
  });

  it("свидание с лайком показывает переход в чат", async () => {
    mockApi({ ...baseHangout, my_like_status: "like", chat_id: 77 });
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    renderDetail(<HangoutDetail />);

    expect(await screen.findByTestId("open-chat")).toBeTruthy();
  });

  it("рисует описание и расстояние до места", async () => {
    mockApi({ ...baseHangout, description: "Смотрим Дюну в IMAX", distance_km: 3.4 });
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    renderDetail(<HangoutDetail />);

    expect(await screen.findByText("Смотрим Дюну в IMAX")).toBeTruthy();
    expect(screen.getByText("hangout.label.distance")).toBeTruthy();
  });
});

describe("HangoutDetailPage (COV-02 часть 7: ветки ошибок и щели интерфейса)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("без :id не грузит встречу и показывает спиннер", async () => {
    authState.token = null;
    mockFetch.mockResolvedValue(ok({}));
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    const { container } = renderBare(<HangoutDetail />);

    expect(container.querySelector(".animate-spin")).toBeTruthy();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("без токена грузит без заголовка Authorization — и встреча, и связи", async () => {
    authState.token = null;
    mockApi({ ...baseHangout });
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    renderDetail(<HangoutDetail />);

    expect(await screen.findByText("Иду на Дюну")).toBeTruthy();
    const detail = mockFetch.mock.calls.find((c) => /\/api\/hangouts\/5$/.test(String(c[0])));
    expect((detail?.[1] as RequestInit)?.headers).toEqual({});
    const related = mockFetch.mock.calls.find((c) => String(c[0]).includes("/related"));
    expect((related?.[1] as RequestInit)?.headers).toEqual({});
  });

  it.each([
    ["watch-hangout"],
    ["skip-hangout"],
    ["like-hangout"],
    ["respond-hangout"],
  ])("без токена клик по %s уводит на /login", async (testid) => {
    authState.token = null;
    mockApi({ ...baseHangout, my_like_status: null, my_response_status: null });
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    renderDetail(<HangoutDetail />);

    fireEvent.click(await screen.findByTestId(testid));
    expect(await screen.findByTestId("login-page")).toBeTruthy();
  });

  it("без токена отмена отклика уводит на /login", async () => {
    authState.token = null;
    mockApi({ ...baseHangout, my_response_status: "pending", status: "active", chat_id: null });
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    renderDetail(<HangoutDetail />);

    fireEvent.click(await screen.findByTestId("cancel-response"));
    expect(await screen.findByTestId("login-page")).toBeTruthy();
  });

  it("без токена покупка билета уводит на /login", async () => {
    authState.token = null;
    mockApi({ ...baseHangout, price: 500, my_ticket_status: null });
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    renderDetail(<HangoutDetail />);

    fireEvent.click(await screen.findByTestId("buy-hangout-ticket"));
    expect(await screen.findByTestId("login-page")).toBeTruthy();
  });

  it("без токена присоединение к company уводит на /login", async () => {
    authState.token = null;
    mockApi({ ...baseHangout, hangout_type: "company", participants: [] });
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    renderDetail(<HangoutDetail />);

    fireEvent.click(await screen.findByTestId("join-hangout"));
    expect(await screen.findByTestId("login-page")).toBeTruthy();
  });

  it("при выключенном hangoutRelations нет подписки и связанных блоков", async () => {
    flagsState.value = { hangoutRelationsEnabled: false };
    mockApi({ ...baseHangout });
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    renderDetail(<HangoutDetail />);

    expect(await screen.findByText("Иду на Дюну")).toBeTruthy();
    expect(screen.queryByTestId("watch-hangout")).toBeNull();
    expect(screen.queryByTestId("related-similar")).toBeNull();
    expect(mockFetch.mock.calls.some((c) => String(c[0]).includes("/related"))).toBe(false);
  });

  it("связанные: only similar без sameSeries рисует лишь «похожие»", async () => {
    mockFetch.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/related")) return Promise.resolve(ok({ similar: [{ ...baseHangout, id: 9, title: "Похожая встреча" }] }));
      return Promise.resolve(ok(baseHangout));
    });
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    renderDetail(<HangoutDetail />);

    expect(await screen.findByTestId("related-similar")).toBeTruthy();
    expect(screen.queryByTestId("related-same-series")).toBeNull();
  });

  it("связанные: only sameSeries без similar рисует лишь «серию»", async () => {
    mockFetch.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/related")) return Promise.resolve(ok({ sameSeries: [{ ...baseHangout, id: 9, title: "Серия" }] }));
      return Promise.resolve(ok(baseHangout));
    });
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    renderDetail(<HangoutDetail />);

    expect(await screen.findByTestId("related-same-series")).toBeTruthy();
    expect(screen.queryByTestId("related-similar")).toBeNull();
  });

  it("связанные: ответ не-массив игнорируется", async () => {
    mockFetch.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/related")) return Promise.resolve(ok({ foo: 1 }));
      return Promise.resolve(ok(baseHangout));
    });
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    renderDetail(<HangoutDetail />);

    expect(await screen.findByText("Иду на Дюну")).toBeTruthy();
    expect(screen.queryByTestId("related-same-series")).toBeNull();
    expect(screen.queryByTestId("related-similar")).toBeNull();
  });

  it("связанные: не-2xx и падение запроса проходят молча", async () => {
    mockFetch.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/related")) return Promise.resolve(fail(500, {}));
      return Promise.resolve(ok(baseHangout));
    });
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;
    const first = renderDetail(<HangoutDetail />);
    expect(await screen.findByText("Иду на Дюну")).toBeTruthy();
    expect(screen.queryByTestId("related-same-series")).toBeNull();
    first.unmount();

    mockFetch.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/related")) return Promise.reject(new Error("network"));
      return Promise.resolve(ok(baseHangout));
    });
    renderDetail(<HangoutDetail />);
    expect(await screen.findByText("Иду на Дюну")).toBeTruthy();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("повторный клик по «Следить» шлёт DELETE и сохраняет прежний счётчик", async () => {
    let method: string | undefined;
    mockApi({ ...baseHangout, is_watching: true, watcher_count: 5 }, [
      (u, init) => {
        if (u.includes("/watch")) {
          method = init?.method;
          return ok({ watching: false });
        }
        return undefined;
      },
    ]);
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    renderDetail(<HangoutDetail />);

    const button = await screen.findByTestId("watch-hangout");
    expect(button.textContent).toContain("Вы следите");
    fireEvent.click(button);

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Вы больше не следите за встречей"));
    expect(method).toBe("DELETE");
    expect(screen.getByText("Следят: 5")).toBeTruthy();
  });

  it("ошибка подписки на встречу даёт тост", async () => {
    mockApi({ ...baseHangout, is_watching: false, watcher_count: 0 }, [
      (u) => (u.includes("/watch") ? fail(500, {}) : undefined),
    ]);
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    renderDetail(<HangoutDetail />);

    fireEvent.click(await screen.findByTestId("watch-hangout"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Не удалось изменить подписку"));
  });

  it("сокет-события по встрече перечитывают её, отписка снимает обработчики", async () => {
    mockApi(baseHangout);
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    const { unmount } = renderDetail(<HangoutDetail />);
    await screen.findByText("Иду на Дюну");

    const before = mockFetch.mock.calls.filter((c) => /\/api\/hangouts\/5$/.test(String(c[0]))).length;
    await act(async () => {
      mockWs.handlers["hangout:new_response"]?.();
      mockWs.handlers["hangout:response_accepted"]?.();
      mockWs.handlers["hangout:cancelled"]?.();
    });
    const after = mockFetch.mock.calls.filter((c) => /\/api\/hangouts\/5$/.test(String(c[0]))).length;
    expect(after).toBeGreaterThanOrEqual(before + 3);

    unmount();
    expect(mockWs.socket.off).toHaveBeenCalledWith("hangout:new_response", expect.any(Function));
  });

  it("отклик: 401 уводит на /login", async () => {
    mockApi({ ...baseHangout, my_response_status: null }, [
      (u) => (u.includes("/respond") ? fail(401, {}) : undefined),
    ]);
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    renderDetail(<HangoutDetail />);
    fireEvent.click(await screen.findByTestId("respond-hangout"));
    fireEvent.click(await screen.findByTestId("submit-response"));

    expect(await screen.findByTestId("login-page")).toBeTruthy();
  });

  it("отклик: серверная ошибка даёт тост", async () => {
    mockApi({ ...baseHangout, my_response_status: null }, [
      (u) => (u.includes("/respond") ? fail(500, {}) : undefined),
    ]);
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    renderDetail(<HangoutDetail />);
    fireEvent.click(await screen.findByTestId("respond-hangout"));
    fireEvent.click(await screen.findByTestId("submit-response"));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("hangout.error.load"));
  });

  it("отмена отклика: серверная ошибка даёт тост", async () => {
    mockApi({ ...baseHangout, my_response_status: "pending", status: "active" }, [
      (u) => (u.includes("/respond") ? fail(500, {}) : undefined),
    ]);
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    renderDetail(<HangoutDetail />);
    fireEvent.click(await screen.findByTestId("cancel-response"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("hangout.error.load"));
  });

  it("решение автора: серверная ошибка даёт тост", async () => {
    mockApi(
      { ...baseHangout, is_author: true, responses: [{ id: 1, user_id: 2, display_name: "Оля", status: "pending", message: null }] },
      [(u) => (/\/responses\/\d+$/.test(u) ? fail(500, {}) : undefined)],
    );
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    renderDetail(<HangoutDetail />);
    fireEvent.click(await screen.findByTestId("accept-response-1"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("hangout.error.load"));
  });

  it("лайк без мэтча показывает обычный тост", async () => {
    mockApi({ ...baseHangout, my_like_status: null }, [
      (u) => (u.includes("/like") ? ok({ mutual: false }) : undefined),
    ]);
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    renderDetail(<HangoutDetail />);
    fireEvent.click(await screen.findByTestId("like-hangout"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("hangout.toast.liked"));
  });

  it("лайк: 401 уводит на /login, ошибка сервера — тост", async () => {
    mockApi({ ...baseHangout, my_like_status: null }, [
      (u) => (u.includes("/like") ? fail(401, {}) : undefined),
    ]);
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;
    const first = renderDetail(<HangoutDetail />);
    fireEvent.click(await screen.findByTestId("like-hangout"));
    expect(await screen.findByTestId("login-page")).toBeTruthy();
    first.unmount();

    mockApi({ ...baseHangout, my_like_status: null }, [
      (u) => (u.includes("/like") ? fail(500, {}) : undefined),
    ]);
    renderDetail(<HangoutDetail />);
    fireEvent.click(await screen.findByTestId("like-hangout"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("hangout.error.load"));
  });

  it("падение запроса «пропустить» даёт тост", async () => {
    mockFetch.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/skip")) return Promise.reject(new Error("down"));
      if (u.includes("/related")) return Promise.resolve(ok({ sameSeries: [], similar: [] }));
      return Promise.resolve(ok({ ...baseHangout, my_like_status: null }));
    });
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    renderDetail(<HangoutDetail />);
    fireEvent.click(await screen.findByTestId("skip-hangout"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("hangout.error.load"));
  });

  it("падение запроса «покинуть» даёт тост", async () => {
    let deleted = false;
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/related")) return Promise.resolve(ok({ sameSeries: [], similar: [] }));
      if (u.endsWith("/join") && init?.method === "DELETE") {
        deleted = true;
        return Promise.reject(new Error("down"));
      }
      return Promise.resolve(ok({ ...baseHangout, hangout_type: "company", my_participant_status: "joined" }));
    });
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    renderDetail(<HangoutDetail />);
    fireEvent.click(await screen.findByTestId("leave-hangout"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("hangout.error.load"));
    expect(deleted).toBe(true);
  });

  it("company: 401 при присоединении уводит на /login", async () => {
    mockApi({ ...baseHangout, hangout_type: "company", participants: [] }, [
      (u) => (u.includes("/join") ? fail(401, {}) : undefined),
    ]);
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    renderDetail(<HangoutDetail />);
    fireEvent.click(await screen.findByTestId("join-hangout"));
    expect(await screen.findByTestId("login-page")).toBeTruthy();
  });

  it("company: ошибка присоединения даёт тост", async () => {
    mockApi({ ...baseHangout, hangout_type: "company", participants: [] }, [
      (u) => (u.includes("/join") ? fail(500, {}) : undefined),
    ]);
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    renderDetail(<HangoutDetail />);
    fireEvent.click(await screen.findByTestId("join-hangout"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("hangout.error.load"));
  });

  it("company: отказ чек-ина показывает причину сервера, пустой — общий тост", async () => {
    stubGeolocation((success) => success({ coords: { latitude: 55.75, longitude: 37.61 } }));
    mockApi({ ...baseHangout, hangout_type: "company", my_participant_status: "joined" }, [
      (u) => (u.includes("/checkin") ? fail(400, { message: "Слишком далеко от места" }) : undefined),
    ]);
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;
    const first = renderDetail(<HangoutDetail />);
    fireEvent.click(await screen.findByTestId("checkin-hangout"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Слишком далеко от места"));
    first.unmount();

    mockApi({ ...baseHangout, hangout_type: "company", my_participant_status: "joined" }, [
      (u) => (u.includes("/checkin") ? fail(500, {}) : undefined),
    ]);
    renderDetail(<HangoutDetail />);
    fireEvent.click(await screen.findByTestId("checkin-hangout"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("hangout.error.load"));
  });

  it("билет: отказ сервера показывает причину, без причины и при падении — общий тост", async () => {
    mockApi({ ...baseHangout, price: 500, my_ticket_status: null }, [
      (u) => (u.includes("/purchase") ? fail(500, { message: "PAYMENT_FAILED" }) : undefined),
    ]);
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;
    const first = renderDetail(<HangoutDetail />);
    fireEvent.click(await screen.findByTestId("buy-hangout-ticket"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("PAYMENT_FAILED"));
    first.unmount();

    mockFetch.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/related")) return Promise.resolve(ok({ sameSeries: [], similar: [] }));
      if (u.includes("/purchase")) return Promise.reject(new Error("down"));
      return Promise.resolve(ok({ ...baseHangout, price: 500, my_ticket_status: null }));
    });
    renderDetail(<HangoutDetail />);
    fireEvent.click(await screen.findByTestId("buy-hangout-ticket"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("hangout.error.load"));
  });

  it("билет: отказ Stripe показывает ключ, а не сырой английский message", async () => {
    mockApi({ ...baseHangout, price: 500, my_ticket_status: null }, [
      (u) => (u.includes("/purchase")
        ? fail(503, { message: "Stripe not configured for production", code: "STRIPE_NOT_CONFIGURED" })
        : undefined),
    ]);
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    renderDetail(<HangoutDetail />);
    fireEvent.click(await screen.findByTestId("buy-hangout-ticket"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("hangout.stripe_unavailable"));
    expect(toast.error).not.toHaveBeenCalledWith("Stripe not configured for production");
  });

  it("билет: ответ без оплаты и без ссылки ничего не подтверждает", async () => {
    mockApi({ ...baseHangout, price: 500, my_ticket_status: null }, [
      (u) => (u.includes("/purchase") ? ok({ paid: false }) : undefined),
    ]);
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    renderDetail(<HangoutDetail />);
    fireEvent.click(await screen.findByTestId("buy-hangout-ticket"));
    await waitFor(() =>
      expect(mockFetch.mock.calls.some((c) => String(c[0]).includes("/purchase"))).toBe(true),
    );
    expect(toast.success).not.toHaveBeenCalledWith("hangout.ticket.purchased");
  });

  it("билет: ссылка на оплату уводит на внешний checkout", async () => {
    const locationStub = { href: "" };
    vi.stubGlobal("location", locationStub);
    mockApi({ ...baseHangout, price: 500, my_ticket_status: null }, [
      (u) => (u.includes("/purchase") ? ok({ url: "https://checkout.stripe.com/session/abc" }) : undefined),
    ]);
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    renderDetail(<HangoutDetail />);
    fireEvent.click(await screen.findByTestId("buy-hangout-ticket"));
    await waitFor(() => expect(locationStub.href).toBe("https://checkout.stripe.com/session/abc"));
  });

  it("платный билет показывает занятость при известной вместимости", async () => {
    mockApi({ ...baseHangout, price: 500, capacity: 10, sold_tickets: 3, my_ticket_status: null });
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    renderDetail(<HangoutDetail />);

    expect(await screen.findByText(/· 3\/10/)).toBeTruthy();
  });

  it("аватар автора и статусы blocked/paused меняют карточку", async () => {
    mockApi({ ...baseHangout, avatar_url: "/uploads/ava.png", status: "blocked" });
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;
    const { container, unmount } = renderDetail(<HangoutDetail />);
    expect(await screen.findByText("hangout.status.blocked")).toBeTruthy();
    expect(container.querySelector('img[src="/uploads/ava.png"]')).toBeTruthy();
    unmount();

    mockApi({ ...baseHangout, status: "paused" });
    renderDetail(<HangoutDetail />);
    expect(await screen.findByText("hangout.status.paused")).toBeTruthy();
  });

  it("без описания и места рисует заголовок и прячет блок «где»", async () => {
    mockApi({ ...baseHangout, description: null, place_name: null, place_address: null, city: null, like_count: null });
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    renderDetail(<HangoutDetail />);

    expect(await screen.findByText("Иду на Дюну")).toBeTruthy();
    expect(screen.queryByText("hangout.label.where")).toBeNull();
  });

  it("автор видит ссылку на чат встречи и пустой список откликов", async () => {
    mockApi({ ...baseHangout, is_author: true, responses: [], chat_id: 42 });
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    renderDetail(<HangoutDetail />);

    expect(await screen.findByText("hangout.label.no_responses_yet")).toBeTruthy();
    expect(screen.getAllByRole("link").some((a) => a.getAttribute("href") === "/chats/42")).toBe(true);
  });

  it("отклики: аватар и заглушка для пустого имени", async () => {
    mockApi({
      ...baseHangout,
      is_author: true,
      chat_id: null,
      responses: [
        { id: 1, user_id: 2, display_name: "Оля", avatar_url: "/uploads/o.png", status: "accepted", message: null },
        { id: 2, user_id: 3, display_name: "", avatar_url: null, status: "declined", message: null },
      ],
    });
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    const { container } = renderDetail(<HangoutDetail />);

    expect(await screen.findByText("Оля")).toBeTruthy();
    expect(container.querySelector('img[src="/uploads/o.png"]')).toBeTruthy();
    expect(screen.getByText("?")).toBeTruthy();
    expect(screen.getByText("hangout.response.accepted")).toBeTruthy();
    expect(screen.getByText("hangout.response.declined")).toBeTruthy();
  });

  it("company: участник с чатом и автор видят ссылку на чат", async () => {
    mockApi({
      ...baseHangout,
      hangout_type: "company",
      my_participant_status: "joined",
      participant_count: null,
      chat_id: 77,
      participants: [],
    });
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;
    const first = renderDetail(<HangoutDetail />);
    expect(await screen.findByText("hangout.label.no_participants")).toBeTruthy();
    expect(screen.getAllByRole("link").some((a) => a.getAttribute("href") === "/chats/77")).toBe(true);
    first.unmount();

    mockApi({ ...baseHangout, hangout_type: "company", is_author: true, chat_id: 88, participants: [] });
    renderDetail(<HangoutDetail />);
    expect(await screen.findByText("hangout.label.participants")).toBeTruthy();
    expect(screen.getAllByRole("link").some((a) => a.getAttribute("href") === "/chats/88")).toBe(true);
  });

  it("company: аватар участника и заглушка пустого имени", async () => {
    mockApi({
      ...baseHangout,
      hangout_type: "company",
      is_author: true,
      participants: [
        { id: 1, user_id: 10, display_name: "Ольга", avatar_url: "/uploads/m.png", role: "organizer" },
        { id: 2, user_id: 11, display_name: "", avatar_url: null, role: "member" },
      ],
    });
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    const { container } = renderDetail(<HangoutDetail />);

    expect(await screen.findByText("Ольга")).toBeTruthy();
    expect(container.querySelector('img[src="/uploads/m.png"]')).toBeTruthy();
    expect(screen.getByText("hangout.label.organizer")).toBeTruthy();
    expect(screen.getAllByText("?").length).toBeGreaterThanOrEqual(1);
  });

  it("кнопка «назад» на карточке ведёт в ленту встреч", async () => {
    mockApi(baseHangout);
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;

    renderDetail(<HangoutDetail />);
    fireEvent.click(await screen.findByTestId("hangout-detail-back"));
    expect(await screen.findByTestId("hangouts-list")).toBeTruthy();
  });

  it("на пустом экране кнопка «назад» ведёт в ленту, а отмена диалога отклика закрывает его", async () => {
    mockFetch.mockImplementation(() => Promise.resolve(fail(404, {})));
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;
    const { unmount } = renderDetail(<HangoutDetail />);
    fireEvent.click(await screen.findByTestId("hangout-detail-back"));
    expect(await screen.findByTestId("hangouts-list")).toBeTruthy();
    unmount();

    mockApi({ ...baseHangout, my_response_status: null });
    renderDetail(<HangoutDetail />);
    await screen.findByText("Иду на Дюну");
    fireEvent.click(screen.getByTestId("respond-hangout"));
    expect(await screen.findByTestId("response-message")).toBeTruthy();
    fireEvent.click(screen.getByText("hangout.action.cancel"));
    await waitFor(() => expect(screen.queryByTestId("response-message")).toBeNull());
  });
});
