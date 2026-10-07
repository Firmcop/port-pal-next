import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./use-organization";

export type ModuleName =
  | "core" | "inventory" | "gate" | "mr" | "billing" | "accounting"
  | "crm" | "manufacturing" | "procurement" | "leasing" | "portal" | "whatsapp" | "hrm" | "logistics" | "assets";

export function useEnabledModules() {
  const org = useOrganization();
  const { data: enabledModules = [], isLoading: queryLoading } = useQuery({
    queryKey: ["enabled-modules", org.organizationId],
    enabled: !!org.organizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscription_modules")
        .select("module_code, enabled")
        .eq("organization_id", org.organizationId!)
        .eq("enabled", true);
      if (error || !data) return [] as ModuleName[];
      return data.map((r: any) => r.module_code as ModuleName);
    },
    staleTime: 30_000,
  });

  // While the organization context (which lives in a *separate* hook instance per
  // consumer) hasn't yet resolved an orgId, treat modules as loading. Otherwise
  // route guards can observe `isLoading=false, enabledModules=[]` and falsely
  // redirect users to the paywall before this hook's org context catches up.
  const isLoading = queryLoading || org.loading || (!!org.isPlatformAdmin ? false : !org.organizationId);

  return {
    enabledModules,
    isLoading,
    isModuleEnabled: (m: ModuleName) =>
      m === "core" || enabledModules.includes(m),
  };
}
