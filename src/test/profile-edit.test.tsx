import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

const tokenState = { value: "test-token" as string | null };
const clearTokenMock = vi.fn();
vi.mock("@/lib/token", () => ({
  getToken: () => tokenState.value,
  clearToken: () => clearTokenMock(),
}));

const toastMock = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({
  toast: toastMock,
  useToast: () => ({ toast: toastMock, toasts: [] }),
}));

const authState = { token: "test-token" as string | null, isLoading: false };
vi.mock("@/context/auth-context", () => ({
  useAuth: () => authState,
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
  VerificationDialog: ({ open, onClose }: { open: boolean; onClose?: () => void }) =>
    open ? (
      <div data-testid="verification-dialog">
        <button type="button" data-testid="verification-close" onClick={() => onClose?.()}>
          close
        </button>
      </div>
    ) : null,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: { value?: string; onValueChange?: (value: string) => void; children?: React.ReactNode }) => (
    <select value={value || ""} onChange={(event) => onValueChange?.(event.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => (
    <option value="" disabled>
      {placeholder}
    </option>
  ),
  SelectContent: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children?: React.ReactNode }) => <option value={value}>{children}</option>,
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

beforeEach(() => {
  tokenState.value = "test-token";
});

function putBody() {
  const calls = mockFetch.mock.calls.filter(
    ([url, opts]) => String(url) === `/api/profile/${ME_DEFAULTS.id}` && (opts as { method?: string })?.method === "PUT",
  );
  const call = calls[calls.length - 1];
  return call ? JSON.parse((call[1] as { body: string }).body) : null;
}

function photoSrc(index: number) {
  const nodes = screen.getAllByAltText(/^Photo /);
  return (nodes[index] as HTMLImageElement).getAttribute("src");
}

async function renderEditPage(expectedName: string = ME_DEFAULTS.display_name) {
  const Page = (await import("@/pages/profile-edit")).default;
  renderPage(<Page />);
  await waitFor(() => {
    expect((screen.getByTestId("profile-name") as HTMLInputElement).value).toBe(expectedName);
  });
  return Page;
}

describe("ProfileEditPage: дата рождения", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    localStorage.clear();
    meOverrides = {};
    authState.token = "test-token";
    authState.isLoading = false;
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

  it("очищенный рост не уходит числом 0 (CHECK 100..250 ронял сохранение в 500)", async () => {
    meOverrides = { height: 168 };
    await renderEditPage();

    fireEvent.change(screen.getByTestId("profile-height"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("save-profile"));

    await waitFor(() => {
      expect(putBody()).toBeTruthy();
    });
    expect(putBody().height).toBe("");
  });

  it("рост из БД попадает в инпут и уходит на сохранение", async () => {
    meOverrides = { height: 168 };
    await renderEditPage();

    await waitFor(() => {
      const input = screen.getByTestId("profile-height") as HTMLInputElement;
      expect(input.value).toBe("168");
    });

    fireEvent.click(screen.getByTestId("save-profile"));
    await waitFor(() => {
      expect(putBody()).toBeTruthy();
    });
    expect(putBody().height).toBe(168);
  });
});

describe("ProfileEditPage: фото", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    localStorage.clear();
    meOverrides = {};
    authState.token = "test-token";
    authState.isLoading = false;
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

describe("ProfileEditPage: потерянная сессия", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    localStorage.clear();
    meOverrides = {};
    authState.isLoading = false;
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => routeFetch(url, opts));
  });

  it("без токена уводит на /login, а не рисует редактируемую форму", async () => {
    localStorage.setItem("userProfile", JSON.stringify({ displayName: "Анна", age: 30, interests: [] }));
    authState.token = null;

    const Page = (await import("@/pages/profile-edit")).default;
    renderPage(<Page />);

    await waitFor(() => {
      expect(routerMock.replace).toHaveBeenCalledWith("/login");
    });
    // форма с полями не показывается: иначе правки уходят в никуда
    expect(screen.queryByTestId("profile-name")).toBeNull();
  });

  it("не показывает форму, пока сессия резолвится (чтобы не мигал кэш из localStorage)", async () => {
    authState.isLoading = true;
    authState.token = null;

    const Page = (await import("@/pages/profile-edit")).default;
    renderPage(<Page />);

    expect(screen.queryByTestId("profile-name")).toBeNull();
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it("при 401 от сервера чистит токен и уводит на /login, а не «ошибка сохранения»", async () => {
    authState.token = "test-token";
    // загрузка проходит, 401 прилетает на /me внутри handleSave
    let meCalls = 0;
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (String(url) === "/api/profile/me") {
        meCalls += 1;
        if (meCalls > 1) {
          return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({ error: "unauthorized" }) });
        }
      }
      return routeFetch(url, opts);
    });

    const Page = (await import("@/pages/profile-edit")).default;
    renderPage(<Page />);
    await waitFor(() => {
      expect((screen.getByTestId("profile-name") as HTMLInputElement).value).toBe(ME_DEFAULTS.display_name);
    });

    fireEvent.click(screen.getByTestId("save-profile"));

    await waitFor(() => {
      expect(clearTokenMock).toHaveBeenCalled();
      expect(routerMock.replace).toHaveBeenCalledWith("/login");
    });
  });
});

describe("ProfileEditPage: AI-био", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    localStorage.clear();
    meOverrides = {};
    authState.token = "test-token";
    authState.isLoading = false;
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => routeFetch(url, opts));
  });

  it("пустой ответ генератора не стирает био и не выдаёт успех", async () => {
    const { generateProfileBio } = await import("@/shims/ai-flows");
    (generateProfileBio as ReturnType<typeof vi.fn>).mockResolvedValue({ bio: "" });

    await renderEditPage();
    fireEvent.click(screen.getByText("profile.ai_improve"));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith({
        variant: "destructive",
        title: "toast.ai_error",
        description: "toast.ai_error_desc",
      }),
    );
    expect(toastMock).not.toHaveBeenCalledWith({
      title: "profile.ai_improve",
      description: "toast.bio_improved",
    });
    expect((screen.getByTestId("profile-bio") as HTMLTextAreaElement).value).toBe(ME_DEFAULTS.bio);
  });

  it("сгенерированный текст подставляется в поле и подтверждается тостом", async () => {
    const { generateProfileBio } = await import("@/shims/ai-flows");
    (generateProfileBio as ReturnType<typeof vi.fn>).mockResolvedValue({ bio: "Люблю кофе и музыку" });

    await renderEditPage();
    fireEvent.click(screen.getByText("profile.ai_improve"));

    await waitFor(() =>
      expect((screen.getByTestId("profile-bio") as HTMLTextAreaElement).value).toBe("Люблю кофе и музыку"),
    );
    expect(toastMock).toHaveBeenCalledWith({
      title: "profile.ai_improve",
      description: "toast.bio_improved",
    });
  });

  it("сбой генератора показывает ошибку, а не успех", async () => {
    const { generateProfileBio } = await import("@/shims/ai-flows");
    (generateProfileBio as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));

    await renderEditPage();
    fireEvent.click(screen.getByText("profile.ai_improve"));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith({
        variant: "destructive",
        title: "toast.ai_error",
        description: "toast.ai_error_desc",
      }),
    );
  });

  it("без интересов и био генератор не вызывается", async () => {
    const { generateProfileBio } = await import("@/shims/ai-flows");
    meOverrides = { interests: [], bio: "" };
    await renderEditPage();

    fireEvent.click(screen.getByText("profile.ai_improve"));

    expect(generateProfileBio).not.toHaveBeenCalled();
  });
});

function mockWithAliases(
  aliases: unknown,
  extra?: (url: string, opts?: { method?: string }) => Promise<unknown> | undefined,
) {
  mockFetch.mockImplementation((url: string, opts?: { method?: string }) => {
    const custom = extra?.(url, opts);
    if (custom) return custom;
    if (String(url) === "/api/profile/aliases" && !opts?.method) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(aliases) });
    }
    return routeFetch(url, opts);
  });
}

const ALIASES = [
  { id: 1, alias: "sun", is_primary: true },
  { id: 2, alias: "moon", is_primary: false },
];

describe("ProfileEditPage: псевдонимы", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    localStorage.clear();
    meOverrides = {};
    authState.token = "test-token";
    authState.isLoading = false;
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => routeFetch(url, opts));
  });

  it("загружает список и помечает основной псевдоним", async () => {
    mockWithAliases(ALIASES);
    await renderEditPage();

    await waitFor(() => expect(screen.getByTestId("alias-1")).toBeInTheDocument());
    expect(screen.getByTestId("alias-2")).toBeInTheDocument();
    expect(screen.getByTestId("alias-1").className).toContain("gradient-bg");
    expect(screen.getByTestId("alias-2").className).not.toContain("gradient-bg");
  });

  it("не-массив в ответе не заполняет список и не ломает страницу", async () => {
    mockWithAliases({ items: ALIASES });
    await renderEditPage();

    await waitFor(() => expect(screen.getByTestId("profile-name")).toBeInTheDocument());
    expect(screen.queryByTestId("alias-1")).toBeNull();
  });

  it("пустой ввод не отправляет POST", async () => {
    mockWithAliases([]);
    await renderEditPage();

    fireEvent.change(screen.getByTestId("new-alias-input"), { target: { value: "   " } });
    fireEvent.click(screen.getByTestId("add-alias-button"));

    const post = mockFetch.mock.calls.find(([, opts]) => (opts as { method?: string })?.method === "POST");
    expect(post).toBeUndefined();
  });

  it("пробелы по Enter не отправляют POST", async () => {
    mockWithAliases([]);
    await renderEditPage();

    const input = screen.getByTestId("new-alias-input");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });

    const post = mockFetch.mock.calls.find(([, opts]) => (opts as { method?: string })?.method === "POST");
    expect(post).toBeUndefined();
  });

  it("добавляет псевдоним, очищает поле и подтверждает тостом", async () => {
    mockWithAliases([], (url, opts) => {
      if (String(url) === "/api/profile/aliases" && opts?.method === "POST") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 3, alias: "star", is_primary: false }) });
      }
      return undefined;
    });
    await renderEditPage();

    fireEvent.change(screen.getByTestId("new-alias-input"), { target: { value: "  star  " } });
    fireEvent.click(screen.getByTestId("add-alias-button"));

    await waitFor(() => expect(screen.getByTestId("alias-3")).toBeInTheDocument());
    const post = mockFetch.mock.calls.find(([, opts]) => (opts as { method?: string })?.method === "POST")!;
    expect(JSON.parse((post[1] as { body: string }).body)).toEqual({ alias: "star" });
    expect((screen.getByTestId("new-alias-input") as HTMLInputElement).value).toBe("");
    expect(toastMock).toHaveBeenCalledWith({ title: "profile.alias_added" });
  });

  it("Enter в поле добавляет псевдоним", async () => {
    mockWithAliases([], (url, opts) => {
      if (String(url) === "/api/profile/aliases" && opts?.method === "POST") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 4, alias: "comet", is_primary: false }) });
      }
      return undefined;
    });
    await renderEditPage();

    const input = screen.getByTestId("new-alias-input");
    fireEvent.change(input, { target: { value: "comet" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(screen.getByTestId("alias-4")).toBeInTheDocument());
  });

  it("отказ сервера не показывает сырой английский message", async () => {
    mockWithAliases([], (url, opts) => {
      if (String(url) === "/api/profile/aliases" && opts?.method === "POST") {
        return Promise.resolve({
          ok: false,
          status: 400,
          json: () => Promise.resolve({ message: "Maximum 5 aliases allowed" }),
        });
      }
      return undefined;
    });
    await renderEditPage();

    fireEvent.change(screen.getByTestId("new-alias-input"), { target: { value: "star" } });
    fireEvent.click(screen.getByTestId("add-alias-button"));

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith({ title: "profile.alias_error", variant: "destructive" }));
    expect(toastMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Maximum 5 aliases allowed" }),
    );
  });

  it("сетевой сбой при добавлении показывает ошибку", async () => {
    mockWithAliases([], (url, opts) => {
      if (String(url) === "/api/profile/aliases" && opts?.method === "POST") {
        return Promise.reject(new Error("network"));
      }
      return undefined;
    });
    await renderEditPage();

    fireEvent.change(screen.getByTestId("new-alias-input"), { target: { value: "star" } });
    fireEvent.click(screen.getByTestId("add-alias-button"));

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith({ title: "profile.alias_error", variant: "destructive" }));
  });

  it("удаление убирает бейдж и не делает псевдоним основным", async () => {
    mockWithAliases(ALIASES);
    await renderEditPage();
    await waitFor(() => expect(screen.getByTestId("alias-2")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("delete-alias-2"));

    await waitFor(() => expect(screen.queryByTestId("alias-2")).toBeNull());
    expect(mockFetch.mock.calls.some(([url]) => String(url) === "/api/profile/aliases/2/primary")).toBe(false);
    expect(toastMock).toHaveBeenCalledWith({ title: "profile.alias_deleted" });
  });

  it("отказ удаления оставляет бейдж и сообщает об ошибке", async () => {
    mockWithAliases(ALIASES, (url, opts) => {
      if (String(url) === "/api/profile/aliases/2" && opts?.method === "DELETE") {
        return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
      }
      return undefined;
    });
    await renderEditPage();
    await waitFor(() => expect(screen.getByTestId("alias-2")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("delete-alias-2"));

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith({ title: "profile.alias_error", variant: "destructive" }));
    expect(screen.getByTestId("alias-2")).toBeInTheDocument();
    expect(toastMock).not.toHaveBeenCalledWith({ title: "profile.alias_deleted" });
  });

  it("клик по бейджу делает псевдоним основным", async () => {
    mockWithAliases(ALIASES);
    await renderEditPage();
    await waitFor(() => expect(screen.getByTestId("alias-2")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("alias-2"));

    await waitFor(() => expect(screen.getByTestId("alias-2").className).toContain("gradient-bg"));
    expect(screen.getByTestId("alias-1").className).not.toContain("gradient-bg");
    expect(
      mockFetch.mock.calls.some(([url, opts]) => String(url) === "/api/profile/aliases/2/primary" && (opts as { method?: string })?.method === "PUT"),
    ).toBe(true);
  });

  it("отказ primary не меняет подсветку", async () => {
    mockWithAliases(ALIASES, (url, opts) => {
      if (String(url) === "/api/profile/aliases/2/primary" && opts?.method === "PUT") {
        return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
      }
      return undefined;
    });
    await renderEditPage();
    await waitFor(() => expect(screen.getByTestId("alias-2")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("alias-2"));

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith({ title: "profile.alias_error", variant: "destructive" }));
    expect(screen.getByTestId("alias-1").className).toContain("gradient-bg");
    expect(screen.getByTestId("alias-2").className).not.toContain("gradient-bg");
  });

  it("при пяти псевдонимах формы добавления нет", async () => {
    mockWithAliases([1, 2, 3, 4, 5].map((id) => ({ id, alias: `a${id}`, is_primary: id === 1 })));
    await renderEditPage();

    await waitFor(() => expect(screen.getByTestId("alias-5")).toBeInTheDocument());
    expect(screen.queryByTestId("new-alias-input")).toBeNull();
  });

  it("без токена не грузит и не добавляет псевдонимы", async () => {
    tokenState.value = null;
    mockWithAliases([]);
    await renderEditPage();

    expect(
      mockFetch.mock.calls.some(([url]) => String(url) === "/api/profile/aliases"),
    ).toBe(false);

    fireEvent.change(screen.getByTestId("new-alias-input"), { target: { value: "star" } });
    fireEvent.click(screen.getByTestId("add-alias-button"));
    expect(mockFetch.mock.calls.some(([, opts]) => (opts as { method?: string })?.method === "POST")).toBe(false);
  });
});

describe("ProfileEditPage: интересы", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    localStorage.clear();
    meOverrides = {};
    authState.token = "test-token";
    authState.isLoading = false;
    mockContentConfig.interests = ["interest.sport", "interest.music"];
    mockContentConfig.dating_goals = ["goal.serious_relationship"];
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => routeFetch(url, opts));
  });

  it("клик добавляет и убирает интерес, id уходят в PUT", async () => {
    await renderEditPage();

    fireEvent.click(screen.getByText("music"));
    fireEvent.click(screen.getByTestId("save-profile"));
    await waitFor(() => expect(putBody()).toBeTruthy());
    expect(putBody().interests).toEqual([1, 2]);

    fireEvent.click(screen.getByText("music"));
    fireEvent.click(screen.getByTestId("save-profile"));
    await waitFor(() => {
      const calls = mockFetch.mock.calls.filter(([, opts]) => (opts as { method?: string })?.method === "PUT");
      expect(calls.length).toBe(2);
    });
    expect(putBody().interests).toEqual([1]);
  });

  it("banned-слово нельзя добавить кликом", async () => {
    mockContentConfig.interests = ["interest.sport", "Хуй"];
    await renderEditPage();

    fireEvent.click(screen.getByText("Хуй"));
    fireEvent.click(screen.getByTestId("save-profile"));

    await waitFor(() => expect(putBody()).toBeTruthy());
    expect(putBody().interests).toEqual([1]);
  });

  it("ключи вне словаря переводов показываются без префикса", async () => {
    mockContentConfig.interests = ["interest.sport", "goal.friendship", "custom_thing"];
    await renderEditPage();

    expect(screen.getByText("friendship")).toBeInTheDocument();
    expect(screen.getByText("custom_thing")).toBeInTheDocument();
  });
});

describe("ProfileEditPage: оценка профиля", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    localStorage.clear();
    localStorage.setItem("userProfileGallery", "[]");
    meOverrides = {};
    authState.token = "test-token";
    authState.isLoading = false;
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => routeFetch(url, opts));
  });

  it("низкая оценка при пустом профиле", async () => {
    meOverrides = { bio: "", city: "", zodiac: "", dating_goal: "", height: null, interests: [] };
    await renderEditPage();

    expect(screen.getByText("15%")).toBeInTheDocument();
    expect(screen.getByText("profile.score_low")).toBeInTheDocument();
  });

  it("средняя оценка для базового профиля", async () => {
    await renderEditPage();

    expect(screen.getByText("48%")).toBeInTheDocument();
    expect(screen.getByText("profile.score_medium")).toBeInTheDocument();
  });

  it("высокая оценка для заполненного профиля", async () => {
    meOverrides = {
      bio: "а".repeat(150),
      attachment_style: "secure",
      photos: [{ id: 1, url: "/uploads/a.jpg" }, { id: 2, url: "/uploads/b.jpg" }],
      interests: [{ id: 1, name_ru: "Спорт" }, { id: 2, name_ru: "Музыка" }],
    };
    await renderEditPage();

    expect(screen.getByText("76%")).toBeInTheDocument();
    expect(screen.getByText("profile.score_high")).toBeInTheDocument();
  });

  it("идеальная оценка упирается в 100 и не выше", async () => {
    meOverrides = {
      bio: "а".repeat(300),
      attachment_style: "secure",
      photos: [{ id: 1, url: "/uploads/a.jpg" }, { id: 2, url: "/uploads/b.jpg" }, { id: 3, url: "/uploads/c.jpg" }],
      interests: [{ id: 1, name_ru: "Спорт" }, { id: 2, name_ru: "Музыка" }, { id: 3, name_ru: "Кино" }, { id: 4, name_ru: "Книги" }, { id: 5, name_ru: "Путешествия" }],
    };
    await renderEditPage();

    expect(screen.getByText("95%")).toBeInTheDocument();
    expect(screen.getByText("profile.score_perfect")).toBeInTheDocument();
  });
});

describe("ProfileEditPage: пол и кого ищем", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    localStorage.clear();
    meOverrides = {};
    authState.token = "test-token";
    authState.isLoading = false;
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => routeFetch(url, opts));
  });

  it("смена пола не перетирает явный выбор «ищу женщин»", async () => {
    meOverrides = { gender: "male", looking_for: "female" };
    await renderEditPage();

    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "female" } });
    fireEvent.click(screen.getByTestId("save-profile"));

    await waitFor(() => expect(putBody()).toBeTruthy());
    expect(putBody().gender).toBe("female");
    expect(putBody().looking_for).toBe("female");
  });

  it("«ищу всех» уходит в PUT как everyone", async () => {
    await renderEditPage();

    fireEvent.change(screen.getAllByRole("combobox")[3], { target: { value: "everyone" } });
    fireEvent.click(screen.getByTestId("save-profile"));

    await waitFor(() => expect(putBody()).toBeTruthy());
    expect(putBody().looking_for).toBe("everyone");
  });
});

describe("ProfileEditPage: сохранение и отказы", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    localStorage.clear();
    meOverrides = {};
    authState.token = "test-token";
    authState.isLoading = false;
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => routeFetch(url, opts));
  });

  it("без фото сохранение блокируется и PUT не уходит", async () => {
    localStorage.setItem("userProfileGallery", "[]");
    await renderEditPage();

    fireEvent.click(screen.getByTestId("save-profile"));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith({
        title: "toast.save_error",
        description: "toast.save_error_desc",
        variant: "destructive",
      }),
    );
    expect(mockFetch.mock.calls.some(([, opts]) => (opts as { method?: string })?.method === "PUT")).toBe(false);
  });

  it("только временные blob-фото не сохраняются", async () => {
    localStorage.setItem("userProfileGallery", JSON.stringify(["blob:local-1"]));
    await renderEditPage();

    fireEvent.click(screen.getByTestId("save-profile"));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith({
        title: "toast.save_error",
        description: "toast.save_error_desc",
        variant: "destructive",
      }),
    );
    expect(mockFetch.mock.calls.some(([, opts]) => (opts as { method?: string })?.method === "PUT")).toBe(false);
  });

  it("500 на /me при сохранении — ошибка без PUT", async () => {
    let meCalls = 0;
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (String(url) === "/api/profile/me") {
        meCalls += 1;
        if (meCalls > 1) return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
      }
      return routeFetch(url, opts);
    });
    await renderEditPage();

    fireEvent.click(screen.getByTestId("save-profile"));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith({
        title: "toast.save_error",
        description: "toast.save_error_desc",
        variant: "destructive",
      }),
    );
    expect(mockFetch.mock.calls.some(([, opts]) => (opts as { method?: string })?.method === "PUT")).toBe(false);
  });

  it("400 на PUT не показывает сырой английский message", async () => {
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (String(url).startsWith("/api/profile/") && opts?.method === "PUT") {
        return Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ message: "Invalid height" }) });
      }
      return routeFetch(url, opts);
    });
    await renderEditPage();

    fireEvent.click(screen.getByTestId("save-profile"));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith({
        title: "toast.save_error",
        description: "toast.save_error_desc",
        variant: "destructive",
      }),
    );
    expect(toastMock).not.toHaveBeenCalledWith(expect.objectContaining({ description: "Invalid height" }));
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it("401 на PUT чистит токен и уводит на /login", async () => {
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (String(url).startsWith("/api/profile/") && opts?.method === "PUT") {
        return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) });
      }
      return routeFetch(url, opts);
    });
    await renderEditPage();

    fireEvent.click(screen.getByTestId("save-profile"));

    await waitFor(() => expect(clearTokenMock).toHaveBeenCalled());
    expect(routerMock.replace).toHaveBeenCalledWith("/login");
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it("успешное сохранение ведёт на /profile и подтверждает тостом", async () => {
    await renderEditPage();

    fireEvent.click(screen.getByTestId("save-profile"));

    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/profile"));
    expect(toastMock).toHaveBeenCalledWith({
      title: "toast.profile_saved",
      description: "toast.profile_saved_desc",
    });
  });

  it("возраст считается из даты рождения", async () => {
    meOverrides = { age: 0, birth_date: "2000-05-05" };
    await renderEditPage();

    fireEvent.click(screen.getByTestId("save-profile"));
    await waitFor(() => expect(putBody()).toBeTruthy());

    const bd = new Date("2000-05-05");
    const today = new Date();
    let expected = today.getFullYear() - bd.getFullYear();
    const m = today.getMonth() - bd.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < bd.getDate())) expected -= 1;
    expect(putBody().birth_date).toBe("2000-05-05");
    expect(putBody().age).toBe(Math.max(18, expected));
  });

  it("слишком юная дата даёт минимум 18 лет", async () => {
    const today = new Date();
    const future = `${today.getFullYear()}-01-01`;
    meOverrides = { age: 30, birth_date: future };
    await renderEditPage();

    fireEvent.click(screen.getByTestId("save-profile"));
    await waitFor(() => expect(putBody()).toBeTruthy());

    expect(putBody().age).toBe(18);
  });

  it("невалидная дата не уходит строкой в API", async () => {
    meOverrides = { age: 33, birth_date: "not-a-date" };
    await renderEditPage();

    fireEvent.click(screen.getByTestId("save-profile"));
    await waitFor(() => expect(putBody()).toBeTruthy());

    expect(putBody().birth_date).toBe(null);
    expect(putBody().age).toBe(33);
  });

  it("кнопка верификации открывает диалог", async () => {
    await renderEditPage();

    expect(screen.queryByTestId("verification-dialog")).toBeNull();
    fireEvent.click(screen.getByTestId("verify-profile"));
    expect(screen.getByTestId("verification-dialog")).toBeInTheDocument();
  });

  it("закрытие диалога верификации прячет его", async () => {
    await renderEditPage();

    fireEvent.click(screen.getByTestId("verify-profile"));
    fireEvent.click(screen.getByTestId("verification-close"));

    expect(screen.queryByTestId("verification-dialog")).toBeNull();
  });

  it("истёкшая сессия при сохранении: без PUT, чистит токен и уводит на /login", async () => {
    await renderEditPage();
    tokenState.value = null;

    fireEvent.click(screen.getByTestId("save-profile"));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith({
        title: "toast.session_expired",
        description: "toast.session_expired_desc",
        variant: "destructive",
      }),
    );
    expect(clearTokenMock).toHaveBeenCalled();
    expect(routerMock.replace).toHaveBeenCalledWith("/login");
    expect(mockFetch.mock.calls.some(([, opts]) => (opts as { method?: string })?.method === "PUT")).toBe(false);
  });

  it("правки всех полей формы уходят в PUT", async () => {
    mockContentConfig.dating_goals = ["goal.serious_relationship", "goal.friendship"];
    await renderEditPage();

    fireEvent.change(screen.getByTestId("profile-name"), { target: { value: "Ольга" } });
    fireEvent.change(screen.getByTestId("profile-bio"), { target: { value: "Люблю горы" } });
    fireEvent.change(screen.getByTestId("profile-birth-date"), { target: { value: "1995-03-04" } });
    fireEvent.change(screen.getByTestId("profile-height"), { target: { value: "175" } });
    fireEvent.change(screen.getByDisplayValue("Москва"), { target: { value: "Казань" } });
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "common.zodiac.aries" } });
    fireEvent.change(screen.getAllByRole("combobox")[2], { target: { value: "goal.friendship" } });

    fireEvent.click(screen.getByTestId("save-profile"));
    await waitFor(() => expect(putBody()).toBeTruthy());

    const body = putBody();
    expect(body.display_name).toBe("Ольга");
    expect(body.name).toBe("Ольга");
    expect(body.bio).toBe("Люблю горы");
    expect(body.birth_date).toBe("1995-03-04");
    expect(body.height).toBe("175");
    expect(body.city).toBe("Казань");
    expect(body.zodiac).toBe("common.zodiac.aries");
    expect(body.dating_goal).toBe("goal.friendship");
  });
});

describe("ProfileEditPage: фото — отказы и границы", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    localStorage.clear();
    meOverrides = {};
    authState.token = "test-token";
    authState.isLoading = false;
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => routeFetch(url, opts));
  });

  it("последнее фото удалить нельзя", async () => {
    localStorage.setItem("userProfileGallery", JSON.stringify(["/uploads/only.jpg"]));
    await renderEditPage();

    fireEvent.click(screen.getByTestId("profile-photo-remove-0"));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith({
        title: "toast.cannot_delete",
        description: "toast.cannot_delete_desc",
        variant: "destructive",
      }),
    );
    expect(screen.getAllByAltText(/^Photo /).length).toBe(1);
  });

  it("отказ сервера при удалении оставляет фото", async () => {
    meOverrides = {
      photos: [
        { id: 11, url: "/uploads/a.jpg", sort_order: 0, is_avatar: 0 },
        { id: 12, url: "/uploads/b.jpg", sort_order: 1, is_avatar: 0 },
      ],
    };
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (String(url).startsWith("/api/photos/") && opts?.method === "DELETE") {
        return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
      }
      return routeFetch(url, opts);
    });
    await renderEditPage();
    await waitFor(() => expect(photoSrc(0)).toBe("/uploads/a.jpg"));

    fireEvent.click(screen.getByTestId("profile-photo-remove-0"));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith({
        title: "toast.save_error",
        description: "toast.save_error_desc",
        variant: "destructive",
      }),
    );
    expect(photoSrc(0)).toBe("/uploads/a.jpg");
  });

  it("404 при удалении считается успехом: фото уже нет на сервере", async () => {
    meOverrides = {
      photos: [
        { id: 11, url: "/uploads/a.jpg", sort_order: 0, is_avatar: 0 },
        { id: 12, url: "/uploads/b.jpg", sort_order: 1, is_avatar: 0 },
      ],
    };
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (String(url).startsWith("/api/photos/") && opts?.method === "DELETE") {
        return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
      }
      return routeFetch(url, opts);
    });
    await renderEditPage();
    await waitFor(() => expect(photoSrc(0)).toBe("/uploads/a.jpg"));

    fireEvent.click(screen.getByTestId("profile-photo-remove-0"));

    await waitFor(() => expect(photoSrc(0)).toBe("/uploads/b.jpg"));
  });

  it("временное blob-фото освобождает URL без запроса к серверу", async () => {
    localStorage.setItem("userProfileGallery", JSON.stringify(["blob:local-1", "/uploads/a.jpg"]));
    const revoke = vi.fn();
    const originalRevoke = URL.revokeObjectURL;
    URL.revokeObjectURL = revoke;
    await renderEditPage();

    fireEvent.click(screen.getByTestId("profile-photo-remove-0"));

    await waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:local-1"));
    expect(mockFetch.mock.calls.some(([, opts]) => (opts as { method?: string })?.method === "DELETE")).toBe(false);
    URL.revokeObjectURL = originalRevoke;
  });

  it("несколько файлов уходят с растущим sort_order", async () => {
    meOverrides = { photos: [{ id: 11, url: "/uploads/a.jpg", sort_order: 0, is_avatar: 0 }] };
    await renderEditPage();

    const input = document.getElementById("photo-upload") as HTMLInputElement;
    const files = [
      new File([new Uint8Array([1])], "one.jpg", { type: "image/jpeg" }),
      new File([new Uint8Array([2])], "two.jpg", { type: "image/jpeg" }),
    ];
    Object.defineProperty(input, "files", { value: files, configurable: true });
    fireEvent.change(input);

    await waitFor(() => expect(screen.getAllByAltText(/^Photo /).length).toBe(3));
    const uploads = mockFetch.mock.calls.filter(([url]) => String(url) === "/api/upload");
    expect(uploads.length).toBe(2);
    expect((uploads[0][1] as { body: FormData }).body.get("sort_order")).toBe("1");
    expect((uploads[1][1] as { body: FormData }).body.get("sort_order")).toBe("2");
  });

  it("отказ загрузки показывает ошибку и не добавляет фото", async () => {
    meOverrides = { photos: [{ id: 11, url: "/uploads/a.jpg", sort_order: 0, is_avatar: 0 }] };
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (String(url) === "/api/upload") {
        return Promise.resolve({ ok: false, status: 413, json: () => Promise.resolve({}) });
      }
      return routeFetch(url, opts);
    });
    await renderEditPage();

    const input = document.getElementById("photo-upload") as HTMLInputElement;
    Object.defineProperty(input, "files", {
      value: [new File([new Uint8Array([1])], "big.jpg", { type: "image/jpeg" })],
      configurable: true,
    });
    fireEvent.change(input);

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith({
        title: "toast.save_error",
        description: "toast.save_error_desc",
        variant: "destructive",
      }),
    );
    expect(screen.getAllByAltText(/^Photo /).length).toBe(1);
  });

  it("пустой выбор файлов не отправляет запрос", async () => {
    await renderEditPage();

    const input = document.getElementById("photo-upload") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [], configurable: true });
    fireEvent.change(input);

    expect(mockFetch.mock.calls.some(([url]) => String(url) === "/api/upload")).toBe(false);
  });
});

describe("ProfileEditPage: загрузка без API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    localStorage.clear();
    meOverrides = {};
    authState.token = "test-token";
    authState.isLoading = false;
    mockContentConfig.interests = ["interest.sport", "interest.music"];
    mockContentConfig.dating_goals = ["goal.serious_relationship"];
  });

  function failMe() {
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (String(url) === "/api/profile/me") {
        return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) });
      }
      return routeFetch(url, opts);
    });
  }

  it("профиль из localStorage: banned-интересы вычищаются, имя сохраняется", async () => {
    failMe();
    localStorage.setItem(
      "userProfile",
      JSON.stringify({ displayName: "Анна", age: 29, interests: ["interest.sport", "Хуй"], photos: ["/uploads/x.jpg"] }),
    );

    await renderEditPage("Анна");

    expect((screen.getByTestId("profile-name") as HTMLInputElement).value).toBe("Анна");
    expect(screen.getByText("sport")).toBeInTheDocument();
    expect(screen.queryByText("Хуй")).toBeNull();
  });

  it("битый JSON профиля даёт демо-профиль, а не пустую форму", async () => {
    failMe();
    localStorage.setItem("userProfile", "{broken");

    await renderEditPage("profile.demo_name");
  });

  it("битый JSON галереи откатывается на фото профиля", async () => {
    failMe();
    localStorage.setItem("userProfile", JSON.stringify({ displayName: "Анна", photos: ["/uploads/a.jpg", "/uploads/b.jpg"] }));
    localStorage.setItem("userProfileGallery", "{broken");

    await renderEditPage("Анна");

    await waitFor(() => expect(screen.getAllByAltText(/^Photo /).length).toBe(2));
  });

  it("без сохранённого профиля рисуется демо-профиль", async () => {
    failMe();

    await renderEditPage("profile.demo_name");
  });
});
