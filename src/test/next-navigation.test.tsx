import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useNavigationType, useLocation } from "react-router-dom";
import {
  useRouter,
  usePathname,
  useSearchParams,
  useParams,
  redirect,
  notFound,
} from "@/shims/next-navigation";

function RouterProbe() {
  const router = useRouter();
  const location = useLocation();
  const navigationType = useNavigationType();
  return (
    <div>
      <div data-testid="pathname">{location.pathname}</div>
      <div data-testid="search">{location.search}</div>
      <div data-testid="navigation-type">{navigationType}</div>
      <div data-testid="router-pathname">{router.pathname}</div>
      <div data-testid="query">{JSON.stringify(router.query)}</div>
      <button data-testid="push" onClick={() => router.push("/pushed")}>push</button>
      <button data-testid="replace" onClick={() => router.replace("/replaced")}>replace</button>
      <button data-testid="back" onClick={() => router.back()}>back</button>
      <button data-testid="forward" onClick={() => router.forward()}>forward</button>
      <button data-testid="refresh" onClick={() => router.refresh()}>refresh</button>
      <button data-testid="prefetch" onClick={() => router.prefetch("/somewhere")}>prefetch</button>
      <Routes>
        <Route path="*" element={null} />
      </Routes>
    </div>
  );
}

function renderProbe(path: string, entries: string[] = [path]) {
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <RouterProbe />
    </MemoryRouter>,
  );
}

function PathnameProbe() {
  const pathname = usePathname();
  return <div data-testid="hook-pathname">{pathname}</div>;
}

function SearchParamsProbe() {
  const params = useSearchParams();
  return <div data-testid="hook-params">{`${params.get("a")}|${params.get("b")}`}</div>;
}

function ParamsProbe() {
  const params = useParams();
  return <div data-testid="hook-route-params">{JSON.stringify(params)}</div>;
}

describe("next-navigation shim", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("отдаёт pathname и разбирает query из адреса", () => {
    renderProbe("/feed?a=1&b=two");

    expect(screen.getByTestId("pathname").textContent).toBe("/feed");
    expect(screen.getByTestId("router-pathname").textContent).toBe("/feed");
    expect(screen.getByTestId("query").textContent).toBe('{"a":"1","b":"two"}');
  });

  it("отдаёт пустой объект query, когда параметров нет", () => {
    renderProbe("/feed");

    expect(screen.getByTestId("query").textContent).toBe("{}");
  });

  it("push и replace ведут на новый адрес с разным типом навигации", () => {
    renderProbe("/feed");

    fireEvent.click(screen.getByTestId("push"));
    expect(screen.getByTestId("pathname").textContent).toBe("/pushed");
    expect(screen.getByTestId("navigation-type").textContent).toBe("PUSH");

    fireEvent.click(screen.getByTestId("replace"));
    expect(screen.getByTestId("pathname").textContent).toBe("/replaced");
    expect(screen.getByTestId("navigation-type").textContent).toBe("REPLACE");
  });

  it("back и forward двигают историю", () => {
    renderProbe("/second", ["/first", "/second"]);

    fireEvent.click(screen.getByTestId("back"));
    expect(screen.getByTestId("pathname").textContent).toBe("/first");

    fireEvent.click(screen.getByTestId("forward"));
    expect(screen.getByTestId("pathname").textContent).toBe("/second");
  });

  it("refresh перезагружает страницу", () => {
    const reload = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, reload } as Location);
    renderProbe("/feed");

    fireEvent.click(screen.getByTestId("refresh"));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("prefetch ничего не делает и не падает", () => {
    renderProbe("/feed");

    expect(() => fireEvent.click(screen.getByTestId("prefetch"))).not.toThrow();
  });

  it("usePathname, useSearchParams и useParams читают маршрут", () => {
    render(
      <MemoryRouter initialEntries={["/groups/7?a=1&b=2"]}>
        <Routes>
          <Route
            path="/groups/:id"
            element={
              <div>
                <PathnameProbe />
                <SearchParamsProbe />
                <ParamsProbe />
              </div>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("hook-pathname").textContent).toBe("/groups/7");
    expect(screen.getByTestId("hook-params").textContent).toBe("1|2");
    expect(screen.getByTestId("hook-route-params").textContent).toBe('{"id":"7"}');
  });

  it("redirect выставляет адрес и бросает исключение", () => {
    const hrefSetter = vi.fn();
    const fakeLocation = {
      ...window.location,
      get href() {
        return "http://localhost/";
      },
      set href(value: string) {
        hrefSetter(value);
      },
    };
    vi.spyOn(window, "location", "get").mockReturnValue(fakeLocation as Location);

    expect(() => redirect("/somewhere")).toThrow("redirect:/somewhere");
    expect(hrefSetter).toHaveBeenCalledWith("/somewhere");
  });

  it("notFound бросает NEXT_NOT_FOUND", () => {
    expect(() => notFound()).toThrow("NEXT_NOT_FOUND");
  });
});
