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

    // Signup creates one company per person; adding more companies is a separate flow.
    const { data: existing } = await admin
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    if (existing) return json({ organization_id: existing.organization_id, existing: true });

    // Company, owner role, modules, first depot and country pack in one transaction.
    const { data: result, error: coErr } = await admin.rpc("create_company", {
      _owner: user.id,
      _name: name,
      _country: country ?? null,
      _currency: currency ?? "USD",
      _timezone: timezone ?? "UTC",
      _depot_name: depotName ?? null,
      _depot_code: depotCode ?? null,
      _company_size: null,
      _business_type: null,
      _modules: null, // the in-app form has no module picker: every module is on for the trial
    });
    if (coErr) throw coErr;

    return json(result);
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
