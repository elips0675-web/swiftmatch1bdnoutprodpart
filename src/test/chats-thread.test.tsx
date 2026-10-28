import React from "react"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const ws = vi.hoisted(() => {
  const handlers = new Map<string, Array<(payload: never) => void>>()
  const socket = {
    on: vi.fn((event: string, cb: (payload: never) => void) => {
      const list = handlers.get(event) ?? []
      list.push(cb)
      handlers.set(event, list)
    }),
    off: vi.fn((event: string, cb: (payload: never) => void) => {
      const list = handlers.get(event) ?? []
      handlers.set(event, list.filter(item => item !== cb))
    }),
    emit: vi.fn(),
  }
  const send = (event: string, payload: unknown) => {
    for (const cb of handlers.get(event) ?? []) cb(payload as never)
  }
  return { socket, send, handlers }
})

vi.mock("@/hooks/use-websocket", () => ({
  useWebSocket: () => ({ socket: ws.socket, connected: true }),
}))

vi.mock("@/hooks/use-webrtc", () => ({ useWebRTC: () => ({}) }))

const nav = vi.hoisted(() => ({ search: "" }))

vi.mock("@/shims/next-navigation", () => ({
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ replace: vi.fn(), back: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
}))

const auth = vi.hoisted(() => ({ token: "test-token" as string | null }))

vi.mock("@/context/auth-context", () => ({
  useAuth: () => ({ token: auth.token, user: { id: 7 }, isLoading: false }),
}))

vi.mock("@/lib/token", () => ({ getToken: () => "test-token" }))

vi.mock("@/context/language-context", () => ({
  useLanguage: () => ({ t: (key: string) => key, language: "RU", setLanguage: vi.fn() }),
}))

vi.mock("@/context/feature-flags-context", () => ({
  useFeatureFlags: () => ({ videoCallsEnabled: true, aiIcebreakersEnabled: true }),
}))

const toastMock = vi.hoisted(() => vi.fn())

vi.mock("@/hooks/use-toast", () => ({ toast: toastMock }))

vi.mock("@/components/ui/dropdown-menu", async () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <>{children}</>
  const Item = ({
    children,
    onSelect,
    ...rest
  }: React.ComponentProps<"button"> & { onSelect?: (e: { preventDefault: () => void }) => void }) => (
    <button type="button" {...rest} onClick={() => onSelect?.({ preventDefault: () => {} })}>
      {children}
    </button>
  )
  return { DropdownMenu: Pass, DropdownMenuTrigger: Pass, DropdownMenuContent: Pass, DropdownMenuItem: Item }
})

vi.mock("@/components/ui/popover", () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <>{children}</>
  return { Popover: Pass, PopoverTrigger: Pass, PopoverContent: Pass }
})

vi.mock("@/hooks/useAntiScreenshot", () => ({ useAntiScreenshot: () => ({ current: null }) }))

vi.mock("@/lib/word-filter", () => ({
  containsForbiddenWords: () => false,
  isGibberish: () => false,
}))

vi.mock("@/components/navigation/bottom-nav", () => ({ BottomNav: () => <div data-testid="bottom-nav" /> }))
vi.mock("@/components/layout/app-header", () => ({ AppHeader: () => <div data-testid="app-header" /> }))
vi.mock("@/components/opening-lines-picker", () => ({ OpeningLinesPicker: () => null }))
vi.mock("@/components/video-call", () => ({ VideoCallDialog: () => null }))
vi.mock("@/components/voice-call", () => ({ VoiceCallDialog: () => null }))
vi.mock("@/components/feeds/category-feed", () => ({ CategoryFeed: () => <div data-testid="group-feed" /> }))

const aiFlows = vi.hoisted(() => ({ aiChatIcebreakerSuggestions: vi.fn() }))

vi.mock("@/shims/ai-flows", () => aiFlows)

import ChatsPage from "@/pages/chats"

const mockFetch = vi.fn()

Element.prototype.scrollIntoView = vi.fn()

interface MessageRow {
  id: number
  text: string
  sender_id: number
  created_at: string
  reactions?: unknown[]
}

interface ChatRow {
  id: number
  other_user_id: number
  display_name: string
  avatar_url: string
  online: boolean
  last_message: string
  updated_at: string
  last_read_at: string | null
  unread_count: number
}

function chat(id: number, name: string, extra: Partial<ChatRow> = {}): ChatRow {
  return {
    id,
    other_user_id: 500 + id,
    display_name: name,
    avatar_url: "",
    online: false,
    last_message: "Привет",
    updated_at: new Date().toISOString(),
    last_read_at: null,
    unread_count: 0,
    ...extra,
  }
}

function message(id: number, text: string, extra: Partial<MessageRow> = {}): MessageRow {
  return { id, text, sender_id: 501, created_at: new Date().toISOString(), reactions: [], ...extra }
}

function json(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) })
}

type Page = { messages: MessageRow[]; has_more: boolean; next_before: number | null }

interface ApiOptions {
  chats?: ChatRow[]
  pages?: Record<string, Page>
  createdChat?: { id: number; existing: boolean }
  scheduleOk?: boolean
  reportOk?: boolean
  reaction?: { action: string; emoji: string; count?: number }
}

function mockApi(options: ApiOptions = {}) {
  mockFetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input)
    const method = (init?.method ?? "GET").toUpperCase()

    if (url === "/api/chats" && method === "POST") return json(options.createdChat ?? { id: 77, existing: false })
    if (url === "/api/chats") return json(options.chats ?? [])
    if (url === "/api/schedule") {
      return options.scheduleOk === false ? json({ message: "schedule-broken" }, false) : json({ id: 1 })
    }
    if (url === "/api/reports") return json({ id: 1 }, options.reportOk !== false)

    const reactions = url.match(/^\/api\/chats\/(\d+)\/messages\/(\d+)\/reactions$/)
    if (reactions) {
      return json(options.reaction ?? { action: "added", emoji: "❤️", count: 1 })
    }

    const messages = url.match(/^\/api\/chats\/(\d+)\/messages/)
    if (messages) {
      if (method === "POST") return json({ id: 99, text: "ok", created_at: new Date().toISOString() })
      const cursor = url.match(/before=(\d+)/)
      const page = options.pages?.[cursor ? cursor[1] : "first"]
      return json(page ?? { messages: [], has_more: false, next_before: null })
    }

    return json({})
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFetch.mockReset()
  globalThis.fetch = mockFetch as unknown as typeof fetch
  ws.handlers.clear()
  nav.search = ""
  auth.token = "test-token"
  aiFlows.aiChatIcebreakerSuggestions.mockResolvedValue({ suggestions: [] })
})

async function openThread(chats: ChatRow[] = [chat(1, "Аня")], options: ApiOptions = {}) {
  mockApi({ chats, ...options })
  render(<ChatsPage />)
  fireEvent.click(await screen.findByTestId("chat-row-1"))
  await screen.findByTestId("messages-scroll")
}

describe("Страница чатов (переписка)", () => {
  it("догружает историю при прокрутке вверх и восстанавливает позицию", async () => {
    await openThread([chat(1, "Аня")], {
      pages: {
        first: { messages: [message(11, "Свежее")], has_more: true, next_before: 5 },
        "5": { messages: [message(4, "Старое")], has_more: false, next_before: null },
      },
    })

    expect(screen.getByText("Свежее")).toBeInTheDocument()
    expect(screen.queryByText("Старое")).toBeNull()

    fireEvent.scroll(screen.getByTestId("messages-scroll"))

    expect(await screen.findByText("Старое")).toBeInTheDocument()
    expect(mockFetch).toHaveBeenCalledWith("/api/chats/1/messages?limit=50&before=5", {
      headers: { Authorization: "Bearer test-token" },
    })

    mockFetch.mockClear()
    fireEvent.scroll(screen.getByTestId("messages-scroll"))

    const messageCalls = mockFetch.mock.calls.filter(call => String(call[0]).includes("/messages"))
    expect(messageCalls).toHaveLength(0)
  })

  it("переключает страницы списка по номеру", async () => {
    mockApi({ chats: Array.from({ length: 9 }, (_, i) => chat(i + 1, `Чат ${i + 1}`)) })
    render(<ChatsPage />)
    await screen.findByTestId("chat-row-1")

    fireEvent.click(screen.getByRole("button", { name: "2" }))

    expect(screen.getByTestId("chat-row-9")).toBeInTheDocument()
    expect(screen.queryByTestId("chat-row-1")).toBeNull()
  })

  it("подставляет промпт темы в поле ввода и закрывает диалог", async () => {
    await openThread()

    fireEvent.click(screen.getByRole("button", { name: "chats.ai_themes" }))
    fireEvent.click(screen.getByTestId("chat-theme-romantic"))

    expect(screen.getByTestId("message-input")).toHaveValue("chats.theme_prompt.romantic")
    expect(screen.queryByTestId("chat-theme-romantic")).toBeNull()
  })

  it("ставит реакцию и снимает её повторным нажатием", async () => {
    await openThread([chat(1, "Аня")], {
      pages: { first: { messages: [message(11, "Привет")], has_more: false, next_before: null } },
      reaction: { action: "added", emoji: "❤️", count: 1 },
    })

    fireEvent.click(screen.getByRole("button", { name: "chats.add_reaction" }))
    fireEvent.click(screen.getByTestId("reaction-quick-heart"))

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/chats/1/messages/11/reactions",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ emoji: "❤️" }) }),
      ),
    )

    expect(await screen.findByRole("button", { name: "❤️" })).toBeInTheDocument()

    mockApi({
      chats: [chat(1, "Аня")],
      pages: { first: { messages: [message(11, "Привет")], has_more: false, next_before: null } },
      reaction: { action: "removed", emoji: "❤️" },
    })
    fireEvent.click(screen.getByRole("button", { name: "chats.add_reaction" }))
    fireEvent.click(screen.getByTestId("reaction-quick-heart"))

    await waitFor(() => expect(screen.queryByRole("button", { name: "❤️" })).toBeNull())
  })

  it("отвечает на сообщение и отправляет reply_to", async () => {
    await openThread([chat(1, "Аня")], {
      pages: { first: { messages: [message(11, "Привет")], has_more: false, next_before: null } },
    })

    fireEvent.click(screen.getByTestId("reply-button"))

    expect(screen.getByTestId("reply-bar")).toBeInTheDocument()
    expect(screen.getByText("chats.reply_to")).toBeInTheDocument()
    expect(within(screen.getByTestId("reply-bar")).getByText("Привет")).toBeInTheDocument()

    fireEvent.change(screen.getByTestId("message-input"), { target: { value: "И тебе" } })
    fireEvent.click(screen.getByTestId("send-button"))

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/chats/1/messages",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ text: "И тебе", reply_to: 11 }),
        }),
      ),
    )
    await waitFor(() => expect(screen.queryByTestId("reply-bar")).toBeNull())
  })

  it("шлёт исчезающее сообщение с ttl_seconds", async () => {
    await openThread()

    fireEvent.click(screen.getByText("chats.ttl_5s"))
    fireEvent.change(screen.getByTestId("message-input"), { target: { value: "Секрет" } })
    fireEvent.click(screen.getByTestId("send-button"))

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/chats/1/messages",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ text: "Секрет", ttl_seconds: 5 }),
        }),
      ),
    )
  })

  it("предлагает видеосвидание и очищает форму", async () => {
    await openThread()

    fireEvent.click(screen.getByRole("button", { name: "schedule.propose_btn" }))

    expect(screen.getByTestId("schedule-submit")).toBeDisabled()

    fireEvent.change(screen.getByTestId("schedule-date"), { target: { value: "2026-10-20" } })
    fireEvent.change(screen.getByTestId("schedule-time"), { target: { value: "18:30" } })
    fireEvent.change(screen.getByTestId("schedule-duration"), { target: { value: "45" } })
    fireEvent.change(screen.getByTestId("schedule-message"), { target: { value: "Давай" } })

    expect(screen.getByTestId("schedule-submit")).not.toBeDisabled()
    fireEvent.click(screen.getByTestId("schedule-submit"))

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/schedule",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            chat_id: 1,
            scheduled_at: "2026-10-20T18:30:00",
            duration_minutes: 45,
            message: "Давай",
          }),
        }),
      ),
    )
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith({ title: "schedule.propose", variant: "default" }))
    await waitFor(() => expect(screen.queryByTestId("schedule-date")).toBeNull())
  })

  it("показывает ошибку сервера при предложении свидания", async () => {
    await openThread([chat(1, "Аня")], { scheduleOk: false })

    fireEvent.click(screen.getByRole("button", { name: "schedule.propose_btn" }))
    fireEvent.change(screen.getByTestId("schedule-date"), { target: { value: "2026-10-20" } })
    fireEvent.change(screen.getByTestId("schedule-time"), { target: { value: "18:30" } })
    fireEvent.click(screen.getByTestId("schedule-submit"))

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith({ variant: "destructive", title: "schedule-broken" }),
    )
    expect(screen.getByTestId("schedule-date")).toBeInTheDocument()
  })

  it("честно показывает ошибку отправки жалобы вместо успеха", async () => {
    await openThread([chat(1, "Аня")], { reportOk: false })

    fireEvent.click(screen.getByTestId("chat-report-open"))
    fireEvent.click(screen.getByText("report.reason.spam"))
    fireEvent.click(screen.getByTestId("report-submit"))

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith({ variant: "destructive", title: "error.generic_title" }),
    )
    expect(screen.getByText("report.title")).toBeInTheDocument()
  })

  it("удаляет переписку из меню действий", async () => {
    await openThread()

    fireEvent.click(screen.getByText("chats.delete_conversation"))

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith("/api/chats/1", { method: "DELETE" }),
    )
    expect(await screen.findByTestId("chat-row-1")).toBeInTheDocument()
  })

  it("по ?matchId открывает существующую переписку", async () => {
    nav.search = "matchId=900"
    mockApi({
      chats: [chat(3, "Матч", { other_user_id: 900 })],
      pages: { first: { messages: [message(31, "Мы совпали", { sender_id: 900 })], has_more: false, next_before: null } },
    })
    render(<ChatsPage />)

    expect(await screen.findByTestId("messages-scroll")).toBeInTheDocument()
    expect(screen.getByText("Мы совпали")).toBeInTheDocument()
    expect(mockFetch).toHaveBeenCalledWith("/api/chats/3/messages?limit=50", {
      headers: { Authorization: "Bearer test-token" },
    })
  })

  it("по ?matchId создаёт переписку, если её ещё нет", async () => {
    nav.search = "matchId=900"
    mockApi({ chats: [chat(1, "Аня")], createdChat: { id: 78, existing: true } })
    render(<ChatsPage />)

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/chats",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ participant_id: 900 }),
        }),
      ),
    )
    expect(await screen.findByTestId("messages-scroll")).toBeInTheDocument()
  })

  it("добавляет сообщение из сокета в открытую переписку и обновляет список для чужой", async () => {
    await openThread()
    const listCalls = () => mockFetch.mock.calls.filter(call => call[0] === "/api/chats").length
    const before = listCalls()

    ws.send("chat:message", { chatId: 1, message: { id: 55, text: "Из сокета", created_at: new Date().toISOString() } })
    expect(await screen.findByText("Из сокета")).toBeInTheDocument()

    ws.send("chat:message", { chatId: 1, message: { id: 55, text: "Из сокета", created_at: new Date().toISOString() } })
    expect(screen.getAllByText("Из сокета")).toHaveLength(1)

    ws.send("chat:message", { chatId: 2, message: { id: 56, text: "Другой чат", created_at: new Date().toISOString() } })
    await waitFor(() => expect(listCalls()).toBeGreaterThan(before))
  })

  it("убирает удалённое сообщение, пришедшее по сокету", async () => {
    await openThread([chat(1, "Аня")], {
      pages: { first: { messages: [message(11, "Удали меня")], has_more: false, next_before: null } },
    })
    expect(screen.getByText("Удали меня")).toBeInTheDocument()

    ws.send("chat:message-deleted", { chatId: 1, messageIds: [11] })

    await waitFor(() => expect(screen.queryByText("Удали меня")).toBeNull())
  })

  it("не трогает тред при удалении несуществующего сообщения", async () => {
    await openThread([chat(1, "Аня")], {
      pages: { first: { messages: [message(11, "Осталось")], has_more: false, next_before: null } },
    })
    expect(screen.getByText("Осталось")).toBeInTheDocument()

    ws.send("chat:message-deleted", { chatId: 1, messageIds: [999] })

    expect(screen.getByText("Осталось")).toBeInTheDocument()
  })

  it("отправляет подсказку-айсбрейкер и пересчитывает высоту при resize", async () => {
    aiFlows.aiChatIcebreakerSuggestions.mockResolvedValue({ suggestions: ["Как прошёл день?"] })
    await openThread()

    fireEvent.click(await screen.findByText("Как прошёл день?"))

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/chats/1/messages",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ text: "Как прошёл день?" }),
        }),
      ),
    )

    Object.defineProperty(window, "innerHeight", { value: 900, configurable: true })
    fireEvent(window, new Event("resize"))

    const wrapper = screen.getByTestId("messages-scroll").parentElement as HTMLElement
    await waitFor(() => expect(wrapper.style.height).toContain("900px"))
  })

  it("возвращается на предыдущую страницу списка", async () => {
    mockApi({ chats: Array.from({ length: 9 }, (_, i) => chat(i + 1, `Чат ${i + 1}`)) })
    render(<ChatsPage />)
    await screen.findByTestId("chat-row-1")

    fireEvent.click(screen.getByRole("button", { name: "2" }))
    expect(screen.getByTestId("chat-row-9")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "chats.page_prev" }))

    expect(screen.getByTestId("chat-row-1")).toBeInTheDocument()
    expect(screen.queryByTestId("chat-row-9")).toBeNull()
  })

  it("показывает аватар собеседника в шапке переписки", async () => {
    await openThread([chat(1, "Аня", { avatar_url: "https://cdn.example/a.png", online: true })])

    expect(screen.getByAltText("Аня")).toBeInTheDocument()
  })

  it("открывает диалоги видеозвонка и аудиозвонка из шапки переписки", async () => {
    await openThread()

    const video = screen.getByRole("button", { name: "chats.video_call" })
    const voice = screen.getByRole("button", { name: "chats.voice_call" })

    fireEvent.click(video)
    fireEvent.click(voice)

    expect(video).toBeInTheDocument()
    expect(voice).toBeInTheDocument()
  })

  it("раскрывает и закрывает пикер быстрых реакций кликом по сообщению", async () => {
    await openThread([chat(1, "Аня")], {
      pages: { first: { messages: [message(11, "Привет")], has_more: false, next_before: null } },
    })

    expect(screen.queryByTestId("reaction-quick-heart")).toBeNull()

    fireEvent.click(screen.getByText("Привет"))
    expect(screen.getByTestId("reaction-quick-heart")).toBeInTheDocument()

    fireEvent.click(screen.getByText("Привет"))
    expect(screen.queryByTestId("reaction-quick-heart")).toBeNull()
  })

  it("снимает реакцию кликом по бейджу под сообщением", async () => {
    await openThread([chat(1, "Аня")], {
      pages: {
        first: { messages: [message(11, "Привет", { reactions: [{ emoji: "🔥" }] })], has_more: false, next_before: null },
      },
      reaction: { action: "removed", emoji: "🔥" },
    })

    fireEvent.click(screen.getByRole("button", { name: "🔥" }))

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/chats/1/messages/11/reactions",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ emoji: "🔥" }) }),
      ),
    )
    await waitFor(() => expect(screen.queryByRole("button", { name: "🔥" })).toBeNull())
  })

  it("отменяет ответ и отправляет сообщение по Enter", async () => {
    await openThread([chat(1, "Аня")], {
      pages: { first: { messages: [message(11, "Привет")], has_more: false, next_before: null } },
    })

    fireEvent.click(screen.getByTestId("reply-button"))
    expect(screen.getByTestId("reply-bar")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "chats.cancel_reply" }))
    expect(screen.queryByTestId("reply-bar")).toBeNull()

    const input = screen.getByTestId("message-input")
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: "Пока" } })
    fireEvent.keyDown(input, { key: "Enter" })

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/chats/1/messages",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ text: "Пока" }) }),
      ),
    )
  })

  it("показывает аватар, бейдж непрочитанного и старую метку времени в списке", async () => {
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
    mockApi({
      chats: [
        chat(1, "С фото", { avatar_url: "https://cdn.example/a.png", unread_count: 3 }),
        chat(2, "Старый", { updated_at: old }),
      ],
    })
    render(<ChatsPage />)

    const row = await screen.findByTestId("chat-row-1")
    expect(row.querySelector("img")).not.toBeNull()
    expect(within(row).getByText("3")).toBeInTheDocument()
    expect(await screen.findByTestId("chat-row-2")).toBeInTheDocument()
  })

  it("вводит описание жалобы и закрывает диалог по отмене", async () => {
    await openThread()

    fireEvent.click(screen.getByTestId("chat-report-open"))
    fireEvent.change(screen.getByTestId("report-description"), { target: { value: "Детали жалобы" } })
    expect(screen.getByTestId("report-description")).toHaveValue("Детали жалобы")

    fireEvent.click(screen.getByTestId("report-cancel"))

    await waitFor(() => expect(screen.queryByTestId("report-description")).toBeNull())
  })

  it("показывает пустой список чатов без ошибок", async () => {
    mockApi({ chats: [] })
    render(<ChatsPage />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith("/api/chats"))
    expect(screen.getByTestId("app-header")).toBeInTheDocument()
    expect(screen.getByTestId("bottom-nav")).toBeInTheDocument()
  })

  it("открывает существующий чат по openChat параметру", async () => {
    nav.search = "openChat=5"
    mockApi({ chats: [chat(5, "Миша")] })
    render(<ChatsPage />)
    expect(await screen.findByTestId("messages-scroll")).toBeInTheDocument()
    expect(screen.getByText("Миша")).toBeInTheDocument()
  })

  it("создаёт чат по openChat при отсутствии в списке и открывает его", async () => {
    nav.search = "openChat=777"
    mockApi({ chats: [chat(1, "Аня")], createdChat: { id: 88, existing: false } })
    render(<ChatsPage />)
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/chats",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ participant_id: 777 }) }),
      ),
    )
    expect(await screen.findByTestId("messages-scroll")).toBeInTheDocument()
  })

  it("добавляет реакцию с другого эмодзи", async () => {
    await openThread([chat(1, "Аня")], {
      pages: { first: { messages: [message(11, "Привет", { reactions: [{ emoji: "🔥" }] })], has_more: false, next_before: null } },
      reaction: { action: "added", emoji: "❤️", count: 1 },
    })

    fireEvent.click(screen.getByText("Привет"))
    fireEvent.click(screen.getByTestId("reaction-quick-like"))
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/chats/1/messages/11/reactions",
        expect.objectContaining({ body: JSON.stringify({ emoji: "👍" }) }),
      ),
    )
  })

  it("отправляет сообщение по клику send", async () => {
    await openThread([chat(1, "Аня")], {
      pages: { first: { messages: [message(11, "Привет")], has_more: false, next_before: null } },
    })
    const input = screen.getByTestId("message-input")
    fireEvent.change(input, { target: { value: "Тест" } })
    fireEvent.click(screen.getByTestId("send-button"))
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/chats/1/messages",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ text: "Тест" }) }),
      ),
    )
  })

  it("не отправляет сообщение при пустом тексте", async () => {
    await openThread()
    const input = screen.getByTestId("message-input")
    fireEvent.change(input, { target: { value: "   " } })
    fireEvent.click(screen.getByTestId("send-button"))
    const postCalls = mockFetch.mock.calls.filter(call => String(call[0]).includes("/messages") && call[1]?.method === "POST")
    expect(postCalls.length).toBe(0)
  })

  it("обновляет список чатов по событию chat:list:invalidate", async () => {
    await openThread()
    const before = mockFetch.mock.calls.filter(call => call[0] === "/api/chats").length
    ws.send("chat:list:invalidate", {})
    await waitFor(() => expect(mockFetch.mock.calls.filter(call => call[0] === "/api/chats").length).toBeGreaterThan(before))
  })

  it("обрабатывает chat:typing событие без ошибок", async () => {
    await openThread()
    ws.send("chat:typing", { chatId: 1, userId: 500 })
    expect(screen.getByTestId("messages-scroll")).toBeInTheDocument()
  })
})
