// Public endpoint that accepts a quote/lead request from the marketing
// website. Hardened with: CORS allowlist, IP+email rate limits, honeypot,
// minimum form-fill time, and tightened validation.

import {
  getClientIp,
  hashWithSalt,
  jsonResponse,
  preflight,
  rateLimited,
  recordAndCount,
  serviceClient,
} from "../_shared/public-api-helpers.ts";

const ENDPOINT = "public-quote-request";

// Limits (per IP unless noted)
const PER_MINUTE = 3;
const PER_HOUR = 20;
const EMAIL_PER_HOUR = 2;
const MIN_FILL_MS = 1500;

function clean(s: unknown, max = 500): string {
  return String(s ?? "").trim().slice(0, max);
}

const URL_PATTERN = /\bhttps?:\/\/|www\.|\.[a-z]{2,}\/|<a\s/i;

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return jsonResponse(req, { error: "Method not allowed" }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(req, { error: "Invalid JSON body" }, 400);
  }

  // Honeypot — silently accept and discard if filled by a bot
  const honeypot = clean(body.website ?? body.company_url ?? body.fax, 200);
  if (honeypot) {
    return jsonResponse(req, {
      ok: true,
      reference: "00000000-0000-0000-0000-000000000000",
      message: "Thanks — we received your request.",
    });
  }

  // Minimum form fill time (set client-side: ms since form rendered)
  const elapsedMs = Number(body.elapsed_ms ?? 0);
  if (!Number.isFinite(elapsedMs) || elapsedMs < MIN_FILL_MS) {
    return jsonResponse(req, { error: "Form submitted too quickly" }, 400);
  }

  const name = clean(body.name, 120);
  const email = clean(body.email, 255).toLowerCase();
  const phone = clean(body.phone, 40);
  const productSlug = clean(body.product_slug, 120);
  const message = clean(body.message, 2000);
  const preferredDate = clean(body.preferred_date, 40);
  const orgOverride = clean(body.org, 60);
  const referrer = clean(body.referrer ?? req.headers.get("referer") ?? "", 500);
  const userAgent = clean(req.headers.get("user-agent") ?? "", 500);

  if (!name || name.length < 2)
    return jsonResponse(req, { error: "Name is required" }, 400);
  if (URL_PATTERN.test(name))
    return jsonResponse(req, { error: "Invalid name" }, 400);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return jsonResponse(req, { error: "Valid email is required" }, 400);
  if (!message && !productSlug)
    return jsonResponse(req, { error: "Please describe what you are interested in" }, 400);

  const sb = serviceClient();
  const ipHash = await hashWithSalt(getClientIp(req));
  const emailHash = await hashWithSalt(email);

  const counts = await recordAndCount(sb, ENDPOINT, ipHash, emailHash, null);
  if (counts.perMinute > PER_MINUTE) {
    return rateLimited(req, 60, "Too many requests from this network. Please try again in a minute.");
  }
  if (counts.perHour > PER_HOUR) {
    return rateLimited(req, 3600, "Hourly limit reached for this network.");
  }
  if (counts.emailPerHour > EMAIL_PER_HOUR) {
    return rateLimited(req, 3600, "Hourly limit reached for this email.");
  }

  // Resolve target organization
  let orgId =
    orgOverride || Deno.env.get("PUBLIC_WEBSITE_ORG_ID") || null;
  let productName: string | null = null;

  if (productSlug) {
    const { data: product } = await sb
      .from("products")
      .select("organization_id, name")
      .eq("slug", productSlug)
      .eq("is_published", true)
      .maybeSingle();
    if (product) {
      orgId = orgId ?? product.organization_id;
      productName = product.name;
    }
  }

  if (!orgId) {
    return jsonResponse(req, { error: "Could not determine target organization for this request" }, 400);
  }

  const notesParts = [
    productName ? `Product of interest: ${productName} (${productSlug})` : null,
    preferredDate ? `Preferred date: ${preferredDate}` : null,
    phone ? `Phone: ${phone}` : null,
    message ? `\nMessage:\n${message}` : null,
  ].filter(Boolean);

  const metadata = {
    source: "website",
    referrer,
    user_agent: userAgent,
    elapsed_ms: elapsedMs,
    product_slug: productSlug || null,
    submitted_at: new Date().toISOString(),
  };

  const { data: lead, error } = await sb
    .from("leads")
    .insert({
      organization_id: orgId,
      contact_name: name,
      contact_email: email,
      contact_phone: phone || null,
      source: "website",
      status: "new",
      notes: notesParts.join("\n"),
      metadata,
    })
    .select("id")
    .single();

  if (error) return jsonResponse(req, { error: error.message }, 500);

  return jsonResponse(req, {
    ok: true,
    reference: lead.id,
    message: "Thanks — we received your request and will be in touch shortly.",
  });
});
