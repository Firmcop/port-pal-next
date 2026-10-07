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
const APP_URL = "https://portal.firmcop.com";

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
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
    const { mode = "create", invitationId, email, displayName, role, roles, organization_id: requestedOrgId } = body ?? {};

    // Caller must be org_owner/admin in the requested org (or any active admin org)
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

    if (!callerMember) return j({ error: "Only organization owners/admins can invite teammates" }, 403);

    // Normalize roles[]
    let rolesArr: string[] = Array.isArray(roles) && roles.length ? roles : (role ? [role] : []);

    // ---- Revoke ----
    if (mode === "revoke") {
      if (!invitationId) return j({ error: "invitationId required" }, 400);
      const { data: inv } = await admin.from("staff_invitations").select("organization_id,email").eq("id", invitationId).maybeSingle();
      if (!inv || inv.organization_id !== callerMember.organization_id) return j({ error: "Not found" }, 404);
      await admin.from("staff_invitations").update({ revoked_at: new Date().toISOString() }).eq("id", invitationId);
      await admin.rpc("log_org_event", {
        _org_id: callerMember.organization_id,
        _event_type: "invitation_revoked",
        _details: { email: inv.email, invitation_id: invitationId },
        _actor: caller.id,
      });
      return j({ ok: true });
    }

    // Block invites when org has no active subscription (skip for revoke handled above)
    if (mode === "create" || mode === "resend") {
      const { data: subActive } = await admin.rpc("org_subscription_active", { _org: callerMember.organization_id });
      if (subActive === false) {
        return j({
          error: "Organization subscription is inactive. Renew or upgrade to invite users.",
          code: "subscription_inactive",
        }, 402);
      }
    }

    // ---- Create or resend ----
    if (mode === "create") {
      if (!email || rolesArr.length === 0) return j({ error: "email and at least one role are required" }, 400);
      for (const r of rolesArr) if (!STAFF_ROLES.includes(r as any)) return j({ error: `Invalid role: ${r}` }, 400);

    } else if (mode === "resend") {
      if (!invitationId) return j({ error: "invitationId required" }, 400);
    } else {
      return j({ error: "Invalid mode" }, 400);
    }

    let targetEmail: string;
    let targetRoles: string[];
    let targetDisplayName: string | null = displayName ?? null;
    let invitationRow: any;

    if (mode === "resend") {
      const { data: inv } = await admin.from("staff_invitations").select("*").eq("id", invitationId).maybeSingle();
      if (!inv || inv.organization_id !== callerMember.organization_id) return j({ error: "Not found" }, 404);
      if (inv.accepted_at || inv.revoked_at) return j({ error: "Invitation no longer active" }, 400);
      targetEmail = inv.email;
      targetRoles = Array.isArray(inv.roles) && inv.roles.length ? inv.roles : [inv.role];
      targetDisplayName = inv.display_name;
      invitationRow = inv;
    } else {
      targetEmail = String(email).trim().toLowerCase();
      targetRoles = rolesArr;

      // Enforce subscription seat capacity before creating any invite
      const { data: cap } = await admin.rpc("check_seat_capacity", { _org: callerMember.organization_id });
      const capRow = Array.isArray(cap) ? cap[0] : cap;
      if (capRow && capRow.can_add === false) {
        return j({
          error: `Seat limit reached (${capRow.used}/${capRow.seat_limit}). Upgrade your subscription to invite more users.`,
          code: "seat_limit_reached",
          used: capRow.used,
          seat_limit: capRow.seat_limit,
        }, 402);
      }

      // Block if already an active member of this org
      const { data: existingUser } = await admin.auth.admin.listUsers();
      const existing = existingUser.users.find((u: any) => (u.email ?? "").toLowerCase() === targetEmail);
      if (existing) {
        const { data: mem } = await admin
          .from("organization_members")
          .select("id")
          .eq("organization_id", callerMember.organization_id)
          .eq("user_id", existing.id)
          .eq("status", "active")
          .maybeSingle();
        if (mem) return j({ error: "User is already a member of this organization" }, 400);
      }

      // Revoke prior pending invitations for the same email+org
      await admin
        .from("staff_invitations")
        .update({ revoked_at: new Date().toISOString() })
        .eq("organization_id", callerMember.organization_id)
        .eq("email", targetEmail)
        .is("accepted_at", null)
        .is("revoked_at", null);
    }


    const rawToken = generateToken();
    const tokenHash = await sha256Hex(rawToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    if (mode === "resend") {
      const { error } = await admin
        .from("staff_invitations")
        .update({ token_hash: tokenHash, expires_at: expiresAt })
        .eq("id", invitationRow.id);
      if (error) return j({ error: error.message }, 400);
    } else {
      const { data: created, error } = await admin
        .from("staff_invitations")
        .insert({
          organization_id: callerMember.organization_id,
          email: targetEmail,
          role: targetRoles[0],
          roles: targetRoles,
          display_name: targetDisplayName,
          token_hash: tokenHash,
          expires_at: expiresAt,
          invited_by: caller.id,
        })
        .select()
        .single();
      if (error) return j({ error: error.message }, 400);
      invitationRow = created;
    }

    // Lookup org name + inviter name for the email
    const [{ data: org }, { data: inviterProfile }] = await Promise.all([
      admin.from("organizations").select("name").eq("id", callerMember.organization_id).maybeSingle(),
      admin.from("profiles").select("display_name").eq("user_id", caller.id).maybeSingle(),
    ]);

    const acceptUrl = `${APP_URL}/accept-invite?token=${rawToken}`;

    // Enqueue branded email
    await admin.functions.invoke("send-transactional-email", {
      body: {
        templateName: "staff-invite",
        recipientEmail: targetEmail,
        idempotencyKey: `staff-invite-${invitationRow.id}-${Date.now()}`,
        templateData: {
          inviterName: inviterProfile?.display_name ?? caller.email,
          organizationName: org?.name ?? "your organization",
          roleLabel: targetRoles.join(", "),
          acceptUrl,
          expiresInDays: 7,
        },
      },
    });

    // Log
    await admin.rpc("log_org_event", {
      _org_id: callerMember.organization_id,
      _event_type: mode === "resend" ? "invitation_resent" : "user_invited",
      _details: { email: targetEmail, roles: targetRoles, invitation_id: invitationRow.id },
      _actor: caller.id,
    });

    return j({ ok: true, invitation_id: invitationRow.id });
  } catch (e: any) {
    console.error("invite-staff-user error", e);
    return j({ error: e?.message ?? "Internal error" }, 500);
  }
});

function j(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
