import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey);

    const body = await req.json().catch(() => ({}));
    const { token, password } = body ?? {};
    if (!token || !password) return j({ error: "token and password required" }, 400);
    if (typeof password !== "string" || password.length < 8) return j({ error: "Password must be at least 8 characters" }, 400);

    const tokenHash = await sha256Hex(token);
    const { data: inv } = await admin
      .from("staff_invitations")
      .select("*")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (!inv) return j({ error: "Invalid invitation" }, 404);
    if (inv.revoked_at) return j({ error: "Invitation was revoked" }, 400);
    if (inv.accepted_at) return j({ error: "Invitation already accepted" }, 400);
    if (new Date(inv.expires_at).getTime() < Date.now()) return j({ error: "Invitation expired" }, 400);

    const email = (inv.email as string).toLowerCase();

    // Find or create the user
    const { data: list } = await admin.auth.admin.listUsers();
    let user = list.users.find((u: any) => (u.email ?? "").toLowerCase() === email);

    if (!user) {
      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: inv.display_name ?? email },
      });
      if (cErr || !created?.user) return j({ error: cErr?.message ?? "Could not create user" }, 400);
      user = created.user;
    } else {
      // Update password so they can sign in immediately
      await admin.auth.admin.updateUserById(user.id, { password });
    }

    // Profile
    await admin.from("profiles").upsert(
      { user_id: user.id, display_name: inv.display_name ?? user.email },
      { onConflict: "user_id" },
    );

    // Add to organization (idempotent)
    await admin
      .from("organization_members")
      .upsert(
        {
          organization_id: inv.organization_id,
          user_id: user.id,
          role: "member",
          status: "active",
        },
        { onConflict: "organization_id,user_id" },
      );

    // Assign staff role(s) — replaces any existing staff role rows for this user
    const STAFF_ROLES = [
      "admin","yard_operator","gate_clerk","viewer",
      "accountant","hr_manager","production_manager","procurement_officer",
      "supply_chain_manager","sales_manager","leasing_manager","mr_supervisor",
    ];
    const invitedRoles: string[] =
      Array.isArray((inv as any).roles) && (inv as any).roles.length ? (inv as any).roles : [inv.role];
    await admin
      .from("user_roles")
      .delete()
      .eq("user_id", user.id)
      .in("role", STAFF_ROLES);
    await admin
      .from("user_roles")
      .upsert(
        invitedRoles.map((r) => ({ user_id: user.id, role: r, organization_id: inv.organization_id })),
        { onConflict: "user_id,role" },
      );

    // Mark accepted
    await admin
      .from("staff_invitations")
      .update({ accepted_at: new Date().toISOString(), accepted_user_id: user.id })
      .eq("id", inv.id);

    await admin.rpc("log_org_event", {
      _org_id: inv.organization_id,
      _event_type: "user_activated",
      _details: { email, roles: invitedRoles, invitation_id: inv.id },
      _actor: user.id,
    });

    return j({ ok: true, email });
  } catch (e: any) {
    console.error("accept-staff-invite error", e);
    return j({ error: e?.message ?? "Internal error" }, 500);
  }
});

function j(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
