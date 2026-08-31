import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

vi.mock("@/lib/token", () => ({
  getToken: () => "test-token",
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("@/hooks/use-premium", () => ({
  usePremium: () => ({ isPremium: false, tier: null, subscription: null, loading: false, daysRemaining: 0, refresh: vi.fn() }),
}));

const mockWs = vi.hoisted(() => {
  const handlers: Record<string, (payload?: any) => void> = {};
  const socket = {
    on: vi.fn((ev: string, cb: (payload?: any) => void) => { handlers[ev] = cb }),
    off: vi.fn(),
    emit: vi.fn(),
  };
  return { socket, handlers };
});

vi.mock("@/hooks/use-websocket", () => ({
  useWebSocket: () => ({ socket: mockWs.socket, connected: false }),
}));

const mockUseLanguage = {
  t: (key: string, options?: Record<string, any>) => {
    let value = (mockTranslations as Record<string, string>)[key] || key;
    if (options) {
      Object.entries(options).forEach(([k, v]) => {
        value = value.replace(`{${k}}`, String(v));
      });
    }
    return value;
  },
  language: "RU",
  setLanguage: vi.fn(),
};

const mockTranslations: Record<string, string> = {
  "hangout.action.respond": "Пойдем!",
  "hangout.action.open_chat": "Открыть чат",
  "hangout.action.message_organizer": "Написать организатору",
  "hangout.action.like": "Нравится",
  "hangout.action.skip": "Пропустить",
  "hangout.response.pending": "На рассмотрении",
  "hangout.response.pending_note": "Ваш отклик на рассмотрении.",
  "hangout.label.responses": "Отклики",
  "hangout.status.active": "Активна",
  "hangout.category.cinema": "Кино",
  "hangout.type.date": "Свидание",
};

vi.mock("@/context/language-context", () => ({
  useLanguage: () => mockUseLanguage,
}));

vi.mock("@/components/layout/app-header", () => ({
  AppHeader: () => <div data-testid="app-header" />,
}));

vi.mock("@/components/navigation/bottom-nav", () => ({
  BottomNav: () => <div data-testid="bottom-nav" />,
}));

const baseHangout = {
  id: 5,
  author_id: 10,
  category: "cinema",
  hangout_type: "date",
  title: "Иду на Дюну",
  description: null,
  place_name: "Аврора",
  place_address: null,
  city: "Москва",
  lat: "55.751",
  lng: "37.618",
  event_date: new Date(Date.now() + 86400000).toISOString(),
  max_companions: 1,
  status: "active",
  created_at: new Date().toISOString(),
  display_name: "Максим",
  avatar_url: null,
  is_author: false,
  my_like_status: null,
  my_response_status: null,
  like_count: 0,
  participant_count: 0,
};

function renderDetail(ui: React.ReactElement) {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={["/hangouts/5"]}>
        <Routes>
          <Route path="/hangouts/:id" element={ui} />
          <Route path="/chats/:chatId" element={<div data-testid="chat-page" />} />
        </Routes>
      </MemoryRouter>
    </HelmetProvider>
  );
}

describe("HangoutDetailPage (H3 pre-accept chat)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it("shows 'message organizer' button to a pending respondent with a chat", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (String(url).includes("/api/hangouts/5")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ...baseHangout, my_response_status: "pending", chat_id: 300 }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;
    renderDetail(<HangoutDetail />);

    await waitFor(() => {
      expect(screen.getByTestId("message-organizer")).toBeTruthy();
    });
    expect(screen.getByText("Написать организатору")).toBeTruthy();
  })

  it("does not show the message-organizer button when there is no chat yet", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (String(url).includes("/api/hangouts/5")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ...baseHangout, my_response_status: "pending", chat_id: null }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    const HangoutDetail = (await import("@/pages/hangout-detail")).default;
    renderDetail(<HangoutDetail />);

    await waitFor(() => {
      expect(screen.getByTestId("response-pending-note")).toBeTruthy();
    });
    expect(screen.queryByTestId("message-organizer")).toBeNull();
  })
});
