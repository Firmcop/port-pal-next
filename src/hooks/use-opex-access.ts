import { useModulePermissions } from "./use-permissions";
import { useUserModuleAccess } from "./use-user-module-access";

/**
 * Access model for Operating Expenses.
 *
 * - Full finance users (admins / accounting view) get the complete screen.
 * - Holders of the narrow `opex_entry` scope may only record expenses
 *   (always submitted for approval) and see their own entries.
 */
export function useOpexAccess() {
  const { seesAll, isLoading: moduleLoading } = useUserModuleAccess();
  const accounting = useModulePermissions("accounting", ["view", "create"]);
  const entry = useModulePermissions("opex_entry", ["view", "create"]);

  const full = seesAll || accounting.can("view");
  const clerk = !full && (entry.can("view") || entry.can("create"));

  return {
    isLoading: moduleLoading || accounting.isLoading || entry.isLoading,
    full,
    clerk,
    canOpen: full || clerk,
    canRecord: full || entry.can("create"),
  };
}
