"use client";

import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { useOrganization } from "@/hooks/use-organization";
import { VendorLayout } from "@/components/VendorLayout";
import { Navigate } from "@/lib/router";
import { FullScreenLoader } from "@/components/PageLoader";

/** Platform-admin console shell (was `VendorRoutes`). */
export default function VendorShell({ children }: { children: ReactNode }) {
  const { session, loading: authLoading } = useAuth();
  const org = useOrganization();
  if (authLoading || org.loading) return <FullScreenLoader />;
  if (!session) return <Navigate to="/login" replace />;
  if (!org.isPlatformAdmin) return <Navigate to="/" replace />;
  return <VendorLayout>{children}</VendorLayout>;
}
