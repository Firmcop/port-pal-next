# Public Website API

These three endpoints let your marketing website (e.g. firmcop.com) read the
published product catalog and submit quote requests into the depot CRM. They
require **no login** — only the project's public anon key.

Base URL:

```
https://ccvlayjcgwiasblitthp.supabase.co/functions/v1
```

Anon key (publishable, safe to ship in the browser):

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNjdmxheWpjZ3dpYXNibGl0dGhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MzQ0OTEsImV4cCI6MjA5MTQxMDQ5MX0.3v9VeLS3t_SzrinGrg8hcvAQLewdy_H4ROzJEO-iYck
```

All requests must include:

```
Authorization: Bearer <ANON_KEY>
apikey:        <ANON_KEY>
```

CORS is restricted to an allowlist (your live website domains + localhost for
development). To add a new domain, ask the depot admin to update
`PUBLIC_WEBSITE_ALLOWED_ORIGINS`.

---

## 1. `GET /public-products-list`

Returns published products. Image URLs are stable public CDN URLs with a
`?v=` cache-bust token that changes only when the product is re-saved, so they
are safe to cache long-term (responses set `Cache-Control: max-age=300, s-maxage=3600`).

### Query params

| Name       | Type   | Notes                                              |
| ---------- | ------ | -------------------------------------------------- |
| `category` | string | Filter by category (e.g. `40ft House`). Optional.  |
| `slug`     | string | Match a single product by slug. Optional.          |

### Example

```bash
curl "https://ccvlayjcgwiasblitthp.supabase.co/functions/v1/public-products-list?category=40ft%20House" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ANON_KEY"
```

### Response 200

```json
{
  "products": [
    {
      "id": "5f1a…",
      "name": "40ft Container – 1 Bedroom Premium Suite",
      "slug": "40ft-1-bedroom-premium",
      "category": "40ft House",
      "short_description": "Luxury 40ft conversion …",
      "long_description": "…",
      "base_price": 1850000,
      "currency": "KES",
      "cover_image_url": "https://…/storage/v1/object/public/product-media/<org>/<file>.jpg?v=1719590400000",
      "gallery": ["https://…?v=1719590400000", "https://…?v=1719590400000"],
      "specs": { "Bedrooms": "1", "Bathrooms": "1" },
      "sort_order": 10,
      "updated_at": "2026-06-28T16:00:00Z"
    }
  ]
}
```

Rate limit: 60 requests / minute per IP. Exceeding returns `429` with a
`Retry-After` header.

---

## 2. `GET /public-product-detail?slug=<slug>`

Single product by slug.

### Example

```bash
curl "https://ccvlayjcgwiasblitthp.supabase.co/functions/v1/public-product-detail?slug=20ft-bedsitter" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ANON_KEY"
```

### Response 200

```json
{
  "product": { "id": "…", "slug": "20ft-bedsitter", "name": "20ft Bedsitter …", "cover_image_url": "https://…", "gallery": ["…"], "specs": { … } }
}
```

### Errors

- `400` `{ "error": "slug is required" }`
- `404` `{ "error": "Not found" }`
- `429` (rate limited)

---

## 3. `POST /public-quote-request`

Inserts a lead into the depot CRM and triggers the existing approval +
notification workflow.

### Required body fields

| Field         | Type    | Notes                                                                                  |
| ------------- | ------- | -------------------------------------------------------------------------------------- |
| `name`        | string  | 2–120 chars. URLs/HTML rejected.                                                       |
| `email`       | string  | Valid email.                                                                            |
| `message`     | string  | Free-form (up to 2000 chars). Required unless `product_slug` is set.                   |
| `elapsed_ms`  | number  | Milliseconds since the form was rendered. Must be ≥ 1500. (Bot deterrent.)             |

### Optional body fields

| Field            | Type   | Notes                                                       |
| ---------------- | ------ | ----------------------------------------------------------- |
| `phone`          | string | Up to 40 chars.                                              |
| `product_slug`   | string | If set, lead is tagged with the matching product.            |
| `preferred_date` | string | Free-form date string (e.g. `2026-07-15`).                   |
| `referrer`       | string | Page URL the user came from.                                 |
| `website`        | string | **HONEYPOT** — must be empty. Hidden field in your form.     |
| `company_url`    | string | **HONEYPOT** — same.                                         |

### Spam / rate limits

- 3 submissions / minute per IP
- 20 submissions / hour per IP
- 2 submissions / hour per email
- Submissions faster than 1.5 seconds are rejected
- Honeypot-filled submissions return `200 ok` but are silently discarded

### Example

```bash
curl -X POST "https://ccvlayjcgwiasblitthp.supabase.co/functions/v1/public-quote-request" \
  -H "Content-Type: application/json" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ANON_KEY" \
  -d '{
    "name": "Jane Doe",
    "email": "jane@example.com",
    "phone": "+254700000000",
    "product_slug": "40ft-1-bedroom-premium",
    "message": "Interested in delivery to Naivasha by August.",
    "elapsed_ms": 4200
  }'
```

### Response 200

```json
{
  "ok": true,
  "reference": "9d4c7e8a-…",
  "message": "Thanks — we received your request and will be in touch shortly."
}
```

### Errors

- `400` validation failed — body includes `{ "error": "…" }`
- `429` rate limited — header `Retry-After` (seconds)
- `500` server error

---

## Ready-to-paste client (`depotApi.ts`)

Drop this into your website project (works in React, Vue, plain JS, or any
modern bundler). No depot SDK needed.

```ts
// depotApi.ts
const DEPOT_URL =
  "https://ccvlayjcgwiasblitthp.supabase.co/functions/v1";
const DEPOT_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNjdmxheWpjZ3dpYXNibGl0dGhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MzQ0OTEsImV4cCI6MjA5MTQxMDQ5MX0.3v9VeLS3t_SzrinGrg8hcvAQLewdy_H4ROzJEO-iYck";

const headers = {
  "Content-Type": "application/json",
  apikey: DEPOT_ANON_KEY,
  Authorization: `Bearer ${DEPOT_ANON_KEY}`,
};

export type Product = {
  id: string;
  name: string;
  slug: string;
  category: string | null;
  short_description: string | null;
  long_description: string | null;
  base_price: number | null;
  currency: string | null;
  cover_image_url: string | null;
  gallery: string[];
  specs: Record<string, string>;
  sort_order: number;
  updated_at: string;
};

export async function listProducts(category?: string): Promise<Product[]> {
  const url = new URL(`${DEPOT_URL}/public-products-list`);
  if (category) url.searchParams.set("category", category);
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`Depot API error ${r.status}`);
  const { products } = await r.json();
  return products;
}

export async function getProduct(slug: string): Promise<Product | null> {
  const url = new URL(`${DEPOT_URL}/public-product-detail`);
  url.searchParams.set("slug", slug);
  const r = await fetch(url, { headers });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Depot API error ${r.status}`);
  const { product } = await r.json();
  return product;
}

export type QuoteRequest = {
  name: string;
  email: string;
  phone?: string;
  product_slug?: string;
  message?: string;
  preferred_date?: string;
  referrer?: string;
  /** Set client-side: ms since the form was rendered. Required (>= 1500). */
  elapsed_ms: number;
  /** Hidden honeypot fields — leave empty. */
  website?: string;
  company_url?: string;
};

export async function submitQuoteRequest(payload: QuoteRequest) {
  const r = await fetch(`${DEPOT_URL}/public-quote-request`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const retryAfter = r.headers.get("Retry-After");
    throw Object.assign(
      new Error(data.error ?? `Depot API error ${r.status}`),
      { status: r.status, retryAfter },
    );
  }
  return data as { ok: true; reference: string; message: string };
}
```

### React hook example

```tsx
import { useEffect, useState } from "react";
import { listProducts, type Product } from "./depotApi";

export function useProducts(category?: string) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listProducts(category)
      .then((p) => !cancelled && setProducts(p))
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [category]);

  return { products, loading, error };
}
```

### Quote form (with honeypot + timing)

```tsx
import { useRef, useState } from "react";
import { submitQuoteRequest } from "./depotApi";

export function QuoteForm({ productSlug }: { productSlug?: string }) {
  const renderedAt = useRef(Date.now());
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = new FormData(e.currentTarget);
    try {
      await submitQuoteRequest({
        name: String(f.get("name") ?? ""),
        email: String(f.get("email") ?? ""),
        phone: String(f.get("phone") ?? ""),
        message: String(f.get("message") ?? ""),
        product_slug: productSlug,
        website: String(f.get("website") ?? ""), // honeypot
        elapsed_ms: Date.now() - renderedAt.current,
        referrer: typeof document !== "undefined" ? document.referrer : "",
      });
      setSent(true);
    } catch (err: any) {
      setError(err.message);
    }
  }

  if (sent) return <p>Thanks — we'll be in touch shortly.</p>;

  return (
    <form onSubmit={onSubmit}>
      <input name="name" required placeholder="Your name" />
      <input name="email" type="email" required placeholder="Email" />
      <input name="phone" placeholder="Phone" />
      <textarea name="message" placeholder="Tell us what you need" />
      {/* Honeypot — must stay empty. Hide from real users. */}
      <input
        name="website"
        tabIndex={-1}
        autoComplete="off"
        style={{ position: "absolute", left: "-9999px" }}
        aria-hidden="true"
      />
      {error && <p style={{ color: "red" }}>{error}</p>}
      <button type="submit">Request a quote</button>
    </form>
  );
}
```

---

## Error handling cheatsheet

| Status | Meaning              | Recommended UI behaviour                              |
| ------ | -------------------- | ----------------------------------------------------- |
| 400    | Validation failed    | Show the `error` message inline on the field.         |
| 404    | Product not found    | Render a "Not found" page.                            |
| 429    | Rate limited         | Show a friendly retry message; respect `Retry-After`. |
| 500    | Server error         | Show generic error, log to your monitoring.           |
