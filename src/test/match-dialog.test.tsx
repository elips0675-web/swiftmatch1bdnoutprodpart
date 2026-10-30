import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

const h = vi.hoisted(() => ({
  pushMock: vi.fn(),
}));

vi.mock("@/shims/next-navigation", () => ({
  useRouter: () => ({ push: h.pushMock, replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("@/components/animations/heart-confetti", () => ({
  HeartConfetti: () => <div data-testid="heart-confetti" />,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    open,
    onOpenChange,
    children,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children?: React.ReactNode;
  }) => (
    <div data-testid="dialog" data-open={String(open)}>
      {children}
      <button data-testid="dialog-request-close" onClick={() => onOpenChange?.(false)}>
        close
      </button>
    </div>
  ),
  DialogContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

const TRANSLATIONS: Record<string, string> = {
  "match.title": "Это совпадение!",
  "match.you_and": "Вы и",
  "match.liked_each_other": "понравились друг другу.",
  "button.write_first": "Написать первым",
  "button.continue": "Продолжить",
  "chats.you": "Вы",
  "chats.unknown_user": "Пользователь",
};

vi.mock("@/context/language-context", () => ({
  useLanguage: () => ({ t: (key: string) => TRANSLATIONS[key] ?? key, language: "RU", setLanguage: vi.fn() }),
}));

import { MatchDialog } from "@/components/dialogs/match-dialog";

const tr = (key: string) => TRANSLATIONS[key] ?? key;

const MATCH = { id: 42, name: "Анна", img: "/demo/people/anna.png" };

function renderDialog(props: Partial<React.ComponentProps<typeof MatchDialog>> = {}) {
  const onOpenChange = props.onOpenChange ?? vi.fn();
  const view = render(
    <MatchDialog
      open={props.open ?? true}
      onOpenChange={onOpenChange}
      currentUser={props.currentUser === undefined ? { photoURL: "/me.png" } : props.currentUser}
      matchUser={props.matchUser === undefined ? MATCH : props.matchUser}
    />,
  );
  return { ...view, onOpenChange };
}

function images() {
  return Array.from(document.querySelectorAll("img"));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Диалог совпадения: содержимое", () => {
  it("без пользователя не рисует ничего", () => {
    renderDialog({ matchUser: null });

    expect(screen.queryByTestId("dialog")).toBeNull();
    expect(document.body.textContent).toBe("");
  });

  it("показывает заголовок, имена и обе кнопки", () => {
    renderDialog();

    expect(screen.getByText(tr("match.title"))).toBeTruthy();
    expect(screen.getByTestId("dialog").textContent).toContain(
      `${tr("match.you_and")} Анна ${tr("match.liked_each_other")}`,
    );
    expect(screen.getByText(tr("button.write_first"))).toBeTruthy();
    expect(screen.getByText(tr("button.continue"))).toBeTruthy();
  });

  it("фото текущего пользователя берётся из photoURL", () => {
    renderDialog({ currentUser: { photoURL: "/photo.png", img: "/img.png" } });

    expect(images()[0].getAttribute("src")).toBe("/photo.png");
    expect(images()[0].getAttribute("alt")).toBe(tr("chats.you"));
  });

  it("без photoURL фото берётся из img", () => {
    renderDialog({ currentUser: { photoURL: "", img: "/img.png" } });

    expect(images()[0].getAttribute("src")).toBe("/img.png");
  });

  it("без фото у текущего пользователя подставляется нейтральная заглушка, а не чужое демо-фото", () => {
    renderDialog({ currentUser: { name: "Я" } });

    expect(images()[0].getAttribute("src")).toBe("/default-avatar.svg");
  });

  it("без сессии текущий пользователь получает заглушку", () => {
    renderDialog({ currentUser: null });

    expect(images()[0].getAttribute("src")).toBe("/default-avatar.svg");
  });

  it("фото совпадения и его имя идут в разметку", () => {
    renderDialog();

    expect(images()[1].getAttribute("src")).toBe("/demo/people/anna.png");
    expect(images()[1].getAttribute("alt")).toBe("Анна");
  });

  it("совпадение без фото получает заглушку, а не лицо постороннего демо-пользователя", () => {
    renderDialog({ matchUser: { id: 42, name: "Анна" } });

    expect(images()[1].getAttribute("src")).toBe("/default-avatar.svg");
    expect(images()[1].getAttribute("alt")).toBe("Анна");
  });

  it("совпадение без имени не оставляет пустое место в фразе", () => {
    renderDialog({ matchUser: { id: 42 } });

    expect(screen.getByText(tr("chats.unknown_user"))).toBeTruthy();
    expect(images()[1].getAttribute("alt")).toBe(tr("chats.unknown_user"));
    expect(document.body.textContent).not.toContain("undefined");
    expect(document.body.textContent).not.toContain("null");
  });

  it("имя совпадения подставляется один раз, без дублей", () => {
    renderDialog();

    expect(screen.getAllByText("Анна")).toHaveLength(1);
  });
});

describe("Диалог совпадения: действия", () => {
  it("«Написать первым» ведёт в чат с этим совпадением", () => {
    renderDialog();

    fireEvent.click(screen.getByText(tr("button.write_first")));

    expect(h.pushMock).toHaveBeenCalledWith("/chats?matchId=42");
    expect(h.pushMock).toHaveBeenCalledTimes(1);
  });

  it("без id кнопка «Написать первым» заблокирована и никуда не ведёт", () => {
    renderDialog({ matchUser: { name: "Анна" } });

    const button = screen.getByText(tr("button.write_first")).closest("button") as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    fireEvent.click(button);
    expect(h.pushMock).not.toHaveBeenCalled();
  });

  it("«Продолжить» закрывает диалог", () => {
    const { onOpenChange } = renderDialog();

    fireEvent.click(screen.getByText(tr("button.continue")));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("закрытие из диалога уходит наружу", () => {
    const { onOpenChange } = renderDialog();

    fireEvent.click(screen.getByTestId("dialog-request-close"));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("открытое состояние передаётся в диалог", () => {
    renderDialog({ open: true });

    expect(screen.getByTestId("dialog").getAttribute("data-open")).toBe("true");
  });

  it("закрытое состояние тоже передаётся, конфетти при этом не рисуются", async () => {
    renderDialog({ open: false });

    expect(screen.getByTestId("dialog").getAttribute("data-open")).toBe("false");
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("heart-confetti")).toBeNull();
  });

  it("при открытии рисует конфетти", async () => {
    renderDialog({ open: true });

    expect(await screen.findByTestId("heart-confetti")).toBeTruthy();
  });
});
