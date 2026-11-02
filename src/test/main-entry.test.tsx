import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";

const mocks = vi.hoisted(() => ({
  initSentry: vi.fn(),
  createRoot: vi.fn(),
  render: vi.fn(),
}));

vi.mock("react-dom/client", () => ({ createRoot: mocks.createRoot }));
vi.mock("@/lib/sentry", () => ({ initSentry: mocks.initSentry }));
vi.mock("@/lib/native", () => ({}));
vi.mock("@/components/shared/pwa-registry", () => ({
  PwaRegistry: () => <div data-testid="pwa-registry" />,
}));
vi.mock("@/App.tsx", () => ({
  default: () => <div data-testid="app" />,
}));

async function importEntry() {
  vi.resetModules();
  await import("@/main");
}

describe("main entry", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    mocks.initSentry.mockClear();
    mocks.createRoot.mockClear();
    mocks.render.mockClear();
    mocks.createRoot.mockReturnValue({ render: mocks.render });
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("инициализирует Sentry до монтирования и рисует приложение в #root", async () => {
    const rootElement = document.getElementById("root");

    await importEntry();

    expect(mocks.initSentry).toHaveBeenCalledTimes(1);
    expect(mocks.createRoot).toHaveBeenCalledTimes(1);
    expect(mocks.createRoot).toHaveBeenCalledWith(rootElement);
    expect(mocks.initSentry.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createRoot.mock.invocationCallOrder[0],
    );
    expect(mocks.render).toHaveBeenCalledTimes(1);
  });

  it("оборачивает приложение в HelmetProvider и рисует PwaRegistry рядом с App", async () => {
    await importEntry();

    const element = mocks.render.mock.calls[0][0] as ReactElement;
    const { HelmetProvider } = await import("react-helmet-async");

    expect(element.type).toBe(HelmetProvider);

    const { container } = render(element);
    expect(screen.getByTestId("app")).toBeInTheDocument();
    expect(screen.getByTestId("pwa-registry")).toBeInTheDocument();
    expect(container.querySelector("[data-testid='app']")).not.toBeNull();
  });

  it("не монтирует приложение повторно при повторном импорте модуля", async () => {
    await importEntry();
    await import("@/main");

    expect(mocks.createRoot).toHaveBeenCalledTimes(1);
    expect(mocks.render).toHaveBeenCalledTimes(1);
    expect(mocks.initSentry).toHaveBeenCalledTimes(1);
  });
});
