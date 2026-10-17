import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import React from "react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { toast } from "sonner";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

vi.mock("@/lib/token", () => ({
  getToken: () => "test-token",
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
        </Routes>
      </MemoryRouter>
    </HelmetProvider>
  );
}

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
