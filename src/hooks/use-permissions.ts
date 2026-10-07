import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export type AppAction = "view" | "create" | "edit" | "delete" | "approve" | "post" | "export";

export function usePermission(module: string, action: AppAction) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["has-permission", user?.id, module, action],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("has_permission", {
        _user_id: user!.id,
        _module: module,
        _action: action,
      });
      if (error) return false;
      return !!data;
    },
  });
}

/**
 * Batch-resolve several actions for one module in a single query.
 * Returns { isLoading, can } where can(action) is true when permitted.
 */
export function useModulePermissions(module: string, actions: AppAction[]) {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["module-permissions", user?.id, module, ...actions],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async () => {
      const results = await Promise.all(
        actions.map(async (action) => {
          const { data, error } = await supabase.rpc("has_permission", {
            _user_id: user!.id,
            _module: module,
            _action: action,
          });
          return [action, error ? false : !!data] as const;
        }),
      );
      return Object.fromEntries(results) as Record<string, boolean>;
    },
  });
  return {
    isLoading: query.isLoading,
    can: (action: AppAction) => query.data?.[action] ?? false,
  };
}
