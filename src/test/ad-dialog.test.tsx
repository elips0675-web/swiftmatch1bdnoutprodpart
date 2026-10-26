import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import React from "react";

const h = vi.hoisted(() => ({
  toastMock: vi.fn(),
  showAdMock: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({ toast: h.toastMock }));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open?: boolean; children?: React.ReactNode }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@capacitor-community/admob", () => ({
  AdMob: { showRewardVideoAd: h.showAdMock },
}));

const TRANSLATIONS: Record<string, string> = {
  "ad.profile_unlocked": "Профиль разблокирован",
  "ad.unlock_description": "Посмотрите рекламу чтобы разблокировать",
  "activity.unlock_title": "Бонус",
  "activity.unlock_desc": "Посмотрите рекламу, чтобы открыть анкету бесплатно на 24 часа.",
  "button.watch": "Смотреть",
  "button.not_now": "Не сейчас",
  "common.loading": "Загрузка...",
};

vi.mock("@/context/language-context", () => ({
  useLanguage: () => ({ t: (key: string) => TRANSLATIONS[key] ?? key, language: "RU", setLanguage: vi.fn() }),
}));

import { AdDialog } from "@/components/dialogs/ad-dialog";

const tr = (key: string) => TRANSLATIONS[key] ?? key;

function setNative(native: boolean | "throws") {
  (window as any).Capacitor = {
    isNativePlatform: () => {
      if (native === "throws") throw new Error("no bridge");
      return native;
    },
  };
}

function clearNative() {
  delete (window as any).Capacitor;
}

function renderDialog(props: { open?: boolean; onOpenChange?: (v: boolean) => void } = {}) {
  const onOpenChange = props.onOpenChange ?? vi.fn();
  const view = render(<AdDialog open={props.open ?? true} onOpenChange={onOpenChange} />);
  return { ...view, onOpenChange };
}

async function clickWatch() {
  fireEvent.click(screen.getByText(tr("button.watch")));
  await act(async () => {
    await Promise.resolve();
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  clearNative();
  h.showAdMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  clearNative();
});

describe("Диалог рекламы: показ и награда", () => {
  it("показывает заголовок, описание и две кнопки", () => {
    renderDialog();

    expect(screen.getByText(tr("activity.unlock_title"))).toBeTruthy();
    expect(screen.getByText(tr("activity.unlock_desc"))).toBeTruthy();
    expect(screen.getByText(tr("button.watch"))).toBeTruthy();
    expect(screen.getByText(tr("button.not_now"))).toBeTruthy();
  });

  it("на вебе ждёт три секунды, показывает загрузку и только потом начисляет награду", async () => {
    vi.useFakeTimers();
    const { onOpenChange } = renderDialog();

    await clickWatch();

    const button = screen.getByText(tr("common.loading")).closest("button")!;
    expect(button.disabled).toBe(true);
    expect(h.toastMock).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();

    await advance(2999);
    expect(h.toastMock).not.toHaveBeenCalled();

    await advance(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(h.toastMock).toHaveBeenCalledWith({
      title: tr("ad.profile_unlocked"),
      description: tr("ad.unlock_description"),
    });
  });

  it("«Не сейчас» закрывает диалог без награды и без показа", async () => {
    const { onOpenChange } = renderDialog();

    fireEvent.click(screen.getByText(tr("button.not_now")));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(h.toastMock).not.toHaveBeenCalled();
    expect(h.showAdMock).not.toHaveBeenCalled();
  });

  it("закрытие во время показа не начисляет награду", async () => {
    vi.useFakeTimers();
    const { rerender, onOpenChange } = renderDialog();

    await clickWatch();
    rerender(<AdDialog open={false} onOpenChange={onOpenChange} />);
    await advance(5000);

    expect(h.toastMock).not.toHaveBeenCalled();
  });

  it("размонтирование во время показа не начисляет награду", async () => {
    vi.useFakeTimers();
    const view = renderDialog();

    await clickWatch();
    view.unmount();
    await advance(5000);

    expect(h.toastMock).not.toHaveBeenCalled();
  });

  it("после отмены повторное открытие снова начисляет награду", async () => {
    vi.useFakeTimers();
    const first = renderDialog();

    await clickWatch();
    first.unmount();
    await advance(5000);
    expect(h.toastMock).not.toHaveBeenCalled();

    const second = renderDialog();
    await clickWatch();
    await advance(3000);

    expect(h.toastMock).toHaveBeenCalledTimes(1);
    expect(second.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("на нативной платформе показывает рекламу SDK и не ждёт таймер", async () => {
    vi.useFakeTimers();
    setNative(true);
    const { onOpenChange } = renderDialog();

    await clickWatch();
    await advance(0);

    expect(h.showAdMock).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(h.toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: tr("ad.profile_unlocked") }),
    );
  });

  it("падение SDK на нативной платформе даёт таймер-фолбэк и награду", async () => {
    vi.useFakeTimers();
    setNative(true);
    h.showAdMock.mockRejectedValue(new Error("sdk missing"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { onOpenChange } = renderDialog();

    await clickWatch();
    expect(h.toastMock).not.toHaveBeenCalled();

    await advance(3000);

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(h.toastMock).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("бросивший мост Capacitor считается вебом", async () => {
    vi.useFakeTimers();
    setNative("throws");
    renderDialog();

    await clickWatch();
    await advance(3000);

    expect(h.showAdMock).not.toHaveBeenCalled();
    expect(h.toastMock).toHaveBeenCalledTimes(1);
  });

  it("Capacitor с isNativePlatform() === false считается вебом", async () => {
    vi.useFakeTimers();
    setNative(false);
    renderDialog();

    await clickWatch();
    await advance(3000);

    expect(h.showAdMock).not.toHaveBeenCalled();
    expect(h.toastMock).toHaveBeenCalledTimes(1);
  });

  it("кнопка «Смотреть» не запускает второй показ, пока идёт первый", async () => {
    vi.useFakeTimers();
    renderDialog();

    await clickWatch();
    const button = screen.getByText(tr("common.loading")).closest("button") as HTMLButtonElement;
    fireEvent.click(button);
    await advance(3000);

    expect(h.toastMock).toHaveBeenCalledTimes(1);
  });

  it("награда начисляется один раз, даже если кнопку нажать после завершения", async () => {
    vi.useFakeTimers();
    const { onOpenChange } = renderDialog();

    await clickWatch();
    await advance(3000);
    expect(h.toastMock).toHaveBeenCalledTimes(1);

    await clickWatch();
    await advance(3000);
    expect(h.toastMock).toHaveBeenCalledTimes(2);
    expect(onOpenChange).toHaveBeenCalledTimes(2);
  });
});

describe("Диалог рекламы: загрузка сбрасывается", () => {
  it("после отмены кнопка снова активна и показывает «Смотреть»", async () => {
    vi.useFakeTimers();
    const { rerender, onOpenChange } = renderDialog();

    await clickWatch();
    rerender(<AdDialog open={false} onOpenChange={onOpenChange} />);
    await advance(5000);

    rerender(<AdDialog open onOpenChange={onOpenChange} />);
    const button = screen.getByText(tr("button.watch")).closest("button") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });
});
