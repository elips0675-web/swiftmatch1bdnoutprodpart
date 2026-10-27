import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import React from "react";
import { MemoryRouter, useLocation } from "react-router-dom";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

const h = vi.hoisted(() => {
  const tokenState = { value: "test-token" as string | null };
  const authState = { user: { id: 7 } as { id: number } | null, isLoading: false };
  const flagsState = { partnerOffersEnabled: false };
  const wsHandlers: Record<string, (payload?: any) => void> = {};
  const wsSocket = {
    on: vi.fn((ev: string, cb: (payload?: any) => void) => {
      wsHandlers[ev] = cb;
    }),
    off: vi.fn(),
    emit: vi.fn(),
  };
  const wsState = { socket: wsSocket as unknown };
  const webrtcMock = {
    startCall: vi.fn(),
    endCall: vi.fn(),
    localStream: null,
    remoteStream: null,
    callState: "idle",
  };
  const trackEventMock = vi.fn();
  const toastMock = vi.fn();
  const partnerProps = { value: null as null | { placement?: string; chatId?: number; onShared?: () => void } };
  return { tokenState, authState, flagsState, wsHandlers, wsSocket, wsState, webrtcMock, trackEventMock, toastMock, partnerProps };
});

const { tokenState, authState, flagsState, wsHandlers, wsSocket, wsState, webrtcMock, trackEventMock, toastMock, partnerProps } = h;

vi.mock("@/lib/token", () => ({ getToken: () => h.tokenState.value }));

vi.mock("@/context/auth-context", () => ({
  useAuth: () => ({ user: h.authState.user, isLoading: h.authState.isLoading }),
}));

vi.mock("@/context/feature-flags-context", () => ({
  useFeatureFlags: () => ({ partnerOffersEnabled: h.flagsState.partnerOffersEnabled }),
}));

vi.mock("@/hooks/use-websocket", () => ({
  useWebSocket: () => ({ socket: h.wsState.socket, connected: true }),
}));

vi.mock("@/hooks/use-webrtc", () => ({ useWebRTC: () => h.webrtcMock }));

vi.mock("@/hooks/useExperiment", () => ({ useTrackEvent: () => h.trackEventMock }));

vi.mock("@/hooks/use-toast", () => ({ toast: h.toastMock }));

vi.mock("@/hooks/useAntiScreenshot", async () => {
  const ReactRef = await import("react");
  return { useAntiScreenshot: () => ReactRef.useRef<HTMLDivElement>(null) };
});

vi.mock("@/components/chat/chat-partner-actions", () => ({
  ChatPartnerActions: (props: { placement?: string; chatId?: number; onShared?: () => void }) => {
    h.partnerProps.value = props;
    return <div data-testid="partner-actions" />;
  },
}));

vi.mock("@/components/opening-lines-picker", () => ({
  OpeningLinesPicker: ({ onPick }: { onPick: (text: string) => void }) => (
    <button data-testid="opening-lines" onClick={() => onPick("Привет из подсказки")} />
  ),
}));

vi.mock("@/components/video-call", () => ({
  VideoCallDialog: ({
    open,
    onOpenChange,
    onToggleMute,
    onToggleVideo,
    isMuted,
    isVideoOff,
  }: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    onToggleMute: () => void;
    onToggleVideo: () => void;
    isMuted: boolean;
    isVideoOff: boolean;
  }) =>
    open ? (
      <div data-testid="video-dialog" data-muted={String(isMuted)} data-video-off={String(isVideoOff)}>
        <button data-testid="video-mute" onClick={onToggleMute} />
        <button data-testid="video-off" onClick={onToggleVideo} />
        <button data-testid="video-close" onClick={() => onOpenChange(false)} />
      </div>
    ) : null,
}));

vi.mock("@/components/voice-call", () => ({
  VoiceCallDialog: ({
    open,
    onOpenChange,
    onToggleMute,
    isMuted,
  }: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    onToggleMute: () => void;
    isMuted: boolean;
  }) =>
    open ? (
      <div data-testid="voice-dialog" data-muted={String(isMuted)}>
        <button data-testid="voice-mute" onClick={onToggleMute} />
        <button data-testid="voice-close" onClick={() => onOpenChange(false)} />
      </div>
    ) : null,
}));

const mockTranslations: Record<string, string> = {
  "error.chat_not_found": "Чат не найден",
  "error.generic_title": "Что-то пошло не так",
  "error.send_message": "Не удалось отправить сообщение",
  "error.edit_message": "Не удалось изменить сообщение",
  "error.reaction": "Не удалось поставить реакцию",
  "error.load_messages": "Не удалось загрузить сообщения",
  "button.back": "Назад",
  "button.save": "Сохранить",
  "button.cancel": "Отмена",
  "button.send": "Отправить",
  "chats.today": "Сегодня",
  "chats.you": "Вы",
  "chats.unknown_user": "Пользователь",
  "chats.edited": "изменено",
  "chats.placeholder": "Ваше сообщение...",
  "chats.reply": "Ответить",
  "chats.reply_to": "Ответ {name}",
  "chats.reply_unavailable": "Сообщение недоступно",
  "chats.cancel_reply": "Отменить ответ",
  "chats.add_reaction": "Добавить реакцию",
  "chats.edit": "Редактировать",
  "chats.actions": "Действия",
  "chats.video_call": "Видеозвонок",
  "chats.voice_call": "Аудиозвонок",
  "chats.ttl": "Исчезающее сообщение",
  "chats.ttl_off": "Выкл",
  "chats.ttl_5s": "5 сек",
  "chats.ttl_30s": "30 сек",
  "chats.ttl_1m": "1 мин",
  "chats.ttl_5m": "5 мин",
  "chats.ttl_1h": "1 час",
  "chats.ttl_24h": "24 часа",
  "chats.hangout_context": "Встреча: «{title}»",
  "partner.card.guests": "Гостей: {count}",
  "partner.booking.title": "Бронирование",
};

const languageState = { value: "RU" as "RU" | "EN" };

const mockUseLanguage = {
  t: (key: string, options?: Record<string, any>) => {
    let value = mockTranslations[key] ?? key;
    if (options) {
      Object.entries(options).forEach(([k, v]) => {
        value = value.replace(`{${k}}`, String(v));
      });
    }
    return value;
  },
  get language() {
    return languageState.value;
  },
  setLanguage: vi.fn(),
};
vi.mock("@/context/language-context", () => ({
  useLanguage: () => mockUseLanguage,
}));

import ChatPage from "@/pages/chats-chatId";

const CHAT_ID = "7";
const tr = (key: string, options?: Record<string, any>) => mockUseLanguage.t(key, options);

const partnerState = { user_id: 8, name: "Аня", avatar: "/a.png", common_interest: "sport" };

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: 50,
    sender_id: 8,
    text: "свежее",
    image_url: null,
    reply_to: null,
    reply_text: null,
    reply_sender_name: null,
    reply_image_url: null,
    ttl_seconds: null,
    created_at: new Date().toISOString(),
    edited_at: null,
    sender_name: "Аня",
    seen: true,
    reactions: [],
    ...overrides,
  };
}

let firstPage: Record<string, unknown> = {
  messages: [message()],
  has_more: false,
  next_before: 50,
};
let olderPage: Record<string, unknown> = { messages: [], has_more: false, next_before: null };

function json(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function isMessagesGet(url: string, init?: RequestInit) {
  return String(url).startsWith(`/api/chats/${CHAT_ID}/messages`) && (init?.method ?? "GET") === "GET";
}

function routeFetch(url: string, init?: RequestInit) {
  const u = String(url);
  const method = init?.method ?? "GET";
  if (isMessagesGet(u, init)) {
    return Promise.resolve(json(/[?&]before=/.test(u) ? olderPage : firstPage));
  }
  if (u.startsWith(`/api/chats/${CHAT_ID}/messages`) && method === "POST") return Promise.resolve(json({ id: 900 }));
  if (u.includes("/reactions") && method === "POST") return Promise.resolve(json({ ok: true }));
  if (u.startsWith(`/api/chats/${CHAT_ID}/messages/`) && method === "PUT") return Promise.resolve(json({ ok: true }));
  if (u.split("?")[0] === `/api/chats/${CHAT_ID}`) return Promise.resolve(json(partnerState));
  if (u.includes("/api/hangouts/by-chat/")) return Promise.resolve(json({}, 404));
  if (u.includes("/read")) return Promise.resolve(json({}));
  return Promise.resolve(json({}, 404));
}

function posts() {
  return mockFetch.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");
}

function messageGets() {
  return mockFetch.mock.calls.filter(([url, init]) => isMessagesGet(String(url), init as RequestInit | undefined));
}

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname}</div>;
}

function renderChat(entries: string[] = [`/chats/${CHAT_ID}`]) {
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <ChatPage params={{ chatId: CHAT_ID }} />
      <LocationProbe />
    </MemoryRouter>,
  );
}

async function openChat() {
  const view = renderChat();
  await screen.findByText("свежее");
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockReset();
  tokenState.value = "test-token";
  authState.user = { id: 7 };
  authState.isLoading = false;
  flagsState.partnerOffersEnabled = false;
  languageState.value = "RU";
  wsState.socket = wsSocket;
  Object.keys(wsHandlers).forEach((k) => delete wsHandlers[k]);
  partnerProps.value = null;
  partnerState.user_id = 8;
  partnerState.name = "Аня";
  partnerState.avatar = "/a.png";
  firstPage = { messages: [message()], has_more: false, next_before: 50 };
  olderPage = { messages: [], has_more: false, next_before: null };
  Element.prototype.scrollIntoView = vi.fn();
  mockFetch.mockImplementation((url: string, init?: RequestInit) => routeFetch(url, init));
});

describe("Комната чата: загрузка и отказы", () => {
  it("до первой загрузки скелетон, а не «чат не найден»", async () => {
    const resolvers: Array<() => void> = [];
    mockFetch.mockImplementation(
      (url: string) =>
        new Promise((resolve) => {
          resolvers.push(() => resolve(String(url).split("?")[0] === `/api/chats/${CHAT_ID}` ? json(partnerState) : json(firstPage)));
        }),
    );

    renderChat();

    expect(screen.queryByTestId("message-list")).toBeNull();
    expect(screen.queryByText(tr("error.chat_not_found"))).toBeNull();

    await act(async () => {
      resolvers.forEach((release) => release());
    });
    await screen.findByTestId("message-list");
  });

  it("отказ загрузки сообщений не выдаёт живой чат за «не найден»", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (isMessagesGet(u, init)) return Promise.resolve(json({ message: "boom" }, 500));
      return routeFetch(url, init);
    });

    renderChat();

    await screen.findByText(tr("error.load_messages"));
    expect(screen.queryByText(tr("error.chat_not_found"))).toBeNull();
  });

  it("отказ загрузки собеседника даёт «чат не найден»", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.split("?")[0] === `/api/chats/${CHAT_ID}`) return Promise.resolve(json({ message: "nope" }, 404));
      return routeFetch(url, init);
    });

    renderChat();

    await screen.findByText(tr("error.chat_not_found"));
  });

  it("кнопка «Назад» на странице ошибки возвращает в список чатов", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.split("?")[0] === `/api/chats/${CHAT_ID}`) return Promise.resolve(json({}, 404));
      return routeFetch(url, init);
    });

    renderChat(["/chats", `/chats/${CHAT_ID}`]);
    await screen.findByText(tr("error.chat_not_found"));

    fireEvent.click(screen.getByText(tr("button.back")));

    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/chats"));
  });

  it("перезагрузка по сокету не прячет уже загруженный чат в скелетон", async () => {
    await openChat();

    let release: (() => void) | null = null;
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (isMessagesGet(url, init)) {
        return new Promise((resolve) => {
          release = () => resolve(json(firstPage));
        });
      }
      return routeFetch(url, init);
    });

    act(() => wsHandlers["chat:message-deleted"]?.({ chatId: Number(CHAT_ID), messageIds: [50] }));

    await waitFor(() => expect(release).toBeTruthy());
    expect(screen.getByTestId("message-list")).toBeTruthy();
    expect(screen.getByText("свежее")).toBeTruthy();

    act(() => release?.());
    await waitFor(() => expect(screen.getByText("свежее")).toBeTruthy());
  });

  it("упавшая перезагрузка не стирает переписку с экрана", async () => {
    await openChat();

    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (isMessagesGet(url, init)) return Promise.resolve(json({ message: "boom" }, 500));
      return routeFetch(url, init);
    });

    act(() => wsHandlers["chat:message-deleted"]?.({ chatId: Number(CHAT_ID), messageIds: [50] }));

    await waitFor(() => expect(messageGets().length).toBeGreaterThan(1));
    expect(screen.getByText("свежее")).toBeTruthy();
    expect(screen.queryByText(tr("error.chat_not_found"))).toBeNull();
    expect(screen.queryByText(tr("error.load_messages"))).toBeNull();
  });
});

describe("Комната чата: realtime", () => {
  it("события сокета перезагружают только свой чат", async () => {
    await openChat();
    const before = messageGets().length;

    act(() => wsHandlers["chat:message-deleted"]?.({ chatId: 999, messageIds: [] }));
    act(() => wsHandlers["chat:message"]?.({ chatId: 999, message: message() }));
    await new Promise((r) => setTimeout(r, 20));
    expect(messageGets()).toHaveLength(before);

    act(() => wsHandlers["chat:message"]?.({ chatId: Number(CHAT_ID), message: message({ id: 60 }) }));
    await waitFor(() => expect(messageGets().length).toBe(before + 1));

    act(() => wsHandlers["chat:message-deleted"]?.({ chatId: Number(CHAT_ID), messageIds: [50] }));
    await waitFor(() => expect(messageGets().length).toBe(before + 2));

    act(() => wsHandlers["chat:message-edited"]?.({ chatId: Number(CHAT_ID) }));
    await waitFor(() => expect(messageGets().length).toBe(before + 3));
  });

  it("без сокета подписок нет", async () => {
    wsState.socket = null;
    await openChat();

    expect(wsSocket.on).not.toHaveBeenCalled();
  });

  it("подписки снимаются при размонтировании", async () => {
    const view = await openChat();

    view.unmount();

    expect(wsSocket.off).toHaveBeenCalledWith("chat:message", expect.any(Function));
    expect(wsSocket.off).toHaveBeenCalledWith("chat:message-deleted", expect.any(Function));
    expect(wsSocket.off).toHaveBeenCalledWith("chat:message-edited", expect.any(Function));
  });
});

describe("Комната чата: карточка брони", () => {
  const bookingMessage = (payload: unknown, overrides: Record<string, unknown> = {}) =>
    message({ id: 61, sender_id: 8, text: "Ужин на двоих", card_type: "booking", card_payload: payload, ...overrides })

  it("card_type=booking рисует карточку из payload, а не сырой текст", async () => {
    firstPage = {
      messages: [bookingMessage(JSON.stringify({
        title: "Ужин на двоих",
        partner_name: "Restoclub",
        date: "2026-11-01",
        time: "19:00",
        guests: 2,
        message: "идём?",
      }))],
      has_more: false,
      next_before: 50,
    };
    renderChat();
    const cards = await screen.findAllByTestId("booking-card");
    expect(cards).toHaveLength(1);

    const card = screen.getByTestId("booking-card");
    expect(card.textContent).toContain("Ужин на двоих");
    expect(card.textContent).toContain("Restoclub");
    expect(card.textContent).toContain("2026-11-01 19:00");
    expect(card.textContent).toContain("Гостей: 2");
    expect(card.textContent).toContain("идём?");
  });

  it("payload уже объектом: карточка рисуется без парсинга строки", async () => {
    firstPage = {
      messages: [bookingMessage({ title: "Спа на двоих" })],
      has_more: false,
      next_before: 50,
    };
    renderChat();

    expect((await screen.findByTestId("booking-card")).textContent).toContain("Спа на двоих");
  });

  it("битый payload не роняет комнату и не рисует пустую карточку", async () => {
    firstPage = {
      messages: [bookingMessage("{не json")],
      has_more: false,
      next_before: 50,
    };
    renderChat();

    await waitFor(() => expect(messageGets().length).toBeGreaterThan(0));
    expect(screen.queryByTestId("booking-card")).toBeNull();
    expect(screen.getByTestId("message-list")).toBeInTheDocument();
  });

  it("у карточки брони нет кнопки правки, у обычного своего сообщения есть", async () => {
    firstPage = {
      messages: [
        bookingMessage({ title: "Ужин" }, { id: 62, sender_id: 7 }),
        message({ id: 63, sender_id: 7, text: "обычное" }),
      ],
      has_more: false,
      next_before: 50,
    };
    renderChat();

    expect(await screen.findByText("обычное")).toBeInTheDocument();
    expect(screen.getAllByTestId("edit-message-button")).toHaveLength(1);
  });
});

describe("Комната чата: отправка", () => {
  it("кнопка отправки заблокирована при пустом вводе и во время отправки", async () => {
    await openChat();
    const button = screen.getByTestId("send-button") as HTMLButtonElement;
    const input = screen.getByTestId("message-input") as HTMLInputElement;

    expect(button.disabled).toBe(true);

    fireEvent.change(input, { target: { value: "привет" } });
    expect(button.disabled).toBe(false);

    let release: (() => void) | null = null;
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith(`/api/chats/${CHAT_ID}/messages`) && init?.method === "POST") {
        return new Promise((resolve) => {
          release = () => resolve(json({ id: 901 }));
        });
      }
      return routeFetch(url, init);
    });

    fireEvent.click(button);
    await waitFor(() => expect(release).toBeTruthy());
    expect((screen.getByTestId("send-button") as HTMLButtonElement).disabled).toBe(true);

    act(() => release?.());
    await waitFor(() => expect((screen.getByTestId("message-input") as HTMLInputElement).value).toBe(""));
  });

  it("пустой Enter не отправляет запрос", async () => {
    await openChat();

    fireEvent.keyDown(screen.getByTestId("message-input"), { key: "Enter" });
    await new Promise((r) => setTimeout(r, 20));

    expect(posts()).toHaveLength(0);
  });

  it("Enter отправляет текст и пишет событие метрики", async () => {
    await openChat();
    fireEvent.change(screen.getByTestId("message-input"), { target: { value: "через Enter" } });

    fireEvent.keyDown(screen.getByTestId("message-input"), { key: "Enter" });

    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse(String((posts()[0][1] as RequestInit).body)).text).toBe("через Enter");
    await waitFor(() =>
      expect(trackEventMock).toHaveBeenCalledWith("message_sent", { chat_id: Number(CHAT_ID), ttl: null }),
    );
  });

  it("сбой отправки возвращает текст в поле и объясняет причину", async () => {
    await openChat();
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith(`/api/chats/${CHAT_ID}/messages`) && init?.method === "POST") {
        return Promise.reject(new Error("offline"));
      }
      return routeFetch(url, init);
    });

    fireEvent.change(screen.getByTestId("message-input"), { target: { value: "важное" } });
    fireEvent.click(screen.getByTestId("send-button"));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ description: tr("error.send_message"), variant: "destructive" }),
      ),
    );
    await waitFor(() => expect((screen.getByTestId("message-input") as HTMLInputElement).value).toBe("важное"));
    expect(screen.queryByText("важное")).toBeNull();
  });

  it("выбранный TTL уходит в тело, «Выкл» — нет", async () => {
    await openChat();
    const input = screen.getByTestId("message-input");

    fireEvent.click(screen.getByLabelText(tr("chats.ttl")));
    fireEvent.click(await screen.findByText(tr("chats.ttl_5s")));
    fireEvent.change(input, { target: { value: "исчезнет" } });
    fireEvent.click(screen.getByTestId("send-button"));

    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse(String((posts()[0][1] as RequestInit).body)).ttl_seconds).toBe(5);

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByLabelText(tr("chats.ttl")));
    fireEvent.click(await screen.findByText(tr("chats.ttl_off")));
    fireEvent.change(input, { target: { value: "обычное" } });
    fireEvent.click(screen.getByTestId("send-button"));

    await waitFor(() => expect(posts()).toHaveLength(2));
    expect(JSON.parse(String((posts()[1][1] as RequestInit).body)).ttl_seconds).toBeUndefined();
  });

  it("быстрая реакция уходит отдельным сообщением и не чистит ввод", async () => {
    await openChat();
    fireEvent.change(screen.getByTestId("message-input"), { target: { value: "черновик" } });

    const triggers = screen.getAllByLabelText(tr("chats.add_reaction"));
    fireEvent.click(triggers[triggers.length - 1]);
    fireEvent.click(await screen.findByLabelText("❤️"));

    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse(String((posts()[0][1] as RequestInit).body)).text).toBe("❤️");
    expect((screen.getByTestId("message-input") as HTMLInputElement).value).toBe("черновик");
  });

  it("подсказка первой фразы подставляет текст в поле", async () => {
    await openChat();

    fireEvent.click(screen.getByTestId("opening-lines"));

    expect((screen.getByTestId("message-input") as HTMLInputElement).value).toBe("Привет из подсказки");
  });
});

describe("Комната чата: реакции", () => {
  it("группирует одинаковые реакции и показывает счётчик", async () => {
    firstPage = {
      messages: [
        message({
          ttl_seconds: 30,
          reactions: [
            { emoji: "❤️", user_id: 7 },
            { emoji: "❤️", user_id: 8 },
            { emoji: "🔥", user_id: 8 },
          ],
        }),
      ],
      has_more: false,
      next_before: 50,
    };
    await openChat();

    const heart = screen.getByText("❤️").closest("button")!;
    expect(heart.textContent).toContain("2");
    const fire = screen.getByText("🔥").closest("button")!;
    expect(fire.textContent).toContain("1");
  });

  it("клик по группе ставит ту же реакцию и обновляет список", async () => {
    firstPage = {
      messages: [message({ reactions: [{ emoji: "🔥", user_id: 8 }] })],
      has_more: false,
      next_before: 50,
    };
    await openChat();
    const before = messageGets().length;

    fireEvent.click(screen.getByText("🔥").closest("button")!);

    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(String(posts()[0][0])).toBe(`/api/chats/${CHAT_ID}/messages/50/reactions`);
    expect(JSON.parse(String((posts()[0][1] as RequestInit).body)).emoji).toBe("🔥");
    await waitFor(() => expect(messageGets().length).toBe(before + 1));
  });

  it("отказ реакции объясняет причину, а не молчит", async () => {
    firstPage = {
      messages: [message({ reactions: [{ emoji: "🔥", user_id: 8 }] })],
      has_more: false,
      next_before: 50,
    };
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/reactions")) return Promise.resolve(json({ message: "nope" }, 500));
      return routeFetch(url, init);
    });
    await openChat();

    fireEvent.click(screen.getByText("🔥").closest("button")!);

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ description: tr("error.reaction"), variant: "destructive" }),
      ),
    );
  });

  it("сетевой сбой реакции тоже объясняется", async () => {
    firstPage = {
      messages: [message({ reactions: [{ emoji: "🔥", user_id: 8 }] })],
      has_more: false,
      next_before: 50,
    };
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/reactions")) return Promise.reject(new Error("offline"));
      return routeFetch(url, init);
    });
    await openChat();

    fireEvent.click(screen.getByText("🔥").closest("button")!);

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ description: tr("error.reaction") })),
    );
  });
});

describe("Комната чата: правка сообщения", () => {
  it("сетевой сбой сохранения правки объясняется, а не молчит", async () => {
    firstPage = {
      messages: [message({ id: 50, sender_id: 7, text: "было", created_at: new Date().toISOString() })],
      has_more: false,
      next_before: 50,
    };
    renderChat();
    await screen.findByText("было");
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith(`/api/chats/${CHAT_ID}/messages/`) && init?.method === "PUT") {
        return Promise.reject(new Error("offline"));
      }
      return routeFetch(url, init);
    });

    fireEvent.click(screen.getByTestId("edit-message-button"));
    fireEvent.change(await screen.findByTestId("message-edit-input"), { target: { value: "стало" } });
    fireEvent.click(screen.getByTestId("edit-save"));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ description: tr("error.edit_message"), variant: "destructive" }),
      ),
    );
  });

  it("отказ сервера на правку объясняется тем же текстом", async () => {
    firstPage = {
      messages: [message({ id: 50, sender_id: 7, text: "было", created_at: new Date().toISOString() })],
      has_more: false,
      next_before: 50,
    };
    renderChat();
    await screen.findByText("было");
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith(`/api/chats/${CHAT_ID}/messages/`) && init?.method === "PUT") {
        return Promise.resolve(json({ message: "nope" }, 403));
      }
      return routeFetch(url, init);
    });

    fireEvent.click(screen.getByTestId("edit-message-button"));
    fireEvent.change(await screen.findByTestId("message-edit-input"), { target: { value: "стало" } });
    fireEvent.click(screen.getByTestId("edit-save"));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ description: tr("error.edit_message") })),
    );
  });
});

describe("Комната чата: история", () => {
  function withMore() {
    firstPage = { messages: [message({ id: 50, text: "свежее" })], has_more: true, next_before: 50 };
  }

  it("сбой загрузки истории не объявляет историю законченной", async () => {
    withMore();
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (isMessagesGet(u, init) && /[?&]before=/.test(u)) return Promise.resolve(json({ message: "boom" }, 500));
      return routeFetch(url, init);
    });
    await openChat();

    fireEvent.scroll(screen.getByTestId("message-list"));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ description: tr("error.load_messages") })),
    );

    olderPage = { messages: [message({ id: 40, text: "старое" })], has_more: false, next_before: 40 };
    mockFetch.mockImplementation((url: string, init?: RequestInit) => routeFetch(url, init));
    fireEvent.scroll(screen.getByTestId("message-list"));

    await screen.findByText("старое");
    expect(mockFetch.mock.calls.filter(([url]) => String(url).includes("before=50")).length).toBeGreaterThanOrEqual(2);
  });

  it("не-массив в ответе истории не роняет страницу", async () => {
    withMore();
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (isMessagesGet(u, init) && /[?&]before=/.test(u)) {
        return Promise.resolve(json({ messages: null, has_more: true, next_before: 50 }));
      }
      return routeFetch(url, init);
    });
    await openChat();

    fireEvent.scroll(screen.getByTestId("message-list"));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ description: tr("error.load_messages") })),
    );
    expect(screen.getByText("свежее")).toBeTruthy();
  });

  it("пустая страница объявляет историю законченной и второй скролл не шлёт запрос", async () => {
    withMore();
    olderPage = { messages: [], has_more: true, next_before: 50 };
    await openChat();

    fireEvent.scroll(screen.getByTestId("message-list"));
    await waitFor(() => expect(mockFetch.mock.calls.filter(([url]) => String(url).includes("before=50")).length).toBe(1));

    fireEvent.scroll(screen.getByTestId("message-list"));
    await new Promise((r) => setTimeout(r, 20));
    expect(mockFetch.mock.calls.filter(([url]) => String(url).includes("before=50")).length).toBe(1);
  });
});

describe("Комната чата: контекст встречи", () => {
  const hangout = {
    id: 3,
    title: "Кино вдвоём",
    event_date: new Date(Date.now() + 86_400_000).toISOString(),
    category: "cinema",
    status: "active",
  };

  it("показывает баннер встречи со ссылкой на неё", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/api/hangouts/by-chat/")) return Promise.resolve(json(hangout));
      return routeFetch(url, init);
    });
    await openChat();

    const banner = await screen.findByTestId("chat-hangout-banner");
    expect(banner.textContent).toContain("Кино вдвоём");
    expect(banner.closest("a")?.getAttribute("href")).toBe("/hangouts/3");
  });

  it("ответ без id баннер не рисует", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/api/hangouts/by-chat/")) return Promise.resolve(json({ title: "без id" }));
      return routeFetch(url, init);
    });
    await openChat();

    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("chat-hangout-banner")).toBeNull();
  });

  it("сетевой сбой запроса встречи не ломает чат", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/api/hangouts/by-chat/")) return Promise.reject(new Error("offline"));
      return routeFetch(url, init);
    });
    await openChat();

    expect(screen.queryByTestId("chat-hangout-banner")).toBeNull();
    expect(screen.getByText("свежее")).toBeTruthy();
  });

  it("без токена контекст встречи не запрашивается", async () => {
    const view = await openChat();
    tokenState.value = null;

    view.rerender(
      <MemoryRouter initialEntries={["/chats/8"]}>
        <ChatPage params={{ chatId: "8" }} />
      </MemoryRouter>,
    );

    await new Promise((r) => setTimeout(r, 20));
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes("/api/hangouts/by-chat/8"))).toBe(false);
  });
});

describe("Комната чата: звонки", () => {
  it("видеозвонок открывает диалог, зовёт startCall и переключает mute/камеру", async () => {
    await openChat();

    fireEvent.click(screen.getByLabelText(tr("chats.video_call")));

    expect(webrtcMock.startCall).toHaveBeenCalledWith(8, "video");
    const dialog = await screen.findByTestId("video-dialog");
    expect(dialog.getAttribute("data-muted")).toBe("false");
    expect(dialog.getAttribute("data-video-off")).toBe("false");

    fireEvent.click(screen.getByTestId("video-mute"));
    fireEvent.click(screen.getByTestId("video-off"));

    expect(screen.getByTestId("video-dialog").getAttribute("data-muted")).toBe("true");
    expect(screen.getByTestId("video-dialog").getAttribute("data-video-off")).toBe("true");

    fireEvent.click(screen.getByTestId("video-close"));
    await waitFor(() => expect(screen.queryByTestId("video-dialog")).toBeNull());
  });

  it("аудиозвонок открывает диалог, зовёт startCall с audio и переключает mute", async () => {
    await openChat();

    fireEvent.click(screen.getByLabelText(tr("chats.voice_call")));

    expect(webrtcMock.startCall).toHaveBeenCalledWith(8, "audio");
    expect((await screen.findByTestId("voice-dialog")).getAttribute("data-muted")).toBe("false");

    fireEvent.click(screen.getByTestId("voice-mute"));
    expect(screen.getByTestId("voice-dialog").getAttribute("data-muted")).toBe("true");

    fireEvent.click(screen.getByTestId("voice-close"));
    await waitFor(() => expect(screen.queryByTestId("voice-dialog")).toBeNull());
  });
});

describe("Комната чата: шапка и мелочи", () => {
  it("без аватара и имени подставляет заглушки", async () => {
    partnerState.name = "";
    partnerState.avatar = "";
    await openChat();

    const img = document.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("/default-avatar.svg");
    expect(img.getAttribute("alt")).toBe(tr("chats.unknown_user"));
  });

  it("флаг партнёрских офферов показывает блок действий, без флага — нет", async () => {
    const view = await openChat();
    expect(screen.queryByTestId("partner-actions")).toBeNull();

    flagsState.partnerOffersEnabled = true;
    view.rerender(
      <MemoryRouter initialEntries={[`/chats/${CHAT_ID}`]}>
        <ChatPage params={{ chatId: CHAT_ID }} />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("partner-actions")).toBeTruthy();
  });

  it("блоку действий передаются chatId комнаты и перезагрузка после шаринга", async () => {
    flagsState.partnerOffersEnabled = true;
    await openChat();
    await screen.findByTestId("partner-actions");

    expect(partnerProps.value?.chatId).toBe(Number(CHAT_ID));
    expect(partnerProps.value?.placement).toBe("chat");

    const before = messageGets().length;
    act(() => partnerProps.value?.onShared?.());
    await waitFor(() => expect(messageGets().length).toBe(before + 1));
  });

  it("кнопка «Назад» в шапке уводит в список чатов", async () => {
    await openChat();

    fireEvent.click(screen.getByLabelText(tr("button.back")));

    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/chats"));
  });

  it("цитата без имени и с картинкой показывает «недоступно» и 📷", async () => {
    firstPage = {
      messages: [
        message({
          text: "ответ",
          reply_to: 40,
          reply_text: null,
          reply_sender_name: null,
          reply_image_url: "/old.png",
        }),
      ],
      has_more: false,
      next_before: 50,
    };
    renderChat();
    await screen.findByText("ответ");

    expect(screen.getByText(tr("chats.reply_unavailable"))).toBeTruthy();
    expect(screen.getByText("📷")).toBeTruthy();
  });

  it("resize с visualViewport подписывается и снимает подписку", async () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    (window as any).visualViewport = { addEventListener, removeEventListener };

    const view = await openChat();
    expect(addEventListener).toHaveBeenCalledWith("resize", expect.any(Function));

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    view.unmount();
    expect(removeEventListener).toHaveBeenCalledWith("resize", expect.any(Function));
    delete (window as any).visualViewport;
  });

  it("без visualViewport страница монтируется и размонтируется без ошибок", async () => {
    const view = await openChat();
    expect((window as any).visualViewport).toBeUndefined();
    view.unmount();
  });

  it("без сессии уводит на /login", async () => {
    authState.user = null;
    authState.isLoading = false;

    renderChat();

    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/login"));
  });

  it("пока сессия грузится, редиректа нет", async () => {
    authState.user = null;
    authState.isLoading = true;

    renderChat();

    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId("location").textContent).toBe(`/chats/${CHAT_ID}`);
  });
});

describe("Комната чата: ответ, правка и ряд реакций", () => {
  function putCalls() {
    return mockFetch.mock.calls.filter(
      ([url, init]) => String(url).includes("/messages/") && (init as RequestInit | undefined)?.method === "PUT",
    );
  }

  it("ответ на своё сообщение подписан «Вы»", async () => {
    firstPage = { messages: [message({ id: 50, sender_id: 7, text: "моё" })], has_more: false, next_before: 50 };
    renderChat();
    await screen.findByText("моё");

    fireEvent.click(screen.getByTestId("reply-button"));

    const bar = await screen.findByTestId("reply-bar");
    expect(bar.textContent).toContain(tr("chats.reply_to", { name: tr("chats.you") }));
    expect(bar.textContent).toContain("моё");
  });

  it("ответ на сообщение без имени и без текста не рисует чужих подписей", async () => {
    partnerState.name = "";
    firstPage = { messages: [message({ id: 50, sender_id: 8, text: "", sender_name: "" })], has_more: false, next_before: 50 };
    renderChat();
    await waitFor(() => expect(screen.getByTestId("message-list")).toBeTruthy());

    fireEvent.click(screen.getByTestId("reply-button"));

    const bar = await screen.findByTestId("reply-bar");
    expect(bar.textContent).toContain(tr("chats.reply_to", { name: "" }));
    expect(bar.textContent).not.toContain("undefined");
    expect(bar.textContent).not.toContain("null");
  });

  it("цитата с текстом показывает его вместо «недоступно»", async () => {
    firstPage = {
      messages: [
        message({
          text: "ответ",
          reply_to: 40,
          reply_text: "цитируемый текст",
          reply_sender_name: "Аня",
        }),
      ],
      has_more: false,
      next_before: 50,
    };
    renderChat();
    await screen.findByText("ответ");

    expect(screen.getByText("цитируемый текст")).toBeTruthy();
    expect(screen.queryByText(tr("chats.reply_unavailable"))).toBeNull();
  });

  it("сбой отправки возвращает не только текст, но и полосу ответа", async () => {
    await openChat();
    fireEvent.click(screen.getByTestId("reply-button"));
    expect(await screen.findByTestId("reply-bar")).toBeTruthy();

    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith(`/api/chats/${CHAT_ID}/messages`) && init?.method === "POST") {
        return Promise.reject(new Error("offline"));
      }
      return routeFetch(url, init);
    });

    fireEvent.change(screen.getByTestId("message-input"), { target: { value: "ответ на сообщение" } });
    fireEvent.click(screen.getByTestId("send-button"));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ description: tr("error.send_message") })),
    );
    expect(await screen.findByTestId("reply-bar")).toBeTruthy();
    expect((screen.getByTestId("message-input") as HTMLInputElement).value).toBe("ответ на сообщение");
  });

  it("Enter в поле правки сохраняет сообщение", async () => {
    firstPage = { messages: [message({ id: 50, sender_id: 7, text: "было" })], has_more: false, next_before: 50 };
    renderChat();
    await screen.findByText("было");

    fireEvent.click(screen.getByTestId("edit-message-button"));
    const input = await screen.findByTestId("message-edit-input");
    fireEvent.change(input, { target: { value: "стало" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(putCalls()).toHaveLength(1));
    expect(JSON.parse(String((putCalls()[0][1] as RequestInit).body)).text).toBe("стало");
    await waitFor(() => expect(screen.queryByTestId("message-edit-input")).toBeNull());
  });

  it("пустая правка не отправляет PUT и закрывает поле", async () => {
    firstPage = { messages: [message({ id: 50, sender_id: 7, text: "было" })], has_more: false, next_before: 50 };
    renderChat();
    await screen.findByText("было");

    fireEvent.click(screen.getByTestId("edit-message-button"));
    const input = await screen.findByTestId("message-edit-input");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByTestId("edit-save"));

    await new Promise((r) => setTimeout(r, 20));
    expect(putCalls()).toHaveLength(0);
    expect(screen.queryByTestId("message-edit-input")).toBeNull();
  });

  it("правка без токена уходит без заголовка авторизации", async () => {
    firstPage = { messages: [message({ id: 50, sender_id: 7, text: "было" })], has_more: false, next_before: 50 };
    renderChat();
    await screen.findByText("было");

    tokenState.value = null;
    fireEvent.click(screen.getByTestId("edit-message-button"));
    fireEvent.change(await screen.findByTestId("message-edit-input"), { target: { value: "стало" } });
    fireEvent.click(screen.getByTestId("edit-save"));

    await waitFor(() => expect(putCalls()).toHaveLength(1));
    expect((putCalls()[0][1] as RequestInit).headers).not.toHaveProperty("Authorization");
  });

  it("ряд быстрых реакций у сообщения ставит реакцию и закрывается", async () => {
    firstPage = { messages: [message({ id: 50, reactions: [] })], has_more: false, next_before: 50 };
    renderChat();
    await screen.findByText("свежее");

    const toggle = screen.getAllByLabelText(tr("chats.add_reaction"))[0];
    fireEvent.click(toggle);
    expect(await screen.findByText("❤️")).toBeTruthy();

    fireEvent.click(screen.getByText("🔥"));

    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(String(posts()[0][0])).toBe(`/api/chats/${CHAT_ID}/messages/50/reactions`);
    expect(JSON.parse(String((posts()[0][1] as RequestInit).body)).emoji).toBe("🔥");
    await waitFor(() => expect(screen.queryByText("❤️")).toBeNull());
  });

  it("повторный клик по 😊 у сообщения закрывает ряд реакций", async () => {
    await openChat();
    const toggle = screen.getAllByLabelText(tr("chats.add_reaction"))[0];

    fireEvent.click(toggle);
    expect(await screen.findByText("❤️")).toBeTruthy();

    fireEvent.click(toggle);
    await waitFor(() => expect(screen.queryByText("❤️")).toBeNull());
  });

  it("реакция без токена уходит без заголовка авторизации", async () => {
    firstPage = {
      messages: [message({ id: 50, reactions: [{ emoji: "🔥", user_id: 8 }] })],
      has_more: false,
      next_before: 50,
    };
    renderChat();
    await screen.findByText("свежее");

    tokenState.value = null;
    fireEvent.click(screen.getByText("🔥").closest("button")!);

    await waitFor(() => expect(posts()).toHaveLength(1));
    expect((posts()[0][1] as RequestInit).headers).not.toHaveProperty("Authorization");
  });

  it("кнопка правки не появляется у старого сообщения", async () => {
    firstPage = {
      messages: [
        message({ id: 50, sender_id: 7, text: "давнее", created_at: new Date(Date.now() - 20 * 60 * 1000).toISOString() }),
      ],
      has_more: false,
      next_before: 50,
    };
    renderChat();
    await screen.findByText("давнее");

    expect(screen.queryByTestId("edit-message-button")).toBeNull();
    expect(screen.getByTestId("reply-button")).toBeTruthy();
  });

  it("фокус в поле ввода прокручивает переписку вниз", async () => {
    await openChat();
    const scrollSpy = Element.prototype.scrollIntoView as unknown as ReturnType<typeof vi.fn>;
    scrollSpy.mockClear();

    fireEvent.focus(screen.getByTestId("message-input"));

    await waitFor(() => expect(scrollSpy).toHaveBeenCalled(), { timeout: 2000 });
  });

  it("история без токена запрашивается без заголовка авторизации", async () => {
    firstPage = { messages: [message({ id: 50, text: "свежее" })], has_more: true, next_before: 50 };
    olderPage = { messages: [message({ id: 40, text: "старое" })], has_more: false, next_before: 40 };
    renderChat();
    await screen.findByText("свежее");

    tokenState.value = null;
    fireEvent.scroll(screen.getByTestId("message-list"));

    await screen.findByText("старое");
    const call = mockFetch.mock.calls.find(([url]) => String(url).includes("before=50"));
    expect((call![1] as RequestInit).headers).toEqual({});
  });

  it("английский язык уходит в запрос собеседника", async () => {
    languageState.value = "EN";
    renderChat();
    await screen.findByText("свежее");

    expect(mockFetch.mock.calls.some(([url]) => String(url) === `/api/chats/${CHAT_ID}?lang=en`)).toBe(true);
  });
});
