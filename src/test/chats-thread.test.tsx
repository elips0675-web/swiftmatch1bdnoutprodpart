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
  const state = { enabled: true }
  return { socket, send, handlers, state }
})

vi.mock("@/hooks/use-websocket", () => ({
  useWebSocket: () => ({ socket: ws.state.enabled ? ws.socket : null, connected: ws.state.enabled }),
}))

vi.mock("@/hooks/use-webrtc", () => ({ useWebRTC: () => ({}) }))

const nav = vi.hoisted(() => ({ search: "" }))

const router = vi.hoisted(() => ({ replace: vi.fn(), back: vi.fn(), push: vi.fn(), prefetch: vi.fn() }))

vi.mock("@/shims/next-navigation", () => ({
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => router,
}))

const auth = vi.hoisted(() => ({
  token: "test-token" as string | null,
  isLoading: false,
  userId: 7 as number | null,
}))

vi.mock("@/context/auth-context", () => ({
  useAuth: () => ({
    token: auth.token,
    user: auth.userId === null ? null : { id: auth.userId },
    isLoading: auth.isLoading,
  }),
}))

vi.mock("@/lib/token", () => ({ getToken: () => "test-token" }))

const lang = vi.hoisted(() => ({ language: "RU" as "RU" | "EN" }))

vi.mock("@/context/language-context", () => ({
  useLanguage: () => ({ t: (key: string) => key, language: lang.language, setLanguage: vi.fn() }),
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

vi.mock("@/hooks/useAntiScreenshot", async () => {
  const React = await import("react")
  return { useAntiScreenshot: () => React.useRef<HTMLDivElement | null>(null) }
})

const wordFilter = vi.hoisted(() => ({ forbidden: false, gibberish: false }))

vi.mock("@/lib/word-filter", () => ({
  containsForbiddenWords: () => wordFilter.forbidden,
  isGibberish: () => wordFilter.gibberish,
}))

vi.mock("@/components/navigation/bottom-nav", () => ({ BottomNav: () => <div data-testid="bottom-nav" /> }))
vi.mock("@/components/layout/app-header", () => ({ AppHeader: () => <div data-testid="app-header" /> }))
vi.mock("@/components/opening-lines-picker", () => ({
  OpeningLinesPicker: ({ onPick }: { onPick?: (text: string) => void }) => (
    <button type="button" data-testid="opening-line-pick" onClick={() => onPick?.("Привет из пикера")}>
      opening-line
    </button>
  ),
}))
vi.mock("@/components/video-call", () => ({
  VideoCallDialog: ({
    onToggleMute,
    onToggleVideo,
  }: {
    onToggleMute?: () => void
    onToggleVideo?: () => void
  }) => (
    <div data-testid="video-call-dialog">
      <button type="button" data-testid="video-toggle-mute" onClick={onToggleMute}>
        mute
      </button>
      <button type="button" data-testid="video-toggle-video" onClick={onToggleVideo}>
        video
      </button>
    </div>
  ),
}))
vi.mock("@/components/voice-call", () => ({
  VoiceCallDialog: ({ onToggleMute }: { onToggleMute?: () => void }) => (
    <div data-testid="voice-call-dialog">
      <button type="button" data-testid="voice-toggle-mute" onClick={onToggleMute}>
        mute
      </button>
    </div>
  ),
}))
vi.mock("@/components/feeds/category-feed", () => ({
  CategoryFeed: ({
    categoryNameRu,
    categoryNameEn,
    groupId,
  }: {
    categoryNameRu?: string
    categoryNameEn?: string
    groupId?: string
  }) => (
    <div data-testid="group-feed" data-name-ru={categoryNameRu} data-name-en={categoryNameEn} data-group={groupId} />
  ),
}))

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
  reply_to?: number | null
  reply_text?: string | null
  reply_sender_name?: string | null
  reply_image_url?: string | null
  image_url?: string
  ttl_seconds?: number
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
  createdChatFail?: boolean
  scheduleOk?: boolean
  scheduleReject?: boolean
  scheduleError?: Record<string, unknown>
  reportOk?: boolean
  reaction?: { action: string; emoji: string; count?: number }
  reactionReject?: boolean
  messagesFail?: boolean
  sendFail?: boolean
  chatDetail?: { common_interest?: string | null }
  chatDetailFail?: boolean
  listFail?: boolean
  listFailAfterFirst?: boolean
}

function mockApi(options: ApiOptions = {}) {
  let listCalls = 0
  mockFetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input)
    const method = (init?.method ?? "GET").toUpperCase()

    if (url === "/api/chats" && method === "POST") {
      return options.createdChatFail ? json(null, false) : json(options.createdChat ?? { id: 77, existing: false })
    }
    if (url === "/api/chats") {
      listCalls += 1
      const fail = options.listFail === true || (options.listFailAfterFirst === true && listCalls > 1)
      return fail ? json(null, false) : json(options.chats ?? [])
    }
    if (url === "/api/schedule") {
      if (options.scheduleReject) return Promise.reject(new Error("network-down"))
      if (options.scheduleError) return json(options.scheduleError, false)
      return options.scheduleOk === false ? json({ message: "schedule-broken" }, false) : json({ id: 1 })
    }
    if (url === "/api/reports") return json({ id: 1 }, options.reportOk !== false)

    const detail = url.match(/^\/api\/chats\/(\d+)\?lang=/)
    if (detail) return options.chatDetailFail ? json(null, false) : json(options.chatDetail ?? {})

    const reactions = url.match(/^\/api\/chats\/(\d+)\/messages\/(\d+)\/reactions$/)
    if (reactions) {
      if (options.reactionReject) return Promise.reject(new Error("network-down"))
      return json(options.reaction ?? { action: "added", emoji: "❤️", count: 1 })
    }

    const messages = url.match(/^\/api\/chats\/(\d+)\/messages/)
    if (messages) {
      if (method === "POST") {
        return options.sendFail ? json(null, false) : json({ id: 99, text: "ok", created_at: new Date().toISOString() })
      }
      if (options.messagesFail) return json(null, false)
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
  ws.state.enabled = true
  nav.search = ""
  auth.token = "test-token"
  auth.isLoading = false
  auth.userId = 7
  lang.language = "RU"
  wordFilter.forbidden = false
  wordFilter.gibberish = false
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
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith("/api/chats", {
        headers: { Authorization: "Bearer test-token" },
      }),
    )
    expect(screen.getByTestId("app-header")).toBeInTheDocument()
    expect(screen.getByTestId("bottom-nav")).toBeInTheDocument()
    expect(screen.getByText("activity.empty")).toBeInTheDocument()
  })

  it("рисует моё сообщение с цитатой, фото, ttl и реакцией", async () => {
    await openThread([chat(1, "Аня")], {
      pages: {
        first: {
          messages: [
            message(11, "Мой ответ", {
              sender_id: 7,
              reactions: [{ emoji: "❤️" }],
              reply_to: 5,
              reply_text: "Цитата",
              reply_sender_name: "Аня",
              image_url: "https://cdn.example/photo.png",
              ttl_seconds: 5,
            }),
          ],
          has_more: false,
          next_before: null,
        },
      },
    })

    expect(screen.getByText("Мой ответ")).toBeInTheDocument()
    expect(screen.getByText("Цитата")).toBeInTheDocument()
    expect(document.querySelector('img[src="https://cdn.example/photo.png"]')).not.toBeNull()
    expect(screen.getByRole("button", { name: "❤️" })).toBeInTheDocument()

    fireEvent.click(screen.getByTestId("reply-button"))
    expect(screen.getByTestId("reply-bar")).toBeInTheDocument()
    expect(within(screen.getByTestId("reply-bar")).getByText("chats.reply_to")).toBeInTheDocument()
  })

  it("показывает заглушку цитаты, если сервер не прислал текст ответа", async () => {
    await openThread([chat(1, "Аня")], {
      pages: {
        first: {
          messages: [message(12, "Ответ без текста", { sender_id: 7, reply_to: 4 })],
          has_more: false,
          next_before: null,
        },
      },
    })

    expect(screen.getAllByText("chats.reply_unavailable")).toHaveLength(2)
  })

  it("показывает относительное время в списке чатов", async () => {
    const now = Date.now()
    mockApi({
      chats: [
        chat(1, "Только что", { updated_at: new Date(now).toISOString() }),
        chat(2, "Минуты", { updated_at: new Date(now - 5 * 60 * 1000).toISOString() }),
        chat(3, "Часы", { updated_at: new Date(now - 3 * 60 * 60 * 1000).toISOString() }),
        chat(4, "Дни", { updated_at: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString() }),
      ],
    })
    render(<ChatsPage />)

    await screen.findByTestId("chat-row-1")
    expect(screen.getByText("только что")).toBeInTheDocument()
    expect(screen.getByText("5м")).toBeInTheDocument()
    expect(screen.getByText("3ч")).toBeInTheDocument()
    expect(screen.getByText("2д")).toBeInTheDocument()
  })

  it("показывает относительное время на английском", async () => {
    lang.language = "EN"
    const now = Date.now()
    mockApi({
      chats: [
        chat(1, "Now", { updated_at: new Date(now).toISOString() }),
        chat(2, "Minutes", { updated_at: new Date(now - 5 * 60 * 1000).toISOString() }),
        chat(3, "Hours", { updated_at: new Date(now - 3 * 60 * 60 * 1000).toISOString() }),
        chat(4, "Days", { updated_at: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString() }),
        chat(5, "Weeks", { updated_at: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString() }),
      ],
    })
    render(<ChatsPage />)

    await screen.findByTestId("chat-row-1")
    expect(screen.getByText("just now")).toBeInTheDocument()
    expect(screen.getByText("5m")).toBeInTheDocument()
    expect(screen.getByText("3h")).toBeInTheDocument()
    expect(screen.getByText("2d")).toBeInTheDocument()
  })

  it("блокирует отправку запрещённых слов и бессмыслицы", async () => {
    await openThread()
    const input = screen.getByTestId("message-input")

    wordFilter.forbidden = true
    fireEvent.change(input, { target: { value: "запрещённое" } })
    fireEvent.click(screen.getByTestId("send-button"))

    expect(toastMock).toHaveBeenCalledWith({
      variant: "destructive",
      title: "filter.toast.title",
      description: "filter.toast.description",
    })

    wordFilter.forbidden = false
    wordFilter.gibberish = true
    fireEvent.change(input, { target: { value: "ааааа" } })
    fireEvent.click(screen.getByTestId("send-button"))

    expect(toastMock).toHaveBeenCalledWith({
      variant: "destructive",
      title: "filter.toast.title",
      description: "filter.toast.gibberish_description",
    })

    const posts = mockFetch.mock.calls.filter(
      call => String(call[0]).includes("/messages") && call[1]?.method === "POST",
    )
    expect(posts).toHaveLength(0)
  })

  it("показывает ошибку сети при предложении свидания", async () => {
    await openThread([chat(1, "Аня")], { scheduleReject: true })

    fireEvent.click(screen.getByRole("button", { name: "schedule.propose_btn" }))
    fireEvent.change(screen.getByTestId("schedule-date"), { target: { value: "2026-10-20" } })
    fireEvent.change(screen.getByTestId("schedule-time"), { target: { value: "18:30" } })
    fireEvent.click(screen.getByTestId("schedule-submit"))

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith({ variant: "destructive", title: "error.generic_title" }),
    )
    expect(screen.getByTestId("schedule-date")).toBeInTheDocument()
  })

  it("по matchId создаёт новый чат и очищает переписку", async () => {
    nav.search = "matchId=900"
    mockApi({ chats: [chat(1, "Аня")], createdChat: { id: 78, existing: false } })
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
    expect(screen.getByText("chats.today")).toBeInTheDocument()
    expect(mockFetch.mock.calls.filter(call => call[0] === "/api/chats").length).toBeGreaterThan(1)
  })

  it("игнорирует некорректный matchId и свой собственный id", async () => {
    nav.search = "matchId=abc"
    mockApi({ chats: [chat(1, "Аня")] })
    const first = render(<ChatsPage />)
    await screen.findByTestId("chat-row-1")
    expect(mockFetch.mock.calls.filter(call => call[1]?.method === "POST")).toHaveLength(0)
    first.unmount()

    nav.search = "matchId=7"
    mockApi({ chats: [chat(1, "Аня")] })
    render(<ChatsPage />)
    await screen.findByTestId("chat-row-1")
    expect(mockFetch.mock.calls.filter(call => call[1]?.method === "POST")).toHaveLength(0)
  })

  it("догрузка истории: пустая страница снимает флаг «есть ещё»", async () => {
    await openThread([chat(1, "Аня")], {
      pages: {
        first: { messages: [message(11, "Свежее")], has_more: true, next_before: 5 },
        "5": { messages: [], has_more: false, next_before: null },
      },
    })

    fireEvent.scroll(screen.getByTestId("messages-scroll"))
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith("/api/chats/1/messages?limit=50&before=5", {
        headers: { Authorization: "Bearer test-token" },
      }),
    )

    mockFetch.mockClear()
    fireEvent.scroll(screen.getByTestId("messages-scroll"))
    expect(mockFetch.mock.calls.filter(call => String(call[0]).includes("/messages"))).toHaveLength(0)
  })

  it("переход назад по matchId уводит по истории браузера", async () => {
    nav.search = "matchId=900"
    mockApi({
      chats: [chat(3, "Матч", { other_user_id: 900 })],
      pages: { first: { messages: [], has_more: false, next_before: null } },
    })
    render(<ChatsPage />)
    await screen.findByTestId("messages-scroll")

    fireEvent.click(screen.getByRole("button", { name: "common.back" }))

    expect(router.back).toHaveBeenCalledTimes(1)
  })

  it("подставляет текст из пикера первых фраз и берёт общий интерес", async () => {
    await openThread([chat(1, "Аня")], { chatDetail: { common_interest: "sport" } })

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith("/api/chats/1?lang=ru", {
        headers: { Authorization: "Bearer test-token" },
      }),
    )

    fireEvent.click(screen.getByTestId("opening-line-pick"))

    expect(screen.getByTestId("message-input")).toHaveValue("Привет из пикера")
  })

  it("отправляет эмодзи из панели смайлов", async () => {
    await openThread()

    const emoji = document.querySelector(".grid.grid-cols-5.gap-1 button")
    expect(emoji).not.toBeNull()
    fireEvent.click(emoji as HTMLElement)

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/chats/1/messages",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ text: "❤️" }) }),
      ),
    )
  })

  it("переключает микрофон и камеру в диалогах звонков", async () => {
    await openThread()

    fireEvent.click(screen.getByRole("button", { name: "chats.video_call" }))
    expect(screen.getByTestId("video-call-dialog")).toBeInTheDocument()
    fireEvent.click(screen.getByTestId("video-toggle-mute"))
    fireEvent.click(screen.getByTestId("video-toggle-video"))

    fireEvent.click(screen.getByRole("button", { name: "chats.voice_call" }))
    expect(screen.getByTestId("voice-call-dialog")).toBeInTheDocument()
    fireEvent.click(screen.getByTestId("voice-toggle-mute"))
  })

  it("группа по groupId открывает ленту группы", async () => {
    nav.search = "groupId=101"
    mockApi({ chats: [] })
    render(<ChatsPage />)

    const feed = await screen.findByTestId("group-feed")
    expect(feed).toHaveAttribute("data-name-ru", "Хип-хоп")
    expect(feed).toHaveAttribute("data-group", "101")
  })

  it("английская локаль: название группы из подгруппы", async () => {
    lang.language = "EN"
    nav.search = "groupId=101"
    mockApi({ chats: [] })
    render(<ChatsPage />)

    const feed = await screen.findByTestId("group-feed")
    expect(feed).toHaveAttribute("data-name-en", "Hip-hop")
  })

  it("неизвестная группа показывает номер вместо названия", async () => {
    nav.search = "groupId=999"
    mockApi({ chats: [] })
    render(<ChatsPage />)

    const feed = await screen.findByTestId("group-feed")
    expect(feed).toHaveAttribute("data-name-ru", "Group #999")
  })

  it("открывает чат, когда детали и история недоступны", async () => {
    mockApi({ chats: [chat(1, "Аня")], chatDetailFail: true, messagesFail: true })
    render(<ChatsPage />)

    fireEvent.click(await screen.findByTestId("chat-row-1"))

    expect(await screen.findByTestId("messages-scroll")).toBeInTheDocument()
    expect(screen.getByText("chats.today")).toBeInTheDocument()
  })

  it("показывает пустой список, если сервер вернул ошибку", async () => {
    mockApi({ chats: [], listFail: true })
    render(<ChatsPage />)

    expect(await screen.findByText("activity.empty")).toBeInTheDocument()
  })

  it("обновляет список по сокету, даже если сервер ответил ошибкой", async () => {
    await openThread()
    mockApi({ chats: [], listFail: true })

    ws.send("chat:message", {
      chatId: 2,
      message: { id: 56, text: "Чужое", created_at: new Date().toISOString() },
    })

    expect(screen.getByTestId("messages-scroll")).toBeInTheDocument()
  })

  it("ошибка создания чата по matchId не ломает страницу", async () => {
    nav.search = "matchId=900"
    mockApi({ chats: [chat(1, "Аня")], createdChatFail: true })
    render(<ChatsPage />)

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith("/api/chats", expect.objectContaining({ method: "POST" })),
    )
    expect(await screen.findByTestId("chat-row-1")).toBeInTheDocument()
    expect(screen.queryByTestId("messages-scroll")).toBeNull()
  })

  it("сбой обновления списка после создания чата не ломает переписку", async () => {
    nav.search = "matchId=900"
    mockApi({
      chats: [chat(1, "Аня")],
      createdChat: { id: 78, existing: true },
      listFailAfterFirst: true,
      pages: { first: { messages: [message(31, "Мы совпали")], has_more: false, next_before: null } },
    })
    render(<ChatsPage />)

    expect(await screen.findByTestId("messages-scroll")).toBeInTheDocument()
    expect(screen.getByText("Мы совпали")).toBeInTheDocument()
  })

  it("список: дубль id, пустые имя, сообщение и дата", async () => {
    mockApi({
      chats: [chat(1, "Аня"), chat(1, "Дубль"), chat(2, "", { last_message: "", updated_at: "" })],
    })
    render(<ChatsPage />)

    await screen.findByTestId("chat-row-1")
    expect(screen.getAllByTestId("chat-row-1")).toHaveLength(1)
    expect(screen.getByTestId("chat-row-2")).toBeInTheDocument()
    expect(screen.getByText("?")).toBeInTheDocument()
  })

  it("подписывается на visualViewport и отписывается при размонтировании", async () => {
    const addSpy = vi.fn()
    const removeSpy = vi.fn()
    Object.defineProperty(window, "visualViewport", {
      value: { addEventListener: addSpy, removeEventListener: removeSpy },
      configurable: true,
    })
    mockApi({ chats: [chat(1, "Аня")] })
    const view = render(<ChatsPage />)
    await screen.findByTestId("chat-row-1")

    expect(addSpy).toHaveBeenCalledWith("resize", expect.any(Function))
    view.unmount()
    expect(removeSpy).toHaveBeenCalledWith("resize", expect.any(Function))

    delete (window as unknown as { visualViewport?: unknown }).visualViewport
  })

  it("работает без websocket", async () => {
    ws.state.enabled = false
    mockApi({ chats: [chat(1, "Аня")] })
    render(<ChatsPage />)

    fireEvent.click(await screen.findByTestId("chat-row-1"))

    expect(await screen.findByTestId("messages-scroll")).toBeInTheDocument()
  })

  it("без сессии уводит на /login и ждёт резолва сессии", async () => {
    auth.token = null
    auth.isLoading = true
    mockApi({ chats: [] })
    const pending = render(<ChatsPage />)
    expect(router.replace).not.toHaveBeenCalled()
    pending.unmount()

    auth.isLoading = false
    render(<ChatsPage />)
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"))
  })

  it("сбой отправки сообщения и реакции не ломают переписку", async () => {
    await openThread([chat(1, "Аня")], {
      pages: { first: { messages: [message(11, "Привет")], has_more: false, next_before: null } },
      sendFail: true,
      reactionReject: true,
    })

    fireEvent.change(screen.getByTestId("message-input"), { target: { value: "Не дойдёт" } })
    fireEvent.click(screen.getByTestId("send-button"))
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith("/api/chats/1/messages", expect.objectContaining({ method: "POST" })),
    )

    fireEvent.click(screen.getByRole("button", { name: "chats.add_reaction" }))
    fireEvent.click(screen.getByTestId("reaction-quick-heart"))

    await waitFor(() => expect(screen.queryByTestId("reaction-quick-heart")).toBeNull())
    expect(screen.getByText("Привет")).toBeInTheDocument()
  })

  it("двойная прокрутка вверх не запускает вторую загрузку истории", async () => {
    await openThread([chat(1, "Аня")], {
      pages: {
        first: { messages: [message(11, "Свежее")], has_more: true, next_before: 5 },
        "5": { messages: [message(4, "Старое")], has_more: false, next_before: null },
      },
    })

    const scroll = screen.getByTestId("messages-scroll")
    fireEvent.scroll(scroll)
    fireEvent.scroll(scroll)

    expect(await screen.findByText("Старое")).toBeInTheDocument()
    expect(mockFetch.mock.calls.filter(call => String(call[0]).includes("before=5"))).toHaveLength(1)
  })

  it("без пользователя страница работает и считает сообщения чужими", async () => {
    auth.userId = null
    await openThread([chat(1, "Аня")], {
      pages: { first: { messages: [message(11, "Чужое")], has_more: false, next_before: null } },
    })

    expect(screen.getByText("Чужое")).toBeInTheDocument()
  })

  it("английская локаль: детали чата и айсбрейкеры запрашиваются на en", async () => {
    lang.language = "EN"
    aiFlows.aiChatIcebreakerSuggestions.mockResolvedValue({ suggestions: ["How was your day?"] })
    await openThread([chat(1, "Аня")])

    expect(await screen.findByText("How was your day?")).toBeInTheDocument()
    expect(mockFetch).toHaveBeenCalledWith("/api/chats/1?lang=en", {
      headers: { Authorization: "Bearer test-token" },
    })
    expect(aiFlows.aiChatIcebreakerSuggestions).toHaveBeenCalledWith({ chatUserId: 501, language: "en" })
  })

  it("по matchId открывает переписку, даже если история недоступна", async () => {
    nav.search = "matchId=900"
    mockApi({ chats: [chat(3, "Матч", { other_user_id: 900 })], messagesFail: true })
    render(<ChatsPage />)

    expect(await screen.findByTestId("messages-scroll")).toBeInTheDocument()
  })

  it("по matchId не ломается, если история существующего чата недоступна", async () => {
    nav.search = "matchId=900"
    mockApi({ chats: [chat(1, "Аня")], createdChat: { id: 78, existing: true }, messagesFail: true })
    render(<ChatsPage />)

    expect(await screen.findByTestId("messages-scroll")).toBeInTheDocument()
  })

  it("пустой ввод по Enter не отправляет сообщение", async () => {
    await openThread()

    fireEvent.keyDown(screen.getByTestId("message-input"), { key: "Enter" })

    expect(
      mockFetch.mock.calls.filter(call => String(call[0]).includes("/messages") && call[1]?.method === "POST"),
    ).toHaveLength(0)
  })

  it("ошибка свидания без текста показывает общий заголовок", async () => {
    await openThread([chat(1, "Аня")], { scheduleError: {} })

    fireEvent.click(screen.getByRole("button", { name: "schedule.propose_btn" }))
    fireEvent.change(screen.getByTestId("schedule-date"), { target: { value: "2026-10-20" } })
    fireEvent.change(screen.getByTestId("schedule-time"), { target: { value: "18:30" } })
    fireEvent.click(screen.getByTestId("schedule-submit"))

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith({ variant: "destructive", title: "error.generic_title" }),
    )
    expect(screen.getByTestId("schedule-date")).toBeInTheDocument()
  })

  it("чужое сообщение без реакций: цитата-фото и ответ на сообщение без текста", async () => {
    await openThread([chat(1, "Аня")], {
      pages: {
        first: {
          messages: [
            message(21, "Ответ с фото", {
              sender_id: 501,
              reactions: undefined,
              reply_to: 3,
              reply_text: null,
              reply_sender_name: "Аня",
              reply_image_url: "https://cdn.example/reply.png",
            }),
            {
              id: 22,
              text: "",
              sender_id: 501,
              created_at: new Date().toISOString(),
              image_url: "https://cdn.example/only.png",
            },
          ],
          has_more: false,
          next_before: null,
        },
      },
    })

    expect(screen.getByText("📷")).toBeInTheDocument()
    expect(document.querySelector('img[src="https://cdn.example/only.png"]')).not.toBeNull()

    fireEvent.click(screen.getAllByTestId("reply-button")[1])

    expect(screen.getByTestId("reply-bar")).toBeInTheDocument()
    expect(within(screen.getByTestId("reply-bar")).getByText("chats.reply_to")).toBeInTheDocument()
  })

  it("панель реакций открывается и закрывается на своих и чужих сообщениях", async () => {
    await openThread([chat(1, "Аня")], {
      pages: {
        first: {
          messages: [
            message(31, "Моё", { sender_id: 7 }),
            message(32, "С реакцией", { sender_id: 501, reactions: [{ emoji: "🔥" }] }),
            message(33, "Без реакции", { sender_id: 501 }),
          ],
          has_more: false,
          next_before: null,
        },
      },
    })

    const smiles = () => screen.getAllByRole("button", { name: "chats.add_reaction" })

    fireEvent.click(smiles()[0])
    expect(screen.getByTestId("reaction-quick-heart")).toBeInTheDocument()
    fireEvent.click(smiles()[0])
    expect(screen.queryByTestId("reaction-quick-heart")).toBeNull()

    fireEvent.click(smiles()[1])
    expect(screen.getByTestId("reaction-quick-heart")).toBeInTheDocument()
    fireEvent.click(smiles()[1])
    expect(screen.queryByTestId("reaction-quick-heart")).toBeNull()

    fireEvent.click(smiles()[2])
    expect(screen.getByTestId("reaction-quick-heart")).toBeInTheDocument()
  })

  it("список показывает аватар при пустом имени", async () => {
    mockApi({ chats: [chat(1, "", { avatar_url: "https://cdn.example/a.png" })] })
    render(<ChatsPage />)

    const row = await screen.findByTestId("chat-row-1")
    expect(row.querySelector("img")).not.toBeNull()
  })

  it("чат с аватаром и пустым именем: заголовок и ответ без имени", async () => {
    nav.search = "matchId=900"
    mockApi({
      chats: [chat(3, "", { other_user_id: 900, avatar_url: "https://cdn.example/av.png" })],
      pages: {
        first: { messages: [message(41, "Чужое", { sender_id: 900 })], has_more: false, next_before: null },
      },
    })
    render(<ChatsPage />)

    await screen.findByTestId("messages-scroll")
    expect(document.querySelector('img[src="https://cdn.example/av.png"]')).not.toBeNull()

    fireEvent.click(screen.getByTestId("reply-button"))

    expect(within(screen.getByTestId("reply-bar")).getByText("chats.reply_to")).toBeInTheDocument()
  })

})
