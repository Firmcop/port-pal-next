import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Plus, Building2, Grid3X3, Blocks, Users, Trash2, Upload, Save, BookOpen, Settings2, Image, Bell, MessageSquare, Activity, Download, PanelLeft } from "lucide-react";
import { usePushSubscription } from "@/hooks/use-push-subscription";
import { useToast } from "@/hooks/use-toast";
import { useEnabledModules, ModuleName } from "@/hooks/use-enabled-modules";
import { useOrganization } from "@/hooks/use-organization";
import { useWorkingDepot } from "@/hooks/use-working-depot";
import UserRolesSection from "@/components/settings/UserRolesSection";
import AccountSecurityCard from "@/components/settings/AccountSecurityCard";
import PermissionsMatrixSection from "@/components/settings/PermissionsMatrixSection";
import NotificationPreferencesSection from "@/components/settings/NotificationPreferencesSection";
import SystemHealthSection from "@/components/settings/SystemHealthSection";
import FinanceNavSection from "@/components/settings/FinanceNavSection";
import AcquisitionDefaultsSection from "@/components/settings/AcquisitionDefaultsSection";

import { useUserStaffRole } from "@/hooks/use-user-staff-role";
import { CurrencySelect } from "@/components/CurrencySelect";
import { useOrgCurrency } from "@/hooks/use-org-currency";
import { PromoteToHqDialog, RetireDepotDialog } from "@/components/settings/DepotAdminDialogs";
import { Crown } from "lucide-react";

export default function DepotSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { enabledModules } = useEnabledModules();
  const { isOwnerOrAdmin } = useUserStaffRole();
  const org = useOrganization();

  const { data: depots } = useQuery({
    queryKey: ["depots", org.organizationId],
    enabled: !!org.organizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("depots")
        .select("*")
        .eq("organization_id", org.organizationId!)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const duplicateHqs = (depots ?? []).filter((d: any) => d.is_hq);
  const hasHqConflict = duplicateHqs.length > 1;


  const { data: blocks } = useQuery({
    queryKey: ["yard-blocks-all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("yard_blocks").select("*, depots(name)").order("name");
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Depot configuration, modules, users, and documentation</p>
        {org.organizationName && (
          <div className="mt-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
            Active tenant: <span className="font-semibold">{org.organizationName}</span>
            {org.isPlatformAdmin && " — switch tenants from the top-bar organization selector."}
          </div>
        )}
        {hasHqConflict && (
          <div className="mt-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm">
            <div className="font-semibold text-destructive">Multiple HQ depots detected</div>
            <div className="text-muted-foreground mt-1">
              {duplicateHqs.map((d: any) => d.name).join(", ")} are all flagged as HQ. Only one HQ per organization is allowed — use "Promote to HQ" on the intended depot to repair.
            </div>
          </div>
        )}
      </div>


      <Tabs defaultValue="general" className="w-full">
        <TabsList className={`grid w-full ${isOwnerOrAdmin ? "grid-cols-7" : "grid-cols-5"}`}>
          <TabsTrigger value="general" className="flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5" />General</TabsTrigger>
          {isOwnerOrAdmin && (
            <TabsTrigger value="modules" className="flex items-center gap-1.5"><Blocks className="h-3.5 w-3.5" />Modules</TabsTrigger>
          )}
          {isOwnerOrAdmin && (
            <TabsTrigger value="sidebar" className="flex items-center gap-1.5"><PanelLeft className="h-3.5 w-3.5" />Sidebar</TabsTrigger>
          )}
          <TabsTrigger value="users" className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" />Users & Access</TabsTrigger>
          <TabsTrigger value="notifications" className="flex items-center gap-1.5"><Bell className="h-3.5 w-3.5" />Notifications</TabsTrigger>
          <TabsTrigger value="system" className="flex items-center gap-1.5"><Activity className="h-3.5 w-3.5" />System</TabsTrigger>
          <TabsTrigger value="docs" className="flex items-center gap-1.5"><BookOpen className="h-3.5 w-3.5" />Documentation</TabsTrigger>
        </TabsList>

        {/* ── General Tab ── */}
        <TabsContent value="general" className="space-y-6">
          {isOwnerOrAdmin && <OrganizationCurrencyCard />}
          {isOwnerOrAdmin && <HqGovernanceCard />}
          {depots?.length ? (
            <DepotProfileEditorSelector depots={depots} onSaved={() => queryClient.invalidateQueries({ queryKey: ["depots"] })} />
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No depot configured yet. Add one below.
              </CardContent>
            </Card>
          )}
          {isOwnerOrAdmin && <DepotAuditLogCard />}

          {/* Depots list */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2"><Building2 className="h-4 w-4" />Depots</CardTitle>
              <AddDepotDialog onSuccess={() => queryClient.invalidateQueries({ queryKey: ["depots"] })} />
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Currency</TableHead>
                    {isOwnerOrAdmin && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!depots?.length ? (
                    <TableRow><TableCell colSpan={isOwnerOrAdmin ? 6 : 5} className="text-center py-6 text-muted-foreground">No depots configured</TableCell></TableRow>
                  ) : depots.map((d: any) => (
                    <DepotRow key={d.id} depot={d} depots={depots} isOwnerOrAdmin={isOwnerOrAdmin} />
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>


          {/* Yard Blocks */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2"><Grid3X3 className="h-4 w-4" />Yard Blocks</CardTitle>
              <AddBlockDialog depots={depots ?? []} onSuccess={() => queryClient.invalidateQueries({ queryKey: ["yard-blocks-all"] })} />
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Depot</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Bays × Rows × Tiers</TableHead>
                    <TableHead>Power</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!blocks?.length ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">No blocks configured</TableCell></TableRow>
                  ) : blocks.map((b: any) => (
                    <TableRow key={b.id}>
                      <TableCell className="font-medium">{b.name}</TableCell>
                      <TableCell>{b.depots?.name}</TableCell>
                      <TableCell className="capitalize">{b.block_type}</TableCell>
                      <TableCell className="font-mono">{b.max_bays} × {b.max_rows} × {b.max_tiers}</TableCell>
                      <TableCell>{b.has_power ? "⚡ Yes" : "No"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Modules Tab (admin/owner only) ── */}
        {isOwnerOrAdmin && (
          <TabsContent value="modules" className="space-y-6">
            <ModulesCheckCard depots={depots ?? []} />

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Blocks className="h-4 w-4" />Optional Modules</CardTitle>
                <CardDescription>Enable or disable feature modules for your depot</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ModuleToggle label="CRM & Sales" description="Leads, deals, quotes, customers, and sales orders pipeline" moduleName="crm" depots={depots ?? []} enabledModules={enabledModules} queryClient={queryClient} />
                <ModuleToggle label="Manufacturing" description="Container conversion jobs with BOM, labour, tasks, and costing" moduleName="manufacturing" depots={depots ?? []} enabledModules={enabledModules} queryClient={queryClient} />
                <ModuleToggle label="Procurement" description="Suppliers, purchase orders, and goods receipt management" moduleName="procurement" depots={depots ?? []} enabledModules={enabledModules} queryClient={queryClient} />
                <ModuleToggle label="Accounting" description="Cost accounting, financial transactions ledger, and P&L summary" moduleName="accounting" depots={depots ?? []} enabledModules={enabledModules} queryClient={queryClient} />
                <ModuleToggle label="Container Leasing" description="Lease quotations, master agreements, on-hire/off-hire tracker, per-diem billing & DPP" moduleName="leasing" depots={depots ?? []} enabledModules={enabledModules} queryClient={queryClient} />
                <ModuleToggle label="Human Resources" description="Employees, payroll runs, payslips, approvals & reconciliation" moduleName="hrm" depots={depots ?? []} enabledModules={enabledModules} queryClient={queryClient} />
                <ModuleToggle label="Logistics" description="Shuttle ops, custom transport orders, fleet & subcontractors, per-trip costing and billing" moduleName="logistics" depots={depots ?? []} enabledModules={enabledModules} queryClient={queryClient} />
                <ModuleToggle label="Customer Portal" description="Self-service /portal for customers: inventory, billing, release instructions" moduleName="portal" depots={depots ?? []} enabledModules={enabledModules} queryClient={queryClient} />
                <ModuleToggle label="WhatsApp Channel" description="Meta Cloud API + Gemini intent parser for inbound customer messages and outbound alerts" moduleName="whatsapp" depots={depots ?? []} enabledModules={enabledModules} queryClient={queryClient} />
              </CardContent>
            </Card>

            {/* Per-module config */}
            <ModuleConfigSection depots={depots ?? []} enabledModules={enabledModules} />
          </TabsContent>
        )}

        {/* ── Users & Access Tab ── */}
        {isOwnerOrAdmin && (
          <TabsContent value="sidebar" className="space-y-6">
            <FinanceNavSection />
            <AcquisitionDefaultsSection />

          </TabsContent>
        )}

        <TabsContent value="users" className="space-y-6">
          <AccountSecurityCard />
          <UserRolesSection />
          <PermissionsMatrixSection />
          <PortalUsersSection />
        </TabsContent>

        {/* ── Notifications Tab ── */}
        <TabsContent value="notifications" className="space-y-6">
          <NotificationPreferencesSection />
        </TabsContent>

        {/* ── System Tab ── */}
        <TabsContent value="system" className="space-y-6">
          <SystemHealthSection />
        </TabsContent>

        {/* ── Documentation Tab ── */}
        <TabsContent value="docs" className="space-y-6">
          <DocumentationSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ─── Organization Currency ─── */
function OrganizationCurrencyCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { organizationId, organizationName } = useOrganization();
  const { currency } = useOrgCurrency();
  const [value, setValue] = useState<string>(currency || "USD");

  useEffect(() => {
    if (currency) setValue(currency);
  }, [currency]);


  const save = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("No organization");
      const { error } = await supabase.from("organizations").update({ currency: value }).eq("id", organizationId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Primary currency updated", description: `${organizationName ?? "Organization"} now uses ${value}.` });
      queryClient.invalidateQueries({ queryKey: ["org-currency"] });
      queryClient.invalidateQueries({ queryKey: ["app-settings-org"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Settings2 className="h-4 w-4" />Organization Currency</CardTitle>
        <CardDescription>Primary currency applied across invoices, reports, and new records. Individual depots, suppliers, and customers may override.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-end gap-3">
          <div className="space-y-2 flex-1 max-w-sm">
            <Label>Primary currency</Label>
            <CurrencySelect value={value} onChange={setValue} />
          </div>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !value || value === currency}>
            <Save className="mr-1 h-4 w-4" />{save.isPending ? "Saving..." : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── Depot Profile Editor ─── */
function DepotProfileEditor({ depot, onSaved }: { depot: any; onSaved: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    name: depot.name ?? "",
    code: depot.code ?? "",
    location: depot.location ?? "",
    timezone: depot.timezone ?? "UTC",
    currency: depot.currency ?? "USD",
    address_line1: depot.address_line1 ?? "",
    address_line2: depot.address_line2 ?? "",
    city: depot.city ?? "",
    country: depot.country ?? "",
    postal_code: depot.postal_code ?? "",
    phone: depot.phone ?? "",
    email: depot.email ?? "",
    website: depot.website ?? "",
    tax_id: depot.tax_id ?? "",
    registration_number: depot.registration_number ?? "",
  });
  const [bankForm, setBankForm] = useState({ bank_name: "", bank_account: "", bank_branch: "" });
  const [logoUrl, setLogoUrl] = useState(depot.logo_url ?? "");
  const [uploading, setUploading] = useState(false);

  // Banking details live in a separate, finance-only table.
  const { data: bankDetails, isError: bankDenied } = useQuery({
    queryKey: ["depot-bank-details", depot.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("depot_bank_details")
        .select("bank_name, bank_account, bank_branch")
        .eq("depot_id", depot.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    retry: false,
  });

  useEffect(() => {
    if (bankDetails) {
      setBankForm({
        bank_name: bankDetails.bank_name ?? "",
        bank_account: bankDetails.bank_account ?? "",
        bank_branch: bankDetails.bank_branch ?? "",
      });
    }
  }, [bankDetails]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const setBank = (k: string, v: string) => setBankForm((f) => ({ ...f, [k]: v }));

  const invalidateBranding = () => {
    queryClient.invalidateQueries({ queryKey: ["depots"] });
    queryClient.invalidateQueries({ queryKey: ["depots", depot.organization_id] });
    queryClient.invalidateQueries({ queryKey: ["working-depot"] });
    queryClient.invalidateQueries({ queryKey: ["working-depot", depot.organization_id] });
    queryClient.invalidateQueries({ queryKey: ["working-depot-options"] });
    queryClient.invalidateQueries({ queryKey: ["working-depot-options", depot.organization_id] });
    queryClient.invalidateQueries({ queryKey: ["app-settings-org"] });
    queryClient.invalidateQueries({ queryKey: ["app-settings-org", depot.organization_id] });
    queryClient.invalidateQueries({ queryKey: ["org-currency"] });
    queryClient.invalidateQueries({ queryKey: ["org-currency", depot.organization_id] });
    queryClient.invalidateQueries({ queryKey: ["depot-bank-details", depot.id] });
  };

  const save = useMutation({
    mutationFn: async () => {
      const nextLogo = logoUrl || null;
      const { error } = await supabase.from("depots").update({ ...form, logo_url: nextLogo }).eq("id", depot.id);
      if (error) throw error;
      if (!bankDenied) {
        const { error: bankErr } = await (supabase as any)
          .from("depot_bank_details")
          .upsert(
            {
              depot_id: depot.id,
              organization_id: depot.organization_id,
              bank_name: bankForm.bank_name || null,
              bank_account: bankForm.bank_account || null,
              bank_branch: bankForm.bank_branch || null,
            },
            { onConflict: "depot_id" },
          );
        if (bankErr) throw bankErr;
      }
      // Mirror HQ depot logo to the organization so app-wide branding updates.
      if (depot.is_hq && depot.organization_id) {
        await supabase.from("organizations").update({ logo_url: nextLogo }).eq("id", depot.organization_id);
      }
    },
    onSuccess: () => { onSaved(); invalidateBranding(); toast({ title: "Depot profile saved" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });


  const uploadLogo = async (file: File) => {
    setUploading(true);
    try {
      const { data: orgRow, error: orgErr } = await supabase.rpc("current_org_id" as any);
      if (orgErr) throw orgErr;
      const orgId = orgRow as string | null;
      if (!orgId) throw new Error("No organization context");
      const path = `${orgId}/${depot.id}/logo.${file.name.split(".").pop()}`;
      const { error: upErr } = await supabase.storage.from("depot-assets").upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from("depot-assets").getPublicUrl(path);
      const logoPublicUrl = `${data.publicUrl}?v=${Date.now()}`;
      setLogoUrl(logoPublicUrl);
      // Persist immediately so the app-wide store picks it up without a Save click.
      await supabase.from("depots").update({ logo_url: logoPublicUrl }).eq("id", depot.id);
      if (depot.is_hq) {
        await supabase.from("organizations").update({ logo_url: logoPublicUrl }).eq("id", orgId);
      }
      invalidateBranding();
      toast({ title: "Logo uploaded" });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };


  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Settings2 className="h-4 w-4" />Depot Profile</CardTitle>
        <CardDescription>Company details used on printed documents (EIRs, invoices, receipts)</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-6">
          {/* Logo */}
          <div className="flex items-center gap-6">
            <div className="h-20 w-20 rounded-lg border-2 border-dashed border-muted-foreground/30 flex items-center justify-center overflow-hidden bg-muted">
              {logoUrl ? (
                <img src={logoUrl} alt="Logo" className="h-full w-full object-contain" />
              ) : (
                <Image className="h-8 w-8 text-muted-foreground/40" />
              )}
            </div>
            <div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { if (e.target.files?.[0]) uploadLogo(e.target.files[0]); }} />
              <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                <Upload className="mr-1 h-3.5 w-3.5" />{uploading ? "Uploading..." : "Upload Logo"}
              </Button>
              <p className="text-xs text-muted-foreground mt-1">Recommended: 200×200px PNG or SVG</p>
            </div>
          </div>

          {/* Basic info */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2"><Label>Depot Name</Label><Input value={form.name} onChange={(e) => set("name", e.target.value)} required /></div>
            <div className="space-y-2"><Label>Code</Label><Input value={form.code} onChange={(e) => set("code", e.target.value.toUpperCase())} required className="font-mono" /></div>
            <div className="space-y-2"><Label>Location</Label><Input value={form.location} onChange={(e) => set("location", e.target.value)} /></div>
          </div>

          {/* Address */}
          <div>
            <h4 className="text-sm font-medium mb-3">Address</h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Address Line 1</Label><Input value={form.address_line1} onChange={(e) => set("address_line1", e.target.value)} placeholder="Street address" /></div>
              <div className="space-y-2"><Label>Address Line 2</Label><Input value={form.address_line2} onChange={(e) => set("address_line2", e.target.value)} placeholder="Suite, unit, etc." /></div>
              <div className="space-y-2"><Label>City</Label><Input value={form.city} onChange={(e) => set("city", e.target.value)} /></div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Postal Code</Label><Input value={form.postal_code} onChange={(e) => set("postal_code", e.target.value)} /></div>
                <div className="space-y-2"><Label>Country</Label><Input value={form.country} onChange={(e) => set("country", e.target.value)} /></div>
              </div>
            </div>
          </div>

          {/* Contact */}
          <div>
            <h4 className="text-sm font-medium mb-3">Contact</h4>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2"><Label>Phone</Label><Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+254..." /></div>
              <div className="space-y-2"><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} /></div>
              <div className="space-y-2"><Label>Website</Label><Input value={form.website} onChange={(e) => set("website", e.target.value)} placeholder="https://..." /></div>
            </div>
          </div>

          {/* Registration & Tax */}
          <div>
            <h4 className="text-sm font-medium mb-3">Registration & Tax</h4>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2"><Label>Registration Number</Label><Input value={form.registration_number} onChange={(e) => set("registration_number", e.target.value)} /></div>
              <div className="space-y-2"><Label>Tax / VAT ID</Label><Input value={form.tax_id} onChange={(e) => set("tax_id", e.target.value)} /></div>
              <div className="space-y-2"><Label>Currency (depot)</Label><CurrencySelect value={form.currency} onChange={(v) => set("currency", v)} /></div>
            </div>
          </div>

          {/* Banking — restricted to owners, admins and accountants */}
          {bankDenied ? (
            <div>
              <h4 className="text-sm font-medium mb-3">Banking Details</h4>
              <p className="text-sm text-muted-foreground">
                Banking details are restricted to owners, admins and accountants.
              </p>
            </div>
          ) : (
            <div>
              <h4 className="text-sm font-medium mb-3">Banking Details</h4>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2"><Label>Bank Name</Label><Input value={bankForm.bank_name} onChange={(e) => setBank("bank_name", e.target.value)} /></div>
                <div className="space-y-2"><Label>Account Number</Label><Input value={bankForm.bank_account} onChange={(e) => setBank("bank_account", e.target.value)} /></div>
                <div className="space-y-2"><Label>Branch Code</Label><Input value={bankForm.bank_branch} onChange={(e) => setBank("bank_branch", e.target.value)} /></div>
              </div>
            </div>
          )}


          <Button type="submit" disabled={save.isPending}><Save className="mr-1 h-4 w-4" />{save.isPending ? "Saving..." : "Save Profile"}</Button>
        </form>
      </CardContent>
    </Card>
  );
}

/* ─── Module-specific config cards ─── */
function ModuleConfigSection({ depots, enabledModules }: { depots: any[]; enabledModules: ModuleName[] }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const depot = depots.find((d: any) => d.is_hq) ?? depots[0];
  const config = (depot?.config as Record<string, any>) ?? {};

  const saveConfig = useMutation({
    mutationFn: async (patch: Record<string, any>) => {
      if (!depot) throw new Error("No depot");
      const merged = { ...config, ...patch };
      const { error } = await supabase.from("depots").update({ config: merged }).eq("id", depot.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["depots"] });
      queryClient.invalidateQueries({ queryKey: ["enabled-modules"] });
      toast({ title: "Module settings saved" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (!depot) return null;

  return (
    <div className="space-y-4">
      {/* Gate – always available */}
      <ConfigCard
        title="Gate Operations"
        description="Default gate and EIR settings"
        fields={[
          { key: "gate_slot_duration", label: "Appointment Slot (minutes)", type: "number", defaultVal: "30" },
          { key: "gate_auto_eir_in", label: "Auto-create EIR on Gate In", type: "switch", defaultVal: false },
          { key: "gate_auto_eir_out", label: "Auto-create EIR on Gate Out", type: "switch", defaultVal: false },
        ]}
        config={config}
        onSave={(patch) => saveConfig.mutate(patch)}
        saving={saveConfig.isPending}
      />

      {/* Billing – always available */}
      <ConfigCard
        title="Billing & Invoicing"
        description="Default billing and payment terms"
        fields={[
          { key: "billing_payment_terms", label: "Payment Terms (days)", type: "number", defaultVal: "30" },
          { key: "billing_invoice_prefix", label: "Invoice Number Prefix", type: "text", defaultVal: "INV-" },
          { key: "billing_tax_rate", label: "Default Tax Rate (%)", type: "number", defaultVal: "16" },
          { key: "billing_late_fee_pct", label: "Late Fee (%)", type: "number", defaultVal: "2" },
        ]}
        config={config}
        onSave={(patch) => saveConfig.mutate(patch)}
        saving={saveConfig.isPending}
      />

      {/* M&R – always available */}
      <ConfigCard
        title="Maintenance & Repair"
        description="Inspection and work order defaults"
        fields={[
          { key: "mr_default_labour_rate", label: "Default Labour Rate / hr", type: "number", defaultVal: "25" },
          { key: "mr_auto_wo_from_estimate", label: "Auto-create Work Order from Approved Estimate", type: "switch", defaultVal: false },
        ]}
        config={config}
        onSave={(patch) => saveConfig.mutate(patch)}
        saving={saveConfig.isPending}
      />

      {enabledModules.includes("crm") && (
        <ConfigCard
          title="CRM & Sales"
          description="Pipeline and quote defaults"
          fields={[
            { key: "crm_quote_validity_days", label: "Quote Validity (days)", type: "number", defaultVal: "30" },
            { key: "crm_lead_sources", label: "Lead Sources (comma-separated)", type: "text", defaultVal: "walk_in,referral,website,phone" },
          ]}
          config={config}
          onSave={(patch) => saveConfig.mutate(patch)}
          saving={saveConfig.isPending}
        />
      )}

      {enabledModules.includes("manufacturing") && (
        <ConfigCard
          title="Manufacturing"
          description="Conversion and BOM settings"
          fields={[
            { key: "mfg_bom_auto_deduct", label: "Auto-deduct BOM from Stock on Issue", type: "switch", defaultVal: false },
            { key: "mfg_task_categories", label: "Task Categories (comma-separated)", type: "text", defaultVal: "fabrication,welding,electrical,plumbing,painting,insulation" },
          ]}
          config={config}
          onSave={(patch) => saveConfig.mutate(patch)}
          saving={saveConfig.isPending}
        />
      )}

      {enabledModules.includes("procurement") && (
        <ConfigCard
          title="Procurement"
          description="Purchase order and reorder settings"
          fields={[
            { key: "proc_po_prefix", label: "PO Number Prefix", type: "text", defaultVal: "PO-" },
            { key: "proc_reorder_threshold", label: "Reorder Alert Threshold", type: "number", defaultVal: "10" },
            { key: "proc_delivery_terms", label: "Default Delivery Terms", type: "text", defaultVal: "Ex-works" },
          ]}
          config={config}
          onSave={(patch) => saveConfig.mutate(patch)}
          saving={saveConfig.isPending}
        />
      )}

      {/* Notifications – always available */}
      <NotificationsConfigCard config={config} onSave={(patch) => saveConfig.mutate(patch)} saving={saveConfig.isPending} />
    </div>
  );
}

/* ─── Notifications Config Card ─── */
function NotificationsConfigCard({ config, onSave, saving }: { config: Record<string, any>; onSave: (patch: Record<string, any>) => void; saving: boolean }) {
  const { permission, subscribed, subscribe, unsubscribe } = usePushSubscription();
  const [local, setLocal] = useState<Record<string, any>>(() => ({
    notify_web_push: config.notify_web_push ?? false,
    notify_whatsapp: config.notify_whatsapp ?? false,
    notify_movements: config.notify_movements ?? true,
    notify_appointments: config.notify_appointments ?? true,
    notify_work_orders: config.notify_work_orders ?? true,
    vapid_public_key: config.vapid_public_key ?? "",
  }));

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2"><Bell className="h-4 w-4" />Push Notifications</CardTitle>
        <CardDescription className="text-xs">Configure Web Push and WhatsApp notification channels</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Web Push Notifications</Label>
            <Switch checked={!!local.notify_web_push} onCheckedChange={(v) => setLocal((l) => ({ ...l, notify_web_push: v }))} />
          </div>
          {local.notify_web_push && (
            <div className="pl-4 space-y-2 border-l-2 border-muted">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm">Browser Subscription</p>
                  <p className="text-xs text-muted-foreground">
                    {subscribed ? "✅ Subscribed" : permission === "denied" ? "❌ Blocked by browser" : "Not subscribed"}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={subscribed ? unsubscribe : subscribe}>
                  {subscribed ? "Unsubscribe" : "Enable"}
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-4 items-center">
                <Label className="text-sm">VAPID Public Key</Label>
                <Input
                  value={local.vapid_public_key}
                  onChange={(e) => setLocal((l) => ({ ...l, vapid_public_key: e.target.value }))}
                  placeholder="Paste your VAPID public key"
                  className="h-8 text-xs font-mono"
                />
              </div>
            </div>
          )}
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-success" />
              <Label className="text-sm font-medium">WhatsApp Notifications</Label>
            </div>
            <Switch checked={!!local.notify_whatsapp} onCheckedChange={(v) => setLocal((l) => ({ ...l, notify_whatsapp: v }))} />
          </div>
          {local.notify_whatsapp && (
            <p className="text-xs text-muted-foreground pl-4 border-l-2 border-muted">
              Requires WhatsApp Cloud API credentials configured in your backend secrets (WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID).
            </p>
          )}
        </div>
        <div className="space-y-2 pt-2 border-t">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Events to notify</Label>
          {[
            { key: "notify_movements", label: "Container Movements" },
            { key: "notify_appointments", label: "Gate Appointments" },
            { key: "notify_work_orders", label: "Work Orders" },
          ].map((evt) => (
            <div key={evt.key} className="flex items-center justify-between">
              <Label className="text-sm">{evt.label}</Label>
              <Switch checked={!!local[evt.key]} onCheckedChange={(v) => setLocal((l) => ({ ...l, [evt.key]: v }))} />
            </div>
          ))}
        </div>
        <Button size="sm" variant="outline" onClick={() => onSave(local)} disabled={saving}>
          <Save className="mr-1 h-3.5 w-3.5" />{saving ? "Saving..." : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}

type FieldDef = { key: string; label: string; type: "text" | "number" | "switch"; defaultVal: string | boolean | number };

function ConfigCard({ title, description, fields, config, onSave, saving }: {
  title: string; description: string; fields: FieldDef[]; config: Record<string, any>; onSave: (patch: Record<string, any>) => void; saving: boolean;
}) {
  const [local, setLocal] = useState<Record<string, any>>(() => {
    const init: Record<string, any> = {};
    fields.forEach((f) => { init[f.key] = config[f.key] ?? f.defaultVal; });
    return init;
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{title}</CardTitle>
        <CardDescription className="text-xs">{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {fields.map((f) =>
          f.type === "switch" ? (
            <div key={f.key} className="flex items-center justify-between">
              <Label className="text-sm">{f.label}</Label>
              <Switch checked={!!local[f.key]} onCheckedChange={(v) => setLocal((l) => ({ ...l, [f.key]: v }))} />
            </div>
          ) : (
            <div key={f.key} className="grid grid-cols-2 gap-4 items-center">
              <Label className="text-sm">{f.label}</Label>
              <Input
                type={f.type}
                value={local[f.key] ?? ""}
                onChange={(e) => setLocal((l) => ({ ...l, [f.key]: f.type === "number" ? Number(e.target.value) : e.target.value }))}
                className="h-8 text-sm"
              />
            </div>
          )
        )}
        <Button size="sm" variant="outline" onClick={() => onSave(local)} disabled={saving}>
          <Save className="mr-1 h-3.5 w-3.5" />{saving ? "Saving..." : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}

/* ─── Documentation Section ─── */
function DocumentationSection() {
  const downloads = [
    {
      title: "Implementation Guide",
      description: "End-to-end setup, configuration, and deployment instructions for administrators and implementers.",
      href: "/docs/Implementation_Guide.pdf",
      filename: "Implementation_Guide.pdf",
      type: "PDF",
    },
    {
      title: "EIR API Documentation",
      description: "Endpoints, request/response examples, schema, and role requirements for EIR records.",
      href: "/docs/EIR_API_Documentation.pdf",
      filename: "EIR_API_Documentation.pdf",
      type: "PDF",
    },
  ];
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><BookOpen className="h-4 w-4" />Downloadable Guides</CardTitle>
          <CardDescription>Reference documentation you can save or share offline.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {downloads.map((d) => (
            <div key={d.href} className="flex items-center justify-between border rounded-lg p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{d.title}</span>
                  <Badge variant="secondary">{d.type}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">{d.description}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button asChild variant="outline" size="sm">
                  <a href={d.href} target="_blank" rel="noopener noreferrer">Open</a>
                </Button>
                <Button asChild size="sm">
                  <a href={d.href} download={d.filename}>
                    <Download className="h-4 w-4 mr-1.5" />Download
                  </a>
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><BookOpen className="h-4 w-4" />Implementation Guide</CardTitle>
          <CardDescription>Step-by-step instructions for setting up and using each module</CardDescription>
        </CardHeader>
        <CardContent>

        <Accordion type="multiple" className="w-full">
          <AccordionItem value="getting-started">
            <AccordionTrigger>🚀 Getting Started</AccordionTrigger>
            <AccordionContent className="prose prose-sm max-w-none text-muted-foreground space-y-2">
              <p><strong>Initial Setup Checklist:</strong></p>
              <ol className="list-decimal pl-5 space-y-1">
                <li><strong>Create a Depot</strong> — Go to Settings → General and add your depot with name, code, and location.</li>
                <li><strong>Complete Depot Profile</strong> — Fill in address, contact, tax ID, and banking details. Upload your logo. These appear on all printed documents.</li>
                <li><strong>Configure Yard Blocks</strong> — Define storage areas (blocks) with bay/row/tier dimensions. Mark reefer blocks with power.</li>
                <li><strong>Add Users</strong> — Go to Users & Access tab. Assign roles: Admin (full access), Yard Operator (operations), Gate Clerk (gate/EIR), Viewer (read-only).</li>
                <li><strong>Enable Modules</strong> — Go to Modules tab and toggle on the features you need (CRM, Manufacturing, Procurement, Accounting).</li>
                <li><strong>Set Up Tariffs</strong> — Navigate to Billing → Tariffs to configure storage rates, handling fees, and other charges.</li>
              </ol>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="gate">
            <AccordionTrigger>🚪 Gate Operations</AccordionTrigger>
            <AccordionContent className="prose prose-sm max-w-none text-muted-foreground space-y-2">
              <p><strong>Workflow: Gate In</strong></p>
              <ol className="list-decimal pl-5 space-y-1">
                <li>Create a <strong>Gate Appointment</strong> (type: Gate In) with container number, shipping line, driver details, and truck plate.</li>
                <li>When the truck arrives, update appointment status to <strong>Arrived</strong>.</li>
                <li>Conduct inspection and create an <strong>EIR (Equipment Interchange Receipt)</strong> — record condition grade (A–D), damage notes, seal number, and photos.</li>
                <li>The container is automatically added to inventory with status "Available" and position is assigned.</li>
                <li>Update appointment to <strong>Completed</strong>.</li>
              </ol>
              <p><strong>Workflow: Gate Out</strong></p>
              <ol className="list-decimal pl-5 space-y-1">
                <li>A Release Instruction must exist (from the customer/shipping line) before a gate-out is allowed.</li>
                <li>Create a Gate Out appointment. The system validates the release instruction.</li>
                <li>Create a gate-out EIR recording the container's condition at departure.</li>
                <li>The container status is updated to "Gated Out" and removed from yard position.</li>
              </ol>
              <p><strong>Trucks & Drivers</strong> — Register recurring trucks and drivers for quick selection during appointments.</p>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="inventory">
            <AccordionTrigger>📦 Inventory Management</AccordionTrigger>
            <AccordionContent className="prose prose-sm max-w-none text-muted-foreground space-y-2">
              <p><strong>Container Lifecycle:</strong></p>
              <p>Available → In Use / Under Repair / In Conversion → Gated Out / Sold</p>
              <p><strong>Key Fields:</strong></p>
              <ul className="list-disc pl-5 space-y-1">
                <li><strong>Container Number</strong> — Standard ISO format (e.g., MSCU1234567)</li>
                <li><strong>Owner</strong> — The shipping line or company that owns the container</li>
                <li><strong>Category</strong> — Dry, Reefer, Open Top, Flat Rack, Tank</li>
                <li><strong>Size</strong> — 20ft or 40ft</li>
                <li><strong>Yard Position</strong> — Block → Bay → Row → Tier</li>
              </ul>
              <p><strong>Movements</strong> — Every position change (gate in, relocation, gate out) creates a movement record for full audit trail.</p>
              <p><strong>Yard Map</strong> — Visual grid showing block occupancy in real-time.</p>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="mr">
            <AccordionTrigger>🔧 Maintenance & Repair (M&R)</AccordionTrigger>
            <AccordionContent className="prose prose-sm max-w-none text-muted-foreground space-y-2">
              <p><strong>Workflow: Inspection → Estimate → Work Order</strong></p>
              <ol className="list-decimal pl-5 space-y-1">
                <li><strong>Inspection</strong> — Record condition grade, findings, photos. Mark if repair is required.</li>
                <li><strong>Damage Estimate</strong> — Create a detailed cost estimate with labour hours, labour cost, and material cost. Submit for approval.</li>
                <li><strong>Approval</strong> — Admin reviews and approves or rejects the estimate. Rejected estimates include a reason.</li>
                <li><strong>Work Order</strong> — Once approved, a work order is created (can be automatic if configured). Assign workers, track progress.</li>
                <li><strong>Completion</strong> — Mark work order complete. Container status returns to "Available".</li>
              </ol>
              <p><strong>Settings:</strong> Configure default labour rate and auto-WO creation in Modules → M&R settings.</p>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="crm">
            <AccordionTrigger>🤝 CRM & Sales</AccordionTrigger>
            <AccordionContent className="prose prose-sm max-w-none text-muted-foreground space-y-2">
              <p><strong>Pipeline: Lead → Deal → Quote → Sales Order</strong></p>
              <ol className="list-decimal pl-5 space-y-1">
                <li><strong>Leads</strong> — Capture inquiries with contact info, source (walk-in, referral, website), and notes. Status: New → Contacted → Qualified → Lost.</li>
                <li><strong>Deals</strong> — Convert qualified leads to deals. Track value, expected close date, and pipeline stage (Discovery → Proposal → Negotiation → Won/Lost).</li>
                <li><strong>Quotes</strong> — Generate itemized quotes for customers. Set validity period. Status: Draft → Sent → Accepted → Rejected.</li>
                <li><strong>Sales Orders</strong> — Convert accepted quotes to orders. Link specific containers or conversions.</li>
                <li><strong>Customers</strong> — Manage customer records with type (shipping line, freight forwarder, trader, individual), contact details, and KRA PIN.</li>
              </ol>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="manufacturing">
            <AccordionTrigger>🏭 Manufacturing (Conversions)</AccordionTrigger>
            <AccordionContent className="prose prose-sm max-w-none text-muted-foreground space-y-2">
              <p><strong>Workflow: Plan → Execute → Complete</strong></p>
              <ol className="list-decimal pl-5 space-y-1">
                <li><strong>Create Conversion</strong> — Select a container, product type (office, ablution, cold room, etc.), and customer if applicable.</li>
                <li><strong>Bill of Materials (BOM)</strong> — Add materials from the catalog or manually. Specify planned quantities. Issue materials from stock when ready.</li>
                <li><strong>Labour</strong> — Assign workers from the employee register. Log hours and rates. Total labour cost is auto-calculated.</li>
                <li><strong>Tasks</strong> — Break down work into tasks (fabrication, welding, electrical, etc.). Assign to workers, track start/end times.</li>
                <li><strong>Services</strong> — Record outsourced services (painting, transport, etc.) with costs.</li>
                <li><strong>Costing</strong> — View real-time cost breakdown: container cost + materials + labour + services = actual cost vs. quoted price.</li>
              </ol>
              <p><strong>Settings:</strong> Configure task categories and BOM auto-deduction in Modules → Manufacturing.</p>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="procurement">
            <AccordionTrigger>📋 Procurement</AccordionTrigger>
            <AccordionContent className="prose prose-sm max-w-none text-muted-foreground space-y-2">
              <p><strong>Workflow: PO → Goods Receipt → Stock Update</strong></p>
              <ol className="list-decimal pl-5 space-y-1">
                <li><strong>Suppliers</strong> — Register suppliers with contact details, categories, and payment terms.</li>
                <li><strong>Materials Catalog</strong> — Define materials with name, unit, unit cost, and category.</li>
                <li><strong>Purchase Orders</strong> — Create POs against suppliers, optionally linked to a conversion job. Add line items from the catalog.</li>
                <li><strong>Goods Receipt</strong> — Record received quantities against PO items. Partial receipts supported.</li>
                <li><strong>Stock Update</strong> — Received quantities automatically update the material stock levels.</li>
              </ol>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="billing">
            <AccordionTrigger>💰 Billing & Finance</AccordionTrigger>
            <AccordionContent className="prose prose-sm max-w-none text-muted-foreground space-y-2">
              <p><strong>Key Features:</strong></p>
              <ul className="list-disc pl-5 space-y-1">
                <li><strong>Tariffs</strong> — Define rates for storage (per day), handling (per move), repair, and custom charges by container size.</li>
                <li><strong>Invoices</strong> — Generate invoices with line items, tax calculation, and customer reference. Status: Draft → Issued → Paid → Overdue.</li>
                <li><strong>Payments</strong> — Record payments against invoices. Methods: bank transfer, cash, cheque, mobile money.</li>
                <li><strong>Accounting Ledger</strong> — All financial events (sales, purchases, payments) auto-post to the accounting transactions ledger with proper debit/credit entries.</li>
                <li><strong>Financial Summary</strong> — P&L view showing revenue by service line, cost of goods sold, and net margin.</li>
              </ul>
              <p><strong>Settings:</strong> Configure payment terms, invoice prefix, tax rate, and late fees in Modules → Billing.</p>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="sales">
            <AccordionTrigger>🏷️ Container Sales</AccordionTrigger>
            <AccordionContent className="prose prose-sm max-w-none text-muted-foreground space-y-2">
              <p><strong>Workflow: List → Mark Sold</strong></p>
              <ol className="list-decimal pl-5 space-y-1">
                <li><strong>List for Sale</strong> — Select a container, set buyer name, entry price (acquisition cost), and markup %. Selling price auto-calculates.</li>
                <li><strong>Mark Sold</strong> — Triggers automated actions:
                  <ul className="list-disc pl-5 mt-1">
                    <li>Container ownership transfers from original owner to depot</li>
                    <li>Purchase invoice generated to original owner (acquisition cost)</li>
                    <li>Gate-out EIR created with release purpose "sale"</li>
                    <li>Gate-out movement recorded</li>
                    <li>Accounting entries: COGS debit + Revenue credit</li>
                    <li>Container status set to "Sold"</li>
                  </ul>
                </li>
                <li><strong>Print Documents</strong> — Print the sale EIR and sale receipt from the sales list.</li>
              </ol>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="repatriation">
            <AccordionTrigger>🚢 Repatriation</AccordionTrigger>
            <AccordionContent className="prose prose-sm max-w-none text-muted-foreground space-y-2">
              <p><strong>Workflow: Request → Approve → Dispatch → Complete</strong></p>
              <ol className="list-decimal pl-5 space-y-1">
                <li><strong>Request</strong> — Create a repatriation for a container to be returned to a shipping line. Specify destination, release order number, and transporter.</li>
                <li><strong>Approve</strong> — Admin approves the repatriation request.</li>
                <li><strong>Dispatch</strong> — Record dispatch. Auto-creates a gate-out EIR for the container. Add trip costs (fuel, tolls, driver allowance).</li>
                <li><strong>Complete</strong> — Mark as delivered. Container status becomes "Gated Out".</li>
              </ol>
              <p><strong>Trip Costing:</strong> Track all costs per trip including fuel, driver allowance, tolls, and other expenses.</p>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="portal">
            <AccordionTrigger>🌐 Customer Portal</AccordionTrigger>
            <AccordionContent className="prose prose-sm max-w-none text-muted-foreground space-y-2">
              <p><strong>Setup:</strong></p>
              <ol className="list-decimal pl-5 space-y-1">
                <li>Go to <strong>Users & Access → Portal Users</strong>.</li>
                <li>Click <strong>Invite Customer</strong> — select a customer, enter their email and initial password.</li>
                <li>The customer receives a verification email and can log in at <code>/portal</code>.</li>
              </ol>
              <p><strong>What customers can access:</strong></p>
              <ul className="list-disc pl-5 space-y-1">
                <li>View their containers in the depot</li>
                <li>See container movements and status</li>
                <li>Create gate appointments</li>
                <li>Submit release instructions</li>
                <li>View their invoices and billing</li>
                <li>Receive notifications</li>
              </ul>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="reports">
            <AccordionTrigger>📊 Reports</AccordionTrigger>
            <AccordionContent className="prose prose-sm max-w-none text-muted-foreground space-y-2">
              <p><strong>Available Reports:</strong></p>
              <ul className="list-disc pl-5 space-y-1">
                <li><strong>Dashboard</strong> — Real-time KPIs: total containers, occupancy rate, pending appointments, active conversions, revenue.</li>
                <li><strong>Inventory Report</strong> — Containers by status, owner, size, and category. Exportable to CSV.</li>
                <li><strong>Movement Report</strong> — All gate-in/gate-out events with date filters.</li>
                <li><strong>Financial Summary</strong> — Revenue, expenses, and profit breakdown by service line and time period.</li>
                <li><strong>Aging Report</strong> — Containers dwell time analysis by owner.</li>
              </ul>
              <p><strong>Exporting:</strong> Most tables support CSV export via the download button in the toolbar.</p>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="leasing">
            <AccordionTrigger>📑 Container Leasing</AccordionTrigger>
            <AccordionContent className="prose prose-sm max-w-none text-muted-foreground space-y-2">
              <p><strong>Workflow:</strong> Quotation → Master Lease Agreement → On-Hire → Per-Diem Billing → Off-Hire / DPP.</p>
              <ul className="list-disc pl-5 space-y-1">
                <li><strong>Quotations</strong> — Build lease offers with daily rate, free days, and minimum hire period.</li>
                <li><strong>Master Agreements</strong> — Activate signed leases; on/off-hire creates immutable movement records.</li>
                <li><strong>Per-Diem Run</strong> — Scheduled invoice run posts charges for each active lease day.</li>
                <li><strong>DPP (Damage Protection Plan)</strong> — Optional add-on that overrides M&R chargebacks at off-hire.</li>
              </ul>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="logistics">
            <AccordionTrigger>🚛 Logistics</AccordionTrigger>
            <AccordionContent className="prose prose-sm max-w-none text-muted-foreground space-y-2">
              <p><strong>Modules:</strong> Shuttle Ops, Transport Orders, Fleet, Subcontractors.</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Create transport orders for inbound/outbound or third-party hauls; assign in-house truck or subcontractor.</li>
                <li>Log per-trip costs (fuel, tolls, allowances) — auto-feeds the job-costing engine and accounting.</li>
                <li>Bill the customer via auto-generated invoices linked to the trip.</li>
              </ul>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="hrm">
            <AccordionTrigger>👷 HR & Payroll</AccordionTrigger>
            <AccordionContent className="prose prose-sm max-w-none text-muted-foreground space-y-2">
              <ul className="list-disc pl-5 space-y-1">
                <li><strong>Employee Register</strong> — Operational workers (distinct from auth accounts) used for labour logging.</li>
                <li><strong>Payroll Run</strong> — Create a monthly run, system generates payslips from logged hours/rates and approved deductions.</li>
                <li><strong>Approvals</strong> — Two-step: payroll owner submits, Admin approves before payslips are issued and posted to accounting.</li>
              </ul>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="vendor-payments">
            <AccordionTrigger>💸 Vendor Payments</AccordionTrigger>
            <AccordionContent className="prose prose-sm max-w-none text-muted-foreground space-y-2">
              <ul className="list-disc pl-5 space-y-1">
                <li>Record outgoing payments against Purchase Orders and Goods Receipts.</li>
                <li>Each payment posts to the accounting ledger and updates job-cost rollups (materials, services).</li>
                <li>Admins can require approval above a configurable threshold.</li>
              </ul>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="release-instructions">
            <AccordionTrigger>📝 Release Instructions</AccordionTrigger>
            <AccordionContent className="prose prose-sm max-w-none text-muted-foreground space-y-2">
              <p>Customers create pickup/delivery instructions via the portal or WhatsApp. Staff must approve before a Gate Out is permitted.</p>
              <ol className="list-decimal pl-5 space-y-1">
                <li>Customer submits instruction (container, transporter, driver, ETA, release order).</li>
                <li>Staff reviews under <strong>Gate → Release Instructions</strong> and approves or rejects (with reason).</li>
                <li>Approved instructions unlock Gate Out for the named truck.</li>
              </ol>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="whatsapp">
            <AccordionTrigger>💬 WhatsApp Channel</AccordionTrigger>
            <AccordionContent className="prose prose-sm max-w-none text-muted-foreground space-y-2">
              <p>Inbound and outbound messaging via Meta Cloud API. Gemini Flash parses customer intents (status check, release request, inquiry).</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Setup: capture WABA phone-number ID and access token under <strong>Modules → WhatsApp settings</strong>.</li>
                <li>Outbound: queued through <code>push_notification_queue</code>; respects per-user notification preferences.</li>
                <li>Inbound: webhook routes to <code>whatsapp-webhook</code> edge function; replies/actions logged for audit.</li>
              </ul>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="push">
            <AccordionTrigger>🔔 Push Notifications</AccordionTrigger>
            <AccordionContent className="prose prose-sm max-w-none text-muted-foreground space-y-2">
              <p>W3C Web Push with VAPID keys. Each user subscribes per device under <strong>Settings → Notifications → My Channels</strong>.</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Database triggers enqueue notifications into <code>push_notification_queue</code> on relevant events.</li>
                <li>A 1-minute cron invokes the <code>push-notify</code> edge function to deliver via Web Push / WhatsApp / Email.</li>
                <li>Users opt in/out per event category in <strong>Notifications → Event Subscriptions</strong>.</li>
              </ul>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="sync-audit">
            <AccordionTrigger>🩺 Sync Audit</AccordionTrigger>
            <AccordionContent className="prose prose-sm max-w-none text-muted-foreground space-y-2">
              <p>Cross-module integrity guardrails. The system records findings in <code>sync_audit_findings</code> whenever operational and accounting layers drift (e.g., completed appointment without EIR, sale marked sold without invoice).</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Review open findings under <strong>Settings → System</strong>.</li>
                <li>Resolve manually after the underlying record is corrected — the audit row is timestamped and signed.</li>
                <li>Automation guards: invoice auto-post, sale → invoice backfill, paid-integrity guard.</li>
              </ul>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="rbac">
            <AccordionTrigger>🔐 RBAC & Permissions</AccordionTrigger>
            <AccordionContent className="prose prose-sm max-w-none text-muted-foreground space-y-2">
              <p><strong>Roles:</strong> Admin · Yard Operator · Gate Clerk · Viewer · Customer (portal).</p>
              <p><strong>Two-tier permission model:</strong></p>
              <ul className="list-disc pl-5 space-y-1">
                <li><strong>Defaults</strong> ship with the platform: a baseline matrix of <code>role × module × action</code> (view, create, edit, delete, approve, post, export).</li>
                <li><strong>Overrides</strong> let admins flip any cell for their organization without touching other tenants.</li>
                <li><strong>Effective check</strong>: server-side <code>has_permission(user, module, action)</code> consults overrides first, then defaults. Admin always returns true.</li>
              </ul>
              <p>Manage via <strong>Settings → Users & Access → Permissions Matrix</strong>. Click a cell to toggle specific actions; use <em>reset</em> to drop overrides back to defaults.</p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
    </div>
  );
}


/* ─── Existing components (preserved) ─── */

function ModuleToggle({ label, description, moduleName, depots, enabledModules, queryClient }: {
  label: string; description: string; moduleName: ModuleName; depots: any[]; enabledModules: ModuleName[]; queryClient: any;
}) {
  const { toast } = useToast();
  const { organizationId } = useOrganization();
  const isEnabled = enabledModules.includes(moduleName);

  const toggle = useMutation({
    mutationFn: async () => {
      // 1) Source of truth for sidebar/RequireModule: subscription_modules
      if (organizationId) {
        // Look up catalog price for snapshot
        const { data: cat } = await supabase
          .from("modules_catalog")
          .select("monthly_price")
          .eq("code", moduleName === "manufacturing" ? "manufacturing" : moduleName)
          .maybeSingle();
        const { error: subErr } = await supabase
          .from("subscription_modules")
          .upsert({
            organization_id: organizationId,
            module_code: moduleName,
            enabled: !isEnabled,
            price_snapshot: Number(cat?.monthly_price ?? 0),
          }, { onConflict: "organization_id,module_code" });
        if (subErr) throw subErr;
      }

      // 2) Mirror into depot config (legacy per-depot toggle, still used by ModuleConfigSection)
      if (depots.length) {
        const depot = depots[0];
        const config = (depot.config as Record<string, unknown>) ?? {};
        const current = ((config.enabled_modules as string[]) ?? [])
          .map((m: string) => m === "conversions" ? "manufacturing" : m);
        const next = isEnabled
          ? current.filter((m: string) => m !== moduleName)
          : [...new Set([...current, moduleName])];
        const { error } = await supabase.from("depots").update({ config: { ...config, enabled_modules: next } }).eq("id", depot.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["enabled-modules"] });
      queryClient.invalidateQueries({ queryKey: ["depots"] });
      queryClient.invalidateQueries({ queryKey: ["subscription-overview"] });
      toast({ title: `${label} ${isEnabled ? "disabled" : "enabled"}` });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="flex items-center justify-between rounded-lg border p-4">
      <div>
        <p className="font-medium">{label}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Switch checked={isEnabled} onCheckedChange={() => toggle.mutate()} disabled={toggle.isPending} />
    </div>
  );
}

function AddDepotDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const [form, setForm] = useState({ name: "", code: "", location: "", timezone: "UTC", currency: "USD" });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("depots").insert(form);
      if (error) throw error;
    },
    onSuccess: () => { onSuccess(); toast({ title: "Depot created" }); setOpen(false); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><Plus className="mr-1 h-4 w-4" />Add Depot</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Depot</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} className="space-y-4">
          <div className="space-y-2"><Label>Name</Label><Input value={form.name} onChange={(e) => set("name", e.target.value)} required /></div>
          <div className="space-y-2"><Label>Code</Label><Input value={form.code} onChange={(e) => set("code", e.target.value.toUpperCase())} required placeholder="DEP01" className="font-mono" /></div>
          <div className="space-y-2"><Label>Location</Label><Input value={form.location} onChange={(e) => set("location", e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2"><Label>Timezone</Label><Input value={form.timezone} onChange={(e) => set("timezone", e.target.value)} /></div>
            <div className="space-y-2"><Label>Currency</Label><CurrencySelect value={form.currency} onChange={(v) => set("currency", v)} /></div>
          </div>
          <Button type="submit" className="w-full" disabled={mutation.isPending}>Create Depot</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddBlockDialog({ depots, onSuccess }: { depots: any[]; onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const { depotId: workingDepotId } = useWorkingDepot();
  const [form, setForm] = useState({ depot_id: "", name: "", block_type: "dry" as const, max_bays: "10", max_rows: "6", max_tiers: "5", has_power: false });
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  // Default the depot picker to the user's active working depot.
  useEffect(() => {
    if (open && !form.depot_id && workingDepotId) set("depot_id", workingDepotId);
  }, [open, workingDepotId, form.depot_id]);

  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("yard_blocks").insert({
        depot_id: form.depot_id,
        name: form.name,
        block_type: form.block_type,
        max_bays: parseInt(form.max_bays),
        max_rows: parseInt(form.max_rows),
        max_tiers: parseInt(form.max_tiers),
        has_power: form.has_power,
      });
      if (error) throw error;
    },
    onSuccess: () => { onSuccess(); toast({ title: "Block created" }); setOpen(false); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><Plus className="mr-1 h-4 w-4" />Add Block</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Yard Block</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} className="space-y-4">
          <div className="space-y-2">
            <Label>Depot</Label>
            <Select value={form.depot_id} onValueChange={(v) => set("depot_id", v)}>
              <SelectTrigger><SelectValue placeholder="Select depot" /></SelectTrigger>
              <SelectContent>{depots.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2"><Label>Block Name</Label><Input value={form.name} onChange={(e) => set("name", e.target.value)} required placeholder="A1" /></div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={form.block_type} onValueChange={(v) => set("block_type", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="dry">Dry</SelectItem>
                  <SelectItem value="reefer">Reefer</SelectItem>
                  <SelectItem value="hazmat">Hazmat</SelectItem>
                  <SelectItem value="mixed">Mixed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2"><Label>Bays</Label><Input type="number" value={form.max_bays} onChange={(e) => set("max_bays", e.target.value)} /></div>
            <div className="space-y-2"><Label>Rows</Label><Input type="number" value={form.max_rows} onChange={(e) => set("max_rows", e.target.value)} /></div>
            <div className="space-y-2"><Label>Tiers</Label><Input type="number" value={form.max_tiers} onChange={(e) => set("max_tiers", e.target.value)} /></div>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={form.has_power} onCheckedChange={(v) => set("has_power", v)} />
            <Label>Has Power (for reefers)</Label>
          </div>
          <Button type="submit" className="w-full" disabled={mutation.isPending}>Create Block</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PortalUsersSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: "", password: "", customer_id: "" });

  const { data: portalUsers, isLoading } = useQuery({
    queryKey: ["portal-users"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_portal_users")
        .select("*, customers(company_name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: customers } = useQuery({
    queryKey: ["customers-for-portal"],
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("id, company_name").eq("is_active", true).order("company_name");
      if (error) throw error;
      return data;
    },
  });

  const invite = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("invite-portal-user", {
        body: { email: inviteForm.email, password: inviteForm.password, customer_id: inviteForm.customer_id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal-users"] });
      toast({ title: "Portal user created", description: "They will receive a verification email." });
      setInviteOpen(false);
      setInviteForm({ email: "", password: "", customer_id: "" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deactivate = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("customer_portal_users").update({ is_active: false } as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal-users"] });
      toast({ title: "Portal user deactivated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" />Portal Users</CardTitle>
        <Button size="sm" onClick={() => setInviteOpen(true)}><Plus className="mr-1 h-4 w-4" />Invite Customer</Button>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead>User ID</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableSkeleton columns={4} />
            ) : !portalUsers?.length ? (
              <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">No portal users</TableCell></TableRow>
            ) : portalUsers.map((pu: any) => (
              <TableRow key={pu.id}>
                <TableCell className="font-medium">{pu.customers?.company_name ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{pu.user_id}</TableCell>
                <TableCell>
                  <Badge variant={pu.is_active ? "default" : "secondary"}>{pu.is_active ? "Active" : "Inactive"}</Badge>
                </TableCell>
                <TableCell>
                  {pu.is_active && (
                    <Button size="sm" variant="ghost" onClick={() => deactivate.mutate(pu.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite Customer to Portal</DialogTitle>
            <DialogDescription>Create a portal account for a customer to access their containers, appointments and billing.</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); invite.mutate(); }} className="space-y-4">
            <div className="space-y-2">
              <Label>Customer</Label>
              <Select value={inviteForm.customer_id} onValueChange={(v) => setInviteForm((f) => ({ ...f, customer_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                <SelectContent>
                  {customers?.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={inviteForm.email} onChange={(e) => setInviteForm((f) => ({ ...f, email: e.target.value }))} required />
            </div>
            <div className="space-y-2">
              <Label>Initial Password</Label>
              <Input type="password" value={inviteForm.password} onChange={(e) => setInviteForm((f) => ({ ...f, password: e.target.value }))} required minLength={6} />
            </div>
            <Button type="submit" className="w-full" disabled={invite.isPending}>Create Portal User</Button>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function DepotProfileEditorSelector({ depots, onSaved }: { depots: any[]; onSaved: () => void }) {
  const [selectedId, setSelectedId] = useState<string>(() => (depots.find(d => d.is_hq) ?? depots[0])?.id);
  const selected = depots.find(d => d.id === selectedId) ?? depots[0];
  return (
    <div className="space-y-3">
      {depots.length > 1 && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Depot being edited</Label>
            <Select value={selected.id} onValueChange={setSelectedId}>
              <SelectTrigger className="w-[280px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {depots.map((d: any) => (
                  <SelectItem key={d.id} value={d.id}>
                    Depot: {d.name} {d.is_hq ? "· HQ" : "· Branch"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            This picks which depot's profile you're editing — it does not switch tenants. Use the tenant switcher in the top bar to change organization.
          </p>
        </div>
      )}
      <DepotProfileEditor key={selected.id} depot={selected} onSaved={onSaved} />
    </div>
  );
}

function DepotRow({ depot, depots, isOwnerOrAdmin }: { depot: any; depots: any[]; isOwnerOrAdmin: boolean }) {
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [retireOpen, setRetireOpen] = useState(false);
  const hq = depots.find((x: any) => x.is_hq) ?? null;
  const queryClient = useQueryClient();
  return (
    <>
      <TableRow>
        <TableCell className="font-medium">{depot.name}</TableCell>
        <TableCell>
          {depot.is_hq ? (
            <Badge className="gap-1"><Crown className="h-3 w-3" />HQ</Badge>
          ) : (
            <Badge variant="secondary">Branch</Badge>
          )}
        </TableCell>
        <TableCell className="font-mono">{depot.code}</TableCell>
        <TableCell>{depot.location ?? "—"}</TableCell>
        <TableCell>{depot.currency}</TableCell>
        {isOwnerOrAdmin && (
          <TableCell className="text-right space-x-2">
            {!depot.is_hq && (
              <>
                <Button size="sm" variant="outline" onClick={() => setPromoteOpen(true)}>
                  <Crown className="h-3.5 w-3.5 mr-1" />Promote to HQ
                </Button>
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setRetireOpen(true)}>
                  <Trash2 className="h-3.5 w-3.5 mr-1" />Retire
                </Button>
              </>
            )}
            {depot.is_hq && <span className="text-xs text-muted-foreground">HQ cannot be deleted</span>}
          </TableCell>
        )}
      </TableRow>
      <PromoteToHqDialog
        open={promoteOpen}
        onOpenChange={setPromoteOpen}
        depot={depot}
        currentHqName={hq?.name}
        onDone={() => queryClient.invalidateQueries({ queryKey: ["depots"] })}
      />
      <RetireDepotDialog
        open={retireOpen}
        onOpenChange={setRetireOpen}
        depot={depot}
        hqDepot={hq}
        onDone={() => queryClient.invalidateQueries({ queryKey: ["depots"] })}
      />
    </>
  );
}


/* ─── HQ Governance (dual-approval toggle) ─── */
function HqGovernanceCard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { organizationId } = useOrganization();
  const { data: org } = useQuery({
    queryKey: ["org-config", organizationId],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase.from("organizations").select("config").eq("id", organizationId!).maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });
  const current = (org?.config?.require_dual_approval_for_hq_ops ?? true) as boolean;
  const toggle = useMutation({
    mutationFn: async (next: boolean) => {
      const merged = { ...(org?.config ?? {}), require_dual_approval_for_hq_ops: next };
      const { error } = await supabase.from("organizations").update({ config: merged }).eq("id", organizationId!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["org-config"] });
      qc.invalidateQueries({ queryKey: ["org-dual-approval"] });
      toast({ title: "HQ governance updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Crown className="h-4 w-4 text-amber-500" />HQ Governance</CardTitle>
        <CardDescription>Require a second administrator to approve promoting a depot to HQ or retiring a branch.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Require dual approval for HQ operations</p>
            <p className="text-xs text-muted-foreground">When enabled, HQ promotions and depot retirements go through the Approvals inbox.</p>
          </div>
          <Switch checked={current} onCheckedChange={(v) => toggle.mutate(v)} disabled={toggle.isPending} />
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── Depot Audit Log ─── */
function DepotAuditLogCard() {
  const { organizationId } = useOrganization();
  const { data, isLoading } = useQuery({
    queryKey: ["depot-lifecycle-events", organizationId],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("depot_lifecycle_events" as any)
        .select("id, depot_id, event, actor, payload, created_at, depots(name, code)")
        .eq("organization_id", organizationId!)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as any[];
    },
  });
  const label = (ev: string) => ({
    depot_profile_updated: "Profile updated",
    depot_promoted_to_hq: "Promoted to HQ",
    depot_retirement_previewed: "Retirement previewed",
    depot_retirement_requested: "Retirement requested",
    depot_retired: "Depot retired",
    depot_created: "Depot created",
  } as Record<string, string>)[ev] ?? ev;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Activity className="h-4 w-4" />Depot Audit Log</CardTitle>
        <CardDescription>Every profile change, HQ promotion, and retirement step for this organization's depots.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[160px]">When</TableHead>
              <TableHead>Depot</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Changes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>
            ) : !data?.length ? (
              <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">No depot events recorded yet.</TableCell></TableRow>
            ) : data.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="text-xs whitespace-nowrap">{new Date(e.created_at).toLocaleString()}</TableCell>
                <TableCell className="text-sm">{e.depots?.name ?? "—"}{e.depots?.code ? <span className="text-xs text-muted-foreground ml-1">({e.depots.code})</span> : null}</TableCell>
                <TableCell><Badge variant="outline">{label(e.event)}</Badge></TableCell>
                <TableCell>
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">View</summary>
                    <pre className="mt-1 bg-muted/50 rounded p-2 overflow-x-auto max-w-xl">{JSON.stringify(e.payload ?? {}, null, 2)}</pre>
                  </details>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/* ─── Modules Check ─── */
type CatalogModule = { code: string; name: string; description: string | null; monthly_price: number; is_core: boolean; sort_order: number };
type SubModule = { module_code: string; enabled: boolean; price_snapshot: number };

function ModulesCheckCard({ depots }: { depots: any[] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const org = useOrganization();
  const { currency } = useOrgCurrency();

  const { data, isLoading } = useQuery({
    queryKey: ["modules-check", org.organizationId],
    enabled: !!org.organizationId,
    queryFn: async () => {
      const [catalog, mods] = await Promise.all([
        supabase.from("modules_catalog").select("*").order("sort_order"),
        supabase.from("subscription_modules").select("module_code, enabled, price_snapshot").eq("organization_id", org.organizationId!),
      ]);
      return {
        catalog: (catalog.data ?? []) as CatalogModule[],
        modules: (mods.data ?? []) as SubModule[],
      };
    },
  });

  const toggleSub = useMutation({
    mutationFn: async ({ code, enabled, price }: { code: string; enabled: boolean; price: number }) => {
      if (!org.organizationId) throw new Error("No organization");
      const { error } = await supabase.from("subscription_modules").upsert({
        organization_id: org.organizationId,
        module_code: code,
        enabled,
        price_snapshot: price,
      }, { onConflict: "organization_id,module_code" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["modules-check"] });
      qc.invalidateQueries({ queryKey: ["enabled-modules"] });
      qc.invalidateQueries({ queryKey: ["subscription-overview"] });
      toast({ title: "Subscription updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const syncFromSubscription = useMutation({
    mutationFn: async () => {
      if (!data) return;
      const enabledCodes = data.modules.filter((m) => m.enabled).map((m) => m.module_code);
      const coreCodes = data.catalog.filter((c) => c.is_core).map((c) => c.code);
      const full = [...new Set([...coreCodes, ...enabledCodes])];
      for (const d of depots) {
        const config = (d.config as Record<string, unknown>) ?? {};
        const { error } = await supabase
          .from("depots")
          .update({ config: { ...config, enabled_modules: full } })
          .eq("id", d.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["depots"] });
      toast({ title: "Depot module mirrors synced from subscription" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (isLoading || !data) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Modules Check</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">Loading…</CardContent>
      </Card>
    );
  }

  const subEnabled = new Set(data.modules.filter((m) => m.enabled).map((m) => m.module_code));
  const optionalModules = data.catalog.filter((c) => !c.is_core);
  const hqDepot = depots.find((d) => d.is_hq) ?? depots[0];

  const drift: { code: string; kind: "depot_only" | "sub_only"; depot: string }[] = [];
  for (const d of depots) {
    const depotMods: string[] = ((d.config as any)?.enabled_modules ?? []).map((m: string) => m === "conversions" ? "manufacturing" : m);
    for (const c of optionalModules) {
      const inDepot = depotMods.includes(c.code);
      const inSub = subEnabled.has(c.code);
      if (inDepot && !inSub) drift.push({ code: c.code, kind: "depot_only", depot: d.name });
      if (!inDepot && inSub && d.id === hqDepot?.id) drift.push({ code: c.code, kind: "sub_only", depot: d.name });
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-base flex items-center gap-2"><Blocks className="h-4 w-4" />Modules Check</CardTitle>
          <CardDescription>Source of truth for which modules are licensed and available in the sidebar.</CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => syncFromSubscription.mutate()} disabled={syncFromSubscription.isPending}>
          Sync depots from subscription
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {drift.length > 0 && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm space-y-1">
            <div className="font-medium">Configuration drift detected</div>
            {drift.slice(0, 10).map((d, i) => (
              <div key={i} className="text-muted-foreground">
                <span className="font-mono">{d.code}</span> —{" "}
                {d.kind === "depot_only"
                  ? `enabled on depot "${d.depot}" but not on the subscription`
                  : `enabled on the subscription but not mirrored to HQ depot "${d.depot}"`}
              </div>
            ))}
            {drift.length > 10 && <div className="text-xs text-muted-foreground">…and {drift.length - 10} more.</div>}
          </div>
        )}

        <div>
          <div className="text-sm font-medium mb-2">Subscription modules (org-wide)</div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Module</TableHead>
                  <TableHead>Price / mo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24 text-right">Enabled</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.catalog.map((mod) => {
                  const sm = data.modules.find((m) => m.module_code === mod.code);
                  const enabled = !!sm?.enabled;
                  return (
                    <TableRow key={mod.code}>
                      <TableCell>
                        <div className="font-medium">{mod.name}</div>
                        <div className="text-xs text-muted-foreground">{mod.description}</div>
                      </TableCell>
                      <TableCell className="font-mono text-sm">{currency} {Number(mod.monthly_price).toFixed(2)}</TableCell>
                      <TableCell>
                        {mod.is_core ? <Badge variant="secondary">Included</Badge> :
                          enabled ? <Badge>Active</Badge> : <Badge variant="outline">Disabled</Badge>}
                      </TableCell>
                      <TableCell className="text-right">
                        <Switch
                          checked={enabled || mod.is_core}
                          disabled={mod.is_core || toggleSub.isPending}
                          onCheckedChange={(v) => toggleSub.mutate({ code: mod.code, enabled: v, price: Number(mod.monthly_price) })}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>

        <div>
          <div className="text-sm font-medium mb-2">Per-depot mirror <span className="text-xs font-normal text-muted-foreground">(HQ inherits from subscription; branches are read-only)</span></div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Depot</TableHead>
                  {optionalModules.map((m) => (
                    <TableHead key={m.code} className="text-xs whitespace-nowrap">{m.name}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {depots.map((d) => {
                  const depotMods: string[] = ((d.config as any)?.enabled_modules ?? []).map((m: string) => m === "conversions" ? "manufacturing" : m);
                  return (
                    <TableRow key={d.id}>
                      <TableCell>
                        <div className="font-medium flex items-center gap-1.5">
                          {d.is_hq && <Crown className="h-3.5 w-3.5 text-amber-500" />}
                          {d.name}
                        </div>
                        <div className="text-xs text-muted-foreground">{d.is_hq ? "HQ" : "Branch"}</div>
                      </TableCell>
                      {optionalModules.map((m) => (
                        <TableCell key={m.code} className="text-center">
                          {depotMods.includes(m.code) ? (
                            <Badge variant="default" className="text-xs">On</Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs">Off</Badge>
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

