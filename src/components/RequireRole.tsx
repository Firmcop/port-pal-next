import { Navigate } from "@/lib/router";
import { useUserStaffRole } from "@/hooks/use-user-staff-role";
import { toast } from "sonner";
import { useEffect, useRef } from "react";

type Allowed =
  | "admin" | "org_owner" | "yard_operator" | "gate_clerk" | "viewer"
  | "accountant" | "hr_manager" | "production_manager" | "procurement_officer"
  | "supply_chain_manager" | "sales_manager" | "leasing_manager" | "mr_supervisor"
  | "asset_manager";

/**
 * UI-level guard for role-restricted routes. RLS remains the source of truth.
 * Default `roles` is owner/admin only.
 */
export function RequireRole({
  roles = ["admin", "org_owner"],
  children,
}: {
  roles?: Allowed[];
  children: React.ReactNode;
}) {
  const { loading, isOwnerOrAdmin, role } = useUserStaffRole();
  const toldRef = useRef(false);

  useEffect(() => {
    if (loading) return;
    const allowed = isOwnerOrAdmin || (role && roles.includes(role as Allowed));
    if (!allowed && !toldRef.current) {
      toldRef.current = true;
      toast.error("You don't have access to this page");
    }
  }, [loading, isOwnerOrAdmin, role, roles]);

  if (loading) {
    return <div className="min-h-[40vh] flex items-center justify-center text-muted-foreground">Loading…</div>;
  }

  const allowed = isOwnerOrAdmin || (role && roles.includes(role as Allowed));
  if (!allowed) return <Navigate to="/" replace />;
  return <>{children}</>;
}
