import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react"
import React from "react"
import { MemoryRouter } from "react-router-dom"

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

vi.mock("@/lib/token", () => ({
  getToken: () => "test-token",
}))

const mockWs = vi.hoisted(() => {
  const handlers: Record<string, (payload?: any) => void> = {}
  const socket = {
    on: vi.fn((ev: string, cb: (payload?: any) => void) => { handlers[ev] = cb }),
    off: vi.fn(),
    emit: vi.fn(),
  }
  return { socket, handlers }
})

vi.mock("@/hooks/use-websocket", () => ({
  useWebSocket: () => ({ socket: mockWs.socket, connected: false }),
}))

const mockUseLanguage = {
  t: (key: string, options?: Record<string, any>) => {
    let value = (mockTranslations as Record<string, string>)[key] || key
    if (options) {
      Object.entries(options).forEach(([k, v]) => {
        value = value.replace(`{${k}}`, String(v))
      })
    }
    return value
  },
  language: "RU",
  setLanguage: vi.fn(),
}

const mockTranslations: Record<string, string> = {
  "hangout.title": "Куда пойдем",
  "hangout.action.create": "Создать встречу",
  "hangout.filter.all_categories": "Все категории",
  "hangout.filter.radius": "Радиус: {km} км",
  "hangout.category.cinema": "Кино",
  "hangout.empty": "Пока нет активных встреч",
  "hangout.disabled": "Встречи скоро появятся",
  "hangout.disabled_desc": "Эта функция пока выключена. Загляните позже!",
  "hangout.label.companions_count": "{count} из {max}",
  "nav.hangouts": "Встречи",
  "hangout.my_listings": "Мои объявления",
  "hangout.my_responses": "Мои отклики",
  "hangout.empty_my_listings": "Вы еще не создавали встречи",
  "hangout.empty_my_responses": "Вы пока никуда не откликались",
  "hangout.go_out.title": "Куда пойти вдвоём",
  "hangout.go_out.cashback": "кэшбэк {pct}%",
  "hangout.go_out.map": "На карте",
  "hangout.go_out.book": "Забронировать",
  "hangout.go_out.filter_all": "Все",
  "hangout.go_out.cat_restaurant": "Рестораны",
  "hangout.go_out.cat_hotel": "Отели",
  "hangout.go_out.map_title": "Где найти",
  "hangout.go_out.map_hint": "Показываем карту вашего города — выберите место, чтобы открыть партнёра",
  "partner.booking.date": "Дата",
  "partner.booking.time": "Время",
  "partner.booking.guests": "Гости",
  "partner.booking.confirm": "Забронировать",
  "partner.booking.fill_required": "Выберите дату и время",
  "partner.booking.error": "Не удалось забронировать",
  "hangout.suggest.upsell_title": "Идеи для пары — Premium",
  "hangout.suggest.go_premium": "Стать Premium",
  "hangout.suggest.title": "Идеи для пары",
  "hangout.suggest.open": "Показать идеи свидания",
  "hangout.suggest.close": "Скрыть",
  "hangout.suggest.create": "Создать встречу",
  "hangout.suggest.error": "Не удалось подобрать идеи. Попробуйте позже.",
}

vi.mock("@/context/language-context", () => ({
  useLanguage: () => mockUseLanguage,
}))

const mockFlags = { hangoutsEnabled: true }

vi.mock("@/context/feature-flags-context", () => ({
  useFeatureFlags: () => mockFlags,
}))

let mockIsPremium = true
vi.mock("@/hooks/use-premium", () => ({
  usePremium: () => ({ isPremium: mockIsPremium }),
}))

vi.mock("@/components/layout/app-header", () => ({
  AppHeader: () => <div data-testid="app-header" />,
}))

vi.mock("@/components/navigation/bottom-nav", () => ({
  BottomNav: () => <div data-testid="bottom-nav" />,
}))

const sampleHangouts = [
  {
    id: 1,
    author_id: 10,
    category: "cinema",
    title: "Иду на Дюну",
    description: null,
    place_name: "Аврора",
    place_address: null,
    city: "Москва",
    event_date: new Date(Date.now() + 86_400_000).toISOString(),
    max_companions: 2,
    status: "active",
    display_name: "Максим",
    avatar_url: null,
    accepted_count: 1,
    lat: "55.751244",
    lng: "37.618423",
  },
]

function renderPage(ui: React.ReactElement) {
  return render(<MemoryRouter initialEntries={["/"]}>{ui}</MemoryRouter>)
}

describe("HangoutsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
    mockFlags.hangoutsEnabled = true
    mockIsPremium = true
    ;(navigator as any).geolocation = undefined
  })

  it("renders feed with hangout cards", async () => {
    mockFetch.mockImplementation((url: string) => {
      const u = String(url)
      if (u.includes("/api/affiliate/offers")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ offers: [] }) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve(sampleHangouts) })
    })
    const HangoutsPage = (await import("@/pages/hangouts")).default

    renderPage(<HangoutsPage />)

    await waitFor(() => {
      expect(screen.getByTestId("hangout-card-1")).toBeTruthy()
    })
    expect(screen.getByText("Иду на Дюну")).toBeTruthy()
  })

  it("applies stagger animation to feed cards", async () => {
    mockFetch.mockImplementation((url: string) => {
      const u = String(url)
      if (u.includes("/api/affiliate/offers")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ offers: [] }) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve(sampleHangouts) })
    })
    const HangoutsPage = (await import("@/pages/hangouts")).default
    renderPage(<HangoutsPage />)
    await waitFor(() => { expect(screen.getByTestId("hangout-card-1")).toBeTruthy() })
    const link = screen.getByTestId("hangout-card-1").closest("a")
    expect(link).toBeTruthy()
    expect(link!.className).toContain("hangout-stagger-enter")
  })

  it("shows pull-to-refresh indicator and triggers refresh on pull gesture", async () => {
    let feedCalls = 0
    mockFetch.mockImplementation((url: string) => {
      const u = String(url)
      if (u.includes("/api/affiliate/offers")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ offers: [] }) })
      if (u.includes("/api/hangouts")) {
        feedCalls++
        return Promise.resolve({ ok: true, json: () => Promise.resolve([...sampleHangouts]) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    })
    const HangoutsPage = (await import("@/pages/hangouts")).default
    renderPage(<HangoutsPage />)
    await waitFor(() => { expect(screen.getByTestId("hangout-card-1")).toBeTruthy() })
    const before = feedCalls

    const root = screen.getByTestId("hangout-ptr").closest(".min-h-screen") as HTMLElement
    expect(screen.getByTestId("hangout-ptr")).toBeTruthy()
    fireEvent.touchStart(root, { touches: [{ clientY: 50 }] })
    fireEvent.touchMove(root, { touches: [{ clientY: 200 }] })
    fireEvent.touchEnd(root)

    await waitFor(() => { expect(feedCalls).toBeGreaterThan(before) })
  })

  it("filters by category when chip clicked", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve([]) })
    const HangoutsPage = (await import("@/pages/hangouts")).default

    renderPage(<HangoutsPage />)
    await waitFor(() => {
      expect(screen.getByTestId("hangout-category-chips")).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId("hangout-category-cinema"))

    await waitFor(() => {
      const calls = mockFetch.mock.calls.filter(([url]) => String(url).includes("/api/hangouts"))
      const last = String(calls[calls.length - 1][0])
      expect(last).toContain("category=cinema")
    })
  })

  it("sends date range params when date chip clicked", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve([]) })
    const HangoutsPage = (await import("@/pages/hangouts")).default

    renderPage(<HangoutsPage />)
    await waitFor(() => {
      expect(screen.getByTestId("hangout-date-chips")).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId("hangout-date-today"))

    await waitFor(() => {
      const calls = mockFetch.mock.calls.filter(([url]) => String(url).includes("/api/hangouts"))
      const last = String(calls[calls.length - 1][0])
      expect(last).toContain("date_from=")
      expect(last).toContain("date_to=")
    })
  })

  it("auto-loads next page when sentinel becomes visible (infinite scroll)", async () => {
    const baseItem = sampleHangouts[0]
    mockFetch.mockImplementation((url: string) => {
      const u = String(url)
      if (u.includes("/api/affiliate/offers")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ offers: [] }) })
      const page = Number(new URLSearchParams(u.split("?")[1] || "").get("page") || 1)
      const count = page >= 2 ? 5 : 20
      const items = Array.from({ length: count }, (_, i) => ({ ...baseItem, id: i + 1 + (page - 1) * 100 }))
      return Promise.resolve({ ok: true, json: () => Promise.resolve(items) })
    })

    class AutoIO {
      constructor(private cb: (entries: { isIntersecting: boolean }[]) => void) {}
      observe() {
        this.cb([{ isIntersecting: true }])
      }
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return []
      }
    }
    ;(globalThis as any).IntersectionObserver = AutoIO

    const HangoutsPage = (await import("@/pages/hangouts")).default
    renderPage(<HangoutsPage />)

    expect(screen.queryByTestId("hangouts-load-more")).toBeNull()

    await waitFor(() => {
      const calls = mockFetch.mock.calls.filter(([url]) => String(url).includes("/api/hangouts"))
      expect(String(calls[calls.length - 1][0])).toContain("page=2")
    })
  })

  it("shows 'Show new' badge on hangout:new ws event and refreshes on click", async () => {
    mockFetch.mockImplementation((url: string) => {
      const u = String(url)
      if (u.includes("/api/affiliate/offers")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ offers: [] }) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve(sampleHangouts) })
    })
    const HangoutsPage = (await import("@/pages/hangouts")).default
    renderPage(<HangoutsPage />)

    await waitFor(() => {
      expect(screen.getByTestId("hangout-card-1")).toBeTruthy()
    })

    expect(screen.queryByTestId("hangouts-new-badge")).toBeNull()

    await act(async () => {
      mockWs.handlers["hangout:new"]?.({ hangoutId: 999, title: "Fresh cafe" })
    })

    await waitFor(() => {
      expect(screen.getByTestId("hangouts-new-badge")).toBeTruthy()
    })

    const before = mockFetch.mock.calls.filter(([url]) => String(url).includes("/api/hangouts")).length
    fireEvent.click(screen.getByTestId("hangouts-new-badge"))

    await waitFor(() => {
      expect(screen.queryByTestId("hangouts-new-badge")).toBeNull()
      const calls = mockFetch.mock.calls.filter(([url]) => String(url).includes("/api/hangouts"))
      expect(calls.length).toBeGreaterThan(before)
    })
  })

  it("filters feed by price (free/paid/range) with URL sync", async () => {
    mockFetch.mockImplementation((url: string) => {
      const u = String(url)
      if (u.includes("/api/affiliate/offers")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ offers: [] }) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve(sampleHangouts) })
    })
    const HangoutsPage = (await import("@/pages/hangouts")).default
    renderPage(<HangoutsPage />)

    await waitFor(() => {
      expect(screen.getByTestId("hangout-price-free")).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId("hangout-price-free"))

    await waitFor(() => {
      expect(screen.getByTestId("hangout-price-free").getAttribute("aria-pressed")).toBe("true")
      const calls = mockFetch.mock.calls.filter(([url]) => String(url).includes("/api/hangouts"))
      const last = String(calls[calls.length - 1][0])
      expect(last).toContain("price=free")
    })

    fireEvent.click(screen.getByTestId("hangout-price-paid"))
    await waitFor(() => {
      expect(screen.getByTestId("hangout-price-max-u1500")).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId("hangout-price-max-u1500"))
    await waitFor(() => {
      const calls = mockFetch.mock.calls.filter(([url]) => String(url).includes("/api/hangouts"))
      const last = String(calls[calls.length - 1][0])
      expect(last).toContain("price=paid")
      expect(last).toContain("max_price=1500")
    })
  })

  it("renders map 'show map' button and opens OSM modal", async () => {
    mockFetch.mockImplementation((url: string) => {
      const u = String(url)
      if (u.includes("/api/affiliate/offers")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ offers: [] }) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve(sampleHangouts) })
    })
    const HangoutsPage = (await import("@/pages/hangouts")).default
    renderPage(<HangoutsPage />)

    await waitFor(() => {
      expect(screen.getByTestId("hangout-card-1")).toBeTruthy()
    })

    expect(screen.getByTestId("hangout-map-1")).toBeTruthy()
    expect(screen.getByTestId("hangout-route-1")).toBeTruthy()

    fireEvent.click(screen.getByTestId("hangout-map-1"))

    await waitFor(() => {
      expect(screen.getByTestId("hangout-route-modal-1")).toBeTruthy()
    })
    const iframe = screen.getByTitle(/Москва/)
    expect(iframe.getAttribute("src")).toContain("openstreetmap.org/export/embed.html")
    expect(iframe.getAttribute("src")).toContain("marker=55.751244")
  })

  it("shows disabled state when flag is off", async () => {
    mockFlags.hangoutsEnabled = false
    const HangoutsPage = (await import("@/pages/hangouts")).default

    renderPage(<HangoutsPage />)

    await waitFor(() => {
      expect(screen.getByTestId("hangouts-disabled")).toBeTruthy()
    })
  })

  it("shows empty message when feed is empty", async () => {
    mockFetch.mockImplementation((url: string) => {
      const u = String(url)
      if (u.includes("/api/affiliate/offers")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ offers: [] }) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    })
    const HangoutsPage = (await import("@/pages/hangouts")).default

    renderPage(<HangoutsPage />)

    await waitFor(() => {
      expect(screen.getByText("Пока нет активных встреч")).toBeTruthy()
    })
  })

  it("renders «Куда пойти вдвоём» affiliate block with offers", async () => {
    const offers = [
      { id: 28, category: "restaurant", title: "Ресторан для первого свидания", deeplink: "https://go/x", price: 2500, city: "Москва", partner_name: "Restoclub", commission_rate: 12 },
      { id: 30, category: "flowers", title: "Цветы к свиданию", deeplink: "https://go/y", price: 1500, city: "Москва", partner_name: "Flowwow", commission_rate: 15 },
    ]
    mockFetch.mockImplementation((url: string) => {
      const u = String(url)
      if (u.includes("/api/affiliate/offers")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ offers }) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    })
    const HangoutsPage = (await import("@/pages/hangouts")).default

    renderPage(<HangoutsPage />)

    await waitFor(() => {
      expect(screen.getByTestId("hangout-go-out")).toBeTruthy()
    })
    expect(screen.getByText("Куда пойти вдвоём")).toBeTruthy()
    expect(screen.getByText("Ресторан для первого свидания")).toBeTruthy()
    expect(screen.getByText("кэшбэк 12%")).toBeTruthy()
    const link = screen.getByTestId("hangout-go-out-28") as HTMLAnchorElement
    expect(link.href).toBe("https://go/x")
    expect(link.target).toBe("_blank")
  })

  it("hides go-out block when offers array is empty", async () => {
    mockFetch.mockImplementation((url: string) => {
      const u = String(url)
      if (u.includes("/api/affiliate/offers")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ offers: [] }) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    })
    const HangoutsPage = (await import("@/pages/hangouts")).default

    renderPage(<HangoutsPage />)

    await waitFor(() => {
      expect(screen.queryByTestId("hangout-go-out")).toBeNull()
    })
  })

  it("renders category filter chips and calls backend with category param", async () => {
    const offers = [
      { id: 28, category: "restaurant", title: "Ресторан для первого свидания", deeplink: "https://go/x", price: 2500, city: "Москва", partner_name: "Restoclub", commission_rate: 12 },
      { id: 30, category: "flowers", title: "Цветы к свиданию", deeplink: "https://go/y", price: 1500, city: "Москва", partner_name: "Flowwow", commission_rate: 15 },
    ]
    const seen: string[] = []
    mockFetch.mockImplementation((url: string) => {
      const u = String(url)
      if (u.includes("/api/affiliate/offers")) {
        seen.push(u)
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ offers }) })
      }
      if (u.includes("/api/profile/me")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ city: "Москва" }) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    })
    const HangoutsPage = (await import("@/pages/hangouts")).default
    renderPage(<HangoutsPage />)
    await waitFor(() => expect(screen.getByTestId("hangout-go-out")).toBeTruthy())

    const allChip = screen.getByTestId("hangout-go-out-filter-all")
    const restChip = screen.getByTestId("hangout-go-out-filter-restaurant")
    expect(allChip).toBeTruthy()
    expect(restChip).toBeTruthy()
    expect(screen.getByText("Рестораны")).toBeTruthy()

    fireEvent.click(restChip)
    await waitFor(() => {
      expect(seen.some((u) => u.includes("category=restaurant"))).toBe(true)
    })
  })

  it("opens booking dialog from card «Забронировать» button", async () => {
    const offers = [
      { id: 28, category: "restaurant", title: "Ресторан для первого свидания", deeplink: "https://go/x", price: 2500, city: "Москва", partner_name: "Restoclub", commission_rate: 12 },
    ]
    const bookingCalls: any[] = []
    mockFetch.mockImplementation((url: string, opts?: any) => {
      const u = String(url)
      if (u.includes("/api/affiliate/offers")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ offers }) })
      if (u.includes("/api/profile/me")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ city: "Москва" }) })
      if (u.includes("/api/partners/booking")) {
        bookingCalls.push({ url: u, body: JSON.parse(opts?.body || "{}") })
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ deeplink: "https://go/x?date=2026-09-01&time=19:00&guests=2", offer_id: 28 }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    })
    const HangoutsPage = (await import("@/pages/hangouts")).default
    renderPage(<HangoutsPage />)
    await waitFor(() => expect(screen.getByTestId("hangout-go-out")).toBeTruthy())

    fireEvent.click(screen.getByTestId("hangout-go-out-book-28"))
    await waitFor(() => expect(screen.getByTestId("goout-booking-date")).toBeTruthy())

    fireEvent.change(screen.getByTestId("goout-booking-date"), { target: { value: "2026-09-01" } })
    fireEvent.click(screen.getByTestId("goout-booking-confirm"))
    await waitFor(() => {
      expect(bookingCalls.length).toBeGreaterThan(0)
      expect(bookingCalls[0].body.offer_id).toBe(28)
    })
  })

  it("opens affiliate map from «На карте» button", async () => {
    const offers = [
      { id: 28, category: "restaurant", title: "Ресторан для первого свидания", deeplink: "https://go/x", price: 2500, city: "Москва", partner_name: "Restoclub", commission_rate: 12 },
    ]
    mockFetch.mockImplementation((url: string) => {
      const u = String(url)
      if (u.includes("/api/affiliate/offers")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ offers }) })
      if (u.includes("/api/profile/me")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ city: "Москва" }) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    })
    const HangoutsPage = (await import("@/pages/hangouts")).default
    renderPage(<HangoutsPage />)
    await waitFor(() => expect(screen.getByTestId("hangout-go-out")).toBeTruthy())

    fireEvent.click(screen.getByTestId("hangout-go-out-map"))
    await waitFor(() => expect(screen.getByTestId("affiliate-map-frame")).toBeTruthy())
    expect(screen.getByTestId("affiliate-map-item-28")).toBeTruthy()
  })

  it("shows premium upsell for free users and navigates to /premium", async () => {
    mockIsPremium = false
    mockFetch.mockImplementation((url: string) => {
      const u = String(url)
      if (u.includes("/api/affiliate/offers")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ offers: [] }) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    })
    const HangoutsPage = (await import("@/pages/hangouts")).default

    renderPage(<HangoutsPage />)

    await waitFor(() => {
      expect(screen.getByTestId("hangout-suggest-upsell")).toBeTruthy()
    })
    expect(screen.getByText("Стать Premium")).toBeTruthy()
    expect(screen.queryByTestId("hangout-suggest-open")).toBeNull()
  })

  it("renders date ideas for premium user after clicking open", async () => {
    mockIsPremium = true
    const ideas = [
      { title: "Кофе и настольные игры", category: "cafe", place: "Кофейня", description: "Дeскрипшн" },
      { title: "Вечер в кино", category: "cinema", place: "Кинотеатр", description: "Д2" },
    ]
    mockFetch.mockImplementation((url: string) => {
      const u = String(url)
      if (u.includes("/api/affiliate/offers")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ offers: [] }) })
      if (u.includes("/api/hangouts/suggest")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ source: "openai", suggestions: ideas }) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    })
    const HangoutsPage = (await import("@/pages/hangouts")).default

    renderPage(<HangoutsPage />)

    await waitFor(() => {
      expect(screen.getByTestId("hangout-suggest-open")).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId("hangout-suggest-open"))

    await waitFor(() => {
      expect(screen.getByText("Кофе и настольные игры")).toBeTruthy()
    })
    expect(screen.getByText("Вечер в кино")).toBeTruthy()
    expect(screen.getAllByText("Создать встречу").length).toBeGreaterThan(0)
  })

  it("shows error message when suggest returns 403 or fails", async () => {
    mockIsPremium = true
    mockFetch.mockImplementation((url: string) => {
      const u = String(url)
      if (u.includes("/api/affiliate/offers")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ offers: [] }) })
      if (u.includes("/api/hangouts/suggest")) return Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({ error: "PREMIUM_REQUIRED" }) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    })
    const HangoutsPage = (await import("@/pages/hangouts")).default

    renderPage(<HangoutsPage />)

    await waitFor(() => {
      expect(screen.getByTestId("hangout-suggest-open")).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId("hangout-suggest-open"))

    await waitFor(() => {
      expect(screen.getByTestId("hangout-suggest-error")).toBeTruthy()
    })
  })
})

describe("HangoutsMyPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
  })

  it("renders tabs and loads listings", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (String(url).includes("/api/hangouts/my")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(sampleHangouts) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    })
    const HangoutsMyPage = (await import("@/pages/hangouts-my")).default

    renderPage(<HangoutsMyPage />)

    await waitFor(() => {
      expect(screen.getByTestId("tab-listings")).toBeTruthy()
      expect(screen.getByTestId("my-hangout-1")).toBeTruthy()
    })
  })

  it("haversineKm computes distance used for radius filter", async () => {
    const { haversineKm } = await import("@/pages/hangouts")
    // Екатеринбург (56.84, 60.64) → Москва (55.75, 37.62)
    const moscowKm = haversineKm(56.84, 60.64, 55.75, 37.62)
    expect(moscowKm).toBeGreaterThan(1200)
    expect(moscowKm).toBeLessThan(1600)
    // Нулевое расстояние для совпадающих координат
    expect(haversineKm(55.75, 37.62, 55.75, 37.62)).toBeLessThan(0.01)
  })
})
