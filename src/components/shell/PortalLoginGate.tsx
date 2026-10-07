"use client";

import { useAuth } from "@/lib/auth";
import { usePortalAuth } from "@/hooks/use-portal-auth";
import { Navigate } from "@/lib/router";
import PortalLogin from "@/views/portal/PortalLogin";

/** Was `PortalAuthRoutes`. */
export default function PortalLoginGate() {
  const { session, loading: authLoading } = useAuth();
  const { isPortalUser, loading: portalLoading } = usePortalAuth();
  if (authLoading || portalLoading) return null;
  if (session && isPortalUser) return <Navigate to="/portal/dashboard" replace />;
  return <PortalLogin />;
}
