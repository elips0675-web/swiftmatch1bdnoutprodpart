import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react"
import React from "react"
import { MemoryRouter, useLocation } from "react-router-dom"
import { __resetFeedCache } from "@/pages/hangouts"
import { formatEventDate } from "@/lib/hangouts"

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

vi.mock("@/lib/token", () => ({ getToken: () => "test-token" }))

const lang = vi.hoisted(() => ({
  t: (key: string) => key,
  language: "RU",
  setLanguage: () => {},
}))

vi.mock("@/context/language-context", () => ({ useLanguage: () => lang }))

const flags = vi.hoisted(() => ({ hangoutsEnabled: true }))
vi.mock("@/context/feature-flags-context", () => ({ useFeatureFlags: () => flags }))

const premium = vi.hoisted(() => ({ isPremium: true }))
vi.mock("@/hooks/use-premium", () => ({ usePremium: () => premium }))

vi.mock("@/hooks/use-websocket", () => ({ useWebSocket: () => ({ socket: null, connected: false }) }))

const toastMock = vi.hoisted(() => vi.fn())
vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }))

const captureMessageMock = vi.hoisted(() => vi.fn())
const captureTimingMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/sentry", () => ({ captureMessage: captureMessageMock, captureTiming: captureTimingMock }))

vi.mock("@/components/layout/app-header", () => ({ AppHeader: () => <div data-testid="app-header" /> }))
vi.mock("@/components/navigation/bottom-nav", () => ({ BottomNav: () => <div data-testid="bottom-nav" /> }))

type Card = Record<string, unknown>

const DAY = 86_400_000

function daysFromNow(days: number): string {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, 19, 30).toISOString()
}

const baseCard: Card = {
  id: 1,
  author_id: 10,
  category: "cinema",
  title: "Иду на Дюну",
  description: null,
  place_name: "Аврора",
  place_address: null,
  city: "Москва",
  event_date: new Date(Date.now() + DAY).toISOString(),
  max_companions: 2,
  status: "active",
  display_name: "Максим",
  avatar_url: null,
  accepted_count: 1,
  lat: "55.751244",
  lng: "37.618423",
}

function jsonResponse(data: unknown, status = 200): Promise<Response> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  } as Response)
}

function mockFeed(items: Card[], total = items.length) {
  mockFetch.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes("/api/affiliate/offers")) return jsonResponse({ offers: [] })
    if (url.includes("/api/hangouts/suggest")) return jsonResponse({ suggestions: [] })
    if (url.includes("/api/hangouts")) return jsonResponse({ items, total })
    return jsonResponse({})
  })
}

function mockFeedWithAction(item: Card, status: number, body: unknown = {}) {
  mockFetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === "POST") return jsonResponse(body, status)
    if (url.includes("/api/affiliate/offers")) return jsonResponse({ offers: [] })
    if (url.includes("/api/hangouts")) return jsonResponse({ items: [item], total: 1 })
    return jsonResponse({})
  })
}

function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="location-probe">{loc.pathname}</div>
}

async function renderFeed(items: Card[]) {
  mockFeed(items)
  const Page = (await import("@/pages/hangouts")).default
  const utils = render(
    <MemoryRouter initialEntries={["/"]}>
      <Page />
      <LocationProbe />
    </MemoryRouter>,
  )
  await waitFor(() => expect(screen.getByTestId(`hangout-card-${String(items[0].id)}`)).toBeTruthy())
  return utils
}

async function renderCard(item: Card) {
  const merged = { ...baseCard, ...item }
  return renderFeed([merged])
}

function actionCalls(): string[] {
  return mockFetch.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === "POST")
    .map(([url]) => String(url))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFetch.mockReset()
  toastMock.mockReset()
  captureMessageMock.mockReset()
  flags.hangoutsEnabled = true
  premium.isPremium = true
  __resetFeedCache()
  Object.defineProperty(window, "location", {
    value: { origin: "http://localhost:3000", href: "" },
    writable: true,
    configurable: true,
  })
  ;(navigator as unknown as { geolocation?: unknown }).geolocation = undefined
})

describe("hangouts feed: группировка и даты", () => {
  it("неизвестная дата не роняет ленту и попадает в группу «дата уточняется»", async () => {
    const bad = { ...baseCard, id: 4, event_date: "not-a-date" }
    const good = { ...baseCard, id: 5, event_date: daysFromNow(0) }
    await renderFeed([bad, good])

    expect(screen.getByTestId("hangout-card-4")).toBeTruthy()
    expect(screen.getByText("hangout.group.unknown")).toBeTruthy()
    expect(screen.getByTestId("hangout-card-5")).toBeTruthy()
  })

  it("раскладывает ленту по группам: сегодня, завтра и конкретные даты", async () => {
    const items = [
      { ...baseCard, id: 1, event_date: daysFromNow(1) },
      { ...baseCard, id: 2, event_date: daysFromNow(0) },
      { ...baseCard, id: 3, event_date: daysFromNow(5) },
      { ...baseCard, id: 4, event_date: daysFromNow(10) },
    ]
    await renderFeed(items)

    expect(screen.getAllByRole("listitem")).toHaveLength(4)
    const headings = Array.from(document.querySelectorAll('section[role="listitem"] h3')).map((h) => h.textContent)
    expect(headings[0]).toBe("hangout.group.today")
    expect(headings[1]).toBe("hangout.group.tomorrow")
    expect(headings.slice(2)).toHaveLength(2)
    expect(headings.slice(2)).not.toContain("hangout.group.today")
  })

  it("в карточке дата показывается как «сегодня», «завтра» или конкретный день", async () => {
    const today = { ...baseCard, id: 1, event_date: daysFromNow(0) }
    const tomorrow = { ...baseCard, id: 2, event_date: daysFromNow(1) }
    const later = { ...baseCard, id: 3, event_date: daysFromNow(5) }
    await renderFeed([today, tomorrow, later])

    expect(screen.getByTestId("hangout-card-1").textContent).toContain("hangout.filter.today")
    expect(screen.getByTestId("hangout-card-2").textContent).toContain("hangout.filter.tomorrow")
    const laterCard = screen.getByTestId("hangout-card-3")
    expect(laterCard.textContent).not.toContain("hangout.filter.today")
    expect(laterCard.textContent).not.toContain("hangout.filter.tomorrow")
    expect(laterCard.textContent).toContain(formatEventDate(String(later.event_date)))
  })

  it("невалидная дата в карточке показывается как есть", async () => {
    const bad = { ...baseCard, id: 6, event_date: "5 мая, вечер" }
    await renderCard(bad)

    expect(screen.getByTestId("hangout-card-6").textContent).toContain("5 мая, вечер")
  })
})

describe("hangouts feed: содержимое карточки", () => {
  it("показывает возраст, онлайн-точку, описание, цену и заполненность мест", async () => {
    await renderCard({ age: 27, online: true, description: "Встречаемся у входа", price: 1500, capacity: 10, sold_tickets: 4 })

    expect(screen.getByText(/· 27/)).toBeTruthy()
    expect(screen.getByTitle("chats.online")).toBeTruthy()
    expect(screen.getByText("Встречаемся у входа")).toBeTruthy()
    expect(screen.getByText("hangout.ticket.price")).toBeTruthy()
    expect(screen.getByText("4/10")).toBeTruthy()
  })

  it("склеивает адрес из названия и города, а без названия показывает только город", async () => {
    await renderCard({})
    expect(screen.getByTestId("hangout-card-1").textContent).toContain("Аврора, Москва")

    vi.clearAllMocks()
    __resetFeedCache()
    await renderCard({ id: 2, place_name: null, city: "Казань" })
    expect(screen.getByTestId("hangout-card-2").textContent).toContain("Казань")
  })

  it("скрывает строку места, если нет ни названия, ни города", async () => {
    const { container } = await renderCard({ place_name: null, city: null })
    expect(container.textContent).not.toContain("Аврора")
  })

  it("для встречи-свидания считает лайки и показывает расстояние", async () => {
    await renderCard({ hangout_type: "date", like_count: 5, distance_km: 2.4 })
    expect(screen.getByText("hangout.label.likes_count")).toBeTruthy()
    expect(screen.getByText("· hangout.label.distance")).toBeTruthy()
  })

  it("показывает рейтинг и остаток мест, включая распроданное событие", async () => {
    await renderCard({ id: 1, rating: 4.6, capacity: 5, sold_tickets: 3 })
    expect(screen.getByTestId("hangout-rating-1").textContent).toBe("4.6")
    expect(screen.getByTestId("hangout-remaining-1").textContent).toBe("hangout.label.remaining")

    vi.clearAllMocks()
    __resetFeedCache()
    await renderCard({ id: 2, capacity: 5, sold_tickets: 5 })
    expect(screen.getByTestId("hangout-remaining-2").textContent).toBe("hangout.label.sold_out")
    const reply = screen.getByTestId("hangout-join-2")
    expect(reply).toBeDisabled()
    expect(reply.textContent).toContain("hangout.action.attend_full")
  })

  it("рисует аватары участников и инициалы, когда аватара нет", async () => {
    const { container } = await renderCard({
      attendees: [
        { user_id: 1, avatar_url: "http://example.com/a.jpg", display_name: "Аня" },
        { user_id: 2, avatar_url: null, display_name: "Борис" },
        { user_id: 3, avatar_url: null, display_name: null },
      ],
    })

    const block = screen.getByTestId("hangout-attendees-1")
    expect(block.querySelectorAll("img")).toHaveLength(1)
    expect(container.textContent).toContain("Б")
    expect(container.textContent).toContain("?")
  })

  it("показывает бейджи «продвинуто» и «реклама»", async () => {
    await renderCard({ boosted: 1, offer_pinned: 1 })
    expect(screen.getByTestId("hangout-boosted-1")).toBeTruthy()
    expect(screen.getByTestId("hangout-sponsored-1")).toBeTruthy()
  })

  it("показывает аватар автора картинкой, если он есть", async () => {
    const { container } = await renderCard({ avatar_url: "http://example.com/me.jpg" })
    const author = screen.getByTestId("hangout-author-10")
    expect(author.querySelector("img")).toBeTruthy()
    expect(container).toBeTruthy()
  })
})

describe("hangouts feed: переходы и карта", () => {
  it("клик по автору уводит в его профиль", async () => {
    await renderCard({ author_id: 42 })
    fireEvent.click(screen.getByTestId("hangout-author-42"))
    await waitFor(() => expect(screen.getByTestId("location-probe").textContent).toBe("/profile/42"))
  })

  it("без author_id клик по автору никуда не уводит", async () => {
    await renderCard({ author_id: null })
    fireEvent.click(screen.getByTestId("hangout-author-null"))
    expect(screen.getByTestId("location-probe").textContent).toBe("/")
  })

  it("маршрут и карта открываются с координатами", async () => {
    const openMock = vi.spyOn(window, "open").mockImplementation(() => null)
    await renderCard({})

    fireEvent.click(screen.getByTestId("hangout-route-1"))
    expect(openMock).toHaveBeenCalledWith(
      "https://www.google.com/maps/dir/?api=1&destination=55.751244,37.618423",
      "_blank",
      "noopener",
    )

    fireEvent.click(screen.getByTestId("hangout-map-1"))
    const frame = await screen.findByTitle("Аврора, Москва")
    expect(frame.getAttribute("src")).toContain("marker=55.751244%2C37.618423")

    fireEvent.click(screen.getByTestId("hangout-route-modal-1"))
    expect(openMock).toHaveBeenLastCalledWith(
      "https://www.google.com/maps/dir/?api=1&destination=55.751244,37.618423",
      "_blank",
      "noopener",
    )
    openMock.mockRestore()
  })

  it("без координат маршрут строится по адресу", async () => {
    const openMock = vi.spyOn(window, "open").mockImplementation(() => null)
    await renderCard({ lat: null, lng: null })

    fireEvent.click(screen.getByTestId("hangout-route-1"))
    expect(openMock.mock.calls[0][0]).toBe(
      `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent("Аврора, Москва")}`,
    )
    openMock.mockRestore()
  })

  it("без координат и адреса кнопки карты не рисуются", async () => {
    await renderCard({ lat: null, lng: null, place_name: null, city: null })
    expect(screen.queryByTestId("hangout-route-1")).toBeNull()
    expect(screen.queryByTestId("hangout-map-1")).toBeNull()
  })
})

describe("hangouts feed: действия", () => {
  it("отклик на свидание показывает тост об успехе", async () => {
    const item = { ...baseCard, hangout_type: "date", is_author: false }
    mockFeedWithAction(item, 200)
    const Page = (await import("@/pages/hangouts")).default
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Page />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByTestId("hangout-respond-1")).toBeTruthy())

    fireEvent.click(screen.getByTestId("hangout-respond-1"))
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith({ title: "hangout.action.responded" }))
    expect(actionCalls()).toEqual(["/api/hangouts/1/respond"])
  })

  it("присоединение к компании показывает тост об успехе", async () => {
    const item = { ...baseCard, hangout_type: "company", is_author: false, participant_count: 1 }
    mockFeedWithAction(item, 201)
    const Page = (await import("@/pages/hangouts")).default
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Page />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByTestId("hangout-join-1")).toBeTruthy())

    fireEvent.click(screen.getByTestId("hangout-join-1"))
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith({ title: "hangout.action.joined" }))
  })

  it("лайк показывает тост и подкрашивает кнопку", async () => {
    mockFeedWithAction({ ...baseCard, my_like_status: null, like_count: 2 }, 200)
    const Page = (await import("@/pages/hangouts")).default
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Page />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByTestId("hangout-quicklike-1")).toBeTruthy())

    fireEvent.click(screen.getByTestId("hangout-quicklike-1"))
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith({ title: "hangout.action.liked" }))
    await waitFor(() => expect(screen.getByTestId("hangout-quicklike-1").className).toContain("bg-pink-100"))
  })

  it("повторный клик во время запроса не отправляет второе действие", async () => {
    let resolvePost: (value: Response) => void = () => {}
    const pending = new Promise<Response>((resolve) => { resolvePost = resolve })
    mockFetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === "POST") return pending
      if (url.includes("/api/affiliate/offers")) return jsonResponse({ offers: [] })
      return jsonResponse({ items: [{ ...baseCard, hangout_type: "company", is_author: false }], total: 1 })
    })
    const Page = (await import("@/pages/hangouts")).default
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Page />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByTestId("hangout-join-1")).toBeTruthy())

    fireEvent.click(screen.getByTestId("hangout-join-1"))
    await waitFor(() => expect(actionCalls()).toHaveLength(1))
    fireEvent.click(screen.getByTestId("hangout-quicklike-1"))
    expect(actionCalls()).toHaveLength(1)

    await act(async () => { resolvePost({ ok: true, status: 200, json: () => Promise.resolve({}) } as Response) })
  })

  it.each([
    [409, "hangout.action.already"],
    [402, "hangout.action.payment_required"],
    [401, "hangout.action.auth_required"],
    [500, "hangout.action.error"],
  ])("ошибка %s показывает свой тост", async (status, key) => {
    mockFeedWithAction({ ...baseCard, hangout_type: "company", is_author: false }, status)
    const Page = (await import("@/pages/hangouts")).default
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Page />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByTestId("hangout-join-1")).toBeTruthy())

    fireEvent.click(screen.getByTestId("hangout-join-1"))
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith({ title: key, variant: "destructive" }))
  })

  it("сетевой сбой действия откатывает кнопку и показывает общий тост", async () => {
    mockFetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === "POST") return Promise.reject(new Error("offline"))
      if (url.includes("/api/affiliate/offers")) return jsonResponse({ offers: [] })
      return jsonResponse({ items: [{ ...baseCard, hangout_type: "company", is_author: false }], total: 1 })
    })
    const Page = (await import("@/pages/hangouts")).default
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Page />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByTestId("hangout-join-1")).toBeTruthy())

    fireEvent.click(screen.getByTestId("hangout-join-1"))
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith({ title: "hangout.action.error", variant: "destructive" }))
    expect(screen.getByTestId("hangout-join-1")).toBeTruthy()
  })

  it("своя встреча не показывает кнопку отклика", async () => {
    await renderCard({ is_author: true })
    expect(screen.queryByTestId("hangout-respond-1")).toBeNull()
    expect(screen.queryByTestId("hangout-join-1")).toBeNull()
  })
})

describe("hangouts feed: шеринг и билет партнёра", () => {
  it("использует нативный share, если он есть", async () => {
    const shareMock = vi.fn((_data: { title: string; url: string }) => Promise.resolve())
    Object.defineProperty(navigator, "share", { value: shareMock, configurable: true })
    await renderCard({})

    fireEvent.click(screen.getByTestId("hangout-share-1"))
    await waitFor(() => expect(shareMock).toHaveBeenCalled())
    expect(shareMock.mock.calls[0][0]).toEqual({
      title: "Иду на Дюну",
      url: "http://localhost:3000/hangouts/1",
    })
    expect(toastMock).not.toHaveBeenCalled()
  })

  it("без нативного share копирует ссылку и сообщает об этом", async () => {
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true })
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
    await renderCard({})

    fireEvent.click(screen.getByTestId("hangout-share-1"))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("http://localhost:3000/hangouts/1"))
    expect(toastMock).toHaveBeenCalledWith({ title: "hangout.action.link_copied" })
  })

  it("отмена нативного share не показывает ошибку", async () => {
    const shareMock = vi.fn(() => Promise.reject(new Error("cancelled")))
    Object.defineProperty(navigator, "share", { value: shareMock, configurable: true })
    await renderCard({})

    fireEvent.click(screen.getByTestId("hangout-share-1"))
    await waitFor(() => expect(shareMock).toHaveBeenCalled())
    expect(toastMock).not.toHaveBeenCalled()
  })

  it("покупка билета партнёра уводит на оплату", async () => {
    mockFetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === "POST" && url === "/api/partners/order") return jsonResponse({ url: "https://pay.example.com/1" })
      if (url.includes("/api/affiliate/offers")) return jsonResponse({ offers: [] })
      return jsonResponse({ items: [{ ...baseCard, offer_id: 7, offer_price: "1200" }], total: 1 })
    })
    const Page = (await import("@/pages/hangouts")).default
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Page />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByTestId("hangout-offer-buy-1")).toBeTruthy())

    fireEvent.click(screen.getByTestId("hangout-offer-buy-1"))
    await waitFor(() => expect(window.location.href).toBe("https://pay.example.com/1"))
    expect(JSON.parse(String((mockFetch.mock.calls.find(([u]) => String(u) === "/api/partners/order")?.[1] as RequestInit).body))).toEqual({ offer_id: 7 })
  })

  it("ответ без url не уводит на оплату и логируется", async () => {
    mockFetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === "POST" && url === "/api/partners/order") return jsonResponse({})
      if (url.includes("/api/affiliate/offers")) return jsonResponse({ offers: [] })
      return jsonResponse({ items: [{ ...baseCard, offer_id: 7, offer_price: "1200" }], total: 1 })
    })
    const Page = (await import("@/pages/hangouts")).default
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Page />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByTestId("hangout-offer-buy-1")).toBeTruthy())

    fireEvent.click(screen.getByTestId("hangout-offer-buy-1"))
    await waitFor(() => expect(captureMessageMock).toHaveBeenCalledWith(
      "hangout.ticket_purchase_failed",
      "error",
      { offer_id: 7, hangout_id: 1, status: 200 },
    ))
    expect(window.location.href).toBe("")
    expect(screen.getByTestId("hangout-offer-buy-1")).toBeEnabled()
  })

  it("сетевой сбой покупки билета логируется отдельным событием", async () => {
    mockFetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === "POST" && url === "/api/partners/order") return Promise.reject(new Error("offline"))
      if (url.includes("/api/affiliate/offers")) return jsonResponse({ offers: [] })
      return jsonResponse({ items: [{ ...baseCard, offer_id: 7, offer_price: "1200" }], total: 1 })
    })
    const Page = (await import("@/pages/hangouts")).default
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Page />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByTestId("hangout-offer-buy-1")).toBeTruthy())

    fireEvent.click(screen.getByTestId("hangout-offer-buy-1"))
    await waitFor(() => expect(captureMessageMock).toHaveBeenCalledWith(
      "hangout.ticket_purchase_error",
      "error",
      { offer_id: 7, hangout_id: 1 },
    ))
  })

  it("во время покупки кнопка заблокирована и показывает состояние", async () => {
    let resolveOrder: (value: Response) => void = () => {}
    const pending = new Promise<Response>((resolve) => { resolveOrder = resolve })
    mockFetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === "POST" && url === "/api/partners/order") return pending
      if (url.includes("/api/affiliate/offers")) return jsonResponse({ offers: [] })
      return jsonResponse({ items: [{ ...baseCard, offer_id: 7, offer_price: "1200" }], total: 1 })
    })
    const Page = (await import("@/pages/hangouts")).default
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Page />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByTestId("hangout-offer-buy-1")).toBeTruthy())

    fireEvent.click(screen.getByTestId("hangout-offer-buy-1"))
    const button = await screen.findByTestId("hangout-offer-buy-1")
    expect(button).toBeDisabled()
    expect(button.textContent).toBe("hangout.offer.buying")

    await act(async () => { resolveOrder({ ok: true, status: 200, json: () => Promise.resolve({}) } as Response) })
  })

  it("оффер без цены показывает заголовок и embed без картинки", async () => {
    const item = { ...baseCard, offer_id: 7, offer_title: "Концерт", offer_deeplink: "https://partner.example.com/c" }
    await renderCard(item)

    expect(screen.getAllByText("Концерт")).toHaveLength(2)
    const embed = screen.getByTestId("hangout-offer-embed-1")
    expect(embed.getAttribute("href")).toBe("https://partner.example.com/c")
    expect(embed.textContent).toContain("Концерт")
    expect(embed.querySelector("img")).toBeNull()
  })
})
