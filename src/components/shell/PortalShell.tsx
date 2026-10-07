"use client";

import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { usePortalAuth } from "@/hooks/use-portal-auth";
import { PortalLayout } from "@/components/PortalLayout";
import { Navigate } from "@/lib/router";
import { FullScreenLoader } from "@/components/PageLoader";

/** Customer self-service portal shell (was `PortalProtectedRoutes`). */
export default function PortalShell({ children }: { children: ReactNode }) {
  const { session, loading: authLoading } = useAuth();
  const { isPortalUser, loading: portalLoading } = usePortalAuth();

  if (authLoading || portalLoading) return <FullScreenLoader />;
  if (!session || !isPortalUser) return <Navigate to="/portal/login" replace />;
  return <PortalLayout>{children}</PortalLayout>;
}
