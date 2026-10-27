import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import React from "react"

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

vi.mock("@/lib/token", () => ({
  getToken: () => "test-token",
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

import { ChatPartnerActions } from "@/components/chat/chat-partner-actions"

describe("ChatPartnerActions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
    vi.stubGlobal("open", vi.fn())
  })

  it("renders chips for placement offers", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(sampleOffers) })

    render(<ChatPartnerActions placement="chat" />)

    await waitFor(() => {
      expect(screen.getByTestId("partner-action-taxi")).toBeTruthy()
      expect(screen.getByTestId("partner-action-cinema")).toBeTruthy()
    })
    expect(String(mockFetch.mock.calls[0][0])).toContain("placement=chat")
  })

  it("tracks click and opens http deeplink", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([sampleOffers[0]]) })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ deeplink: "https://x.ru/?utm_source=swiftmatch&ref=ABC" }),
      })

    render(<ChatPartnerActions />)
    await waitFor(() => expect(screen.getByTestId("partner-action-taxi")).toBeTruthy())

    fireEvent.click(screen.getByTestId("partner-action-taxi"))

    await waitFor(() => {
      const trackCall = mockFetch.mock.calls.find(([url]) => String(url).includes("/api/partners/track"))
      expect(trackCall).toBeTruthy()
      expect(JSON.parse(trackCall![1].body)).toEqual({ offer_id: 1 })
      expect(window.open).toHaveBeenCalledWith(
        "https://x.ru/?utm_source=swiftmatch&ref=ABC",
        "_blank",
        "noopener",
      )
    })
  })

  it("renders nothing when no offers", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) })

    const { container } = render(<ChatPartnerActions />)

    await waitFor(() => {
      expect(screen.queryByTestId("partner-actions")).toBeNull()
      expect(container.textContent).toBe("")
    })
  })

  it("передаёт chatId и onShared в диалог ресторана", async () => {
    const onShared = vi.fn()
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([{ id: 3, partner_name: "R", category: "restaurant", title: "Ужин", description: null }]),
      })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ shared: true }) })

    render(<ChatPartnerActions placement="chat" chatId={42} onShared={onShared} />)
    await waitFor(() => expect(screen.getByTestId("partner-action-restaurant")).toBeTruthy())

    fireEvent.click(screen.getByTestId("partner-action-restaurant"))
    fireEvent.change(screen.getByTestId("booking-date"), { target: { value: "2026-12-31" } })
    fireEvent.click(screen.getByTestId("confirm-booking"))

    await waitFor(() => expect(onShared).toHaveBeenCalledTimes(1))
    const shareCall = mockFetch.mock.calls.find(([url]) => String(url).includes("/api/partners/booking/share"))
    expect(JSON.parse(shareCall![1].body)).toMatchObject({ chat_id: 42, offer_id: 3 })
  })

  it("передаёт chatId и onShared в диалог спа", async () => {
    const onShared = vi.fn()
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([{ id: 4, partner_name: "S", category: "spa", title: "Спа", description: null }]),
      })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ shared: true }) })

    render(<ChatPartnerActions placement="chat" chatId={42} onShared={onShared} />)
    await waitFor(() => expect(screen.getByTestId("partner-action-spa")).toBeTruthy())

    fireEvent.click(screen.getByTestId("partner-action-spa"))
    fireEvent.change(screen.getByTestId("spa-date"), { target: { value: "2026-12-31" } })
    fireEvent.click(screen.getByTestId("spa-book"))

    await waitFor(() => expect(onShared).toHaveBeenCalledTimes(1))
    const shareCall = mockFetch.mock.calls.find(([url]) => String(url).includes("/api/partners/booking/share"))
    expect(JSON.parse(shareCall![1].body)).toMatchObject({ chat_id: 42, offer_id: 4 })
  })
})
