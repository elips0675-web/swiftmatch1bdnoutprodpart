import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react"
import React from "react"

vi.mock("@/context/language-context", () => ({
  useLanguage: () => ({
    t: (key: string, options?: Record<string, string>) =>
      options ? `${key} ${Object.values(options).join(" ")}` : key,
    language: "ru",
    setLanguage: () => {},
  }),
}))

const tokenState = vi.hoisted(() => ({ value: "user-token" as string | null }))

vi.mock("@/lib/token", () => ({ getToken: () => tokenState.value }))

import { GoOutBookingDialog, AffiliateMap, fillDeeplink, type GoOutOffer } from "@/components/hangout-go-out"

const offer = (patch: Partial<GoOutOffer> = {}): GoOutOffer => ({
  id: 7,
  category: "restaurant",
  title: "Ужин на двоих",
  deeplink: "https://partner.example/book",
  partner_name: "Партнёр",
  city: "Москва",
  price: 1500,
  commission_rate: 12,
  ...patch,
})

const jsonResponse = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response

let openSpy: ReturnType<typeof vi.fn>
let writeText: ReturnType<typeof vi.fn>

beforeEach(() => {
  cleanup()
  tokenState.value = "user-token"
  openSpy = vi.fn(() => ({}) as Window)
  vi.stubGlobal("open", openSpy)
  writeText = vi.fn(() => Promise.resolve())
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("fillDeeplink", () => {
  it("подставляет город из аргумента и кодирует спецсимволы", () => {
    const url = fillDeeplink("https://p.example/?c={city}", "Нижний Новгород", offer({ city: "Москва" }))
    expect(url).toBe("https://p.example/?c=%D0%9D%D0%B8%D0%B6%D0%BD%D0%B8%D0%B9%20%D0%9D%D0%BE%D0%B2%D0%B3%D0%BE%D1%80%D0%BE%D0%B4")
  })

  it("берёт город оффера, когда аргумент пустой, и пустую строку без города", () => {
    expect(fillDeeplink("https://p.example/?c={city}", "", offer({ city: "Казань" })))
      .toBe("https://p.example/?c=%D0%9A%D0%B0%D0%B7%D0%B0%D0%BD%D1%8C")
    expect(fillDeeplink("https://p.example/?c={city}", "", offer({ city: null })))
      .toBe("https://p.example/?c=")
  })

  it("подставляет координаты и оставляет пустоту, если их нет", () => {
    expect(fillDeeplink("https://p.example/?lat={lat}&lng={lng}", "", offer({ lat: 55.75, lng: 37.61 })))
      .toBe("https://p.example/?lat=55.75&lng=37.61")
    expect(fillDeeplink("https://p.example/?lat={lat}&lng={lng}", "", offer({ lat: null, lng: undefined })))
      .toBe("https://p.example/?lat=&lng=")
  })

  it("заменяет повторяющиеся плейсхолдеры во всех вхождениях", () => {
    expect(fillDeeplink("{city}-{city}", "Сочи", offer())).toBe(
      "%D0%A1%D0%BE%D1%87%D0%B8-%D0%A1%D0%BE%D1%87%D0%B8",
    )
  })
})

describe("GoOutBookingDialog", () => {
  it("ничего не рендерит без оффера", () => {
    const { container } = render(
      <GoOutBookingDialog offer={null} city="Москва" open onOpenChange={() => {}} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it("для не-ресторана открывает deeplink и закрывает диалог", () => {
    const onOpenChange = vi.fn()
    render(
      <GoOutBookingDialog
        offer={offer({ category: "spa", title: "Спа", deeplink: "https://p.example/spa?c={city}" })}
        city="Сочи"
        open
        onOpenChange={onOpenChange}
      />,
    )
    fireEvent.click(screen.getByTestId("goout-booking-confirm"))
    expect(openSpy).toHaveBeenCalledWith(
      "https://p.example/spa?c=%D0%A1%D0%BE%D1%87%D0%B8",
      "_blank",
      "noopener",
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("для не-ресторана при заблокированном окне оставляет диалог и показывает ссылку", () => {
    openSpy.mockReturnValue(null)
    const onOpenChange = vi.fn()
    render(
      <GoOutBookingDialog offer={offer({ category: "cinema", deeplink: "https://p.example/film" })} city="Москва" open onOpenChange={onOpenChange} />,
    )
    fireEvent.click(screen.getByTestId("goout-booking-confirm"))
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByTestId("goout-fallback-link").textContent).toBe("https://p.example/film")
    expect(screen.getByText("partner.popup_blocked")).toBeTruthy()
  })

  it("копирует ссылку из fallback и закрывает по кнопке", async () => {
    openSpy.mockReturnValue(null)
    const onOpenChange = vi.fn()
    render(
      <GoOutBookingDialog offer={offer({ category: "cinema", deeplink: "https://p.example/film" })} city="Москва" open onOpenChange={onOpenChange} />,
    )
    fireEvent.click(screen.getByTestId("goout-booking-confirm"))
    fireEvent.click(screen.getByTestId("goout-fallback-copy"))
    expect(writeText).toHaveBeenCalledWith("https://p.example/film")
    fireEvent.click(screen.getByTestId("goout-fallback-close"))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("не копирует ссылку, если Clipboard API недоступен", () => {
    openSpy.mockReturnValue(null)
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined })
    render(
      <GoOutBookingDialog offer={offer({ category: "cinema", deeplink: "https://p.example/film" })} city="Москва" open onOpenChange={() => {}} />,
    )
    fireEvent.click(screen.getByTestId("goout-booking-confirm"))
    expect(() => fireEvent.click(screen.getByTestId("goout-fallback-copy"))).not.toThrow()
  })

  it("для ресторана без даты показывает ошибку и не идёт в сеть", () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    render(<GoOutBookingDialog offer={offer({ deeplink: "" })} city="Москва" open onOpenChange={() => {}} />)
    fireEvent.change(screen.getByTestId("goout-booking-date"), { target: { value: "" } })
    fireEvent.click(screen.getByTestId("goout-booking-confirm"))
    expect(screen.getByText("partner.booking.fill_required")).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("бронирует столик с телом, Bearer и открывает deeplink", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ deeplink: "https://p.example/booking?x=1" }, 201))
    vi.stubGlobal("fetch", fetchMock)
    const onOpenChange = vi.fn()
    render(<GoOutBookingDialog offer={offer()} city="Москва" open onOpenChange={onOpenChange} />)

    fireEvent.change(screen.getByTestId("goout-booking-date"), { target: { value: "2026-11-05" } })
    fireEvent.change(screen.getByTestId("goout-booking-time"), { target: { value: "20:30" } })
    fireEvent.change(screen.getByTestId("goout-booking-guests"), { target: { value: "4" } })
    fireEvent.click(screen.getByTestId("goout-booking-confirm"))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/partners/booking")
    expect(init.method).toBe("POST")
    expect(init.headers).toEqual({ "Content-Type": "application/json", Authorization: "Bearer user-token" })
    expect(JSON.parse(String(init.body))).toEqual({ offer_id: 7, date: "2026-11-05", time: "20:30", guests: 4 })
    expect(openSpy).toHaveBeenCalledWith("https://p.example/booking?x=1", "_blank", "noopener")
  })

  it("бронирует без заголовка Authorization при отсутствии токена", async () => {
    tokenState.value = null
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({}, 201))
    vi.stubGlobal("fetch", fetchMock)
    render(<GoOutBookingDialog offer={offer()} city="Москва" open onOpenChange={() => {}} />)
    fireEvent.change(screen.getByTestId("goout-booking-date"), { target: { value: "2026-11-05" } })
    fireEvent.click(screen.getByTestId("goout-booking-confirm"))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.headers).toEqual({ "Content-Type": "application/json" })
  })

  it("закрывает диалог после успешной брони без deeplink", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ deeplink: "" }, 201)))
    const onOpenChange = vi.fn()
    render(<GoOutBookingDialog offer={offer()} city="Москва" open onOpenChange={onOpenChange} />)
    fireEvent.change(screen.getByTestId("goout-booking-date"), { target: { value: "2026-11-05" } })
    fireEvent.click(screen.getByTestId("goout-booking-confirm"))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(openSpy).not.toHaveBeenCalled()
  })

  it("оставляет диалог открытым и показывает ссылку, если окно заблокировано после брони", async () => {
    openSpy.mockReturnValue(null)
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ deeplink: "https://p.example/b?x=1" }, 201)))
    const onOpenChange = vi.fn()
    render(<GoOutBookingDialog offer={offer()} city="Москва" open onOpenChange={onOpenChange} />)
    fireEvent.change(screen.getByTestId("goout-booking-date"), { target: { value: "2026-11-05" } })
    fireEvent.click(screen.getByTestId("goout-booking-confirm"))
    await waitFor(() => expect(screen.getByTestId("goout-fallback-link")).toBeTruthy())
    expect(screen.getByTestId("goout-fallback-link").textContent).toBe("https://p.example/b?x=1")
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it("не показывает английское сообщение сервера при отказе", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ message: "Failed to create booking" }, 500)))
    render(<GoOutBookingDialog offer={offer()} city="Москва" open onOpenChange={() => {}} />)
    fireEvent.change(screen.getByTestId("goout-booking-date"), { target: { value: "2026-11-05" } })
    fireEvent.click(screen.getByTestId("goout-booking-confirm"))
    await waitFor(() => expect(screen.getByText("partner.booking.error")).toBeTruthy())
    expect(screen.queryByText("Failed to create booking")).toBeNull()
  })

  it("показывает локализованную ошибку при сетевом сбое", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down") }))
    render(<GoOutBookingDialog offer={offer()} city="Москва" open onOpenChange={() => {}} />)
    fireEvent.change(screen.getByTestId("goout-booking-date"), { target: { value: "2026-11-05" } })
    fireEvent.click(screen.getByTestId("goout-booking-confirm"))
    await waitFor(() => expect(screen.getByText("partner.booking.error")).toBeTruthy())
    expect(screen.queryByText("network down")).toBeNull()
  })

  it("блокирует кнопку и показывает спиннер на время запроса", async () => {
    let resolve: (value: Response) => void = () => {}
    const pending = new Promise<Response>((r) => { resolve = r })
    vi.stubGlobal("fetch", vi.fn(() => pending))
    render(<GoOutBookingDialog offer={offer()} city="Москва" open onOpenChange={() => {}} />)
    fireEvent.change(screen.getByTestId("goout-booking-date"), { target: { value: "2026-11-05" } })
    fireEvent.click(screen.getByTestId("goout-booking-confirm"))
    const button = screen.getByTestId("goout-booking-confirm") as HTMLButtonElement
    await waitFor(() => expect(button.disabled).toBe(true))
    resolve(jsonResponse({}, 201))
    await waitFor(() => expect(button.disabled).toBe(false))
  })

  it("показывает цену с разделителями и кэшбэк только для положительного числа", () => {
    render(<GoOutBookingDialog offer={offer({ category: "cinema", price: 1200, commission_rate: 15 })} city="Москва" open onOpenChange={() => {}} />)
    const price = screen.getByText(/₽/).textContent?.replace(/\u00A0/g, " ")
    expect(price).toBe("1 200 ₽")
    expect(screen.getByText("hangout.go_out.cashback 15")).toBeTruthy()
  })

  it("показывает дробную цену как есть и скрывает кэшбэк", () => {
    render(<GoOutBookingDialog offer={offer({ category: "cinema", price: 99.5, commission_rate: null })} city="Москва" open onOpenChange={() => {}} />)
    expect(screen.getByText(/₽/).textContent).toBe("99.5 ₽")
    expect(screen.queryByText(/hangout\.go_out\.cashback/)).toBeNull()
  })

  it("скрывает кэшбэк при нулевой ставке", () => {
    render(<GoOutBookingDialog offer={offer({ category: "cinema", commission_rate: 0 })} city="Москва" open onOpenChange={() => {}} />)
    expect(screen.queryByText(/hangout\.go_out\.cashback/)).toBeNull()
  })

  it("не показывает цену, когда её нет, и подставляет описание, партнёра и город", () => {
    render(
      <GoOutBookingDialog
        offer={offer({ category: "cinema", price: null, description: "Уютный зал", city: "Тверь" })}
        city="Москва"
        open
        onOpenChange={() => {}}
      />,
    )
    expect(screen.queryByText(/₽/)).toBeNull()
    expect(screen.getByText("Уютный зал")).toBeTruthy()
    expect(screen.getByText("Партнёр — Тверь")).toBeTruthy()
  })

  it("не показывает город, когда его нет", () => {
    render(<GoOutBookingDialog offer={offer({ category: "cinema", city: null })} city="Москва" open onOpenChange={() => {}} />)
    expect(screen.getByText("Партнёр")).toBeTruthy()
    expect(screen.queryByText(/—/)).toBeNull()
  })

  it("показывает поля брони только для ресторана", () => {
    const { unmount } = render(<GoOutBookingDialog offer={offer()} city="Москва" open onOpenChange={() => {}} />)
    expect(screen.getByTestId("goout-booking-date")).toBeTruthy()
    expect(screen.getByTestId("goout-booking-guests")).toBeTruthy()
    unmount()
    render(<GoOutBookingDialog offer={offer({ category: "spa" })} city="Москва" open onOpenChange={() => {}} />)
    expect(screen.queryByTestId("goout-booking-date")).toBeNull()
  })
})

describe("AffiliateMap", () => {
  it("строит bbox по координатам первого оффера с обеими точками", () => {
    render(
      <AffiliateMap
        offers={[offer({ id: 1, lat: null, lng: null }), offer({ id: 2, lat: 55.75, lng: 37.61 })]}
        city="Москва"
        open
        onOpenChange={() => {}}
      />,
    )
    const src = screen.getByTestId("affiliate-map-frame").getAttribute("src") || ""
    expect(src).toContain("bbox=37.56%2C55.73%2C37.66%2C55.77")
    expect(src).toContain("marker=55.75%2C37.61")
  })

  it("ограничивает bbox рамками карты", () => {
    render(
      <AffiliateMap offers={[offer({ lat: 89.99, lng: -179.99 })]} city="Москва" open onOpenChange={() => {}} />,
    )
    const src = screen.getByTestId("affiliate-map-frame").getAttribute("src") || ""
    expect(src).toContain("bbox=-180%2C89.97%2C-179.94%2C90&layer=mapnik")
  })

  it("не выпускает bbox за верхние границы карты", () => {
    render(
      <AffiliateMap offers={[offer({ lat: 89.99, lng: 179.99 })]} city="Москва" open onOpenChange={() => {}} />,
    )
    const src = screen.getByTestId("affiliate-map-frame").getAttribute("src") || ""
    expect(src).toContain("bbox=179.94%2C89.97%2C180%2C90&layer=mapnik")
  })

  it("без координат ищет центр по городу оффера и кодирует его", () => {
    render(
      <AffiliateMap offers={[offer({ lat: null, lng: null, city: "Казань" })]} city="" open onOpenChange={() => {}} />,
    )
    const src = screen.getByTestId("affiliate-map-frame").getAttribute("src") || ""
    expect(src).toContain("bbox=&layer=mapnik&q=%D0%9A%D0%B0%D0%B7%D0%B0%D0%BD%D1%8C")
    expect(screen.getByText("Казань")).toBeTruthy()
  })

  it("показывает подсказку, когда города нет", () => {
    render(<AffiliateMap offers={[]} city="" open onOpenChange={() => {}} />)
    expect(screen.getByText("hangout.go_out.map_hint")).toBeTruthy()
  })

  it("перечисляет офферы ссылками с заполненным deeplink", () => {
    render(
      <AffiliateMap
        offers={[offer({ id: 5, deeplink: "https://p.example/offer?c={city}", city: "Москва" })]}
        city="Сочи"
        open
        onOpenChange={() => {}}
      />,
    )
    const link = screen.getByTestId("affiliate-map-item-5")
    expect(link.getAttribute("href")).toBe("https://p.example/offer?c=%D0%A1%D0%BE%D1%87%D0%B8")
    expect(link.getAttribute("target")).toBe("_blank")
    expect(link.getAttribute("rel")).toBe("noopener noreferrer")
  })
})
