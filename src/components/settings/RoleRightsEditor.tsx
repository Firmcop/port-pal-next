import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { RotateCcw, Info } from "lucide-react";

const ACTIONS = ["view", "create", "edit", "delete", "approve", "post", "export"] as const;
export type AppAction = (typeof ACTIONS)[number];

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

export type StagedOverride = { module: string; action: AppAction; allowed: boolean };

interface Props {
  role: string;
  organizationId: string | null;
  /** When provided, overrides are persisted live; otherwise they are staged and returned via onChange. */
  livePersist?: boolean;
  onChange?: (staged: StagedOverride[]) => void;
}

/**
 * Reusable matrix editor for a single role.
 * Shows effective permissions (default + org override) and lets admins tweak.
 */
export default function RoleRightsEditor({ role, organizationId, livePersist, onChange }: Props) {
  const [staged, setStaged] = useState<Map<string, boolean>>(new Map());

  const { data: defaults = [] } = useQuery({
    queryKey: ["role-perm-defaults", role],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("role_permission_defaults")
        .select("module, action, allowed")
        .eq("role", role as any);
      if (error) throw error;
      return data as { module: string; action: AppAction; allowed: boolean }[];
    },
  });

  const { data: overrides = [], refetch } = useQuery({
    queryKey: ["role-perm-overrides", role, organizationId],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("role_permission_overrides")
        .select("module, action, allowed")
        .eq("role", role as any)
        .eq("organization_id", organizationId!);
      if (error) throw error;
      return data as { module: string; action: AppAction; allowed: boolean }[];
    },
  });

  const baseline = useMemo(() => {
    const m = new Map<string, boolean>();
    defaults.forEach((d) => m.set(`${d.module}|${d.action}`, d.allowed));
    overrides.forEach((o) => m.set(`${o.module}|${o.action}`, o.allowed));
    return m;
  }, [defaults, overrides]);

  const effective = (module: string, action: AppAction) => {
    const k = `${module}|${action}`;
    return staged.has(k) ? staged.get(k)! : baseline.get(k) ?? false;
  };

  const emit = (next: Map<string, boolean>) => {
    if (!onChange) return;
    const arr: StagedOverride[] = [];
    next.forEach((allowed, k) => {
      const [module, action] = k.split("|") as [string, AppAction];
      arr.push({ module, action, allowed });
    });
    onChange(arr);
  };

  const toggle = async (module: string, action: AppAction, value: boolean) => {
    const k = `${module}|${action}`;
    const next = new Map(staged);
    if ((baseline.get(k) ?? false) === value) next.delete(k);
    else next.set(k, value);
    setStaged(next);
    emit(next);

    if (livePersist && organizationId) {
      await supabase.from("role_permission_overrides").upsert(
        { organization_id: organizationId, role: role as any, module, action, allowed: value },
        { onConflict: "organization_id,role,module,action" }
      );
      await refetch();
    }
  };

  const resetToDefaults = async () => {
    setStaged(new Map());
    emit(new Map());
    if (livePersist && organizationId) {
      await supabase
        .from("role_permission_overrides")
        .delete()
        .eq("organization_id", organizationId)
        .eq("role", role as any);
      await refetch();
    }
  };

  useEffect(() => {
    setStaged(new Map());
  }, [role]);

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Info className="h-3 w-3" />
          Changes apply to <strong className="mx-1">every user with the {role} role</strong> in this organization.
        </p>
        <Button size="sm" variant="ghost" onClick={resetToDefaults} className="h-7">
          <RotateCcw className="h-3 w-3 mr-1" /> Reset to defaults
        </Button>
      </div>
      <div className="border rounded-md max-h-[420px] overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 bg-background z-10">
            <TableRow>
              <TableHead className="w-[200px]">Module</TableHead>
              {ACTIONS.map((a) => (
                <TableHead key={a} className="text-center capitalize text-xs">{a}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {MODULES.map((m) => (
              <TableRow key={m.code}>
                <TableCell className="font-medium text-sm">{m.label}</TableCell>
                {ACTIONS.map((a) => (
                  <TableCell key={a} className="text-center">
                    <Checkbox
                      checked={effective(m.code, a)}
                      onCheckedChange={(v) => toggle(m.code, a, !!v)}
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
