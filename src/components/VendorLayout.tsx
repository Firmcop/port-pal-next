import { ReactNode } from "react";
import { NavLink, useNavigate } from "@/lib/router";
import { Building2, LayoutGrid, ArrowLeft, Package, Receipt, History, ShieldCheck, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

export function VendorLayout({ children }: { children: ReactNode }) {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="min-h-screen flex">
      <aside className="w-60 border-r bg-card shrink-0 flex flex-col">
        <div className="p-4 border-b">
          <div className="flex items-center gap-2">
            <LayoutGrid className="h-5 w-5 text-primary" />
            <span className="font-bold">Vendor Console</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">CDMS SaaS platform</p>
        </div>
        <nav className="p-2 flex-1 space-y-1">
          <NavLink to="/vendor/organizations" className={({ isActive }) => `flex items-center gap-2 px-3 py-2 rounded-md text-sm ${isActive ? "bg-accent text-primary font-medium" : "hover:bg-accent"}`}>
            <Building2 className="h-4 w-4" /> Organizations
          </NavLink>
          <NavLink to="/vendor/modules" className={({ isActive }) => `flex items-center gap-2 px-3 py-2 rounded-md text-sm ${isActive ? "bg-accent text-primary font-medium" : "hover:bg-accent"}`}>
            <Package className="h-4 w-4" /> Modules & Pricing
          </NavLink>
          <NavLink to="/vendor/invoices" className={({ isActive }) => `flex items-center gap-2 px-3 py-2 rounded-md text-sm ${isActive ? "bg-accent text-primary font-medium" : "hover:bg-accent"}`}>
            <Receipt className="h-4 w-4" /> Invoices
          </NavLink>
          <NavLink to="/vendor/events" className={({ isActive }) => `flex items-center gap-2 px-3 py-2 rounded-md text-sm ${isActive ? "bg-accent text-primary font-medium" : "hover:bg-accent"}`}>
            <History className="h-4 w-4" /> Audit log
          </NavLink>
          <NavLink to="/vendor/security" className={({ isActive }) => `flex items-center gap-2 px-3 py-2 rounded-md text-sm ${isActive ? "bg-accent text-primary font-medium" : "hover:bg-accent"}`}>
            <ShieldCheck className="h-4 w-4" /> Security
          </NavLink>
          <NavLink to="/vendor/db-load" className={({ isActive }) => `flex items-center gap-2 px-3 py-2 rounded-md text-sm ${isActive ? "bg-accent text-primary font-medium" : "hover:bg-accent"}`}>
            <Database className="h-4 w-4" /> DB Load
          </NavLink>
        </nav>
        <div className="p-3 border-t space-y-2">
          <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => navigate("/")}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Back to app
          </Button>
          <Button variant="ghost" size="sm" className="w-full" onClick={signOut}>Sign out</Button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto p-6">{children}</main>
    </div>
  );
}
