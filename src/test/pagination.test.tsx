import { describe, it, expect } from "vitest";
import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";

describe("Pagination", () => {
  it("рисует навигацию с меткой для скринридера и центрирующими классами", () => {
    render(<Pagination data-testid="pages" />);

    const nav = screen.getByTestId("pages");
    expect(nav.tagName).toBe("NAV");
    expect(nav).toHaveAttribute("role", "navigation");
    expect(nav).toHaveAttribute("aria-label", "pagination");
    expect(nav.className).toContain("mx-auto");
    expect(nav.className).toContain("w-full");
    expect(nav.className).toContain("justify-center");
  });

  it("добавляет внешний className к своим классам, а не заменяет их", () => {
    render(<Pagination className="mb-4" data-testid="pages" />);

    const nav = screen.getByTestId("pages");
    expect(nav.className).toContain("mb-4");
    expect(nav.className).toContain("justify-center");
  });

  it("прокидывает остальные пропсы в nav", () => {
    render(<Pagination id="page-list" aria-describedby="hint" />);

    const nav = screen.getByRole("navigation");
    expect(nav).toHaveAttribute("id", "page-list");
    expect(nav).toHaveAttribute("aria-describedby", "hint");
  });

  it("выставляет displayName всем трём компонентам", () => {
    expect(Pagination.displayName).toBe("Pagination");
    expect(PaginationContent.displayName).toBe("PaginationContent");
    expect(PaginationItem.displayName).toBe("PaginationItem");
  });
});

describe("PaginationContent", () => {
  it("рисует список с рядом элементов и пробелами между ними", () => {
    render(
      <PaginationContent data-testid="content">
        <PaginationItem>1</PaginationItem>
      </PaginationContent>,
    );

    const list = screen.getByTestId("content");
    expect(list.tagName).toBe("UL");
    expect(list.className).toContain("flex-row");
    expect(list.className).toContain("items-center");
    expect(list.className).toContain("gap-1");
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("отдаёт ref на ul и не теряет внешний className", () => {
    const ref = createRef<HTMLUListElement>();
    render(<PaginationContent ref={ref} className="mt-2" data-testid="content" />);

    const list = screen.getByTestId("content");
    expect(ref.current).toBe(list);
    expect(list.className).toContain("mt-2");
    expect(list.className).toContain("gap-1");
  });
});

describe("PaginationItem", () => {
  it("рисует элемент списка и проксирует пропсы", () => {
    render(
      <PaginationItem data-testid="item" aria-label="страница 2">
        2
      </PaginationItem>,
    );

    const item = screen.getByTestId("item");
    expect(item.tagName).toBe("LI");
    expect(item).toHaveAttribute("aria-label", "страница 2");
    expect(item.textContent).toBe("2");
  });

  it("отдаёт ref на li и применяет внешний className", () => {
    const ref = createRef<HTMLLIElement>();
    render(<PaginationItem ref={ref} className="opacity-50" data-testid="item" />);

    const item = screen.getByTestId("item");
    expect(ref.current).toBe(item);
    expect(item.className).toBe("opacity-50");
  });

  it("собирает полную пагинацию из трёх страниц", () => {
    render(
      <Pagination>
        <PaginationContent>
          <PaginationItem>назад</PaginationItem>
          <PaginationItem aria-current="page">1</PaginationItem>
          <PaginationItem>вперёд</PaginationItem>
        </PaginationContent>
      </Pagination>,
    );

    expect(screen.getByRole("navigation")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("1")).toHaveAttribute("aria-current", "page");
  });
});
