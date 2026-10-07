// Shared helpers for the public-* edge functions (CORS allowlist, IP hashing,
// rate-limit checks, image-URL signing).

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

const STORAGE_BUCKET = "product-media";
const SIGN_TTL_SECONDS = 60 * 60; // 1 hour

const baseHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
};

function parseAllowedOrigins(): { exact: Set<string>; allowLocalhost: boolean } {
  const raw = Deno.env.get("PUBLIC_WEBSITE_ALLOWED_ORIGINS") ?? "";
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  let allowLocalhost = false;
  const exact = new Set<string>();
  for (const o of list) {
    if (/localhost/i.test(o) || /127\.0\.0\.1/.test(o)) {
      allowLocalhost = true;
    }
    exact.add(o);
  }
  return { exact, allowLocalhost };
}

export function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const { exact, allowLocalhost } = parseAllowedOrigins();

  let allowed = "";
  if (origin) {
    if (exact.has(origin)) allowed = origin;
    else if (
      allowLocalhost &&
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
    ) {
      allowed = origin;
    }
  }
  // Fall back to first configured origin when no/unknown Origin (curl, server-to-server)
  if (!allowed) {
    const first = [...exact][0] ?? "*";
    allowed = first;
  }
  return { ...baseHeaders, "Access-Control-Allow-Origin": allowed };
}

export function preflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeadersFor(req) });
  }
  return null;
}

export function jsonResponse(
  req: Request,
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeadersFor(req),
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });
}

export function getClientIp(req: Request): string {
  const fwd =
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for") ??
    "";
  return fwd.split(",")[0].trim() || "unknown";
}

export async function hashWithSalt(value: string): Promise<string> {
  const salt = Deno.env.get("PUBLIC_REQUEST_SALT") ?? "fallback-salt";
  const data = new TextEncoder().encode(`${salt}:${value.toLowerCase()}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

/**
 * Records the hit and returns counts. The caller decides if the limit is hit.
 * Best-effort: failures don't block the request.
 */
export async function recordAndCount(
  sb: SupabaseClient,
  endpoint: string,
  ipHash: string,
  emailHash: string | null,
  orgId: string | null,
): Promise<{ perMinute: number; perHour: number; emailPerHour: number }> {
  try {
    await sb.from("public_request_log").insert({
      endpoint,
      ip_hash: ipHash,
      email_hash: emailHash,
      organization_id: orgId,
    });
  } catch (_) { /* ignore */ }

  const nowMinuteIso = new Date(Date.now() - 60_000).toISOString();
  const nowHourIso = new Date(Date.now() - 60 * 60_000).toISOString();

  const [{ count: perMinute }, { count: perHour }, emailRes] = await Promise.all([
    sb.from("public_request_log")
      .select("id", { count: "exact", head: true })
      .eq("endpoint", endpoint)
      .eq("ip_hash", ipHash)
      .gte("created_at", nowMinuteIso),
    sb.from("public_request_log")
      .select("id", { count: "exact", head: true })
      .eq("endpoint", endpoint)
      .eq("ip_hash", ipHash)
      .gte("created_at", nowHourIso),
    emailHash
      ? sb.from("public_request_log")
          .select("id", { count: "exact", head: true })
          .eq("endpoint", endpoint)
          .eq("email_hash", emailHash)
          .gte("created_at", nowHourIso)
      : Promise.resolve({ count: 0 } as any),
  ]);

  return {
    perMinute: perMinute ?? 0,
    perHour: perHour ?? 0,
    emailPerHour: (emailRes as any).count ?? 0,
  };
}

export function rateLimited(req: Request, retryAfterSec: number, message: string) {
  return jsonResponse(req, { error: message }, 429, {
    "Retry-After": String(retryAfterSec),
  });
}

/** Convert a stored object path (or legacy public URL) to a signed CDN URL. */
export async function signMediaPath(
  sb: SupabaseClient,
  value: string | null | undefined,
): Promise<string | null> {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  const { data } = await sb.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(value, SIGN_TTL_SECONDS);
  return data?.signedUrl ?? null;
}

export async function signMediaList(
  sb: SupabaseClient,
  values: unknown,
): Promise<string[]> {
  if (!Array.isArray(values)) return [];
  const signed = await Promise.all(
    values.map((v) => signMediaPath(sb, typeof v === "string" ? v : null)),
  );
  return signed.filter((s): s is string => !!s);
}

/**
 * Build a stable public CDN URL for an object in `product-media`. Relies on the
 * `Public can read product media` SELECT policy on storage.objects. Appends a
 * `?v=` cache-bust derived from the row's updated_at so the URL changes only
 * when the underlying product is re-saved, allowing safe long-lived caching.
 */
export function publicMediaUrl(
  value: string | null | undefined,
  version?: string | null,
): string | null {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  const base = Deno.env.get("SUPABASE_URL")!.replace(/\/+$/, "");
  const v = version ? Date.parse(version) || version : "";
  const qs = v ? `?v=${encodeURIComponent(v)}` : "";
  const path = value.split("/").map(encodeURIComponent).join("/");
  return `${base}/storage/v1/object/public/${STORAGE_BUCKET}/${path}${qs}`;
}

export function publicMediaList(
  values: unknown,
  version?: string | null,
): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((v) => (typeof v === "string" ? publicMediaUrl(v, version) : null))
    .filter((s): s is string => !!s);
}
