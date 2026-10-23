import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react"
import React from "react"
import { MemoryRouter } from "react-router-dom"
import HangoutsPage, { __resetFeedCache } from "@/pages/hangouts"

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

const mockTranslations: Record<string, string> = {
  "hangout.title": "Куда пойдем",
  "hangout.action.create": "Создать встречу",
  "hangout.filter.all_categories": "Все категории",
  "hangout.filter.all_types": "Все",
  "hangout.filter.all_dates": "Любая дата",
  "hangout.filter.today": "Сегодня",
  "hangout.filter.tomorrow": "Завтра",
  "hangout.filter.weekend": "Выходные",
  "hangout.filter.title": "Фильтры",
  "hangout.filter.search": "Поиск",
  "hangout.filter.clear_search": "Очистить",
  "hangout.filter.sort": "Сортировка",
  "hangout.filter.price": "Цена",
  "hangout.filter.radius": "Радиус: {km} км",
  "hangout.filter.geo_denied": "Геолокация отключена",
  "hangout.filter.geo_retry": "Разрешить",
  "hangout.sort.date": "По дате",
  "hangout.sort.popularity": "По популярности",
  "hangout.sort.price": "По цене",
  "hangout.price.all": "Любая",
  "hangout.price.free": "Бесплатно",
  "hangout.price.paid": "Платно",
  "hangout.price.any": "Не важно",
  "hangout.price.max": "до {amount}",
  "hangout.category.cinema": "Кино",
  "hangout.type.date": "Свидание",
  "hangout.type.company": "Компания",
  "hangout.group.today": "Сегодня",
  "hangout.group.tomorrow": "Завтра",
  "hangout.group.unknown": "Дата уточняется",
  "hangout.empty": "Пока нет активных встреч",
  "hangout.empty_desc": "Загляните позже или создайте свою",
  "hangout.empty_reset": "Сбросить фильтры",
  "hangout.empty_goout": "Куда пойти",
  "hangout.empty_banner_title": "Как это работает",
  "hangout.empty_banner_date": "Формат свидания",
  "hangout.empty_banner_company": "Формат компании",
  "hangout.empty_recommend_title": "Популярное в других городах",
  "hangout.empty_recommend_desc": "Рядом пусто",
  "hangout.empty_recommend_placeholder": "Подбираем популярные встречи",
  "hangout.new.title": "Новые встречи",
  "hangout.new.desc": "Обновите ленту",
  "hangout.new.show": "Показать {count}",
  "hangout.my_listings": "Мои объявления",
  "hangout.go_out.title": "Куда пойти вдвоём",
  "hangout.go_out.cashback": "кэшбэк {pct}%",
  "hangout.go_out.map": "На карте",
  "hangout.go_out.book": "Забронировать",
  "hangout.go_out.filter_all": "Все",
  "hangout.go_out.cat_restaurant": "Рестораны",
  "hangout.suggest.upsell_title": "Идеи для пары",
  "hangout.suggest.go_premium": "Стать Premium",
  "hangout.suggest.title": "Идеи для пары",
  "hangout.suggest.open": "Показать идеи",
  "hangout.suggest.close": "Скрыть",
  "hangout.suggest.create": "Создать встречу",
  "hangout.suggest.error": "Не удалось подобрать идеи",
  "hangout.disabled": "Встречи скоро появятся",
  "hangout.disabled_desc": "Функция выключена",
}

const mockUseLanguage = {
  t: (key: string, options?: Record<string, any>) => {
    let value = mockTranslations[key] || key
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

const baseHangout = {
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
}

function renderPage(entry = "/hangouts") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <HangoutsPage />
    </MemoryRouter>,
  )
}

function okOffers() {
  return Promise.resolve({ ok: true, json: () => Promise.resolve({ offers: [] }) })
}

function lastFeedUrl(): string {
  const calls = mockFetch.mock.calls.filter(([u]) => String(u).includes("/api/hangouts?"))
  return String(calls[calls.length - 1]?.[0] || "")
}

function feedUrls(): string[] {
  return mockFetch.mock.calls.map(([u]) => String(u)).filter((u) => u.includes("/api/hangouts?"))
}

const notifications: Array<{ title: string; body?: string }> = []

class MockNotification {
  static permission: NotificationPermission = "granted"
  static requestPermission = vi.fn(() => Promise.resolve("granted" as NotificationPermission))
  constructor(title: string, options?: NotificationOptions) {
    notifications.push({ title, body: options?.body })
  }
}

function setGeo(outcomes: Array<"ok" | "denied">) {
  let i = 0
  const getCurrentPosition = vi.fn((success: PositionCallback, error?: PositionErrorCallback) => {
    const outcome = outcomes[Math.min(i, outcomes.length - 1)]
    i += 1
    if (outcome === "ok") {
      success({ coords: { latitude: 55.75, longitude: 37.62 } } as GeolocationPosition)
    } else if (error) {
      error({ code: 1 } as GeolocationPositionError)
    }
  })
  Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition }, configurable: true })
  return getCurrentPosition
}

describe("HangoutsPage: фильтры, URL и сортировка", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
    mockFlags.hangoutsEnabled = true
    mockIsPremium = true
    notifications.length = 0
    MockNotification.permission = "granted"
    MockNotification.requestPermission = vi.fn(() => Promise.resolve("granted" as NotificationPermission))
    Object.defineProperty(window, "Notification", { value: MockNotification, configurable: true, writable: true })
    Object.defineProperty(navigator, "geolocation", { value: undefined, configurable: true })
    __resetFeedCache()
  })

  it("«завтра» и «выходные» дают диапазон дат в запросе ленты", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (String(url).includes("/api/affiliate/offers")) return okOffers()
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    })
    renderPage()
    await waitFor(() => expect(screen.getByTestId("hangout-date-chips")).toBeTruthy())

    fireEvent.click(screen.getByTestId("hangout-date-tomorrow"))
    await waitFor(() => {
      const u = lastFeedUrl()
      expect(u).toContain("date_from=")
      expect(u).toContain("date_to=")
    })
    const tomorrowFrom = new URL(lastFeedUrl(), "http://localhost").searchParams.get("date_from")
    expect(tomorrowFrom).toBeTruthy()

    fireEvent.click(screen.getByTestId("hangout-date-weekend"))
    await waitFor(() => {
      const u = lastFeedUrl()
      expect(u).toContain("date_from=")
      expect(u).toContain("date_to=")
    })
    const weekendFrom = new Date(new URL(lastFeedUrl(), "http://localhost").searchParams.get("date_from") as string)
    const weekendTo = new Date(new URL(lastFeedUrl(), "http://localhost").searchParams.get("date_to") as string)
    expect(weekendFrom.getDay()).toBe(6)
    expect(weekendTo.getTime() - weekendFrom.getTime()).toBe(48 * 60 * 60 * 1000)
    expect(tomorrowFrom).toBeTruthy()
  })

  it("читает фильтры из URL, включая max_price и сортировку", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (String(url).includes("/api/affiliate/offers")) return okOffers()
      if (String(url).includes("/api/profile/me")) return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    })
    renderPage("/hangouts?q=%D0%BA%D0%B8%D0%BD%D0%BE&category=cinema&date=today&type=date&sort=popularity&price=paid&max_price=1500")

    await waitFor(() => {
      const u = lastFeedUrl()
      expect(u).toContain("q=%D0%BA%D0%B8%D0%BD%D0%BE")
      expect(u).toContain("category=cinema")
      expect(u).toContain("type=date")
      expect(u).toContain("sort=popularity")
      expect(u).toContain("price=paid")
      expect(u).toContain("max_price=1500")
      expect(u).toContain("date_from=")
    })
    expect((screen.getByTestId("hangout-search") as HTMLInputElement).value).toBe("кино")
    expect(screen.getByTestId("hangout-price-paid").getAttribute("aria-pressed")).toBe("true")
  })

  it("сортирует ленту по популярности и по цене на клиенте", async () => {
    const items = [
      { ...baseHangout, id: 1, like_count: 0, participant_count: 1, accepted_count: 0, price: 300 },
      { ...baseHangout, id: 2, like_count: 10, participant_count: 5, accepted_count: 0, price: 500 },
      { ...baseHangout, id: 3, like_count: 2, participant_count: 2, accepted_count: 0, price: 100 },
    ]
    mockFetch.mockImplementation((url: string) => {
      const u = String(url)
      if (u.includes("/api/affiliate/offers")) return okOffers()
      if (u.includes("sort=popularity") && !u.includes("page=")) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve(items) })
    })
    const { container } = renderPage()
    await waitFor(() => expect(screen.getByTestId("hangout-card-1")).toBeTruthy())

    const order = () =>
      Array.from(container.querySelectorAll('[data-testid^="hangout-card-"]')).map((el) => el.getAttribute("data-testid"))

    fireEvent.change(screen.getByTestId("hangout-sort-select"), { target: { value: "popularity" } })
    await waitFor(() => expect(order()).toEqual(["hangout-card-2", "hangout-card-3", "hangout-card-1"]))

    fireEvent.change(screen.getByTestId("hangout-sort-select"), { target: { value: "price" } })
    await waitFor(() => expect(order()).toEqual(["hangout-card-3", "hangout-card-1", "hangout-card-2"]))
  })

  it("пустое состояние: кнопка сброса очищает все фильтры", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (String(url).includes("/api/affiliate/offers")) return okOffers()
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    })
    renderPage("/hangouts?q=%D0%BA%D0%BE%D1%84%D0%B5&category=cinema&type=company&date=today&sort=popularity&price=free")

    await waitFor(() => expect(screen.getByTestId("hangouts-empty-reset")).toBeTruthy())
    fireEvent.click(screen.getByTestId("hangouts-empty-reset"))

    await waitFor(() => {
      const u = lastFeedUrl()
      expect(u).not.toContain("category=cinema")
      expect(u).not.toContain("price=free")
      expect(u).not.toContain("sort=popularity")
      expect(u).not.toContain("date_from=")
      expect(u).not.toContain("q=")
      expect(u).toContain("page=1")
    })
    expect((screen.getByTestId("hangout-search") as HTMLInputElement).value).toBe("")
    expect(screen.getByTestId("hangout-category-all").getAttribute("aria-pressed")).toBe("true")
  })

  it("поиск с дебаунсом уходит в запрос и сбрасывает страницу", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (String(url).includes("/api/affiliate/offers")) return okOffers()
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    })
    renderPage()
    await waitFor(() => expect(screen.getByTestId("hangout-search")).toBeTruthy())

    fireEvent.change(screen.getByTestId("hangout-search"), { target: { value: "кофе" } })
    await waitFor(
      () => {
        expect(lastFeedUrl()).toContain("q=%D0%BA%D0%BE%D1%84%D0%B5")
        expect(lastFeedUrl()).toContain("page=1")
      },
      { timeout: 3000 },
    )
  })
})

describe("HangoutsPage: геолокация и real-time", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
    mockFlags.hangoutsEnabled = true
    mockIsPremium = true
    notifications.length = 0
    MockNotification.permission = "granted"
    MockNotification.requestPermission = vi.fn(() => Promise.resolve("granted" as NotificationPermission))
    Object.defineProperty(window, "Notification", { value: MockNotification, configurable: true, writable: true })
    Object.defineProperty(navigator, "geolocation", { value: undefined, configurable: true })
    __resetFeedCache()
  })

  it("при разрешённой геолокации координаты и радиус уходят в запрос", async () => {
    setGeo(["ok"])
    mockFetch.mockImplementation((url: string) => {
      if (String(url).includes("/api/affiliate/offers")) return okOffers()
      return Promise.resolve({ ok: true, json: () => Promise.resolve([baseHangout]) })
    })
    renderPage()

    await waitFor(() => {
      const u = lastFeedUrl()
      expect(u).toContain("lat=55.75")
      expect(u).toContain("lng=37.62")
      expect(u).toContain("radius=10")
    })
    expect(screen.queryByTestId("hangout-geo-retry")).toBeNull()
  })

  it("при отказе показывает подсказку и повторный запрос разрешения", async () => {
    const getCurrentPosition = setGeo(["denied", "ok"])
    mockFetch.mockImplementation((url: string) => {
      if (String(url).includes("/api/affiliate/offers")) return okOffers()
      return Promise.resolve({ ok: true, json: () => Promise.resolve([baseHangout]) })
    })
    renderPage()

    await waitFor(() => expect(screen.getByTestId("hangout-geo-retry")).toBeTruthy())
    expect(screen.getByText("Геолокация отключена")).toBeTruthy()
    expect(getCurrentPosition).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId("hangout-geo-retry"))
    await waitFor(() => {
      expect(getCurrentPosition).toHaveBeenCalledTimes(2)
      expect(lastFeedUrl()).toContain("lat=55.75")
    })
    expect(screen.queryByTestId("hangout-geo-retry")).toBeNull()
  })

  it("встреча за радиусом не попадает в счётчик, а в радиусе — попадает", async () => {
    setGeo(["ok"])
    mockFetch.mockImplementation((url: string) => {
      if (String(url).includes("/api/affiliate/offers")) return okOffers()
      return Promise.resolve({ ok: true, json: () => Promise.resolve([baseHangout]) })
    })
    renderPage()
    await waitFor(() => expect(lastFeedUrl()).toContain("lat=55.75"))

    await act(async () => {
      mockWs.handlers["hangout:new"]?.({ hangoutId: 501, title: "Питер", lat: 59.93, lng: 30.31 })
    })
    expect(screen.queryByTestId("hangouts-new-badge")).toBeNull()

    await act(async () => {
      mockWs.handlers["hangout:new"]?.({ hangoutId: 502, title: "Рядом", lat: 55.76, lng: 37.63 })
    })
    await waitFor(() => expect(screen.getByTestId("hangouts-new-badge")).toBeTruthy())
    expect(notifications.map((n) => n.title)).toContain("Новые встречи")
  })

  it("при разрешении default запрашивает доступ и показывает уведомление", async () => {
    MockNotification.permission = "default"
    mockFetch.mockImplementation((url: string) => {
      if (String(url).includes("/api/affiliate/offers")) return okOffers()
      return Promise.resolve({ ok: true, json: () => Promise.resolve([baseHangout]) })
    })
    renderPage()
    await waitFor(() => expect(screen.getByTestId("hangout-card-1")).toBeTruthy())

    await act(async () => {
      mockWs.handlers["hangout:new"]?.({ hangoutId: 601, title: "Кофе" })
    })
    await waitFor(() => expect(MockNotification.requestPermission).toHaveBeenCalled())
    await waitFor(() => expect(notifications.some((n) => n.body === "Кофе")).toBe(true))
  })

  it("при запрещённых уведомлениях не создаёт системное уведомление", async () => {
    MockNotification.permission = "denied"
    mockFetch.mockImplementation((url: string) => {
      if (String(url).includes("/api/affiliate/offers")) return okOffers()
      return Promise.resolve({ ok: true, json: () => Promise.resolve([baseHangout]) })
    })
    renderPage()
    await waitFor(() => expect(screen.getByTestId("hangout-card-1")).toBeTruthy())

    await act(async () => {
      mockWs.handlers["hangout:new"]?.({ hangoutId: 602, title: "Кино" })
    })
    await waitFor(() => expect(screen.getByTestId("hangouts-new-badge")).toBeTruthy())
    expect(notifications).toHaveLength(0)
    expect(MockNotification.requestPermission).not.toHaveBeenCalled()
  })
})

describe("HangoutsPage: pull-to-refresh и AI-подбор", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
    mockFlags.hangoutsEnabled = true
    mockIsPremium = true
    notifications.length = 0
    Object.defineProperty(navigator, "geolocation", { value: undefined, configurable: true })
    __resetFeedCache()
  })

  it("короткое движение вниз не обновляет ленту", async () => {
    let feedCalls = 0
    mockFetch.mockImplementation((url: string) => {
      const u = String(url)
      if (u.includes("/api/affiliate/offers")) return okOffers()
      feedCalls += 1
      return Promise.resolve({ ok: true, json: () => Promise.resolve([baseHangout]) })
    })
    renderPage()
    await waitFor(() => expect(screen.getByTestId("hangout-card-1")).toBeTruthy())
    const before = feedCalls

    const root = screen.getByTestId("hangout-ptr").closest(".min-h-screen") as HTMLElement
    fireEvent.touchMove(root, { touches: [{ clientY: 120 }] })
    fireEvent.touchStart(root, { touches: [{ clientY: 100 }] })
    fireEvent.touchMove(root, { touches: [{ clientY: 110 }] })
    expect(screen.getByTestId("hangout-ptr").className).toContain("ptr-visible")
    fireEvent.touchEnd(root)

    expect(screen.getByTestId("hangout-ptr").className).not.toContain("ptr-visible")
    expect(feedCalls).toBe(before)
  })

  it("ошибка 500 от AI-подбора показывает сообщение", async () => {
    mockFetch.mockImplementation((url: string) => {
      const u = String(url)
      if (u.includes("/api/affiliate/offers")) return okOffers()
      if (u.includes("/api/hangouts/suggest")) return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    })
    renderPage()
    await waitFor(() => expect(screen.getByTestId("hangout-suggest-open")).toBeTruthy())

    fireEvent.click(screen.getByTestId("hangout-suggest-open"))
    await waitFor(() => expect(screen.getByTestId("hangout-suggest-error")).toBeTruthy())
  })

  it("сетевой сбой AI-подбора показывает сообщение", async () => {
    mockFetch.mockImplementation((url: string) => {
      const u = String(url)
      if (u.includes("/api/affiliate/offers")) return okOffers()
      if (u.includes("/api/hangouts/suggest")) return Promise.reject(new Error("network"))
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    })
    renderPage()
    await waitFor(() => expect(screen.getByTestId("hangout-suggest-open")).toBeTruthy())

    fireEvent.click(screen.getByTestId("hangout-suggest-open"))
    await waitFor(() => expect(screen.getByTestId("hangout-suggest-error")).toBeTruthy())
  })

  it("переключение языка идей очищает показанный список", async () => {
    const ideas = [
      { title: "Кофе и настольные игры", category: "cafe", place: "Кофейня", description: "Тихо" },
      { title: "Вечер в кино", category: "cinema", place: "Кинотеатр", description: "Премьера" },
    ]
    mockFetch.mockImplementation((url: string) => {
      const u = String(url)
      if (u.includes("/api/affiliate/offers")) return okOffers()
      if (u.includes("/api/hangouts/suggest")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ suggestions: ideas }) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    })
    renderPage()
    await waitFor(() => expect(screen.getByTestId("hangout-suggest-open")).toBeTruthy())

    fireEvent.click(screen.getByTestId("hangout-suggest-open"))
    await waitFor(() => expect(screen.getByTestId("hangout-suggest-idea-0")).toBeTruthy())

    fireEvent.click(screen.getByTestId("hangout-suggest-lang-en"))
    await waitFor(() => expect(screen.queryByTestId("hangout-suggest-idea-0")).toBeNull())
    expect(screen.getByTestId("hangout-suggest-lang-en").getAttribute("aria-pressed")).toBe("true")
  })

  it("пока рекомендации грузятся, показывает заглушку", async () => {
    let resolveRecs: (v: any) => void = () => {}
    const recsPromise = new Promise<any>((res) => { resolveRecs = res })
    mockFetch.mockImplementation((url: string) => {
      const u = String(url)
      if (u.includes("/api/affiliate/offers")) return okOffers()
      if (u.includes("sort=popularity")) return recsPromise
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    })
    renderPage()

    await waitFor(() => expect(screen.getByTestId("hangout-recs-loading")).toBeTruthy())
    await act(async () => {
      resolveRecs({ ok: true, json: () => Promise.resolve([]) })
    })
    await waitFor(() => expect(screen.queryByTestId("hangout-recs-loading")).toBeNull())
  })

  it("бронирование оффера открывается с клавиатуры (Enter и пробел)", async () => {
    const offers = [
      { id: 28, category: "restaurant", title: "Ресторан", deeplink: "https://go/x", price: 2500, city: "Москва", commission_rate: 12 },
    ]
    mockFetch.mockImplementation((url: string) => {
      const u = String(url)
      if (u.includes("/api/affiliate/offers")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ offers }) })
      if (u.includes("/api/profile/me")) return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    })
    renderPage()
    await waitFor(() => expect(screen.getByTestId("hangout-go-out")).toBeTruthy())

    fireEvent.keyDown(screen.getByTestId("hangout-go-out-book-28"), { key: "a" })
    expect(screen.queryByTestId("goout-booking-date")).toBeNull()

    fireEvent.keyDown(screen.getByTestId("hangout-go-out-book-28"), { key: " " })
    await waitFor(() => expect(screen.getByTestId("goout-booking-date")).toBeTruthy())
    fireEvent.keyDown(screen.getByTestId("hangout-go-out-book-28"), { key: "Enter" })
    await waitFor(() => expect(screen.getByTestId("goout-booking-date")).toBeTruthy())
  })
})
