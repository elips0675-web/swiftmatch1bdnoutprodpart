import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AppContainer } from "@/components/layout/app-container";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="*"
          element={
            <AppContainer>
              <div data-testid="child">контент</div>
            </AppContainer>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AppContainer", () => {
  it("рисует детей в мобильной колонке на обычных страницах", () => {
    renderAt("/feed");

    const child = screen.getByTestId("child");
    expect(child.textContent).toBe("контент");
    const container = child.parentElement as HTMLElement;
    expect(container.className).toContain("max-w-[480px]");
    expect(container.className).toContain("bg-white");
    expect(container.className).not.toContain("bg-muted/40");
  });

  it("переключает фон на админский раздел", () => {
    renderAt("/admin/users");

    const container = screen.getByTestId("child").parentElement as HTMLElement;
    expect(container.className).toContain("bg-muted/40");
    expect(container.className).not.toContain("max-w-[480px]");
  });

  it("считает админским и сам корень /admin", () => {
    renderAt("/admin");

    const container = screen.getByTestId("child").parentElement as HTMLElement;
    expect(container.className).toContain("bg-muted/40");
  });

  it("не считает админским путь, который только начинается с /admin", () => {
    renderAt("/administrator");

    const container = screen.getByTestId("child").parentElement as HTMLElement;
    expect(container.className).not.toContain("bg-muted/40");
    expect(container.className).toContain("max-w-[480px]");
  });
});
