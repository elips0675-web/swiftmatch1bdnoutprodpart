import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

vi.mock("@/lib/token", () => ({
  getToken: () => "test-token",
}));

const mockLanguage = { t: (key: string) => key, language: "RU", setLanguage: vi.fn() };
vi.mock("@/context/language-context", () => ({
  useLanguage: () => mockLanguage,
}));

const mockContentConfig = {
  interests: ["interest.sport", "interest.music"],
  dating_goals: ["goal.serious_relationship"],
};
vi.mock("@/lib/useContentConfig", () => ({
  useContentConfig: () => mockContentConfig,
}));

vi.mock("@/shims/ai-flows", () => ({
  generateProfileBio: vi.fn(),
}));

vi.mock("@/components/layout/app-header", () => ({
  AppHeader: () => <div data-testid="app-header" />,
}));

vi.mock("@/components/navigation/bottom-nav", () => ({
  BottomNav: () => <div data-testid="bottom-nav" />,
}));

vi.mock("@/components/shared/verification", () => ({
  VerificationDialog: () => null,
}));

const routerMock = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() };
vi.mock("@/shims/next-navigation", () => ({
  useRouter: () => routerMock,
}));

const ME_DEFAULTS = {
  id: 42,
  display_name: "Ирина",
  name: "Ирина",
  age: 30,
  birth_date: null,
  bio: "Люблю кофе",
  city: "Москва",
  height: 168,
  gender: "female",
  looking_for: "male",
  dating_goal: "goal.serious_relationship",
  zodiac: "common.zodiac.leo",
  photos: [],
  interests: [{ id: 1, name_ru: "Спорт", name_en: "Sport" }],
};

let meOverrides: Record<string, unknown> = {};

function routeFetch(url: string, opts?: { method?: string }) {
  const u = String(url);
  if (u === "/api/profile/me") {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ...ME_DEFAULTS, ...meOverrides }),
    });
  }
  if (u.startsWith("/api/profile/") && opts?.method === "PUT") {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: ME_DEFAULTS.id }) });
  }
  if (u === "/api/upload") {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ id: 55, url: "/uploads/new.jpg", sort_order: 9, is_avatar: false }),
    });
  }
  if (u.startsWith("/api/photos/") && opts?.method === "DELETE") {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
  }
  return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
}

function renderPage(ui: React.ReactElement) {
  return render(<MemoryRouter initialEntries={["/profile/edit"]}>{ui}</MemoryRouter>);
}

function putBody() {
  const call = mockFetch.mock.calls.find(
    ([url, opts]) => String(url) === `/api/profile/${ME_DEFAULTS.id}` && (opts as { method?: string })?.method === "PUT",
  );
  return call ? JSON.parse((call[1] as { body: string }).body) : null;
}

function photoSrc(index: number) {
  const nodes = screen.getAllByAltText(/^Photo /);
  return (nodes[index] as HTMLImageElement).getAttribute("src");
}

async function renderEditPage() {
  const Page = (await import("@/pages/profile-edit")).default;
  renderPage(<Page />);
  await waitFor(() => {
    expect((screen.getByTestId("profile-name") as HTMLInputElement).value).toBe(ME_DEFAULTS.display_name);
  });
  return Page;
}

describe("ProfileEditPage: дата рождения", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    localStorage.clear();
    meOverrides = {};
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => routeFetch(url, opts));
  });

  it("не подставляет выдуманную дату, когда в БД её нет", async () => {
    await renderEditPage();

    const input = (await screen.findByTestId("profile-birth-date")) as HTMLInputElement;
    expect(input.value).toBe("");
  });

  it("при сохранении без даты не перезаписывает возраст (регрессия: было 2001-08-10 -> age 25)", async () => {
    meOverrides = { age: 37, birth_date: null };
    await renderEditPage();

    fireEvent.click(screen.getByTestId("save-profile"));

    await waitFor(() => {
      const body = putBody();
      expect(body).toBeTruthy();
      expect(body.birth_date).toBe(null);
      expect(body.age).toBe(37);
    });
  });

  it("подставляет дату из БД в input типа date", async () => {
    meOverrides = { age: 30, birth_date: "1995-06-15" };
    await renderEditPage();

    await waitFor(() => {
      expect((screen.getByTestId("profile-birth-date") as HTMLInputElement).value).toBe("1995-06-15");
    });
  });

  it("PUT уходит с Content-Type и собственным id (не демо)", async () => {
    await renderEditPage();

    fireEvent.click(screen.getByTestId("save-profile"));

    await waitFor(() => {
      expect(putBody()).toBeTruthy();
    });
    const call = mockFetch.mock.calls.find(
      ([url, opts]) => String(url) === `/api/profile/${ME_DEFAULTS.id}` && (opts as { method?: string })?.method === "PUT",
    )!;
    const opts = call[1] as { headers: Record<string, string> };
    expect(opts.headers["Content-Type"]).toBe("application/json");
    expect(opts.headers.Authorization).toBe("Bearer test-token");
  });
});

describe("ProfileEditPage: фото", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    localStorage.clear();
    meOverrides = {};
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => routeFetch(url, opts));
  });

  it("удаление фото вызывает DELETE /api/photos/:id", async () => {
    meOverrides = {
      photos: [
        { id: 11, url: "/uploads/a.jpg", sort_order: 0, is_avatar: 0 },
        { id: 12, url: "/uploads/b.jpg", sort_order: 1, is_avatar: 0 },
      ],
    };
    await renderEditPage();

    await waitFor(() => {
      expect(photoSrc(0)).toBe("/uploads/a.jpg");
    });

    fireEvent.click(screen.getByTestId("profile-photo-remove-0"));

    await waitFor(() => {
      const del = mockFetch.mock.calls.find(
        ([url, opts]) => String(url) === "/api/photos/11" && (opts as { method?: string })?.method === "DELETE",
      );
      expect(del).toBeTruthy();
    });
    await waitFor(() => {
      expect(photoSrc(0)).toBe("/uploads/b.jpg");
    });
  });

  it("загрузка фото использует url из ответа сервера, а не base64 в localStorage", async () => {
    meOverrides = { photos: [{ id: 11, url: "/uploads/a.jpg", sort_order: 0, is_avatar: 0 }] };
    await renderEditPage();

    const before = screen.getAllByAltText(/^Photo /).length;
    const file = new File([new Uint8Array([1, 2, 3])], "photo.jpg", { type: "image/jpeg" });
    const input = document.getElementById("photo-upload") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    fireEvent.change(input);

    await waitFor(() => {
      expect(screen.getAllByAltText(/^Photo /).length).toBe(before + 1);
    });

    const nodes = screen.getAllByAltText(/^Photo /);
    expect((nodes[nodes.length - 1] as HTMLImageElement).getAttribute("src")).toBe("/uploads/new.jpg");
    const stored = localStorage.getItem("userProfileGallery") || "";
    expect(stored).not.toContain("data:");
    expect(stored).toContain("/uploads/new.jpg");
  });
});
