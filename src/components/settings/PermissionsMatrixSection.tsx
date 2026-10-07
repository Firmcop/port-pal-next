import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Shield, RotateCcw, Lock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useUserStaffRole } from "@/hooks/use-user-staff-role";
import { useOrganization } from "@/hooks/use-organization";

const ROLES = [
  "admin", "yard_operator", "gate_clerk", "viewer", "customer",
  "accountant", "hr_manager", "production_manager", "procurement_officer",
  "supply_chain_manager", "sales_manager", "leasing_manager", "mr_supervisor",
] as const;
const ROLE_LABEL: Record<string, string> = {
  admin: "Admin", yard_operator: "Yard Op", gate_clerk: "Gate Clerk", viewer: "Viewer", customer: "Customer",
  accountant: "Accountant", hr_manager: "HR", production_manager: "Production",
  procurement_officer: "Procurement", supply_chain_manager: "Supply Chain",
  sales_manager: "Sales", leasing_manager: "Leasing", mr_supervisor: "M&R",
};
const ACTIONS = ["view", "create", "edit", "delete", "approve", "post", "export"] as const;
const MODULES: { code: string; label: string }[] = [
  { code: "inventory", label: "Inventory & Yard" },
  { code: "gate", label: "Gate Operations" },
  { code: "mr", label: "Maintenance & Repair" },
  { code: "billing", label: "Billing & Tariffs" },
  { code: "accounting", label: "Accounting" },
  { code: "crm", label: "CRM & Sales" },
  { code: "manufacturing", label: "Manufacturing" },
  { code: "procurement", label: "Procurement" },
  { code: "leasing", label: "Leasing" },
  { code: "logistics", label: "Logistics" },
  { code: "hrm", label: "HR & Payroll" },
  { code: "portal", label: "Customer Portal" },
  { code: "whatsapp", label: "WhatsApp Channel" },
  { code: "sync_audit", label: "Sync Audit" },
  { code: "release_instructions", label: "Release Instructions" },
  { code: "vendor_payments", label: "Vendor Payments" },
  { code: "sale_automation", label: "Container Sales" },
  { code: "repatriation", label: "Repatriation" },
];

type Row = { role: string; module: string; action: string; allowed: boolean };

export default function PermissionsMatrixSection() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { isOwnerOrAdmin } = useUserStaffRole();
  const { organizationId } = useOrganization();

  const { data: defaults = [] } = useQuery({
    queryKey: ["role-perm-defaults"],
    queryFn: async () => {
      const { data, error } = await supabase.from("role_permission_defaults").select("role, module, action, allowed");
      if (error) throw error;
      return data as Row[];
    },
  });

  const { data: overrides = [] } = useQuery({
    queryKey: ["role-perm-overrides", organizationId],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("role_permission_overrides")
        .select("role, module, action, allowed")
        .eq("organization_id", organizationId!);
      if (error) throw error;
      return data as Row[];
    },
  });

  const effective = useMemo(() => {
    const map = new Map<string, { allowed: boolean; isOverride: boolean }>();
    defaults.forEach((d) => map.set(`${d.role}|${d.module}|${d.action}`, { allowed: d.allowed, isOverride: false }));
    overrides.forEach((o) => map.set(`${o.role}|${o.module}|${o.action}`, { allowed: o.allowed, isOverride: true }));
    return map;
  }, [defaults, overrides]);

  const grantedCount = (role: string, module: string) =>
    ACTIONS.filter((a) => effective.get(`${role}|${module}|${a}`)?.allowed).length;

  const upsert = useMutation({
    mutationFn: async (vals: { role: string; module: string; action: string; allowed: boolean }[]) => {
      if (!organizationId) throw new Error("No organization");
      const rows = vals.map((v) => ({ ...v, organization_id: organizationId }));
      const { error } = await supabase.from("role_permission_overrides").upsert(rows as any, {
        onConflict: "organization_id,role,module,action",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["role-perm-overrides", organizationId] });
      toast({ title: "Permissions updated" });
    },
    onError: (e: any) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const resetRole = useMutation({
    mutationFn: async (role: string) => {
      if (!organizationId) return;
      const { error } = await supabase
        .from("role_permission_overrides")
        .delete()
        .eq("organization_id", organizationId)
        .eq("role", role as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["role-perm-overrides", organizationId] });
      toast({ title: "Role reset to defaults" });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Shield className="h-4 w-4" />Permissions Matrix</CardTitle>
        <CardDescription>
          Defaults ship with the platform; admins can override per role for this organization.
          {!isOwnerOrAdmin && (<span className="ml-2 inline-flex items-center gap-1 text-xs"><Lock className="h-3 w-3" />Read-only</span>)}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[220px]">Module</TableHead>
              {ROLES.map((r) => (
                <TableHead key={r} className="text-center">
                  <div className="flex flex-col items-center gap-1">
                    <span>{ROLE_LABEL[r]}</span>
                    {isOwnerOrAdmin && r !== "admin" && (
                      <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[10px]" onClick={() => resetRole.mutate(r)}>
                        <RotateCcw className="h-2.5 w-2.5 mr-0.5" />reset
                      </Button>
                    )}
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {MODULES.map((m) => (
              <TableRow key={m.code}>
                <TableCell className="font-medium">{m.label}</TableCell>
                {ROLES.map((r) => {
                  const count = grantedCount(r, m.code);
                  const hasOverride = ACTIONS.some((a) => effective.get(`${r}|${m.code}|${a}`)?.isOverride);
                  const cell = (
                    <Badge variant={count === 0 ? "outline" : count === ACTIONS.length ? "default" : "secondary"} className="cursor-pointer">
                      {count}/{ACTIONS.length}{hasOverride && "*"}
                    </Badge>
                  );
                  return (
                    <TableCell key={r} className="text-center">
                      {isOwnerOrAdmin && r !== "admin" ? (
                        <Popover>
                          <PopoverTrigger asChild><button>{cell}</button></PopoverTrigger>
                          <PopoverContent className="w-56">
                            <div className="text-xs font-semibold mb-2">{ROLE_LABEL[r]} · {m.label}</div>
                            <div className="space-y-1.5">
                              {ACTIONS.map((a) => {
                                const cur = effective.get(`${r}|${m.code}|${a}`);
                                return (
                                  <label key={a} className="flex items-center gap-2 text-sm capitalize">
                                    <Checkbox
                                      checked={!!cur?.allowed}
                                      onCheckedChange={(v) =>
                                        upsert.mutate([{ role: r, module: m.code, action: a, allowed: !!v }])
                                      }
                                    />
                                    {a}
                                    {cur?.isOverride && <span className="text-[10px] text-muted-foreground">(override)</span>}
                                  </label>
                                );
                              })}
                            </div>
                          </PopoverContent>
                        </Popover>
                      ) : (
                        cell
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="px-4 py-2 text-[11px] text-muted-foreground border-t">
          <span className="font-medium">Legend:</span> N/7 granted actions per role · <code>*</code> indicates an org-specific override.
        </div>
      </CardContent>
    </Card>
  );
}
