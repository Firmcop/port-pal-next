// Where the app finds its database. Public values (they ship to every browser).
//
// The Lovable-hosted database (ccvlayjcgwiasblitthp) was shut down on or before
// 5 Nov 2026. Vercel's settings still name it, so any setting that points there
// is replaced by port-pal-prod. Once the Vercel settings are updated this
// fallback does nothing.
const RETIRED_PROJECT = "ccvlayjcgwiasblitthp";
const PROD = {
  url: "https://oagthtplaxgbvpijargj.supabase.co",
  key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hZ3RodHBsYXhnYnZwaWphcmdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0NjU5NzYsImV4cCI6MjEwNzA0MTk3Nn0.12FZixqDnM6lz8_naJY5Sc471j0GuREGJ_kg5S0hysI",
  projectId: "oagthtplaxgbvpijargj",
};

const envUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const useProd = !envUrl || envUrl.includes(RETIRED_PROJECT);

export const SUPABASE_URL = useProd ? PROD.url : envUrl;
export const SUPABASE_PUBLISHABLE_KEY = useProd ? PROD.key : (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string);
export const SUPABASE_PROJECT_ID = useProd ? PROD.projectId : (process.env.NEXT_PUBLIC_SUPABASE_PROJECT_ID ?? "");
