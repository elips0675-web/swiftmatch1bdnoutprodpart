import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import React from "react"

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

const nav = vi.hoisted(() => ({ search: "", replace: vi.fn(), back: vi.fn() }))

vi.mock("@/shims/next-navigation", () => ({
  useRouter: () => ({ replace: nav.replace, back: nav.back, push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
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
  useFeatureFlags: () => ({ videoCallsEnabled: true, aiIcebreakersEnabled: false }),
}))

vi.mock("@/hooks/use-websocket", () => ({
  useWebSocket: () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() }, connected: true }),
}))

vi.mock("@/hooks/use-webrtc", () => ({ useWebRTC: () => ({}) }))

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
vi.mock("@/shims/ai-flows", () => ({
  aiChatIcebreakerSuggestions: () => Promise.resolve({ suggestions: [] }),
}))

import ChatsPage from "@/pages/chats"

Element.prototype.scrollIntoView = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  mockFetch.mockReset()
  nav.search = ""
  auth.token = "test-token"
})

interface ChatApiRow {
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

function chat(id: number, name: string, extra: Partial<ChatApiRow> = {}): ChatApiRow {
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

function mockApi(list: ChatApiRow[], messages: unknown[] = []) {
  mockFetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input)
    const method = (init?.method ?? "GET").toUpperCase()
    if (url.includes("/messages")) {
      if (method === "POST") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 99, text: "ok", created_at: new Date().toISOString() }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ messages, has_more: false, next_before: null }) })
    }
    if (url.startsWith("/api/chats/")) return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    if (input === "/api/chats") return Promise.resolve({ ok: true, json: () => Promise.resolve(list) })
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  })
}

describe("Страница чатов (список)", () => {
  it("показывает спиннер, пока список грузится", () => {
    mockFetch.mockReturnValue(new Promise(() => {}))

    const { container } = render(<ChatsPage />)

    expect(screen.getByPlaceholderText("chats.search")).toBeInTheDocument()
    expect(container.querySelector(".animate-spin")).toBeTruthy()
    expect(screen.queryByTestId("chat-row-1")).toBeNull()
  })

  it("загружает список чатов из GET /api/chats", async () => {
    mockApi([chat(1, "Аня"), chat(2, "Борис")])

    render(<ChatsPage />)

    expect(await screen.findByTestId("chat-row-1")).toBeInTheDocument()
    expect(screen.getByTestId("chat-row-2")).toBeInTheDocument()
    expect(screen.getByText("Аня")).toBeInTheDocument()
    expect(mockFetch).toHaveBeenCalledWith("/api/chats", {
      headers: { Authorization: "Bearer test-token" },
    })
  })

  it("на пустом списке показывает activity.empty", async () => {
    mockApi([])

    render(<ChatsPage />)

    expect(await screen.findByText("activity.empty")).toBeInTheDocument()
  })

  it("фильтрует чаты по поиску", async () => {
    mockApi([chat(1, "Аня"), chat(2, "Борис")])

    render(<ChatsPage />)
    await screen.findByTestId("chat-row-1")

    fireEvent.change(screen.getByPlaceholderText("chats.search"), { target: { value: "ан" } })

    expect(screen.getByTestId("chat-row-1")).toBeInTheDocument()
    expect(screen.queryByTestId("chat-row-2")).toBeNull()
  })

  it("разбивает список на страницы по 8 и переключает их", async () => {
    mockApi(Array.from({ length: 9 }, (_, i) => chat(i + 1, `Чат ${i + 1}`)))

    render(<ChatsPage />)

    await waitFor(() => expect(screen.getByTestId("chat-row-1")).toBeInTheDocument())
    expect(screen.getByTestId("chat-row-8")).toBeInTheDocument()
    expect(screen.queryByTestId("chat-row-9")).toBeNull()

    expect(screen.getByRole("button", { name: "chats.page_prev" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "chats.page_next" }))

    expect(screen.getByTestId("chat-row-9")).toBeInTheDocument()
    expect(screen.queryByTestId("chat-row-1")).toBeNull()
    expect(screen.getByRole("button", { name: "chats.page_next" })).toBeDisabled()
  })

  it("без токена уводит на /login", async () => {
    auth.token = null
    mockApi([])

    render(<ChatsPage />)

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/login"))
  })

  it("по ?groupId открывает ленту группы", async () => {
    nav.search = "groupId=5"
    mockApi([])

    render(<ChatsPage />)

    expect(await screen.findByTestId("group-feed")).toBeInTheDocument()
  })

  it("открывает переписку, отправляет сообщение и возвращается к списку", async () => {
    const message = {
      id: 11,
      text: "Как дела?",
      sender_id: 501,
      created_at: new Date().toISOString(),
      reactions: [],
      reply_to: null,
      ttl_seconds: null,
    }
    mockApi([chat(1, "Аня", { online: true })], [message])

    render(<ChatsPage />)

    fireEvent.click(await screen.findByTestId("chat-row-1"))

    expect(await screen.findByTestId("messages-scroll")).toBeInTheDocument()
    expect(screen.getByText("Как дела?")).toBeInTheDocument()
    expect(mockFetch).toHaveBeenCalledWith("/api/chats/1?lang=ru", {
      headers: { Authorization: "Bearer test-token" },
    })
    expect(mockFetch).toHaveBeenCalledWith("/api/chats/1/read", {
      method: "PUT",
      headers: { Authorization: "Bearer test-token" },
    })

    for (const name of [
      "common.back",
      "chats.video_call",
      "chats.voice_call",
      "schedule.propose_btn",
      "chats.ai_themes",
      "chats.actions",
    ]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument()
    }

    fireEvent.change(screen.getByTestId("message-input"), { target: { value: "Привет" } })
    fireEvent.click(screen.getByTestId("send-button"))

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/chats/1/messages",
        expect.objectContaining({ method: "POST" }),
      ),
    )

    fireEvent.click(screen.getByRole("button", { name: "common.back" }))

    expect(await screen.findByTestId("chat-row-1")).toBeInTheDocument()
  })

  it("жалоба на собеседника уходит на сервер через POST /api/reports", async () => {
    const message = {
      id: 11,
      text: "Привет",
      sender_id: 501,
      created_at: new Date().toISOString(),
      reactions: [],
      reply_to: null,
      ttl_seconds: null,
    }
    mockApi([chat(1, "Аня")], [message])

    render(<ChatsPage />)
    fireEvent.click(await screen.findByTestId("chat-row-1"))
    await screen.findByTestId("messages-scroll")

    fireEvent.click(screen.getByTestId("chat-report-open"))
    expect(screen.getByText("report.title")).toBeInTheDocument()

    fireEvent.click(screen.getByText("report.button.send"))
    expect(toastMock).toHaveBeenCalledWith({
      variant: "destructive",
      title: "report.toast.no_reason_title",
      description: "report.toast.no_reason_desc",
    })

    fireEvent.click(screen.getByText("report.reason.content"))
    fireEvent.click(screen.getByTestId("report-submit"))

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/reports",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ reported_id: 501, reason: "offensive" }),
        }),
      ),
    )
    await waitFor(() => expect(screen.queryByText("report.title")).toBeNull())
  })
})
