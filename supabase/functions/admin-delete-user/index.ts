import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return j({ error: "Unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: ud, error: ue } = await userClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (ue || !ud?.user) return j({ error: "Unauthorized" }, 401);
    const caller = ud.user;

    const admin = createClient(url, serviceKey);
    const body = await req.json().catch(() => ({}));
    const { userId, organization_id: orgId, hardDelete } = body ?? {};
    if (!userId || !orgId) return j({ error: "userId and organization_id required" }, 400);
    if (userId === caller.id) return j({ error: "You cannot delete your own account here" }, 400);

    // Caller authorization
    const { data: callerMember } = await admin
      .from("organization_members")
      .select("role")
      .eq("user_id", caller.id)
      .eq("organization_id", orgId)
      .eq("status", "active")
      .in("role", ["org_owner", "admin"])
      .maybeSingle();
    if (!callerMember) return j({ error: "Only organization owners/admins can delete users" }, 403);

    // Target membership
    const { data: targetMem } = await admin
      .from("organization_members")
      .select("id, role")
      .eq("organization_id", orgId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!targetMem) return j({ error: "User is not a member of this organization" }, 404);

    // Last-owner guard
    if (targetMem.role === "org_owner") {
      const { count } = await admin
        .from("organization_members")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("role", "org_owner")
        .eq("status", "active");
      if ((count ?? 0) <= 1) return j({ error: "Cannot remove the last organization owner" }, 400);
    }

    // Detach from this org
    await admin.from("organization_members").delete().eq("id", targetMem.id);
    await admin.from("user_roles").delete().eq("user_id", userId).eq("organization_id", orgId);

    // Check other org memberships
    const { count: otherOrgs } = await admin
      .from("organization_members")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "active");

    let authDeleted = false;
    if (hardDelete && (otherOrgs ?? 0) === 0) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (!error) authDeleted = true;
    }

    await admin.rpc("log_org_event", {
      _org_id: orgId,
      _event_type: "user_deleted_by_admin",
      _details: { target_user_id: userId, hard_delete: authDeleted },
      _actor: caller.id,
    }).catch(() => {});

    return j({ ok: true, auth_user_deleted: authDeleted });
  } catch (e: any) {
    console.error("admin-delete-user error", e);
    return j({ error: e?.message ?? "Internal error" }, 500);
  }
});
