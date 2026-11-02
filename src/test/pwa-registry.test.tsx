import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { PwaRegistry } from "@/components/shared/pwa-registry";

const register = vi.fn();

function withServiceWorker(value: { register: typeof register } | undefined) {
  Object.defineProperty(window.navigator, "serviceWorker", {
    value,
    configurable: true,
    writable: true,
  });
}

describe("PwaRegistry", () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

  beforeEach(() => {
    register.mockReset();
    register.mockResolvedValue({ scope: "/" });
    consoleError.mockClear();
  });

  afterEach(() => {
    withServiceWorker(undefined);
  });

  it("регистрирует воркер по пути /sw.js и ничего не рисует", () => {
    withServiceWorker({ register });

    const { container } = render(<PwaRegistry />);

    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith("/sw.js");
    expect(container).toBeEmptyDOMElement();
  });

  it("не обращается к воркеру, если браузер его не поддерживает", () => {
    withServiceWorker(undefined);
    delete (window.navigator as { serviceWorker?: unknown }).serviceWorker;

    expect(() => render(<PwaRegistry />)).not.toThrow();
    expect(register).not.toHaveBeenCalled();
  });

  it("гасит отказ регистрации и не роняет приложение", async () => {
    const failure = new Error("registration failed");
    register.mockRejectedValueOnce(failure);
    withServiceWorker({ register });

    const { container } = render(<PwaRegistry />);

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith("Service Worker registration failed:", failure);
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("регистрирует воркер один раз, а не на каждый рендер", () => {
    withServiceWorker({ register });

    const { rerender } = render(<PwaRegistry />);
    rerender(<PwaRegistry />);
    rerender(<PwaRegistry />);

    expect(register).toHaveBeenCalledTimes(1);
  });
});
