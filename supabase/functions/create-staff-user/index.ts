import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STAFF_ROLES = [
  "admin","yard_operator","gate_clerk","viewer",
  "accountant","hr_manager","production_manager","procurement_officer",
  "supply_chain_manager","sales_manager","leasing_manager","mr_supervisor",
] as const;

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
    const { email, password, displayName, role, roles, organization_id: requestedOrgId } = body ?? {};

    // Caller must be org_owner/admin in the requested org (or their first active admin org)
    let memberQuery = admin
      .from("organization_members")
      .select("organization_id, role")
      .eq("user_id", caller.id)
      .eq("status", "active")
      .in("role", ["org_owner", "admin"]);
    if (requestedOrgId) memberQuery = memberQuery.eq("organization_id", requestedOrgId);
    const { data: callerMember } = await memberQuery
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!callerMember) return j({ error: "Only organization owners/admins can add users" }, 403);

    const rolesArr: string[] = Array.isArray(roles) && roles.length ? roles : (role ? [role] : []);
    if (!email || !password || rolesArr.length === 0) return j({ error: "email, password and at least one role are required" }, 400);
    for (const r of rolesArr) if (!STAFF_ROLES.includes(r as any)) return j({ error: `Invalid role: ${r}` }, 400);
    if (String(password).length < 8) return j({ error: "Password must be at least 8 characters" }, 400);

    const targetEmail = String(email).trim().toLowerCase();

    // Block user creation when org has no active subscription
    const { data: subActive } = await admin.rpc("org_subscription_active", { _org: callerMember.organization_id });
    if (subActive === false) {
      return j({
        error: "Organization subscription is inactive. Renew or upgrade to add users.",
        code: "subscription_inactive",
      }, 402);
    }

    // Enforce subscription seat capacity
    const { data: cap } = await admin.rpc("check_seat_capacity", { _org: callerMember.organization_id });

    const capRow = Array.isArray(cap) ? cap[0] : cap;
    if (capRow && capRow.can_add === false) {
      return j({
        error: `Seat limit reached (${capRow.used}/${capRow.seat_limit}). Upgrade your subscription to add more users.`,
        code: "seat_limit_reached",
        used: capRow.used,
        seat_limit: capRow.seat_limit,
      }, 402);
    }

    // Check if user already exists
    const { data: existingUsers } = await admin.auth.admin.listUsers();

    let userId: string | null =
      existingUsers.users.find((u: any) => (u.email ?? "").toLowerCase() === targetEmail)?.id ?? null;

    let createdHere = false;
    if (!userId) {
      const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
        email: targetEmail,
        password,
        email_confirm: true,
        user_metadata: { display_name: displayName ?? targetEmail },
      });
      if (createErr) return j({ error: createErr.message }, 400);
      userId = newUser.user.id;
      createdHere = true;
    }

    try {
      // Ensure profile
      await admin.from("profiles").upsert(
        { user_id: userId, display_name: displayName ?? targetEmail },
        { onConflict: "user_id" }
      );

      // Block duplicate membership
      const { data: existingMem } = await admin
        .from("organization_members")
        .select("id, status")
        .eq("organization_id", callerMember.organization_id)
        .eq("user_id", userId)
        .maybeSingle();

      if (existingMem && existingMem.status === "active") {
        return j({ error: "User is already a member of this organization" }, 400);
      }

      if (existingMem) {
        await admin
          .from("organization_members")
          .update({ status: "active", role: "viewer" })
          .eq("id", existingMem.id);
      } else {
        const { error: memErr } = await admin.from("organization_members").insert({
          organization_id: callerMember.organization_id,
          user_id: userId,
          role: "viewer",
          status: "active",
        });
        if (memErr) throw memErr;
      }

      // Assign staff roles (replace existing) — scoped to the caller's organization
      await admin.from("user_roles").delete().eq("user_id", userId).in("role", STAFF_ROLES as any);
      const { error: roleErr } = await admin
        .from("user_roles")
        .insert(rolesArr.map((r) => ({ user_id: userId, role: r, organization_id: callerMember.organization_id })));
      if (roleErr) throw roleErr;

      await admin.rpc("log_org_event", {
        _org_id: callerMember.organization_id,
        _event_type: "user_added_directly",
        _details: { email: targetEmail, roles: rolesArr, created_auth_user: createdHere },
        _actor: caller.id,
      });

      return j({ ok: true, user_id: userId, created: createdHere });
    } catch (e: any) {
      if (createdHere && userId) {
        await admin.auth.admin.deleteUser(userId).catch(() => {});
      }
      return j({ error: e?.message ?? "Failed to provision user" }, 500);
    }
  } catch (e: any) {
    console.error("create-staff-user error", e);
    return j({ error: e?.message ?? "Internal error" }, 500);
  }
});
