import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";

const flags = vi.hoisted(() => ({ userWatchesEnabled: true }));

const t = (key: string) => key;
const language = { t, language: "RU", setLanguage: () => {} };

vi.mock("@/lib/token", () => ({ getToken: () => "test-token" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/context/language-context", () => ({
  useLanguage: () => language,
}));
vi.mock("@/context/feature-flags-context", () => ({
  useFeatureFlags: () => ({ userWatchesEnabled: flags.userWatchesEnabled }),
}));
vi.mock("@/components/layout/app-header", () => ({
  AppHeader: () => <div data-testid="app-header" />,
}));
vi.mock("@/components/navigation/bottom-nav", () => ({
  BottomNav: () => <div data-testid="bottom-nav" />,
}));

import ProfileWatchingPage from "@/pages/profile-watching";
import { toast } from "sonner";

let watching: Array<{ id: number; display_name: string; avatar_url: string | null; created_at: string }> = [];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  flags.userWatchesEnabled = true;
  watching = [];
  fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    if (u === "/api/users/watching") {
      return { ok: true, json: async () => watching };
    }
    if (u.endsWith("/watch")) {
      return { ok: true, json: async () => ({ watching: false }) };
    }
    return { ok: true, json: async () => ({}) };
  });
  global.fetch = fetchMock as unknown as typeof fetch;
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/profile/watching"]}>
      <ProfileWatchingPage />
    </MemoryRouter>,
  );
}

describe("ProfileWatchingPage", () => {
  it("рисует список людей, за которыми следит пользователь", async () => {
    watching = [
      { id: 5, display_name: "Иван", avatar_url: null, created_at: "2026-10-01" },
      { id: 8, display_name: "Мария", avatar_url: null, created_at: "2026-10-02" },
    ];
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("watching-list")).toBeTruthy();
    });
    expect(screen.getByText("Иван")).toBeTruthy();
    expect(screen.getByText("Мария")).toBeTruthy();
  });

  it("показывает пустое состояние, когда подписок нет", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("watching-empty")).toBeTruthy();
    });
  });

  it("отписывает через DELETE и убирает строку из списка", async () => {
    watching = [{ id: 5, display_name: "Иван", avatar_url: null, created_at: "2026-10-01" }];
    renderPage();

    const unwatch = await screen.findByTestId("unwatch-5");
    fireEvent.click(unwatch);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/users/5/watch",
        expect.objectContaining({ method: "DELETE" }),
      );
    });
    await waitFor(() => {
      expect(screen.queryByText("Иван")).toBeNull();
    });
    expect(toast.success).toHaveBeenCalledWith("watching.unwatched");
  });

  it("не грузит список и показывает заглушку, когда флаг выключен", async () => {
    flags.userWatchesEnabled = false;
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("hangout.disabled_desc")).toBeTruthy();
    });
    expect(fetchMock).not.toHaveBeenCalledWith("/api/users/watching", expect.anything());
  });
});
