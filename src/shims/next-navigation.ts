import { useCallback, useMemo } from "react";
import { useNavigate, useLocation, useParams as useRouterParams, useSearchParams as useRouterSearchParams } from "react-router-dom";

export function useRouter() {
  const navigate = useNavigate();
  const location = useLocation();
  const push = useCallback((href: string) => navigate(href), [navigate]);
  const replace = useCallback((href: string) => navigate(href, { replace: true }), [navigate]);
  const back = useCallback(() => navigate(-1), [navigate]);
  const forward = useCallback(() => navigate(1), [navigate]);
  const refresh = useCallback(() => window.location.reload(), []);
  const prefetch = useCallback((_: string) => {}, []);
  const search = location.search;
  const query = useMemo(() => Object.fromEntries(new URLSearchParams(search)), [search]);
  return useMemo(() => ({
    push, replace, back, forward, refresh, prefetch,
    pathname: location.pathname,
    query,
  }), [push, replace, back, forward, refresh, prefetch, location.pathname, query]);
}

export function usePathname() {
  return useLocation().pathname;
}

export function useSearchParams() {
  const [params] = useRouterSearchParams();
  return params;
}

export function useParams<T extends Record<string, string> = Record<string, string>>() {
  return useRouterParams() as T;
}

export function redirect(href: string): never {
  if (typeof window !== "undefined") {
    window.location.href = href;
  }
  throw new Error("redirect:" + href);
}

export function notFound(): never {
  throw new Error("NEXT_NOT_FOUND");
}
