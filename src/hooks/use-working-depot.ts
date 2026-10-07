import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useOrganization } from "@/hooks/use-organization";
import {
  getAppSettings,
  getWorkingDepotBrand,
  getWorkingDepotId,
  setAppSettings,
  subscribeAppSettings,
  WorkingDepotBrand,
} from "@/lib/app-settings";

const STORAGE_KEY = "working_depot_id";
const EVT = "working-depot-changed";

export function getStoredWorkingDepotId(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(STORAGE_KEY);
}

export function setStoredWorkingDepotId(id: string | null) {
  if (typeof localStorage === "undefined") return;
  if (id) localStorage.setItem(STORAGE_KEY, id);
  else localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event(EVT));
}

type DepotRow = {
  id: string;
  name: string;
  code: string | null;
  address_line1: string | null;
  city: string | null;
  country: string | null;
  logo_url: string | null;
  tax_id: string | null;
  is_hq: boolean;
  organization_id: string;
};

function toBrand(d: DepotRow | null): WorkingDepotBrand {
  if (!d) return null;
  const loc = [d.address_line1, d.city, d.country].filter(Boolean).join(", ");
  return {
    id: d.id,
    name: d.name,
    code: d.code,
    location: loc || null,
    logoUrl: d.logo_url,
    taxId: d.tax_id,
  };
}

/**
 * Bootstrap the "working depot" for the current user.
 *
 * Resolution order:
 *   1. `localStorage.working_depot_id` (per-tab pin)
 *   2. `profiles.default_depot_id` (user-level default)
 *   3. HQ depot of the active organization
 *
 * The resolved depot's brand (name, logo, address, tax id) is pushed into the
 * global app-settings store so document templates and new records can default
 * to it without re-fetching.
 */
export function useWorkingDepotBootstrap() {
  const { user } = useAuth();
  const { organizationId } = useOrganization();
  const qc = useQueryClient();
  const [tick, setTick] = useState(0);

  // Re-run when the localStorage pin changes in this or another tab.
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    window.addEventListener(EVT, bump);
    window.addEventListener("storage", bump);
    return () => {
      window.removeEventListener(EVT, bump);
      window.removeEventListener("storage", bump);
    };
  }, []);

  useQuery({
    queryKey: ["working-depot", organizationId, user?.id, tick],
    enabled: !!organizationId,
    queryFn: async () => {
      const pinned = getStoredWorkingDepotId();

      // Fetch profile default in parallel with depot list.
      const [{ data: profile }, { data: depots }] = await Promise.all([
        user
          ? supabase.from("profiles").select("default_depot_id").eq("id", user.id).maybeSingle()
          : Promise.resolve({ data: null as any }),
        supabase
          .from("depots")
          .select("id, name, code, address_line1, city, country, logo_url, tax_id, is_hq, organization_id")
          .eq("organization_id", organizationId!),
      ]);

      const rows = (depots ?? []) as DepotRow[];
      const byId = new Map(rows.map((d) => [d.id, d]));

      let chosen: DepotRow | null = null;
      if (pinned && byId.has(pinned)) chosen = byId.get(pinned)!;
      else if (profile?.default_depot_id && byId.has(profile.default_depot_id))
        chosen = byId.get(profile.default_depot_id)!;
      else chosen = rows.find((d) => d.is_hq) ?? rows[0] ?? null;

      setAppSettings({
        workingDepotId: chosen?.id ?? null,
        workingDepotBrand: toBrand(chosen),
      });
      return chosen;
    },
  });

  // If the org changes, drop stale working-depot cache immediately.
  useEffect(() => {
    return () => {
      qc.invalidateQueries({ queryKey: ["working-depot"] });
    };
  }, [organizationId, qc]);
}

/** Reactive read + setter for the current working depot. */
export function useWorkingDepot() {
  const { user } = useAuth();
  const [, setV] = useState(0);
  useEffect(() => subscribeAppSettings(() => setV((n) => n + 1)), []);

  const set = useCallback(
    async (depotId: string | null, opts: { persistProfile?: boolean } = { persistProfile: true }) => {
      setStoredWorkingDepotId(depotId);
      if (opts.persistProfile && user) {
        // Best-effort profile persistence; ignore RLS errors silently.
        await supabase.from("profiles").update({ default_depot_id: depotId }).eq("id", user.id);
      }
    },
    [user],
  );

  return {
    depotId: getWorkingDepotId(),
    brand: getWorkingDepotBrand(),
    setWorkingDepot: set,
  };
}
