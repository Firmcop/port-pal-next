import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useOrganization } from "./use-organization";
import { supabase } from "@/integrations/supabase/client";

const FUNCTIONAL_SCOPE: Record<string, string[]> = {
  sales_manager: ["sales_manager", "leasing_manager", "viewer"],
  supply_chain_manager: ["supply_chain_manager", "procurement_officer", "yard_operator", "gate_clerk", "viewer"],
  production_manager: ["production_manager", "mr_supervisor", "yard_operator", "viewer"],
  leasing_manager: ["leasing_manager", "sales_manager", "viewer"],
  mr_supervisor: ["mr_supervisor", "production_manager", "yard_operator", "viewer"],
};

const FULL_ACCESS_ROLES = new Set(["admin", "hr_manager"]);
const READ_MANAGER_ROLES = new Set(Object.keys(FUNCTIONAL_SCOPE));

/**
 * Determines whether the current user can open the Users directory,
 * whether they can perform manage actions, and which teammate roles
 * they are allowed to see.
 */
export function useUserDirectoryAccess() {
  const { user } = useAuth();
  const org = useOrganization();

  const { data, isLoading } = useQuery({
    queryKey: ["my-user-roles-for-directory", user?.id, org.organizationId],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role, organization_id")
        .eq("user_id", user!.id);
      return (data ?? [])
        .filter((r: any) => !org.organizationId || !r.organization_id || r.organization_id === org.organizationId)
        .map((r: any) => r.role as string);
    },
  });

  const myRoles = data ?? [];
  const isOwnerOrAdmin =
    org.isPlatformAdmin || org.role === "org_owner" || org.role === "admin" || myRoles.includes("admin");
  const canManage = isOwnerOrAdmin || myRoles.includes("hr_manager");

  let visibleRoles: string[] | null = null; // null = see everyone
  if (!canManage) {
    const scopes = new Set<string>();
    for (const r of myRoles) {
      if (READ_MANAGER_ROLES.has(r)) FUNCTIONAL_SCOPE[r].forEach((x) => scopes.add(x));
    }
    visibleRoles = Array.from(scopes);
  }

  const canOpen = canManage || (visibleRoles?.length ?? 0) > 0;

  return {
    loading: org.loading || isLoading,
    canOpen,
    canManage,
    /** null = unrestricted; array = the staff roles the viewer may see */
    visibleRoles,
  };
}

export const USER_DIRECTORY_ROLES = [
  "admin",
  "org_owner",
  "hr_manager",
  "sales_manager",
  "supply_chain_manager",
  "production_manager",
  "leasing_manager",
  "mr_supervisor",
] as const;
