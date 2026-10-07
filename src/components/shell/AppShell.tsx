"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useOrganization } from "@/hooks/use-organization";
import { AppLayout } from "@/components/AppLayout";
import { Navigate } from "@/lib/router";
import { FullScreenLoader } from "@/components/PageLoader";
import Paywall from "@/views/Paywall";

/**
 * Staff workspace shell (was `ProtectedRoutes` in the react-router App.tsx).
 * The proxy already bounces signed-out users server-side; this keeps the
 * organisation-level checks: onboarding and the paywall.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const org = useOrganization();
  const pathname = usePathname();

  if (loading || org.loading) return <FullScreenLoader />;
  if (!session) return <Navigate to={`/login?next=${encodeURIComponent(pathname ?? "/")}`} replace />;
  // Force onboarding for users with no real organization (covers both "no membership" and "stuck in legacy default org")
  if (org.needsOnboarding) return <Navigate to="/onboarding" replace />;

  // Paywall enforcement — only hard-blocked statuses. Expired trials auto-downgrade to 'free' via cron.
  const blocked = !org.isPlatformAdmin && ["past_due", "suspended", "cancelled"].includes(org.status ?? "");
  if (blocked && pathname !== "/settings/subscription") {
    return (
      <AppLayout>
        <Paywall />
      </AppLayout>
    );
  }

  return <AppLayout>{children}</AppLayout>;
}
