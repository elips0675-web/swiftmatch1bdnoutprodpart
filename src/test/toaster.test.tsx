import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Toaster } from "@/components/ui/toaster";

const state = vi.hoisted(() => ({ toasts: [] as Record<string, unknown>[] }));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toasts: state.toasts, toast: vi.fn(), dismiss: vi.fn() }),
}));

describe("Toaster", () => {
  beforeEach(() => {
    state.toasts = [];
  });

  it("рисует пустой вьюпорт, когда уведомлений нет", () => {
    const { container } = render(<Toaster />);

    expect(container.querySelectorAll("li")).toHaveLength(0);
    expect(container.querySelector("ol")).not.toBeNull();
  });

  it("показывает заголовок и описание уведомления", () => {
    state.toasts = [{ id: "1", title: "Заголовок", description: "Описание" }];

    render(<Toaster />);

    expect(screen.getByText("Заголовок")).toBeInTheDocument();
    expect(screen.getByText("Описание")).toBeInTheDocument();
  });

  it("не рисует пустые заголовок и описание", () => {
    state.toasts = [{ id: "1", title: "", description: "", open: true }];

    const { container } = render(<Toaster />);

    expect(container.querySelectorAll("li")).toHaveLength(1);
    expect(container.querySelector(".font-semibold")).toBeNull();
    expect(container.querySelector(".opacity-90")).toBeNull();
  });

  it("показывает уведомление только с описанием", () => {
    state.toasts = [{ id: "1", description: "Только описание" }];

    render(<Toaster />);

    expect(screen.getByText("Только описание")).toBeInTheDocument();
    expect(screen.queryByText("Заголовок")).toBeNull();
  });

  it("рисует действие и кнопку закрытия в каждом уведомлении", () => {
    state.toasts = [
      { id: "1", title: "Ошибка", action: <button type="button">Повторить</button> },
      { id: "2", title: "Вторая" },
    ];

    const { container } = render(<Toaster />);

    expect(screen.getByRole("button", { name: "Повторить" })).toBeInTheDocument();
    expect(container.querySelectorAll("[toast-close]")).toHaveLength(2);
  });

  it("прокидывает вариант и остальные пропсы в корень уведомления", () => {
    state.toasts = [{ id: "1", title: "Сбой", variant: "destructive" }];

    const { container } = render(<Toaster />);

    const root = container.querySelector("li");
    expect(root).not.toBeNull();
    expect(root?.className).toContain("destructive");
    expect(root?.className).toContain("border-destructive");
  });

  it("не передаёт собственные поля уведомления в разметку", () => {
    state.toasts = [{ id: "1", title: "Текст", description: "Детали" }];

    const { container } = render(<Toaster />);

    const root = container.querySelector("li");
    expect(root).not.toBeNull();
    expect(root?.hasAttribute("title")).toBe(false);
    expect(root?.hasAttribute("description")).toBe(false);
  });
});
