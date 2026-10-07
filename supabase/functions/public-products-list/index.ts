// Public, unauthenticated endpoint returning published products with CDN-ready
// image URLs. Hardened with CORS allowlist and light per-IP rate limiting.

import {
  getClientIp,
  hashWithSalt,
  jsonResponse,
  preflight,
  publicMediaList,
  publicMediaUrl,
  rateLimited,
  recordAndCount,
  serviceClient,
} from "../_shared/public-api-helpers.ts";

const ENDPOINT = "public-products-list";
const PER_MINUTE_LIMIT = 60;

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "GET") return jsonResponse(req, { error: "Method not allowed" }, 405);

  const sb = serviceClient();
  const ipHash = await hashWithSalt(getClientIp(req));

  const counts = await recordAndCount(sb, ENDPOINT, ipHash, null, null);
  if (counts.perMinute > PER_MINUTE_LIMIT) {
    return rateLimited(req, 60, "Too many requests — please slow down.");
  }

  const url = new URL(req.url);
  const category = url.searchParams.get("category");
  const slug = url.searchParams.get("slug");
  const orgFilter =
    url.searchParams.get("org") ?? Deno.env.get("PUBLIC_WEBSITE_ORG_ID") ?? null;

  let q = sb
    .from("products")
    .select(
      "id, organization_id, name, slug, category, short_description, long_description, base_price, currency, cover_image_url, gallery, specs, sort_order, updated_at",
    )
    .eq("is_published", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
    .limit(200);

  if (category) q = q.eq("category", category);
  if (slug) q = q.eq("slug", slug);
  if (orgFilter) q = q.eq("organization_id", orgFilter);

  const { data, error } = await q;
  if (error) return jsonResponse(req, { error: error.message }, 500);

  const products = (data ?? []).map((p: any) => ({
    ...p,
    cover_image_url: publicMediaUrl(p.cover_image_url, p.updated_at),
    gallery: publicMediaList(p.gallery, p.updated_at),
  }));

  return jsonResponse(req, { products }, 200, {
    "Cache-Control": "public, max-age=300, s-maxage=3600",
  });
});
