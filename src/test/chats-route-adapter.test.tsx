import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"

vi.mock("@/pages/chats-chatId", () => ({
  default: ({ params }: { params: { chatId: string } }) => <div data-testid="chat-page">{params.chatId}</div>,
}))

import ChatRouteAdapter from "@/pages/_chats-chatId-adapter"

describe("Адаптер маршрута /chats/:chatId", () => {
  it("передаёт chatId из URL в страницу чата", () => {
    render(
      <MemoryRouter initialEntries={["/chats/42"]}>
        <Routes>
          <Route path="/chats/:chatId" element={<ChatRouteAdapter />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByTestId("chat-page").textContent).toBe("42")
  })

  it("подставляет пустую строку, если параметра в URL нет", () => {
    render(<ChatRouteAdapter />, { wrapper: MemoryRouter })

    expect(screen.getByTestId("chat-page").textContent).toBe("")
  })
})
