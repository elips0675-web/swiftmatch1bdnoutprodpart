import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import React from "react";

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

import { WatchButton } from "@/components/watch-button";
import { toast } from "sonner";

let watching: Array<{ id: number; display_name: string }> = [];
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
      return { ok: true, json: async () => ({ watching: init?.method !== "DELETE" }) };
    }
    return { ok: true, json: async () => ({}) };
  });
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe("WatchButton", () => {
  it("отражает уже существующую подписку из /api/users/watching", async () => {
    watching = [{ id: 5, display_name: "Иван" }];
    render(<WatchButton userId={5} />);

    await waitFor(() => {
      expect(screen.getByTestId("user-watch-button").getAttribute("aria-label")).toBe("user.watch.following");
    });
  });

  it("подписывается через POST и меняет состояние", async () => {
    render(<WatchButton userId={5} />);
    await waitFor(() => {
      expect(screen.getByTestId("user-watch-button").getAttribute("aria-label")).toBe("user.watch.follow");
    });

    fireEvent.click(screen.getByTestId("user-watch-button"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/users/5/watch",
        expect.objectContaining({ method: "POST" }),
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId("user-watch-button").getAttribute("aria-label")).toBe("user.watch.following");
    });
    expect(toast.success).toHaveBeenCalledWith("user.watch.toast_subscribed");
  });

  it("отписывается через DELETE, когда подписка уже есть", async () => {
    watching = [{ id: 5, display_name: "Иван" }];
    render(<WatchButton userId={5} />);
    await waitFor(() => {
      expect(screen.getByTestId("user-watch-button").getAttribute("aria-label")).toBe("user.watch.following");
    });

    fireEvent.click(screen.getByTestId("user-watch-button"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/users/5/watch",
        expect.objectContaining({ method: "DELETE" }),
      );
    });
    expect(toast.success).toHaveBeenCalledWith("user.watch.toast_unsubscribed");
  });

  it("не рендерится, когда флаг выключен", async () => {
    flags.userWatchesEnabled = false;
    render(<WatchButton userId={5} />);
    expect(screen.queryByTestId("user-watch-button")).toBeNull();
  });
});
