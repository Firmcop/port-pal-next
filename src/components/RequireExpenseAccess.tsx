import { Navigate } from "@/lib/router";
import { useEnabledModules } from "@/hooks/use-enabled-modules";
import { useOrganization } from "@/hooks/use-organization";
import { useOpexAccess } from "@/hooks/use-opex-access";

/**
 * Route guard for Operating Expenses: the organization must subscribe to
 * accounting, and the user must have either full accounting view or the
 * narrow `opex_entry` expense-posting scope.
 */
export function RequireExpenseAccess({ children }: { children: React.ReactNode }) {
  const org = useOrganization();
  const { isModuleEnabled, isLoading: modulesLoading } = useEnabledModules();
  const access = useOpexAccess();

  if (org.loading || modulesLoading || access.isLoading) {
    return <div className="min-h-[40vh] flex items-center justify-center text-muted-foreground">Loading...</div>;
  }
  if (org.isPlatformAdmin) return <>{children}</>;
  if (!isModuleEnabled("accounting" as any)) return <Navigate to="/paywall?module=accounting" replace />;
  if (!access.canOpen) return <Navigate to="/" replace />;
  return <>{children}</>;
}
