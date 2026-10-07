import { Navigate } from "@/lib/router";
import { useEnabledModules, type ModuleName } from "@/hooks/use-enabled-modules";
import { useOrganization } from "@/hooks/use-organization";
import { useUserModuleAccess } from "@/hooks/use-user-module-access";

/**
 * Route guard combining two checks:
 *   1. The organization's subscription enables the module (paywall).
 *   2. The signed-in user's RBAC view-modules include the module.
 *
 * `code` may be a single module or a list — access is granted when ANY of the
 * listed modules is both subscribed and viewable by the user.
 *
 * Admins, org owners and platform admins bypass the RBAC check.
 * Server-side enforcement still lives in RLS; this prevents UI access
 * to modules the user/org isn't entitled to.
 */
export function RequireModule({ code, children }: { code: ModuleName | ModuleName[]; children: React.ReactNode }) {
  const org = useOrganization();
  const { isModuleEnabled, isLoading: modulesLoading } = useEnabledModules();
  const { canView, isLoading: accessLoading, seesAll } = useUserModuleAccess();

  if (org.loading || modulesLoading || accessLoading) {
    return <div className="min-h-[40vh] flex items-center justify-center text-muted-foreground">Loading...</div>;
  }
  if (org.isPlatformAdmin) return <>{children}</>;

  const codes: ModuleName[] = Array.isArray(code) ? code : [code];

  // Subscription gate → paywall.
  const subscribed = codes.filter((c) => isModuleEnabled(c));
  if (subscribed.length === 0) {
    return <Navigate to={`/paywall?module=${codes[0]}`} replace />;
  }
  // RBAC gate → bounce to dashboard (the user is signed in, just not entitled).
  if (!seesAll && !subscribed.some((c) => canView(c))) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}
