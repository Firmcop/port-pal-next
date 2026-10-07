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

const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";
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
      const [{ data: memberships }, { data: pa }] = await Promise.all([
        supabase
          .from("organization_members")
          .select("organization_id, role, organizations(id, name, status, trial_ends_at, country)")
          .eq("user_id", user.id)
          .eq("status", "active")
          .order("created_at", { ascending: true }),
        supabase.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle(),
      ]);

      const isPlatformAdmin = !!pa;
      const storedId = getStoredActiveOrgId();

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
        needsOnboarding: !isPlatformAdmin && (!member || organizationId === DEFAULT_ORG_ID),
      });
    })();
  }, [user, authLoading, tick]);

  return state;
}
