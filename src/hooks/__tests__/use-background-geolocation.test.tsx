import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const h = vi.hoisted(() => ({
  token: "tok" as string | null,
  fetch: vi.fn(),
  refresh: vi.fn(),
  nativePosition: vi.fn(),
}));

vi.mock("@/lib/token", () => ({ getToken: () => h.token }));

vi.mock("@/lib/auth-refresh", () => ({ refreshAuthToken: () => h.refresh() }));

vi.mock("@capacitor/geolocation", () => ({
  Geolocation: { getCurrentPosition: (...args: unknown[]) => h.nativePosition(...args) },
}));

import { useBackgroundGeolocation } from "@/hooks/use-background-geolocation";

globalThis.fetch = h.fetch as unknown as typeof fetch;

type Success = (position: { coords: { latitude: number; longitude: number } }) => void;
type Failure = (error: { code: number }) => void;
type Options = { enableHighAccuracy: boolean; timeout: number; maximumAge: number };

let geo: { getCurrentPosition: ReturnType<typeof vi.fn> };

function installGeolocation(
  handler: (success: Success, failure: Failure, options?: Options) => void = (success) =>
    success({ coords: { latitude: 55.75, longitude: 37.61 } }),
) {
  geo = { getCurrentPosition: vi.fn(handler) };
  Object.defineProperty(navigator, "geolocation", {
    value: geo,
    configurable: true,
    writable: true,
  });
}

function removeGeolocation() {
  delete (navigator as unknown as { geolocation?: unknown }).geolocation;
}

function okResponse() {
  return { ok: true, status: 200 };
}

function flush() {
  return act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function lastRequest() {
  const call = h.fetch.mock.calls[h.fetch.mock.calls.length - 1];
  return {
    url: call[0] as string,
    init: call[1] as { method: string; headers: Record<string, string>; body: string },
  };
}

function sentBody() {
  return JSON.parse(lastRequest().init.body) as { lat: number; lng: number };
}

function setNativePlatform(value: unknown) {
  (window as unknown as { Capacitor?: unknown }).Capacitor = value;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.token = "tok";
  h.fetch.mockResolvedValue(okResponse());
  h.refresh.mockResolvedValue("refreshed-token");
  h.nativePosition.mockResolvedValue({ coords: { latitude: 55.75, longitude: 37.61 } });
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  installGeolocation();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  removeGeolocation();
});

describe("Фоновая геолокация: веб", () => {
  it("первый замер уходит на /api/location с токеном и координатами", async () => {
    const { unmount } = renderHook(() => useBackgroundGeolocation());
    await flush();

    expect(h.fetch).toHaveBeenCalledTimes(1);
    const { url, init } = lastRequest();
    expect(url).toBe("/api/location");
    expect(init.method).toBe("PUT");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(sentBody()).toEqual({ lat: 55.75, lng: 37.61 });

    unmount();
  });

  it("первый замер запрашивает высокую точность", async () => {
    const { unmount } = renderHook(() => useBackgroundGeolocation());
    await flush();

    const options = geo.getCurrentPosition.mock.calls[0][2] as Options;
    expect(options.enableHighAccuracy).toBe(true);
    expect(options.timeout).toBe(10000);

    unmount();
  });

  it("без токена координаты никуда не отправляются", async () => {
    h.token = null;
    const { unmount } = renderHook(() => useBackgroundGeolocation());
    await flush();

    expect(h.fetch).not.toHaveBeenCalled();

    unmount();
  });

  it("истёкший токен обновляется, и запрос повторяется с новым", async () => {
    h.fetch.mockResolvedValueOnce({ ok: false, status: 401 }).mockResolvedValueOnce(okResponse());

    const { unmount } = renderHook(() => useBackgroundGeolocation());
    await flush();

    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(h.fetch).toHaveBeenCalledTimes(2);
    expect(lastRequest().init.headers.Authorization).toBe("Bearer refreshed-token");

    unmount();
  });

  it("если сессию продлить нельзя, второго запроса нет и ничего не падает", async () => {
    h.fetch.mockResolvedValueOnce({ ok: false, status: 401 });
    h.refresh.mockResolvedValue(null);

    const { unmount } = renderHook(() => useBackgroundGeolocation());
    await flush();

    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(h.fetch).toHaveBeenCalledTimes(1);

    unmount();
  });

  it("отказ сервера не роняет хук и не печатает координаты в консоль", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    h.fetch.mockResolvedValue({ ok: false, status: 500 });

    const { unmount } = renderHook(() => useBackgroundGeolocation());
    await flush();

    const printed = logSpy.mock.calls.flat().join(" ");
    expect(printed).not.toContain("55.75");
    expect(printed).not.toContain("37.61");
    expect(logSpy).toHaveBeenCalledWith("[GPS] Update rejected:", 500);

    unmount();
    logSpy.mockRestore();
  });

  it("сетевая ошибка не роняет хук и не печатает координаты", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    h.fetch.mockRejectedValue(new Error("offline"));

    const { unmount } = renderHook(() => useBackgroundGeolocation());
    await flush();

    const printed = logSpy.mock.calls.flat().join(" ");
    expect(printed).not.toContain("55.75");
    expect(logSpy).toHaveBeenCalledWith("[GPS] Update failed");

    unmount();
    logSpy.mockRestore();
  });

  it("успешная отправка логируется без координат", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { unmount } = renderHook(() => useBackgroundGeolocation());
    await flush();

    expect(logSpy).toHaveBeenCalledWith("[GPS] Location updated");
    expect(logSpy.mock.calls.flat().join(" ")).not.toContain("55.75");

    unmount();
    logSpy.mockRestore();
  });

  it("не отправляет повторно, если пользователь не сдвинулся", async () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useBackgroundGeolocation());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    });

    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(2);
    expect(h.fetch).toHaveBeenCalledTimes(1);

    unmount();
  });

  it("не отправляет повторно при смещении меньше 100 метров", async () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useBackgroundGeolocation());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    geo.getCurrentPosition.mockImplementation((success: Success) =>
      success({ coords: { latitude: 55.7505, longitude: 37.61 } }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    });

    expect(h.fetch).toHaveBeenCalledTimes(1);

    unmount();
  });

  it("отправляет заново при смещении больше 100 метров", async () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useBackgroundGeolocation());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    geo.getCurrentPosition.mockImplementation((success: Success) =>
      success({ coords: { latitude: 55.752, longitude: 37.61 } }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    });

    expect(h.fetch).toHaveBeenCalledTimes(2);
    expect(sentBody()).toEqual({ lat: 55.752, lng: 37.61 });

    unmount();
  });

  it("считает смещение от последней отправки, а не от прошлого замера", async () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useBackgroundGeolocation());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    geo.getCurrentPosition.mockImplementation((success: Success) =>
      success({ coords: { latitude: 55.75054, longitude: 37.61 } }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    });
    expect(h.fetch).toHaveBeenCalledTimes(1);

    geo.getCurrentPosition.mockImplementation((success: Success) =>
      success({ coords: { latitude: 55.75108, longitude: 37.61 } }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    });

    expect(h.fetch).toHaveBeenCalledTimes(2);
    expect(sentBody()).toEqual({ lat: 55.75108, lng: 37.61 });

    unmount();
  });

  it("не отправляет повторно, если сервер отклонил первый замер", async () => {
    vi.useFakeTimers();
    h.fetch.mockResolvedValue({ ok: false, status: 500 });
    const { unmount } = renderHook(() => useBackgroundGeolocation());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    });

    expect(h.fetch).toHaveBeenCalledTimes(2);

    unmount();
  });

  it("запрет доступа останавливает опрос вместо вечных попыток", async () => {
    vi.useFakeTimers();
    installGeolocation((_success, failure) => failure({ code: 1 }));

    const { unmount } = renderHook(() => useBackgroundGeolocation());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    });

    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(h.fetch).not.toHaveBeenCalled();

    unmount();
  });

  it("временная ошибка геолокации опрос не останавливает", async () => {
    vi.useFakeTimers();
    installGeolocation((_success, failure) => failure({ code: 2 }));

    const { unmount } = renderHook(() => useBackgroundGeolocation());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    });

    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(2);

    unmount();
  });

  it("без поддержки геолокации ничего не запускается и не падает", async () => {
    removeGeolocation();

    const { unmount } = renderHook(() => useBackgroundGeolocation());
    await flush();

    expect(h.fetch).not.toHaveBeenCalled();

    unmount();
  });

  it("в среде без navigator хук не падает", async () => {
    vi.stubGlobal("navigator", undefined);

    const { unmount } = renderHook(() => useBackgroundGeolocation());
    await flush();

    expect(h.fetch).not.toHaveBeenCalled();

    unmount();
  });

  it("позиция, пришедшая после размонтирования, не отправляется", async () => {
    let pendingSuccess: Success = () => {};
    installGeolocation((success) => {
      pendingSuccess = success;
    });

    const { unmount } = renderHook(() => useBackgroundGeolocation());
    await flush();
    unmount();

    await act(async () => {
      pendingSuccess({ coords: { latitude: 55.75, longitude: 37.61 } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("интервальный замер идёт с низкой точностью и большим таймаутом", async () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useBackgroundGeolocation());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    });

    const options = geo.getCurrentPosition.mock.calls[1][2] as Options;
    expect(options.enableHighAccuracy).toBe(false);
    expect(options.timeout).toBe(15000);

    unmount();
  });
});

describe("Фоновая геолокация: натив", () => {
  beforeEach(() => {
    setNativePlatform({ isNativePlatform: () => true });
  });

  it("берёт позицию у Capacitor и отправляет её на сервер", async () => {
    const { unmount } = renderHook(() => useBackgroundGeolocation());
    await flush();

    expect(h.nativePosition).toHaveBeenCalledWith({ enableHighAccuracy: true, timeout: 10000 });
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(sentBody()).toEqual({ lat: 55.75, lng: 37.61 });

    unmount();
  });

  it("позиция без координат игнорируется", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    h.nativePosition.mockResolvedValue({});

    const { unmount } = renderHook(() => useBackgroundGeolocation());
    await flush();

    expect(h.fetch).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalledWith("[GPS] Update failed");

    unmount();
    logSpy.mockRestore();
  });

  it("сбой плагина не роняет хук", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    h.nativePosition.mockRejectedValue(new Error("permission denied"));

    const { unmount } = renderHook(() => useBackgroundGeolocation());
    await flush();

    expect(h.fetch).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith("[GPS] Update failed");

    unmount();
    logSpy.mockRestore();
  });

  it("опрос идёт каждые пять минут", async () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useBackgroundGeolocation());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    });

    expect(h.nativePosition).toHaveBeenCalledTimes(2);

    unmount();
  });

  it("позиция, пришедшая после размонтирования, не отправляется", async () => {
    let resolvePosition: (value: unknown) => void = () => {};
    h.nativePosition.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePosition = resolve;
        }),
    );

    const { unmount } = renderHook(() => useBackgroundGeolocation());
    await act(async () => {
      await Promise.resolve();
    });

    unmount();
    await act(async () => {
      resolvePosition({ coords: { latitude: 55.75, longitude: 37.61 } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("без метода isNativePlatform считается вебом", async () => {
    setNativePlatform({});

    const { unmount } = renderHook(() => useBackgroundGeolocation());
    await flush();

    expect(h.nativePosition).not.toHaveBeenCalled();
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);

    unmount();
  });
});

describe("Фоновая геолокация: остановка опроса", () => {
  it("размонтирование прекращает опрос", async () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useBackgroundGeolocation());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    });

    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it("размонтирование без запущенного опроса не падает", async () => {
    removeGeolocation();
    const { unmount } = renderHook(() => useBackgroundGeolocation());

    unmount();

    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("ответ сервера, пришедший после размонтирования, не запоминается", async () => {
    let resolveFetch: (value: unknown) => void = () => {};
    h.fetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const { unmount } = renderHook(() => useBackgroundGeolocation());
    await act(async () => {
      await Promise.resolve();
    });
    expect(h.fetch).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      resolveFetch({ ok: true, status: 200 });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(h.fetch).toHaveBeenCalledTimes(1);
  });
});
