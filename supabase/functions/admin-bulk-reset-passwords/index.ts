import { createClient } from "npm:@supabase/supabase-js@2.103.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function j(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v.trim());
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Internal error");

// Password alphabet: no ambiguous chars (0/O/1/l/I).
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
function generatePassword(len = 14) {
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[buf[i] % ALPHABET.length];
  // Guarantee at least one digit + one upper + one lower.
  return out.replace(/^./, "A").replace(/.$/, "7").slice(0, -2) + "a7";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return j({ error: "Unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anon || !serviceKey) return j({ error: "Backend not configured" }, 500);

    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: ud, error: ue } = await userClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (ue || !ud?.user) return j({ error: "Unauthorized" }, 401);
    const caller = ud.user;

    const admin = createClient(url, serviceKey);
    const body = await req.json().catch(() => ({}));
    const orgId = body?.organization_id;
    const userIds: unknown = body?.userIds;
    if (!isUuid(orgId)) return j({ error: "Valid organization_id required" }, 400);

    // Caller must be org_owner/admin of that org.
    const { data: callerMember, error: cmErr } = await admin
      .from("organization_members")
      .select("organization_id, role")
      .eq("organization_id", orgId)
      .eq("user_id", caller.id)
      .eq("status", "active")
      .in("role", ["org_owner", "admin"])
      .maybeSingle();
    if (cmErr) return j({ error: cmErr.message }, 400);
    if (!callerMember) return j({ error: "Only organization owners/admins can bulk reset passwords" }, 403);

    // Resolve target users: active org members, excluding the caller.
    const { data: members, error: memErr } = await admin
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", orgId)
      .eq("status", "active");
    if (memErr) return j({ error: memErr.message }, 400);
    let targets = (members ?? []).map((m: { user_id: string }) => m.user_id).filter((u) => u !== caller.id);

    if (Array.isArray(userIds) && userIds.length) {
      const allowed = new Set(userIds.filter(isUuid));
      targets = targets.filter((u) => allowed.has(u));
    }
    if (!targets.length) return j({ ok: true, results: [] });

    // Exclude portal-only users (role = 'customer' and no staff role).
    const { data: allRoles } = await admin
      .from("user_roles")
      .select("user_id, role")
      .in("user_id", targets);
    const rolesByUser = new Map<string, string[]>();
    (allRoles ?? []).forEach((r: { user_id: string; role: string }) => {
      const list = rolesByUser.get(r.user_id) ?? [];
      list.push(r.role);
      rolesByUser.set(r.user_id, list);
    });
    targets = targets.filter((u) => {
      const roles = rolesByUser.get(u) ?? [];
      if (!roles.length) return true;
      return roles.some((r) => r !== "customer");
    });

    // Load display names.
    const { data: profs } = await admin
      .from("profiles")
      .select("user_id, display_name")
      .in("user_id", targets);
    const nameByUser = new Map<string, string>();
    (profs ?? []).forEach((p: { user_id: string; display_name: string | null }) => {
      if (p.display_name) nameByUser.set(p.user_id, p.display_name);
    });

    const results: Array<{
      userId: string;
      email: string | null;
      displayName: string | null;
      roles: string[];
      password: string | null;
      ok: boolean;
      error?: string;
    }> = [];

    for (const uid of targets) {
      const roles = (rolesByUser.get(uid) ?? []).filter((r) => r !== "customer");
      try {
        const { data: got, error: gErr } = await admin.auth.admin.getUserById(uid);
        if (gErr || !got?.user) throw new Error(gErr?.message ?? "User not found");
        const email = got.user.email ?? null;
        const password = generatePassword(14);
        const { error: uErr } = await admin.auth.admin.updateUserById(uid, { password });
        if (uErr) throw new Error(uErr.message);
        try { await admin.auth.admin.signOut(uid); } catch { /* non-fatal */ }
        results.push({
          userId: uid,
          email,
          displayName: nameByUser.get(uid) ?? null,
          roles,
          password,
          ok: true,
        });
      } catch (e) {
        results.push({
          userId: uid,
          email: null,
          displayName: nameByUser.get(uid) ?? null,
          roles,
          password: null,
          ok: false,
          error: errMsg(e),
        });
      }
    }

    try {
      await admin.rpc("log_org_event", {
        _org_id: orgId,
        _event_type: "bulk_password_reset",
        _details: { count: results.length, success: results.filter((r) => r.ok).length },
        _actor: caller.id,
      });
    } catch { /* ignore */ }

    return j({ ok: true, results });
  } catch (e) {
    console.error("admin-bulk-reset-passwords error", errMsg(e));
    return j({ error: errMsg(e) }, 500);
  }
});
