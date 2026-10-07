// Public endpoint returning a single published product by slug, with signed
// CDN URLs for cover image and gallery.

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

const ENDPOINT = "public-product-detail";
const PER_MINUTE_LIMIT = 60;

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "GET") return jsonResponse(req, { error: "Method not allowed" }, 405);

  const url = new URL(req.url);
  const slug = url.searchParams.get("slug");
  if (!slug) return jsonResponse(req, { error: "slug is required" }, 400);

  const sb = serviceClient();
  const ipHash = await hashWithSalt(getClientIp(req));

  const counts = await recordAndCount(sb, ENDPOINT, ipHash, null, null);
  if (counts.perMinute > PER_MINUTE_LIMIT) {
    return rateLimited(req, 60, "Too many requests — please slow down.");
  }

  const orgFilter =
    url.searchParams.get("org") ?? Deno.env.get("PUBLIC_WEBSITE_ORG_ID") ?? null;

  let q = sb
    .from("products")
    .select(
      "id, organization_id, name, slug, category, short_description, long_description, base_price, currency, cover_image_url, gallery, specs, updated_at",
    )
    .eq("is_published", true)
    .eq("slug", slug)
    .limit(1);
  if (orgFilter) q = q.eq("organization_id", orgFilter);

  const { data, error } = await q.maybeSingle();
  if (error) return jsonResponse(req, { error: error.message }, 500);
  if (!data) return jsonResponse(req, { error: "Not found" }, 404);

  const version = (data as any).updated_at as string | null;
  const product = {
    ...data,
    cover_image_url: publicMediaUrl((data as any).cover_image_url, version),
    gallery: publicMediaList((data as any).gallery, version),
  };

  return jsonResponse(req, { product }, 200, {
    "Cache-Control": "public, max-age=300, s-maxage=3600",
  });
});
