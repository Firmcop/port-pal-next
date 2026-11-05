import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { applyLanguage, resolveLanguageFromCountry } from "@/lib/i18n-locale";

export type OrgContext = {
  loading: boolean;
  organizationId: string | null;
  organizationName: string | null;
  status: string | null;
  trialEndsAt: string | null;
  role: string | null;
  isPlatformAdmin: boolean;
  needsOnboarding: boolean;
};

const ACTIVE_ORG_STORAGE_KEY = "active_org_id";

export function getStoredActiveOrgId(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(ACTIVE_ORG_STORAGE_KEY);
}

export function setStoredActiveOrgId(id: string | null) {
  if (typeof localStorage === "undefined") return;
  if (id) localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, id);
  else localStorage.removeItem(ACTIVE_ORG_STORAGE_KEY);
  // Notify listeners in the same tab (localStorage 'storage' events only fire cross-tab).
  window.dispatchEvent(new Event("active-org-changed"));
}

/** Switch company: the database is told first (it decides what is read and written), then the UI. */
export async function switchOrganization(id: string) {
  const { error } = await (supabase as any).rpc("set_active_organization", { _org: id });
  // A database without the function (before the Phase 0 migration) keeps the old,
  // screen-only switch instead of blocking it.
  if (error && !isMissingFunction(error)) throw error;
  setStoredActiveOrgId(id);
}

function isMissingFunction(error: { code?: string; message?: string }) {
  return error.code === "PGRST202" || /could not find the function/i.test(error.message ?? "");
}

export function useOrganization(): OrgContext {
  const { user, loading: authLoading } = useAuth();
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<OrgContext>({
    loading: true,
    organizationId: null,
    organizationName: null,
    status: null,
    trialEndsAt: null,
    role: null,
    isPlatformAdmin: false,
    needsOnboarding: false,
  });

  // Re-run when the active org changes in this tab or another.
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    window.addEventListener("active-org-changed", bump);
    window.addEventListener("storage", bump);
    return () => {
      window.removeEventListener("active-org-changed", bump);
      window.removeEventListener("storage", bump);
    };
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setState((s) => ({ ...s, loading: false }));
      return;
    }
    (async () => {
      const [{ data: memberships }, { data: pa }, { data: profile }] = await Promise.all([
        supabase
          .from("organization_members")
          .select("organization_id, role, organizations(id, name, status, trial_ends_at, country)")
          .eq("user_id", user.id)
          .eq("status", "active")
          .order("created_at", { ascending: true }),
        supabase.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle(),
        (supabase as any).from("profiles").select("active_organization_id").eq("user_id", user.id).maybeSingle(),
      ]);

      const isPlatformAdmin = !!pa;
      // This browser's choice first, then the choice saved on the profile (other devices).
      const serverActiveId: string | null = (profile as any)?.active_organization_id ?? null;
      const storedId = getStoredActiveOrgId() ?? serverActiveId;

      // Resolve which membership (if any) matches the stored active org.
      let member = (memberships ?? [])[0] as any;
      if (storedId) {
        const match = (memberships ?? []).find((m: any) => m.organization_id === storedId);
        if (match) member = match;
      }

      let org: any = member?.organizations;
      let organizationId: string | null = member?.organization_id ?? null;
      let organizationName: string | null = org?.name ?? null;

      // Platform admins can pin an active org they aren't a member of.
      if (isPlatformAdmin && storedId && storedId !== organizationId) {
        const { data: pinned } = await supabase
          .from("organizations")
          .select("id, name, status, trial_ends_at, country")
          .eq("id", storedId)
          .maybeSingle();
        if (pinned) {
          org = pinned;
          organizationId = pinned.id;
          organizationName = pinned.name;
        }
      }

      // Keep the database on the same company the screen shows: it scopes every read and write.
      if (organizationId && organizationId !== serverActiveId) {
        const { error } = await (supabase as any).rpc("set_active_organization", { _org: organizationId });
        if (error && !isMissingFunction(error)) console.error("Could not set active company", error);
      }

      // Apply org-locale language only if user hasn't explicitly chosen one.
      if (org?.country && !localStorage.getItem("app_lang")) {
        applyLanguage(resolveLanguageFromCountry(org.country));
      }
      setState({
        loading: false,
        organizationId,
        organizationName,
        status: org?.status ?? null,
        trialEndsAt: org?.trial_ends_at ?? null,
        role: (member as any)?.role ?? (isPlatformAdmin ? "platform_admin" : null),
        isPlatformAdmin,
        needsOnboarding: !isPlatformAdmin && !member,
      });
    })();
  }, [user, authLoading, tick]);

  return state;
}
