import { ScanSearch, Gauge,
  LayoutDashboard, Package, Map, ArrowLeftRight, FileBarChart, Settings, LogOut, Container,
  CalendarClock, Truck, FileCheck, ClipboardCheck, Calculator, Wrench, Activity,
  Receipt, CreditCard, Tags, BarChart3, Hammer, ShoppingCart, BookOpen, PieChart, Moon, Sun, Users, Ship,
  UserPlus, Handshake, FileText, ClipboardList, Building2, ShoppingBag,
  KeyRound, ListChecks, PlayCircle, Wallet, FolderKanban, PiggyBank, Search, BadgeDollarSign, DollarSign,
  BookText, Scale, TrendingUp, CalendarRange, Clock, Repeat, AlarmClock, FileSpreadsheet, Percent, FileCheck2, Waves, Globe, Target,
  Building, ReceiptText, Coins, Shield, Lock, History, Boxes, PackageMinus, PackageOpen,
  ShieldAlert, Landmark,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/lib/auth";
import { useEnabledModules } from "@/hooks/use-enabled-modules";
import { useUserModuleAccess } from "@/hooks/use-user-module-access";
import { useModulePermissions, type AppAction } from "@/hooks/use-permissions";
import { useTheme } from "@/hooks/use-theme";
import { useOrganization } from "@/hooks/use-organization";
import { useUserDirectoryAccess } from "@/hooks/use-user-directory-access";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useAppSettings } from "@/hooks/use-app-settings";

export type Item = { key: string; url: string; icon: any; module?: string | string[]; action?: AppAction };

const mainItems: Item[] = [
  { key: "dashboard", url: "/", icon: LayoutDashboard },
  { key: "inventory", url: "/inventory", icon: Package },
  { key: "yard_map", url: "/yard-map", icon: Map },
  { key: "movements", url: "/movements", icon: ArrowLeftRight },
  { key: "stock_adjustments", url: "/stock-adjustments", icon: Scale },
  { key: "stock_reconciliation", url: "/stock-reconciliation", icon: ListChecks },
  { key: "reports", url: "/reports", icon: FileBarChart },
];

const gateItems: Item[] = [
  { key: "gate_dashboard", url: "/gate/dashboard", icon: Activity },
  { key: "appointments", url: "/gate/appointments", icon: CalendarClock },
  { key: "trucks_drivers", url: "/gate/trucks-drivers", icon: Truck },
  { key: "eir_records", url: "/gate/eir", icon: FileCheck },
  { key: "repatriation", url: "/repatriation", icon: Ship },
  { key: "repat_rate_cards", url: "/repatriation/rate-cards", icon: Calculator },
  { key: "repat_profitability", url: "/repatriation/profitability", icon: FileBarChart },
];

const mrItems: Item[] = [
  { key: "inspections", url: "/mr/inspections", icon: ClipboardCheck },
  { key: "estimates", url: "/mr/estimates", icon: Calculator },
  { key: "work_orders", url: "/mr/work-orders", icon: Wrench },
];

const crmItems: Item[] = [
  { key: "customers", url: "/customers", icon: Users },
  { key: "leads", url: "/leads", icon: UserPlus },
  { key: "deals", url: "/deals", icon: Handshake },
  { key: "quotes", url: "/quotes", icon: FileText },
  { key: "quote_templates", url: "/crm/quote-templates", icon: BookOpen },
  { key: "website_catalog", url: "/crm/website-catalog", icon: Globe },
  { key: "sales_orders", url: "/sales-orders", icon: ClipboardList },
];



const manufacturingItems: Item[] = [
  { key: "conversion_jobs", url: "/conversions", icon: Hammer },
  { key: "finished_products", url: "/finished-products", icon: Package },
  { key: "sub_assembly_stock", url: "/sub-assembly-stock", icon: Package },
  { key: "container_sales", url: "/sales", icon: ShoppingCart },
  { key: "materials_stock", url: "/materials", icon: Package },
];

const procurementItems: Item[] = [
  { key: "suppliers", url: "/suppliers", icon: Building2 },
  { key: "rfqs", url: "/procurement/rfqs", icon: FileText },
  { key: "procurement_store", url: "/procurement", icon: ShoppingBag },
];

const leasingItems: Item[] = [
  { key: "quotations", url: "/leasing/quotations", icon: FileText },
  { key: "agreements", url: "/leasing/agreements", icon: KeyRound },
  { key: "lease_units", url: "/leasing/units", icon: Container },
  { key: "tracker", url: "/leasing/tracker", icon: ListChecks },
  { key: "billing_run", url: "/leasing/billing", icon: PlayCircle },
];

export const billingItems: Item[] = [
  { key: "finance_dashboard", url: "/finance/dashboard", icon: PiggyBank, module: "accounting" },
  { key: "chart_of_accounts", url: "/finance/chart-of-accounts", icon: BookOpen, module: "accounting" },
  { key: "fiscal_periods", url: "/finance/periods", icon: CalendarRange, module: "accounting" },
  { key: "manual_journals", url: "/finance/journals", icon: BookText, module: "accounting" },
  { key: "tariffs", url: "/billing/tariffs", icon: Tags, module: "billing" },
  { key: "invoices", url: "/billing/invoices", icon: Receipt, module: "billing" },
  { key: "recurring_invoices", url: "/finance/recurring-invoices", icon: Repeat, module: "billing" },
  { key: "supplier_invoices", url: "/finance/supplier-invoices", icon: ReceiptText, module: "accounting" },
  { key: "invoice_reconciliation", url: "/finance/invoice-reconciliation", icon: ScanSearch, module: "accounting" },
  { key: "control_room", url: "/finance/control-room", icon: Gauge, module: "accounting" },
  { key: "supplier_pricing", url: "/finance/supplier-pricing", icon: Tags, module: "accounting" },
  { key: "payments", url: "/billing/payments", icon: CreditCard, module: "billing" },
  { key: "contra_settlements", url: "/finance/contra-settlements", icon: ArrowLeftRight, module: "accounting" },
  { key: "counterparty_reconciliation", url: "/finance/counterparty-reconciliation", icon: Scale, module: "accounting" },
  { key: "accounting_policies", url: "/finance/accounting-policies", icon: Scale, module: "accounting" },
  { key: "finance_watchdog", url: "/finance/watchdog", icon: ShieldAlert, module: "accounting" },

  { key: "reconciliation", url: "/billing/reconciliation", icon: Receipt, module: "billing" },
  { key: "dunning", url: "/finance/dunning", icon: AlarmClock, module: "billing" },
  { key: "statements", url: "/finance/statements", icon: FileSpreadsheet, module: "billing" },
  { key: "transactions", url: "/accounting/transactions", icon: BookOpen, module: "accounting" },
  { key: "ledger_search", url: "/finance/ledger", icon: Search, module: "accounting" },
  { key: "trial_balance", url: "/finance/reports/trial-balance", icon: Scale, module: "accounting" },
  { key: "profit_loss", url: "/finance/reports/profit-loss", icon: TrendingUp, module: "accounting" },
  { key: "project_pnl", url: "/finance/reports/project-pnl", icon: FolderKanban, module: "accounting" },
  { key: "balance_sheet", url: "/finance/reports/balance-sheet", icon: Wallet, module: "accounting" },
  { key: "aging_reports", url: "/finance/reports/aging", icon: Clock, module: "billing" },
  { key: "financial_summary", url: "/accounting/summary", icon: PieChart, module: "accounting" },
  { key: "bank_cash_accounts", url: "/finance/accounts", icon: Wallet, module: "accounting" },
  { key: "inter_account_transfers", url: "/finance/transfers", icon: ArrowLeftRight, module: "accounting" },
  { key: "bank_reconciliations", url: "/finance/reconciliations", icon: ClipboardCheck, module: "accounting" },
  { key: "projects", url: "/finance/projects", icon: FolderKanban, module: ["accounting", "manufacturing"] },
  { key: "tax_codes", url: "/finance/tax-codes", icon: Percent, module: "accounting" },
  { key: "tax_returns", url: "/finance/tax-returns", icon: FileText, module: "accounting" },
  { key: "withholding", url: "/finance/withholding", icon: FileCheck2, module: "accounting" },
  { key: "budgets", url: "/finance/budgets", icon: Target, module: "accounting" },
  { key: "budget_variance", url: "/finance/budget-variance", icon: TrendingUp, module: "accounting" },
  { key: "budgets_vs_actual", url: "/finance/budgets-vs-actual", icon: Target, module: "accounting" },
  { key: "cashflow_forecast", url: "/finance/cashflow-forecast", icon: Waves, module: "accounting" },
  { key: "fx_revaluation", url: "/finance/fx-revaluation", icon: Globe, module: "accounting" },
  { key: "fixed_assets", url: "/finance/fixed-assets", icon: Building, module: "accounting" },
  { key: "operating_expenses", url: "/finance/operating-expenses", icon: ReceiptText, module: "accounting" },
  { key: "loans", url: "/finance/loans", icon: Landmark, module: "accounting" },
  { key: "commitments", url: "/finance/commitments", icon: CalendarClock, module: "accounting" },
  { key: "expense_categories", url: "/finance/expense-categories", icon: Tags, module: "accounting" },
  { key: "opex_report", url: "/finance/opex-report", icon: BarChart3, module: "accounting" },
  { key: "expense_claims", url: "/finance/expense-claims", icon: ReceiptText, module: "accounting" },
  { key: "petty_cash", url: "/finance/petty-cash", icon: Coins, module: "accounting" },
  { key: "approvals", url: "/finance/approvals", icon: Shield, module: "accounting" },
  { key: "period_close", url: "/finance/period-close", icon: ListChecks, module: "accounting" },
  { key: "year_end_close", url: "/finance/year-end-close", icon: Lock, module: "accounting" },
  { key: "finance_audit_log", url: "/finance/audit-log", icon: History, module: "accounting" },
];

const adminItems: Item[] = [
  { key: "settings", url: "/settings", icon: Settings },
];

const hrmItems: Item[] = [
  { key: "hrm_employees", url: "/hrm/employees", icon: Users, module: "hrm", action: "view" },
  { key: "hrm_attendance", url: "/hrm/attendance", icon: ClipboardList, module: "hrm_attendance", action: "view" },
  { key: "hrm_payslips", url: "/hrm/payslips", icon: BadgeDollarSign, module: "hrm", action: "approve" },
  { key: "hrm_payroll_runs", url: "/hrm/payroll-runs", icon: ClipboardList, module: "hrm", action: "approve" },
  { key: "hrm_payroll_reconciliation", url: "/hrm/payroll-reconciliation", icon: ClipboardList, module: "hrm", action: "approve" },
  { key: "hrm_statutory_returns", url: "/hrm/statutory-returns", icon: ClipboardList, module: "hrm", action: "approve" },
  { key: "hrm_wage_reconciliation", url: "/hrm/wage-reconciliation", icon: ClipboardList, module: "hrm", action: "approve" },
  { key: "hrm_payslip_template", url: "/hrm/settings/payslip-template", icon: ClipboardList, module: "hrm", action: "approve" },
];

const logisticsItems: Item[] = [
  { key: "logistics_dashboard", url: "/logistics", icon: PieChart },
  { key: "logistics_orders", url: "/logistics/orders", icon: ClipboardList },
  { key: "logistics_trips", url: "/logistics/trips", icon: Truck },
  { key: "logistics_routes", url: "/logistics/routes", icon: Map },
  { key: "logistics_carriers", url: "/logistics/carriers", icon: Building2 },
  { key: "logistics_vehicles", url: "/logistics/vehicles", icon: Truck },
  { key: "logistics_drivers", url: "/logistics/drivers", icon: Users },
  { key: "logistics_costs", url: "/logistics/costs", icon: DollarSign },
  { key: "logistics_billing", url: "/logistics/billing", icon: PlayCircle },
];

const assetsItems: Item[] = [
  { key: "assets_register", url: "/assets", icon: Boxes },
  { key: "assets_issues", url: "/assets/issues", icon: PackageOpen },
  { key: "assets_maintenance", url: "/assets/maintenance", icon: Wrench },
  { key: "assets_disposals", url: "/assets/disposals", icon: PackageMinus },
  { key: "fixed_assets", url: "/finance/fixed-assets", icon: Building },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { signOut, user } = useAuth();
  const { isModuleEnabled } = useEnabledModules();
  const { canView, seesAll } = useUserModuleAccess();
  const hrmPerm = useModulePermissions("hrm", ["view", "approve"]);
  const attendancePerm = useModulePermissions("hrm_attendance", ["view"]);
  const { dark, toggle: toggleTheme } = useTheme();
  const { isPlatformAdmin } = useOrganization();
  const directory = useUserDirectoryAccess();
  const { t } = useTranslation(["nav", "common"]);
  const { hiddenFinanceNav } = useAppSettings();
  const opexEntryPerm = useModulePermissions("opex_entry", ["view", "create"]);
  const opexClerkOnly = !seesAll && !canView("accounting") && (opexEntryPerm.can("view") || opexEntryPerm.can("create"));
  const visibleBillingItems = (opexClerkOnly
    ? billingItems.filter((i) => i.key === "operating_expenses")
    : billingItems
  ).filter((i) => !hiddenFinanceNav.includes(i.key));
  const visibleHrmItems = seesAll
    ? hrmItems
    : hrmItems.filter((item) => {
        const permission = item.module === "hrm_attendance" ? attendancePerm : hrmPerm;
        return permission.can(item.action ?? "view");
      });

  const showModule = (m: string) => isModuleEnabled(m as any) && canView(m);

  const renderGroup = (label: string, items: Item[], defaultModule?: string, canAction?: (a: AppAction) => boolean, validateModule = true) => {
    const visible = items.filter((item) => {
      const mod = item.module ?? defaultModule;
      if (mod && validateModule) {
        const ok = Array.isArray(mod) ? mod.some((m) => canView(m)) : canView(mod);
        if (!ok) return false;
      }
      if (item.action && canAction && !seesAll && !canAction(item.action)) return false;
      return true;
    });
    if (!visible.length) return null;
    return (
      <SidebarGroup>
        <SidebarGroupLabel>{label}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {visible.map((item) => (
              <SidebarMenuItem key={item.key}>
                <SidebarMenuButton asChild>
                  <NavLink to={item.url} end={item.url === "/"} className="hover:bg-sidebar-accent" activeClassName="bg-sidebar-accent text-sidebar-primary font-medium">
                    <item.icon className="me-2 h-4 w-4" />
                    {!collapsed && <span>{t(`nav:${item.key}`)}</span>}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-2">
                <Container className="h-5 w-5 text-sidebar-primary" />
                {!collapsed && <span className="text-base font-bold tracking-tight">CDMS</span>}
              </div>
              <button onClick={toggleTheme} className="p-1 rounded hover:bg-sidebar-accent text-sidebar-foreground/60 hover:text-sidebar-foreground transition-colors" aria-label={t("common:toggle_theme")}>
                {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
            </div>
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainItems.filter((item) => {
                if (item.key === "dashboard") return true;
                if (item.key === "reports") return canView("inventory") || canView("billing") || canView("accounting");
                return canView("inventory");
              }).map((item) => (
                <SidebarMenuItem key={item.key}>
                  <SidebarMenuButton asChild>
                    <NavLink to={item.url} end={item.url === "/"} className="hover:bg-sidebar-accent" activeClassName="bg-sidebar-accent text-sidebar-primary font-medium">
                      <item.icon className="me-2 h-4 w-4" />
                      {!collapsed && <span>{t(`nav:${item.key}`)}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {showModule("gate") && renderGroup(t("nav:gate_operations"), gateItems, "gate")}
        {showModule("mr") && renderGroup(t("nav:mr"), mrItems, "mr")}
        {showModule("crm") && renderGroup(t("nav:crm_sales"), crmItems, "crm")}
        {showModule("manufacturing") && renderGroup(t("nav:manufacturing"), manufacturingItems, "manufacturing")}
        {showModule("procurement") && renderGroup(t("nav:procurement"), procurementItems, "procurement")}
        {showModule("leasing") && renderGroup(t("nav:leasing"), leasingItems, "leasing")}
        {(showModule("billing") || showModule("accounting") || opexClerkOnly) &&
          renderGroup(t("nav:billing_finance"), visibleBillingItems, undefined, undefined, !opexClerkOnly)}
        {isModuleEnabled("hrm") && visibleHrmItems.length > 0 && renderGroup(t("nav:hrm"), visibleHrmItems, undefined, undefined, false)}
        {showModule("logistics") && renderGroup(t("nav:logistics"), logisticsItems, "logistics")}
        {showModule("assets") && renderGroup(t("nav:assets"), assetsItems, "assets")}
        {!seesAll && directory.canOpen && (
          <SidebarGroup>
            <SidebarGroupLabel>{t("nav:team", { defaultValue: "Team" })}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <NavLink to="/users" className="hover:bg-sidebar-accent" activeClassName="bg-sidebar-accent text-sidebar-primary font-medium">
                      <Users className="me-2 h-4 w-4" />
                      {!collapsed && <span>{t("nav:users", { defaultValue: "Users" })}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        {seesAll && renderGroup(t("nav:admin"), adminItems)}

        {isPlatformAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>{t("nav:vendor")}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <NavLink to="/vendor/organizations" className="hover:bg-sidebar-accent" activeClassName="bg-sidebar-accent text-sidebar-primary font-medium">
                      <Building2 className="me-2 h-4 w-4" />
                      {!collapsed && <span>{t("nav:vendor_console")}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        {!collapsed && (
          <div className="px-2 pb-2">
            <LanguageSwitcher className="h-8 w-full text-xs" />
          </div>
        )}
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={signOut} className="hover:bg-sidebar-accent text-sidebar-foreground/60">
              <LogOut className="me-2 h-4 w-4" />
              {!collapsed && <span>{t("common:sign_out")}</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        {!collapsed && user && (
          <div className="px-3 pb-2 text-xs text-sidebar-foreground/40 truncate">{user.email}</div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
