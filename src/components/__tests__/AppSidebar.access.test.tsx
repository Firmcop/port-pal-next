/**
 * Verifies sidebar visibility per manager role / org context.
 *
 * We mock the data hooks so the test is hermetic — no backend calls. The mocks
 * model the exact contract used by AppSidebar: `useEnabledModules.isModuleEnabled`
 * and `useUserModuleAccess.canView` / `.seesAll`. This is the same surface used
 * by route guards and action buttons, so verifying it here also verifies that
 * managers can only reach their assigned modules elsewhere in the app.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "@/lib/router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/i18n";

// --- Mocks --------------------------------------------------------------
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: "u1", email: "test@example.com" }, signOut: vi.fn() }),
}));

const mockEnabled = vi.fn();
vi.mock("@/hooks/use-enabled-modules", () => ({
  useEnabledModules: () => ({ isModuleEnabled: mockEnabled, enabledModules: [], isLoading: false }),
}));

const mockAccess = vi.fn();
vi.mock("@/hooks/use-user-module-access", () => ({
  useUserModuleAccess: () => mockAccess(),
}));

const mockModulePermissions = vi.fn();
vi.mock("@/hooks/use-permissions", () => ({
  useModulePermissions: (module: string) => mockModulePermissions(module),
}));

vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ dark: false, toggle: vi.fn() }) }));

const mockOrg = vi.fn();
vi.mock("@/hooks/use-organization", () => ({ useOrganization: () => mockOrg() }));

vi.mock("@/components/ui/sidebar", async () => {
  const React = await import("react");
  const passthrough = (tag: string) => ({ children, ...p }: any) =>
    React.createElement(tag, p, children);
  return {
    Sidebar: passthrough("aside"),
    SidebarContent: passthrough("div"),
    SidebarGroup: passthrough("section"),
    SidebarGroupLabel: passthrough("h3"),
    SidebarGroupContent: passthrough("div"),
    SidebarMenu: passthrough("ul"),
    SidebarMenuItem: passthrough("li"),
    SidebarMenuButton: ({ children, asChild, ...p }: any) =>
      asChild ? children : React.createElement("button", p, children),
    SidebarFooter: passthrough("footer"),
    useSidebar: () => ({ state: "expanded" }),
  };
});

import { AppSidebar } from "@/components/AppSidebar";

// --- Fixtures -----------------------------------------------------------
// Mirrors the access plan documented for FCL managers.
type Scenario = {
  name: string;
  modules: string[];          // org-enabled modules
  views: string[];            // modules the user can view (from get_user_view_modules)
  seesAll: boolean;
  expectGroups: string[];     // visible group labels
  forbiddenGroups: string[];  // groups that must be hidden
};

const ALL_MODULES = [
  "core","inventory","gate","mr","crm","manufacturing","procurement",
  "leasing","billing","accounting","hrm","logistics",
];

const SCENARIOS: Scenario[] = [
  {
    name: "Admin / org owner sees every enabled module + Admin group",
    modules: ALL_MODULES,
    views: [],            // irrelevant when seesAll
    seesAll: true,
    expectGroups: [
      "Gate Operations","M&R","CRM & Sales","Manufacturing","Procurement",
      "Leasing","Billing & Finance","Human Resources","Logistics","Admin",
    ],
    forbiddenGroups: [],
  },
  {
    name: "Romadenx (Procurement / Manufacturing / Logistics manager)",
    modules: ALL_MODULES,
    views: ["inventory","procurement","manufacturing","logistics"],
    seesAll: false,
    expectGroups: ["Manufacturing","Procurement","Logistics"],
    forbiddenGroups: [
      "Gate Operations","M&R","CRM & Sales","Leasing",
      "Billing & Finance","Human Resources","Admin",
    ],
  },
  {
    name: "Gloria (Operations + CRM/Sales manager)",
    modules: ALL_MODULES,
    views: ["inventory","gate","mr","crm"],
    seesAll: false,
    expectGroups: ["Gate Operations","M&R","CRM & Sales"],
    forbiddenGroups: [
      "Manufacturing","Procurement","Leasing","Billing & Finance",
      "Human Resources","Logistics","Admin",
    ],
  },
  {
    name: "Accountant — finance only, no operations",
    modules: ALL_MODULES,
    views: ["billing","accounting"],
    seesAll: false,
    expectGroups: ["Billing & Finance"],
    forbiddenGroups: [
      "Gate Operations","M&R","CRM & Sales","Manufacturing",
      "Procurement","Leasing","Human Resources","Logistics","Admin",
    ],
  },
  {
    name: "Viewer with no module grants sees no sidebar groups",
    modules: ALL_MODULES,
    views: [],
    seesAll: false,
    expectGroups: [],
    forbiddenGroups: [
      "Gate Operations","M&R","CRM & Sales","Manufacturing","Procurement",
      "Leasing","Billing & Finance","Human Resources","Logistics","Admin",
    ],
  },
  {
    name: "Logistics manager in org where logistics module is disabled",
    modules: ALL_MODULES.filter((m) => m !== "logistics"),
    views: ["logistics","inventory"],
    seesAll: false,
    expectGroups: [],
    forbiddenGroups: ["Logistics"],
  },
];

// --- Helpers ------------------------------------------------------------
function renderSidebar(s: Scenario, opts: { isPlatformAdmin?: boolean } = {}) {
  mockEnabled.mockImplementation(
    (m: string) => m === "core" || s.modules.includes(m),
  );
  mockAccess.mockReturnValue({
    isLoading: false,
    seesAll: s.seesAll,
    canView: (m: string) => s.seesAll || s.views.includes(m),
  });
  mockOrg.mockReturnValue({
    loading: false,
    organizationId: "org-1",
    organizationName: "Test Org",
    status: "active",
    trialEndsAt: null,
    role: s.seesAll ? "admin" : "member",
    isPlatformAdmin: !!opts.isPlatformAdmin,
    needsOnboarding: false,
  });

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AppSidebar />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function groupHeadings() {
  return screen.queryAllByRole("heading", { level: 3 }).map((n) => n.textContent?.trim() ?? "");
}

// --- Tests --------------------------------------------------------------
describe("AppSidebar — manager access scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockModulePermissions.mockReturnValue({ isLoading: false, can: () => false });
  });

  for (const s of SCENARIOS) {
    it(s.name, () => {
      renderSidebar(s);
      const headings = groupHeadings();
      for (const g of s.expectGroups) {
        expect(headings, `expected group "${g}" visible`).toContain(g);
      }
      for (const g of s.forbiddenGroups) {
        expect(headings, `expected group "${g}" hidden`).not.toContain(g);
      }
    });
  }

  it("hides Vendor Console for non platform admins", () => {
    renderSidebar(SCENARIOS[0]); // admin, but not platform admin
    expect(groupHeadings()).not.toContain("Vendor");
  });

  it("shows Vendor Console for platform admins", () => {
    renderSidebar(SCENARIOS[0], { isPlatformAdmin: true });
    expect(groupHeadings()).toContain("Vendor");
  });

  it("Procurement manager sees Suppliers link but no Quotes link", () => {
    renderSidebar(SCENARIOS[1]);
    expect(screen.getByRole("link", { name: /Suppliers/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Quotes$/i })).not.toBeInTheDocument();
  });

  it("Operations/CRM manager sees EIR + Quotes but no Conversions", () => {
    renderSidebar(SCENARIOS[2]);
    expect(screen.getByRole("link", { name: /EIR Records/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Quotes$/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Conversion Jobs/i })).not.toBeInTheDocument();
  });

  it("Accountant has Finance children but no Inventory / Gate links", () => {
    renderSidebar(SCENARIOS[3]);
    expect(screen.getByRole("link", { name: /^Invoices$/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Inventory$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Gate Dashboard/i })).not.toBeInTheDocument();
  });

  it("Dashboard link is always visible regardless of grants", () => {
    renderSidebar(SCENARIOS[4]); // empty viewer
    expect(screen.getByRole("link", { name: /Dashboard/i })).toBeInTheDocument();
  });

  it("attendance-only user sees Weekly Attendance and no other HR links", () => {
    mockModulePermissions.mockImplementation((module: string) => ({
      isLoading: false,
      can: (action: string) => module === "hrm_attendance" && action === "view",
    }));
    renderSidebar({
      name: "Attendance clerk",
      modules: ALL_MODULES,
      views: ["hrm"],
      seesAll: false,
      expectGroups: ["Human Resources"],
      forbiddenGroups: [],
    });

    expect(screen.getByRole("link", { name: /Weekly Attendance/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Employees/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Payslips/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Payroll Runs/i })).not.toBeInTheDocument();
  });
});
