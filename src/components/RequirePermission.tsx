import { Navigate } from "@/lib/router";
import { usePermission, type AppAction } from "@/hooks/use-permissions";
import { toast } from "sonner";
import { useEffect, useRef } from "react";

/**
 * UI-level guard for permission-restricted routes. RLS remains the source of truth.
 */
export function RequirePermission({
  module,
  action = "view",
  children,
}: {
  module: string;
  action?: AppAction;
  children: React.ReactNode;
}) {
  const perm = usePermission(module, action);
  const toldRef = useRef(false);

  useEffect(() => {
    if (perm.isLoading) return;
    if (!perm.data && !toldRef.current) {
      toldRef.current = true;
      toast.error("You don't have access to this page");
    }
  }, [perm.isLoading, perm.data]);

  if (perm.isLoading) {
    return <div className="min-h-[40vh] flex items-center justify-center text-muted-foreground">Loading…</div>;
  }

  if (!perm.data) return <Navigate to="/" replace />;
  return <>{children}</>;
}
