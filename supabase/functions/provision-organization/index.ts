import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) return json({ error: "Unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);
    const user = userData.user;

    const body = await req.json().catch(() => ({}));
    const { name, country, currency, timezone, depotName, depotCode } = body;
    if (!name || typeof name !== "string") return json({ error: "name required" }, 400);

    const admin = createClient(url, serviceKey);

    // Already a member of a real org? return existing (ignore default/legacy org)
    const { data: existing } = await admin
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .eq("status", "active")
      .neq("organization_id", "00000000-0000-0000-0000-000000000001")
      .maybeSingle();
    if (existing) return json({ organization_id: existing.organization_id, existing: true });

    // Clean up any stale membership in the default/legacy org so the new tenant is truly isolated
    await admin
      .from("organization_members")
      .delete()
      .eq("user_id", user.id)
      .eq("organization_id", "00000000-0000-0000-0000-000000000001");

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40)
      + "-" + Math.random().toString(36).slice(2, 6);

    const { data: org, error: orgErr } = await admin
      .from("organizations")
      .insert({
        name,
        slug,
        country: country ?? null,
        currency: currency ?? "USD",
        timezone: timezone ?? "UTC",
        owner_user_id: user.id,
        billing_email: user.email,
        status: "trial",
      })
      .select()
      .single();
    if (orgErr) throw orgErr;

    await admin.from("organization_members").insert({
      organization_id: org.id,
      user_id: user.id,
      role: "org_owner",
      status: "active",
    });

    // Grant staff "admin" role so the owner can use the app and manage users
    await admin.from("user_roles").upsert(
      { user_id: user.id, role: "admin", organization_id: org.id },
      { onConflict: "user_id,role" }
    );

    // Seed subscription_modules: enable every module for the trial
    const { data: catalog } = await admin
      .from("modules_catalog")
      .select("code, monthly_price");
    if (catalog?.length) {
      await admin.from("subscription_modules").upsert(
        catalog.map((m: any) => ({
          organization_id: org.id,
          module_code: m.code,
          price_snapshot: m.monthly_price,
          enabled: true,
        })),
        { onConflict: "organization_id,module_code" }
      );
    }

    if (depotName && depotCode) {
      await admin.from("depots").insert({
        organization_id: org.id,
        name: depotName,
        code: depotCode,
        currency: org.currency,
        timezone: org.timezone,
      });
    }

    // Audit lifecycle events
    await admin.rpc("log_org_event", {
      _org_id: org.id,
      _event_type: "org_created",
      _details: { country, currency, timezone, depot: depotName ?? null },
      _actor: user.id,
    });
    await admin.rpc("log_org_event", {
      _org_id: org.id,
      _event_type: "trial_started",
      _details: { trial_ends_at: org.trial_ends_at, days: 14 },
      _actor: user.id,
    });

    return json({ organization_id: org.id, slug: org.slug });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
