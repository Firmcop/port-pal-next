import { ReactNode, useState } from "react";
import { Link, useLocation } from "@/lib/router";
import { usePortalAuth } from "@/hooks/use-portal-auth";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard, Box, CalendarClock, FileKey, ArrowRightLeft,
  Receipt, Bell, LogOut, Menu, X, Ship, KeyRound, ClipboardCheck,
} from "lucide-react";

const navItems = [
  { to: "/portal/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/portal/inventory", label: "Inventory", icon: Box },
  { to: "/portal/appointments", label: "Appointments", icon: CalendarClock },
  { to: "/portal/eirs", label: "Equipment receipts", icon: ClipboardCheck },
  { to: "/portal/releases", label: "Releases", icon: FileKey },
  { to: "/portal/leases", label: "My Leases", icon: KeyRound },
  { to: "/portal/movements", label: "Movements", icon: ArrowRightLeft },
  { to: "/portal/billing", label: "Billing", icon: Receipt },
  { to: "/portal/notifications", label: "Notifications", icon: Bell },
];

import { useAppSettingsBootstrap } from "@/hooks/use-app-settings";

export function PortalLayout({ children }: { children: ReactNode }) {
  const { customerName } = usePortalAuth();
  const { signOut } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  useAppSettingsBootstrap();

  return (
    <div className="min-h-screen flex bg-background">
      {/* Sidebar */}
      <aside className={cn(
"fixed inset-y-0 left-0 z-50 w-64 bg-sidebar text-sidebar-foreground flex flex-col transition-transform lg:translate-x-0",
        mobileOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="p-4 border-b border-sidebar-border">
          <div className="flex items-center gap-2">
            <Ship className="h-6 w-6 text-sidebar-primary" />
            <div>
              <h2 className="font-semibold text-sm text-sidebar-primary-foreground">Customer Portal</h2>
              {customerName && <p className="text-xs text-sidebar-foreground/70 truncate">{customerName}</p>}
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const active = location.pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setMobileOpen(false)}
                className={cn(
"flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-primary"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-sidebar-border">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent/50"
            onClick={() => signOut()}
          >
            <LogOut className="h-4 w-4 mr-2" />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Main content */}
      <div className="flex-1 lg:ml-64">
        <header className="sticky top-0 z-30 bg-background border-b px-4 py-3 flex items-center gap-3 lg:hidden">
          <Button variant="ghost" size="icon" onClick={() => setMobileOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>
          <span className="font-semibold text-sm">Customer Portal</span>
        </header>
        <main className="p-4 lg:p-6 max-w-7xl mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
