import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, fireEvent, act, within } from "@testing-library/react"
import React from "react"

const { getTokenMock } = vi.hoisted(() => ({ getTokenMock: vi.fn() }))

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

vi.mock("@/lib/token", () => ({
  getToken: getTokenMock,
}))

const mockUseLanguage = {
  t: (key: string) => key,
  language: "RU",
  setLanguage: vi.fn(),
}

vi.mock("@/context/language-context", () => ({
  useLanguage: () => mockUseLanguage,
}))

const sampleOffers = [
  { id: 1, partner_name: "Yandex Go", category: "taxi", title: "Такси", description: "d" },
  { id: 2, partner_name: "Afisha", category: "cinema", title: "Кино", description: null },
]

const jsonResponse = (data: unknown) => ({ ok: true, json: () => Promise.resolve(data) })

const openMock = vi.fn()

import { ChatPartnerActions } from "@/components/chat/chat-partner-actions"

type GeoSuccess = (position: GeolocationPosition) => void
type GeoError = (error: GeolocationPositionError) => void

function stubGeolocation(impl: (success: GeoSuccess, error: GeoError) => void) {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition: impl },
  })
}

function trackCall() {
  return mockFetch.mock.calls.find(([url]) => String(url).includes("/api/partners/track"))
}

function trackBody() {
  return JSON.parse(String((trackCall()?.[1] as RequestInit).body))
}

describe("ChatPartnerActions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
    getTokenMock.mockReset()
    getTokenMock.mockReturnValue("test-token")
    openMock.mockReset()
    openMock.mockReturnValue({})
    vi.stubGlobal("open", openMock)
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { href: "" },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    delete (navigator as unknown as { geolocation?: Geolocation }).geolocation
    delete (navigator as unknown as { clipboard?: Clipboard }).clipboard
    delete (document as unknown as { hidden?: boolean }).hidden
  })

  it("renders chips for placement offers", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(sampleOffers))

    render(<ChatPartnerActions placement="chat" />)

    await waitFor(() => {
      expect(screen.getByTestId("partner-action-taxi")).toBeTruthy()
      expect(screen.getByTestId("partner-action-cinema")).toBeTruthy()
    })
    expect(String(mockFetch.mock.calls[0][0])).toContain("placement=chat")
  })

  it("показывает три скелетона, пока офферы грузятся", async () => {
    let resolveOffers!: (value: unknown) => void
    mockFetch.mockReturnValueOnce(new Promise((resolve) => { resolveOffers = resolve }))

    const { container } = render(<ChatPartnerActions />)

    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(3)

    await act(async () => {
      resolveOffers(jsonResponse(sampleOffers))
      await Promise.resolve()
    })

    await waitFor(() => expect(screen.getByTestId("partner-action-taxi")).toBeTruthy())
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(0)
  })

  it("tracks click and opens http deeplink", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse([sampleOffers[0]]))
      .mockResolvedValueOnce(jsonResponse({ deeplink: "https://x.ru/?utm_source=swiftmatch&ref=ABC" }))

    render(<ChatPartnerActions />)
    await waitFor(() => expect(screen.getByTestId("partner-action-taxi")).toBeTruthy())

    fireEvent.click(screen.getByTestId("partner-action-taxi"))

    await waitFor(() => {
      expect(trackCall()).toBeTruthy()
      expect(trackBody()).toEqual({ offer_id: 1 })
      expect(openMock).toHaveBeenCalledWith(
        "https://x.ru/?utm_source=swiftmatch&ref=ABC",
        "_blank",
        "noopener",
      )
    })
    expect(screen.queryByTestId("partner-fallback-dialog")).toBeNull()
  })

  it("renders nothing when no offers", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([]))

    const { container } = render(<ChatPartnerActions />)

    await waitFor(() => {
      expect(screen.queryByTestId("partner-actions")).toBeNull()
      expect(container.textContent).toBe("")
    })
  })

  it("не-массив в ответе офферов скрывает блок", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ offers: [] }))

    const { container } = render(<ChatPartnerActions />)

    await waitFor(() => expect(container.querySelectorAll(".animate-pulse")).toHaveLength(0))
    expect(screen.queryByTestId("partner-actions")).toBeNull()
    expect(container.textContent).toBe("")
  })

  it("передаёт chatId и onShared в диалог ресторана", async () => {
    const onShared = vi.fn()
    mockFetch
      .mockResolvedValueOnce(jsonResponse([{ id: 3, partner_name: "R", category: "restaurant", title: "Ужин", description: null }]))
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({ shared: true }))

    render(<ChatPartnerActions placement="chat" chatId={42} onShared={onShared} />)
    await waitFor(() => expect(screen.getByTestId("partner-action-restaurant")).toBeTruthy())

    fireEvent.click(screen.getByTestId("partner-action-restaurant"))
    fireEvent.change(screen.getByTestId("booking-date"), { target: { value: "2026-12-31" } })
    fireEvent.click(screen.getByTestId("confirm-booking"))

    await waitFor(() => expect(onShared).toHaveBeenCalledTimes(1))
    const shareCall = mockFetch.mock.calls.find(([url]) => String(url).includes("/api/partners/booking/share"))
    expect(JSON.parse((shareCall![1] as RequestInit).body as string)).toMatchObject({ chat_id: 42, offer_id: 3 })
  })

  it("передаёт chatId и onShared в диалог спа", async () => {
    const onShared = vi.fn()
    mockFetch
      .mockResolvedValueOnce(jsonResponse([{ id: 4, partner_name: "S", category: "spa", title: "Спа", description: null }]))
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({ shared: true }))

    render(<ChatPartnerActions placement="chat" chatId={42} onShared={onShared} />)
    await waitFor(() => expect(screen.getByTestId("partner-action-spa")).toBeTruthy())

    fireEvent.click(screen.getByTestId("partner-action-spa"))
    fireEvent.change(screen.getByTestId("spa-date"), { target: { value: "2026-12-31" } })
    fireEvent.click(screen.getByTestId("spa-book"))

    await waitFor(() => expect(onShared).toHaveBeenCalledTimes(1))
    const shareCall = mockFetch.mock.calls.find(([url]) => String(url).includes("/api/partners/booking/share"))
    expect(JSON.parse((shareCall![1] as RequestInit).body as string)).toMatchObject({ chat_id: 42, offer_id: 4 })
  })

  it("неизвестная категория показывает «Другое» вместо сырого ключа", async () => {
    const unknown = { id: 9, partner_name: "X", category: "mystery", title: "Загадка", description: null }
    mockFetch
      .mockResolvedValueOnce(jsonResponse([unknown]))
      .mockResolvedValueOnce(jsonResponse({ deeplink: "https://x.ru/9" }))

    render(<ChatPartnerActions />)

    const chip = await screen.findByTestId("partner-action-mystery")
    expect(chip).toHaveTextContent("partner.category.other")
    expect(chip).toHaveAttribute("aria-label", "partner.category.other")

    fireEvent.click(chip)
    await waitFor(() => expect(openMock).toHaveBeenCalledWith("https://x.ru/9", "_blank", "noopener"))
  })

  it("открывает заказ цветов для flowers и gift и закрывает по Escape", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([
      { id: 11, partner_name: "Flowwow", category: "flowers", title: "Букет", description: "Розы" },
      { id: 12, partner_name: "Gift", category: "gift", title: "Подарок", description: null },
    ]))

    render(<ChatPartnerActions />)

    fireEvent.click(await screen.findByTestId("partner-action-flowers"))
    expect(await screen.findByText("partner.order.title")).toBeTruthy()

    fireEvent.keyDown(document, { key: "Escape" })
    await waitFor(() => expect(screen.queryByText("partner.order.title")).toBeNull())

    fireEvent.click(screen.getByTestId("partner-action-gift"))
    expect(await screen.findByText("partner.order.title")).toBeTruthy()
  })

  it("открывает бронирование отеля и закрывает по Escape", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([
      { id: 13, partner_name: "Ostrovok", category: "hotel", title: "Отель", description: null },
    ]))

    render(<ChatPartnerActions />)

    fireEvent.click(await screen.findByTestId("partner-action-hotel"))
    expect(await screen.findByText("partner.hotel.title")).toBeTruthy()

    fireEvent.keyDown(document, { key: "Escape" })
    await waitFor(() => expect(screen.queryByText("partner.hotel.title")).toBeNull())
  })

  it("закрывает диалоги ресторана и спа по Escape", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([
      { id: 14, partner_name: "R", category: "restaurant", title: "Ужин", description: null },
      { id: 15, partner_name: "S", category: "spa", title: "Спа", description: null },
    ]))

    render(<ChatPartnerActions />)

    fireEvent.click(await screen.findByTestId("partner-action-restaurant"))
    expect(await screen.findByText("partner.booking.title")).toBeTruthy()
    fireEvent.keyDown(document, { key: "Escape" })
    await waitFor(() => expect(screen.queryByText("partner.booking.title")).toBeNull())

    fireEvent.click(screen.getByTestId("partner-action-spa"))
    expect(await screen.findByText("partner.spa.title")).toBeTruthy()
    fireEvent.keyDown(document, { key: "Escape" })
    await waitFor(() => expect(screen.queryByText("partner.spa.title")).toBeNull())
  })

  it("передаёт округлённые координаты в track", async () => {
    stubGeolocation((success) => {
      success({ coords: { latitude: 55.7512444, longitude: 37.6184234 } } as GeolocationPosition)
    })
    mockFetch
      .mockResolvedValueOnce(jsonResponse([sampleOffers[0]]))
      .mockResolvedValueOnce(jsonResponse({ deeplink: "https://x.ru/geo" }))

    render(<ChatPartnerActions />)
    fireEvent.click(await screen.findByTestId("partner-action-taxi"))

    await waitFor(() => {
      expect(trackBody()).toEqual({ offer_id: 1, lat: 55.751244, lng: 37.618423 })
    })
  })

  it("трекает без координат, если геолокация вернула ошибку", async () => {
    stubGeolocation((_success, error) => {
      error({ code: 1, message: "denied" } as GeolocationPositionError)
    })
    mockFetch
      .mockResolvedValueOnce(jsonResponse([sampleOffers[0]]))
      .mockResolvedValueOnce(jsonResponse({ deeplink: "https://x.ru/no-geo" }))

    render(<ChatPartnerActions />)
    fireEvent.click(await screen.findByTestId("partner-action-taxi"))

    await waitFor(() => expect(trackBody()).toEqual({ offer_id: 1 }))
    expect(openMock).toHaveBeenCalledWith("https://x.ru/no-geo", "_blank", "noopener")
  })

  it("не ставит Authorization, если токена нет", async () => {
    getTokenMock.mockReturnValueOnce("test-token").mockReturnValueOnce(null)
    mockFetch
      .mockResolvedValueOnce(jsonResponse([sampleOffers[0]]))
      .mockResolvedValueOnce(jsonResponse({ deeplink: "https://x.ru/no-token" }))

    render(<ChatPartnerActions />)
    fireEvent.click(await screen.findByTestId("partner-action-taxi"))

    await waitFor(() => expect(trackCall()).toBeTruthy())
    const headers = (trackCall()![1] as RequestInit).headers as Record<string, string>
    expect(headers["Content-Type"]).toBe("application/json")
    expect(headers.Authorization).toBeUndefined()
  })

  it("неуспешный track не открывает ссылку и снимает спиннер", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse([sampleOffers[0]]))
      .mockResolvedValueOnce({ ok: false, json: () => Promise.resolve({ message: "nope" }) })

    render(<ChatPartnerActions />)
    const chip = await screen.findByTestId("partner-action-taxi")
    fireEvent.click(chip)

    await waitFor(() => expect(chip).toBeEnabled())
    expect(openMock).not.toHaveBeenCalled()
    expect(screen.queryByTestId("partner-fallback-dialog")).toBeNull()
  })

  it("сетевой сбой track не ломает компонент", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse([sampleOffers[0]]))
      .mockRejectedValueOnce(new Error("offline"))

    render(<ChatPartnerActions />)
    const chip = await screen.findByTestId("partner-action-taxi")
    fireEvent.click(chip)

    await waitFor(() => expect(chip).toBeEnabled())
    expect(openMock).not.toHaveBeenCalled()
  })

  it("пустой deeplink не уводит на undefined", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse([sampleOffers[0]]))
      .mockResolvedValueOnce(jsonResponse({}))

    render(<ChatPartnerActions />)
    const chip = await screen.findByTestId("partner-action-taxi")
    fireEvent.click(chip)

    await waitFor(() => expect(chip).toBeEnabled())
    expect(window.location.href).toBe("")
    expect(openMock).not.toHaveBeenCalled()
    expect(screen.queryByTestId("partner-fallback-dialog")).toBeNull()
  })

  it("пустая строка deeplink не уводит со страницы", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse([sampleOffers[0]]))
      .mockResolvedValueOnce(jsonResponse({ deeplink: "" }))

    render(<ChatPartnerActions />)
    const chip = await screen.findByTestId("partner-action-taxi")
    fireEvent.click(chip)

    await waitFor(() => expect(chip).toBeEnabled())
    expect(window.location.href).toBe("")
    expect(openMock).not.toHaveBeenCalled()
  })

  it("не-http deeplink уводит по схеме и показывает fallback с описанием", async () => {
    const offer = { id: 16, partner_name: "Maps", category: "taxi", title: "Маршрут", description: "До центра" }
    mockFetch
      .mockResolvedValueOnce(jsonResponse([offer]))
      .mockResolvedValueOnce(jsonResponse({ deeplink: "yandexmaps://route?text=home" }))

    render(<ChatPartnerActions />)
    await screen.findByTestId("partner-action-taxi")

    vi.useFakeTimers()
    fireEvent.click(screen.getByTestId("partner-action-taxi"))
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    vi.useRealTimers()

    expect(window.location.href).toBe("yandexmaps://route?text=home")
    const dialog = screen.getByTestId("partner-fallback-dialog")
    expect(within(dialog).getByText("partner.category.taxi")).toBeTruthy()
    expect(within(dialog).getByText("До центра")).toBeTruthy()
    expect(within(dialog).getByText("partner.copy_link")).toBeTruthy()
    expect(screen.getByTestId("partner-fallback-link")).toHaveTextContent("yandexmaps://route?text=home")
  })

  it("blur до таймаута не показывает fallback", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse([sampleOffers[0]]))
      .mockResolvedValueOnce(jsonResponse({ deeplink: "yandexmaps://route?text=home" }))

    render(<ChatPartnerActions />)
    await screen.findByTestId("partner-action-taxi")

    vi.useFakeTimers()
    fireEvent.click(screen.getByTestId("partner-action-taxi"))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    window.dispatchEvent(new Event("blur"))
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    vi.useRealTimers()

    expect(window.location.href).toBe("yandexmaps://route?text=home")
    expect(screen.queryByTestId("partner-fallback-dialog")).toBeNull()
  })

  it("скрытая вкладка не показывает fallback", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse([sampleOffers[0]]))
      .mockResolvedValueOnce(jsonResponse({ deeplink: "yandexmaps://route?text=home" }))

    render(<ChatPartnerActions />)
    await screen.findByTestId("partner-action-taxi")
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true })

    vi.useFakeTimers()
    fireEvent.click(screen.getByTestId("partner-action-taxi"))
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    vi.useRealTimers()

    expect(screen.queryByTestId("partner-fallback-dialog")).toBeNull()
  })

  it("заблокированный popup показывает fallback без описания", async () => {
    openMock.mockReturnValueOnce(null)
    mockFetch
      .mockResolvedValueOnce(jsonResponse([sampleOffers[1]]))
      .mockResolvedValueOnce(jsonResponse({ deeplink: "https://x.ru/blocked" }))

    render(<ChatPartnerActions />)
    fireEvent.click(await screen.findByTestId("partner-action-cinema"))

    const dialog = await screen.findByTestId("partner-fallback-dialog")
    expect(within(dialog).getByText("partner.category.cinema")).toBeTruthy()
    expect(screen.getByTestId("partner-fallback-link")).toHaveTextContent("https://x.ru/blocked")
    expect(within(dialog).queryByText("d")).toBeNull()
  })

  it("кнопка копирования копирует ссылку и закрывает fallback", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
    openMock.mockReturnValueOnce(null)
    mockFetch
      .mockResolvedValueOnce(jsonResponse([sampleOffers[0]]))
      .mockResolvedValueOnce(jsonResponse({ deeplink: "https://x.ru/copy" }))

    render(<ChatPartnerActions />)
    fireEvent.click(await screen.findByTestId("partner-action-taxi"))
    await screen.findByTestId("partner-fallback-dialog")

    fireEvent.click(screen.getByTestId("partner-fallback-copy"))

    expect(writeText).toHaveBeenCalledWith("https://x.ru/copy")
    await waitFor(() => expect(screen.queryByTestId("partner-fallback-dialog")).toBeNull())
  })

  it("копирование не падает без Clipboard API", async () => {
    delete (navigator as unknown as { clipboard?: Clipboard }).clipboard
    openMock.mockReturnValueOnce(null)
    mockFetch
      .mockResolvedValueOnce(jsonResponse([sampleOffers[0]]))
      .mockResolvedValueOnce(jsonResponse({ deeplink: "https://x.ru/no-clipboard" }))

    render(<ChatPartnerActions />)
    fireEvent.click(await screen.findByTestId("partner-action-taxi"))
    await screen.findByTestId("partner-fallback-dialog")

    fireEvent.click(screen.getByTestId("partner-fallback-copy"))

    await waitFor(() => expect(screen.queryByTestId("partner-fallback-dialog")).toBeNull())
  })

  it("закрывает fallback по Escape", async () => {
    openMock.mockReturnValueOnce(null)
    mockFetch
      .mockResolvedValueOnce(jsonResponse([sampleOffers[0]]))
      .mockResolvedValueOnce(jsonResponse({ deeplink: "https://x.ru/escape" }))

    render(<ChatPartnerActions />)
    fireEvent.click(await screen.findByTestId("partner-action-taxi"))
    await screen.findByTestId("partner-fallback-dialog")

    fireEvent.keyDown(document, { key: "Escape" })

    await waitFor(() => expect(screen.queryByTestId("partner-fallback-dialog")).toBeNull())
  })

  it("показывает спиннер и блокирует чип, пока track в полёте", async () => {
    let resolveTrack!: (value: unknown) => void
    mockFetch
      .mockResolvedValueOnce(jsonResponse([sampleOffers[0]]))
      .mockReturnValueOnce(new Promise((resolve) => { resolveTrack = resolve }))

    render(<ChatPartnerActions />)
    const chip = await screen.findByTestId("partner-action-taxi")
    fireEvent.click(chip)

    await waitFor(() => expect(chip).toBeDisabled())
    expect(chip.querySelector(".animate-spin")).toBeTruthy()

    await act(async () => {
      resolveTrack(jsonResponse({ deeplink: "https://x.ru/late" }))
      await Promise.resolve()
    })

    await waitFor(() => expect(chip).toBeEnabled())
    expect(openMock).toHaveBeenCalledWith("https://x.ru/late", "_blank", "noopener")
  })
})
