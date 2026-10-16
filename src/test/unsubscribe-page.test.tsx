import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

vi.mock("@/context/language-context", () => ({
  useLanguage: () => ({ t: (key: string) => key, language: "RU", setLanguage: vi.fn() }),
}));

import UnsubscribePage from "@/pages/unsubscribe";

function renderAt(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/unsubscribe${search}`]}>
      <UnsubscribePage />
    </MemoryRouter>,
  );
}

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/unsubscribe", () => {
  it("отправляет u и t на публичный эндпоинт и показывает успех", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { code: "UNSUBSCRIBED" }));
    renderAt("?u=5&t=abc");

    await waitFor(() => expect(screen.getByText("unsubscribe.success")).toBeTruthy());
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/email/unsubscribe");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ u: "5", t: "abc" });
  });

  it("неверная ссылка → сообщение о недействительной ссылке, без кнопки повтора", async () => {
    mockFetch.mockResolvedValue(jsonResponse(400, { code: "UNSUBSCRIBE_INVALID" }));
    renderAt("?u=5&t=abc");

    await waitFor(() => expect(screen.getByText("unsubscribe.invalid_link")).toBeTruthy());
    expect(screen.queryByText("unsubscribe.retry")).toBeNull();
  });

  it("флаг выключен → сообщение о недоступности", async () => {
    mockFetch.mockResolvedValue(jsonResponse(404, { code: "UNSUBSCRIBE_DISABLED" }));
    renderAt("?u=5&t=abc");

    await waitFor(() => expect(screen.getByText("unsubscribe.disabled")).toBeTruthy());
  });

  it("сбой сети → ошибка и повторный запрос по кнопке", async () => {
    mockFetch.mockRejectedValueOnce(new Error("offline"));
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { code: "UNSUBSCRIBED" }));
    renderAt("?u=5&t=abc");

    await waitFor(() => expect(screen.getByText("unsubscribe.retry")).toBeTruthy());
    fireEvent.click(screen.getByText("unsubscribe.retry"));

    await waitFor(() => expect(screen.getByText("unsubscribe.success")).toBeTruthy());
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("без параметров u/t запрос не уходит, показывается недействительная ссылка", async () => {
    renderAt("");

    await waitFor(() => expect(screen.getByText("unsubscribe.invalid_link")).toBeTruthy());
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
