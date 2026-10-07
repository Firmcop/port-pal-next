import { ReactNode, useEffect } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { NotificationBell } from "@/components/NotificationBell";
import { TenantSwitcher } from "@/components/TenantSwitcher";
import { WorkingDepotSwitcher } from "@/components/WorkingDepotSwitcher";
import { usePushSubscription } from "@/hooks/use-push-subscription";
import { TrialBanner } from "@/components/TrialBanner";
import { FreeTierBanner } from "@/components/FreeTierBanner";
import { useAppSettingsBootstrap } from "@/hooks/use-app-settings";
import { useWorkingDepotBootstrap } from "@/hooks/use-working-depot";

export function AppLayout({ children }: { children: ReactNode }) {
  const { permission, subscribed, subscribe } = usePushSubscription();
  useAppSettingsBootstrap();
  useWorkingDepotBootstrap();

  // Auto-prompt for push subscription on first load if not yet decided
  useEffect(() => {
    if (permission === "default" && !subscribed) {
      // Don't auto-prompt — user enables via settings
    }
  }, [permission, subscribed]);

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0 w-full">
          <header className="h-12 flex items-center justify-between border-b bg-card px-2 sm:px-4 shrink-0 gap-2">
            <SidebarTrigger className="shrink-0" />
            <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-wrap justify-end">
              <TenantSwitcher />
              <WorkingDepotSwitcher />
              <NotificationBell />
            </div>
          </header>
          <TrialBanner />
          <FreeTierBanner />
          <main className="flex-1 overflow-x-hidden overflow-y-auto p-3 sm:p-6 min-w-0">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}
