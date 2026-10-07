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

function isUuid(v: unknown) {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.trim());
}

function cleanEmail(v: unknown) {
  const email = String(v ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : "Internal error";
}

type AuthUserSummary = {
  id: string;
  email?: string | null;
};

async function findUserByEmail(admin: ReturnType<typeof createClient>, email: string) {
  let page = 1;
  const perPage = 1000;
  while (page <= 20) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const found = (data.users as AuthUserSummary[]).find((u) => (u.email ?? "").toLowerCase() === email);
    if (found) return found;
    if (data.users.length < perPage) return null;
    page += 1;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return j({ error: "Unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anon || !serviceKey) {
      console.error("admin-update-user missing backend credentials");
      return j({ error: "User management is not configured on the backend" }, 500);
    }

    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: ud, error: ue } = await userClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (ue || !ud?.user) return j({ error: "Unauthorized" }, 401);
    const caller = ud.user;

    const admin = createClient(url, serviceKey);
    const body = await req.json().catch(() => ({}));
    const {
      userId,
      organization_id: orgId,
      email,
      password,
      displayName,
      phone,
      signOutAll,
    } = body ?? {};

    if (!isUuid(userId)) return j({ error: "Valid userId required" }, 400);
    if (orgId && !isUuid(orgId)) return j({ error: "Valid organization_id required" }, 400);
    if (email && !cleanEmail(email)) return j({ error: "Enter a valid email address" }, 400);

    // Caller must be org_owner/admin in same org as target user
    let memberQ = admin
      .from("organization_members")
      .select("organization_id, role")
      .eq("user_id", caller.id)
      .eq("status", "active")
      .in("role", ["org_owner", "admin"]);
    if (orgId) memberQ = memberQ.eq("organization_id", orgId);
    const { data: callerMember, error: callerMemberErr } = await memberQ.limit(1).maybeSingle();
    if (callerMemberErr) return j({ error: callerMemberErr.message }, 400);
    if (!callerMember) return j({ error: "Only organization owners/admins can manage users" }, 403);

    // Target must belong to that org
    const { data: targetMem, error: targetMemErr } = await admin
      .from("organization_members")
      .select("id, role")
      .eq("organization_id", callerMember.organization_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (targetMemErr) return j({ error: targetMemErr.message }, 400);
    if (!targetMem) return j({ error: "User is not a member of this organization" }, 404);

    if (password && String(password).length < 8) {
      return j({ error: "Password must be at least 8 characters" }, 400);
    }

    const authUpdate: Record<string, unknown> = {};
    if (email) {
      const newEmail = cleanEmail(email)!;
      const { data: targetUser, error: targetUserErr } = await admin.auth.admin.getUserById(userId);
      if (targetUserErr || !targetUser?.user) return j({ error: targetUserErr?.message ?? "User account was not found" }, 404);
      const currentEmail = (targetUser.user.email ?? "").toLowerCase();
      if (currentEmail !== newEmail) {
        const existing = await findUserByEmail(admin, newEmail);
        if (existing) {
          // If the email already resolves to this same auth user, treat as no-op
          if (existing.id === userId) {
            // nothing to update
          } else {
            return j({ error: "Email is already in use by another user" }, 409);
          }
        } else {
          authUpdate.email = newEmail;
          authUpdate.email_confirm = true;
        }
      }
    }
    if (password) authUpdate.password = password;
    if (Object.keys(authUpdate).length) {
      const { error } = await admin.auth.admin.updateUserById(userId, authUpdate);
      if (error) {
        const msg = /duplicate|already/i.test(error.message)
          ? "Email is already in use by another user"
          : error.message;
        return j({ error: msg }, 400);
      }
    }

    if (displayName !== undefined || phone !== undefined) {
      const patch: Record<string, unknown> = {};
      if (displayName !== undefined) patch.display_name = displayName;
      if (phone !== undefined) patch.phone = phone;
      const { error } = await admin.from("profiles").update(patch).eq("user_id", userId);
      if (error) return j({ error: error.message }, 400);
    }

    if (signOutAll) {
      try {
        await admin.auth.admin.signOut(userId);
      } catch (e) {
        console.warn("admin-update-user sign-out failed", errorMessage(e));
      }
    }

    try {
      await admin.rpc("log_org_event", {
        _org_id: callerMember.organization_id,
        _event_type: "user_updated_by_admin",
        _details: {
          target_user_id: userId,
          changed: {
            email: !!email, password: !!password,
            profile: displayName !== undefined || phone !== undefined,
            signed_out: !!signOutAll,
          },
        },
        _actor: caller.id,
      });
    } catch (e) {
      console.warn("admin-update-user audit log failed", errorMessage(e));
    }


    return j({ ok: true });
  } catch (e) {
    console.error("admin-update-user error", e);
    return j({ error: errorMessage(e) }, 500);
  }
});
