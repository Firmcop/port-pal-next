import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Runs before every page request (Next.js 16 "proxy", formerly middleware).
 *  1. Refreshes the Supabase session cookie so it never silently expires.
 *  2. Redirects signed-out visitors to the right login page on the server,
 *     so protected screens never download or flash before the redirect.
 * Organisation checks (onboarding, paywall, modules, roles) stay in the app
 * shell and in Postgres RLS — the proxy only answers "is anyone signed in?".
 */

const PUBLIC_PREFIXES = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/unsubscribe",
  "/accept-invite",
  "/oauth",
  "/.lovable",
  "/.well-known",
  "/portal/login",
  "/api",
];

function isPublic(pathname: string) {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // getClaims() verifies the JWT locally (asymmetric keys) — no network hop on most requests.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const { pathname, search } = request.nextUrl;

  if (!signedIn && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.search = "";
    if (pathname.startsWith("/portal")) {
      url.pathname = "/portal/login";
    } else {
      url.pathname = "/login";
      if (pathname !== "/") url.searchParams.set("next", pathname + search);
    }
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets, the service worker and public docs.
    "/((?!_next/static|_next/image|favicon.png|sw.js|robots.txt|sitemap.xml|llms.txt|docs/|placeholder.svg|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|map|txt|xml|pdf)$).*)",
  ],
};
