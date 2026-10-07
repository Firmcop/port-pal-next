import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useOrganization } from "./use-organization";

export type StaffRole =
  | "admin" | "yard_operator" | "gate_clerk" | "viewer"
  | "accountant" | "hr_manager" | "production_manager" | "procurement_officer"
  | "supply_chain_manager" | "sales_manager" | "leasing_manager" | "mr_supervisor"
  | "asset_manager"
  | null;

const ROLE_PRIORITY: Record<string, number> = {
  admin: 100,
  accountant: 60, hr_manager: 60, production_manager: 60, procurement_officer: 60,
  supply_chain_manager: 60, sales_manager: 60, leasing_manager: 60, mr_supervisor: 60,
  asset_manager: 60,
  yard_operator: 30, gate_clerk: 20, viewer: 10,
};

export function useUserStaffRole() {
  const { user } = useAuth();
  const org = useOrganization();

  const { data: role, isLoading } = useQuery({
    queryKey: ["my-staff-role", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<StaffRole> => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id);
      const roles = (data ?? []).map((r: any) => r.role as string);
      let best: string | null = null;
      let bestP = -1;
      for (const r of roles) {
        const p = ROLE_PRIORITY[r] ?? -1;
        if (p > bestP) { bestP = p; best = r; }
      }
      return (best as StaffRole) ?? null;
    },
    staleTime: 60_000,
  });

  const isAdmin = role === "admin";
  const isOrgOwner = org.role === "org_owner";
  const isOwnerOrAdmin = isOrgOwner || org.role === "admin" || isAdmin || org.isPlatformAdmin;

  return {
    role,
    loading: org.loading || isLoading,
    isAdmin,
    isOrgOwner,
    isOwnerOrAdmin,
  };
}
