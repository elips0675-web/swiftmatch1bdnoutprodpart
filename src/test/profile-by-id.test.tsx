import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation, useNavigationType } from "react-router-dom";
import ProfileById from "@/pages/profile-[id]";

function Destination() {
  const location = useLocation();
  const navigationType = useNavigationType();
  return (
    <>
      <div data-testid="destination">{`${location.pathname}${location.search}`}</div>
      <div data-testid="navigation-type">{navigationType}</div>
    </>
  );
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/profile/:id" element={<ProfileById />} />
        <Route path="/user" element={<Destination />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ProfileById", () => {
  it("перенаправляет /profile/:id на страницу пользователя через replace", async () => {
    renderAt("/profile/42");

    await waitFor(() => {
      expect(screen.getByTestId("destination").textContent).toBe("/user?id=42");
    });
    expect(screen.getByTestId("navigation-type").textContent).toBe("REPLACE");
  });

  it("кодирует идентификатор, чтобы он не добавлял лишние параметры", async () => {
    renderAt("/profile/7&tab=photos");

    await waitFor(() => {
      expect(screen.getByTestId("destination").textContent).toBe("/user?id=7%26tab%3Dphotos");
    });
  });

  it("ничего не рендерит и не уводит со страницы без идентификатора", () => {
    render(
      <MemoryRouter initialEntries={["/profile"]}>
        <Routes>
          <Route path="/profile" element={<ProfileById />} />
          <Route path="/user" element={<Destination />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByTestId("destination")).toBeNull();
  });
});
