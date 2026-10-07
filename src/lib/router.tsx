"use client";

/**
 * Router compatibility layer.
 *
 * The legacy app was written against react-router-dom v6. During the move to
 * the Next.js App Router every `import … from "react-router-dom"` was rewritten
 * to import from this module, which re-implements the small API surface the
 * app actually uses (Link, NavLink, Navigate, useNavigate, useParams,
 * useSearchParams, useLocation, MemoryRouter) on top of `next/navigation`.
 *
 * New code should import from `next/link` / `next/navigation` directly; this
 * shim exists so the 165 existing screens run unchanged and can be migrated
 * one at a time.
 */

import NextLink from "next/link";
import {
  useParams as useNextParams,
  usePathname,
  useRouter,
  useSearchParams as useNextSearchParams,
} from "next/navigation";
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from "react";

/* ------------------------------------------------------------------------ */
/* Types                                                                     */
/* ------------------------------------------------------------------------ */

export type To = string | { pathname?: string; search?: string; hash?: string };

export interface NavigateOptions {
  replace?: boolean;
  state?: unknown;
  /** Accepted for API compatibility; Next.js always scrolls to top on push. */
  preventScrollReset?: boolean;
}

export interface Location {
  pathname: string;
  search: string;
  hash: string;
  state: unknown;
  key: string;
}

export type NavigateFunction = {
  (to: To, options?: NavigateOptions): void;
  (delta: number): void;
};

type URLSearchParamsInit =
  | string
  | URLSearchParams
  | Record<string, string | string[]>
  | [string, string][];

/* ------------------------------------------------------------------------ */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------ */

export function toHref(to: To): string {
  if (typeof to === "string") return to;
  const search = to.search ? (to.search.startsWith("?") ? to.search : `?${to.search}`) : "";
  const hash = to.hash ? (to.hash.startsWith("#") ? to.hash : `#${to.hash}`) : "";
  return `${to.pathname ?? ""}${search}${hash}`;
}

function toSearchParams(init: URLSearchParamsInit): URLSearchParams {
  if (init instanceof URLSearchParams) return new URLSearchParams(init);
  if (typeof init === "string" || Array.isArray(init)) return new URLSearchParams(init);
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(init)) {
    if (Array.isArray(v)) v.forEach((x) => sp.append(k, x));
    else sp.set(k, v);
  }
  return sp;
}

// Navigation state (react-router's `state`) is kept in sessionStorage keyed by
// the target href so `useLocation().state` keeps working after a push.
const STATE_KEY = "__router_state__";
function saveState(href: string, state: unknown) {
  try {
    if (state === undefined) sessionStorage.removeItem(STATE_KEY);
    else sessionStorage.setItem(STATE_KEY, JSON.stringify({ href, state }));
  } catch {
    /* storage unavailable — state is best effort */
  }
}
function readState(href: string): unknown {
  try {
    const raw = sessionStorage.getItem(STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { href: string; state: unknown };
    return parsed.href === href ? parsed.state : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------ */
/* In-memory router (tests / Storybook)                                      */
/* ------------------------------------------------------------------------ */

interface MemoryRouterValue {
  location: Location;
  navigate: NavigateFunction;
  params: Record<string, string>;
}
const MemoryRouterContext = createContext<MemoryRouterValue | null>(null);

export function MemoryRouter({
  children,
  initialEntries = ["/"],
  params = {},
}: {
  children: ReactNode;
  initialEntries?: string[];
  params?: Record<string, string>;
}) {
  const [stack, setStack] = useState<string[]>(initialEntries);
  const current = stack[stack.length - 1] ?? "/";
  const url = new URL(current, "http://memory.local");
  const navigate = useCallback(((to: To | number, opts?: NavigateOptions) => {
    if (typeof to === "number") {
      setStack((s) => (to < 0 ? s.slice(0, Math.max(1, s.length + to)) : s));
      return;
    }
    const href = toHref(to);
    setStack((s) => (opts?.replace ? [...s.slice(0, -1), href] : [...s, href]));
  }) as NavigateFunction, []);
  const value = useMemo<MemoryRouterValue>(
    () => ({
      location: { pathname: url.pathname, search: url.search, hash: url.hash, state: null, key: String(stack.length) },
      navigate,
      params,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [current, navigate, params],
  );
  return <MemoryRouterContext.Provider value={value}>{children}</MemoryRouterContext.Provider>;
}

/* ------------------------------------------------------------------------ */
/* Hooks                                                                     */
/* ------------------------------------------------------------------------ */

export function useNavigate(): NavigateFunction {
  const memory = useContext(MemoryRouterContext);
  if (memory) return memory.navigate;
  // eslint-disable-next-line react-hooks/rules-of-hooks -- context presence is fixed for a component's lifetime
  const router = useRouter();
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useCallback(
    ((to: To | number, opts?: NavigateOptions) => {
      if (typeof to === "number") {
        if (to === -1) router.back();
        else if (to === 1) router.forward();
        else window.history.go(to);
        return;
      }
      const href = toHref(to);
      saveState(href, opts?.state);
      if (opts?.replace) router.replace(href);
      else router.push(href);
    }) as NavigateFunction,
    [router],
  );
}

export function useParams<T extends Record<string, string | undefined> = Record<string, string | undefined>>(): T {
  const memory = useContext(MemoryRouterContext);
  if (memory) return memory.params as T;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const p = useNextParams() ?? {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(p)) out[k] = Array.isArray(v) ? v.join("/") : decodeURIComponent(v);
  return out as T;
}

export function useLocation(): Location {
  const memory = useContext(MemoryRouterContext);
  if (memory) return memory.location;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const pathname = usePathname() ?? "/";
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const sp = useNextSearchParams();
  const search = sp && sp.toString() ? `?${sp.toString()}` : "";
  const hash = typeof window !== "undefined" ? window.location.hash : "";
  return { pathname, search, hash, state: readState(pathname + search), key: pathname + search };
}

/**
 * react-router style `[params, setParams]`. The returned URLSearchParams is a
 * mutable copy, so legacy code that calls `.delete()` / `.set()` on it and then
 * passes it back to `setSearchParams` keeps working.
 */
export function useSearchParams(): [
  URLSearchParams,
  (next: URLSearchParamsInit | ((prev: URLSearchParams) => URLSearchParamsInit), opts?: NavigateOptions) => void,
] {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const setParams = useCallback(
    (next: URLSearchParamsInit | ((prev: URLSearchParams) => URLSearchParamsInit), opts?: NavigateOptions) => {
      const resolved = toSearchParams(typeof next === "function" ? next(new URLSearchParams(location.search)) : next);
      const qs = resolved.toString();
      navigate(`${location.pathname}${qs ? `?${qs}` : ""}`, opts);
    },
    [location.pathname, location.search, navigate],
  );
  return [params, setParams];
}

/* ------------------------------------------------------------------------ */
/* Components                                                                */
/* ------------------------------------------------------------------------ */

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  to: To;
  replace?: boolean;
  state?: unknown;
  prefetch?: boolean;
  children?: ReactNode;
}

export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { to, replace, state, prefetch, onClick, ...rest },
  ref,
) {
  const memory = useContext(MemoryRouterContext);
  const href = toHref(to);
  if (memory) {
    return (
      <a
        ref={ref}
        href={href}
        onClick={(e) => {
          onClick?.(e);
          if (e.defaultPrevented || rest.target === "_blank") return;
          e.preventDefault();
          memory.navigate(href, { replace });
        }}
        {...rest}
      />
    );
  }
  return (
    <NextLink
      ref={ref}
      href={href}
      replace={replace}
      prefetch={prefetch}
      onClick={(e) => {
        if (state !== undefined) saveState(href, state);
        onClick?.(e);
      }}
      {...rest}
    />
  );
});

type NavLinkRenderProps = { isActive: boolean; isPending: boolean; isTransitioning: boolean };

export interface NavLinkProps extends Omit<LinkProps, "className" | "style" | "children"> {
  end?: boolean;
  caseSensitive?: boolean;
  className?: string | ((p: NavLinkRenderProps) => string | undefined);
  style?: CSSProperties | ((p: NavLinkRenderProps) => CSSProperties | undefined);
  children?: ReactNode | ((p: NavLinkRenderProps) => ReactNode);
}

export const NavLink = forwardRef<HTMLAnchorElement, NavLinkProps>(function NavLink(
  { to, end, caseSensitive, className, style, children, ...rest },
  ref,
) {
  const { pathname } = useLocation();
  const target = toHref(to).split(/[?#]/)[0] || "/";
  const norm = (s: string) => (caseSensitive ? s : s.toLowerCase()).replace(/\/+$/, "") || "/";
  const cur = norm(pathname);
  const tgt = norm(target);
  const isActive = cur === tgt || (!end && tgt !== "/" && cur.startsWith(`${tgt}/`));
  const rp: NavLinkRenderProps = { isActive, isPending: false, isTransitioning: false };
  return (
    <Link
      ref={ref}
      to={to}
      aria-current={isActive ? "page" : undefined}
      className={typeof className === "function" ? className(rp) : className}
      style={typeof style === "function" ? style(rp) : style}
      {...rest}
    >
      {typeof children === "function" ? children(rp) : children}
    </Link>
  );
});

export function Navigate({ to, replace, state }: { to: To; replace?: boolean; state?: unknown }) {
  const navigate = useNavigate();
  const href = toHref(to);
  useEffect(() => {
    navigate(href, { replace, state });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [href]);
  return null;
}
