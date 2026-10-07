import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useOrganization } from "./use-organization";
import { useUserStaffRole } from "./use-user-staff-role";

/**
 * Returns the set of modules the current user has 'view' permission on.
 * Admins / org owners / platform admins see everything.
 */
export function useUserModuleAccess() {
  const { user } = useAuth();
  const org = useOrganization();
  const { isOwnerOrAdmin, loading: roleLoading } = useUserStaffRole();

  const seesAll = isOwnerOrAdmin || org.isPlatformAdmin;

  const { data: allowed, isLoading } = useQuery({
    queryKey: ["user-view-modules", user?.id],
    enabled: !!user && !seesAll && !roleLoading,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_user_view_modules", { _user_id: user!.id });
      if (error || !data) return [] as string[];
      return (data as any[]).map((r) => (typeof r === "string" ? r : r.get_user_view_modules)) as string[];
    },
  });

  const allowedSet = new Set(allowed ?? []);

  return {
    isLoading: roleLoading || (!seesAll && isLoading),
    seesAll,
    canView: (module: string) => seesAll || allowedSet.has(module),
  };
}
