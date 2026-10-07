import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/use-organization";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ShieldPlus, Loader2 } from "lucide-react";

const ACTIONS = ["view", "create", "edit", "delete", "approve", "post", "export"] as const;
type Action = (typeof ACTIONS)[number];

/**
 * Per-user permission overrides: grant (or keep inherited) module actions
 * for one user beyond what their roles allow. E.g. give an attendance clerk
 * hrm view/create/edit without the hr_manager role.
 */
export default function UserPermissionOverrides() {
  const { organizationId } = useOrganization();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedUser, setSelectedUser] = useState<string>("");

  const { data: members = [] } = useQuery({
    queryKey: ["upo-members", organizationId],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data: mems, error } = await (supabase as any)
        .from("organization_members")
        .select("user_id, role")
        .eq("organization_id", organizationId)
        .eq("status", "active");
      if (error) throw error;
      const ids = (mems ?? []).map((m: any) => m.user_id);
      const { data: profs } = await (supabase as any)
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
      const nameBy = new Map((profs ?? []).map((p: any) => [p.user_id, p.display_name]));
      return (mems ?? []).map((m: any) => ({ ...m, name: nameBy.get(m.user_id) ?? m.user_id.slice(0, 8) }));
    },
  });

  const { data: modules = [] } = useQuery({
    queryKey: ["upo-modules"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("modules_catalog").select("*");
      if (error) throw error;
      const catalog = (data ?? []).map((m: any) => ({
        code: m.code ?? m.module_code ?? m.module,
        name: m.name ?? m.label ?? m.code ?? m.module_code ?? m.module,
      })).filter((m: any) => !!m.code);
      return [
        ...catalog,
        { code: "hrm_attendance", name: "Weekly Attendance only" },
        { code: "opex_entry", name: "Expense posting only" },
      ];
    },
  });

  const { data: overrides = [], isLoading } = useQuery({
    queryKey: ["user-permission-overrides", organizationId, selectedUser],
    enabled: !!organizationId && !!selectedUser,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("user_permission_overrides")
        .select("id, module, action, allowed")
        .eq("organization_id", organizationId)
        .eq("user_id", selectedUser);
      if (error) throw error;
      return data ?? [];
    },
  });

  const granted = useMemo(() => {
    const s = new Set<string>();
    for (const o of overrides as any[]) if (o.allowed) s.add(`${o.module}:${o.action}`);
    return s;
  }, [overrides]);

  const toggle = useMutation({
    mutationFn: async ({ module, action, on }: { module: string; action: Action; on: boolean }) => {
      if (on) {
        const { error } = await (supabase as any)
          .from("user_permission_overrides")
          .upsert(
            { organization_id: organizationId, user_id: selectedUser, module, action, allowed: true },
            { onConflict: "organization_id,user_id,module,action" },
          );
        if (error) throw error;
      } else {
        const { error } = await (supabase as any)
          .from("user_permission_overrides")
          .delete()
          .eq("organization_id", organizationId)
          .eq("user_id", selectedUser)
          .eq("module", module)
          .eq("action", action);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-permission-overrides"] });
      qc.invalidateQueries({ queryKey: ["has-permission"] });
      qc.invalidateQueries({ queryKey: ["module-permissions"] });
      qc.invalidateQueries({ queryKey: ["user-view-modules"] });
    },
    onError: (e: any) => toast({ title: "Could not update permission", description: e.message, variant: "destructive" }),
  });

  const member = members.find((m: any) => m.user_id === selectedUser);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldPlus className="h-4 w-4" /> Individual permission grants
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Give one user extra module permissions beyond their role — e.g. grant Weekly Attendance only
          (view, create, edit) without access to employees, payslips, or payroll approvals. Role-based rules
          still apply on top of anything not ticked here.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="max-w-sm space-y-1">
          <Select value={selectedUser} onValueChange={setSelectedUser}>
            <SelectTrigger><SelectValue placeholder="Select a teammate" /></SelectTrigger>
            <SelectContent>
              {members.map((m: any) => (
                <SelectItem key={m.user_id} value={m.user_id}>
                  {m.name} <span className="text-muted-foreground">· {m.role}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedUser && (
          isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="text-left p-2 font-medium">Module</th>
                    {ACTIONS.map((a) => (
                      <th key={a} className="p-2 font-medium capitalize text-center">{a}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {modules.map((m: any) => (
                    <tr key={m.code} className="border-b last:border-0">
                      <td className="p-2">
                        <div className="font-medium">{m.name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{m.code}</div>
                      </td>
                      {ACTIONS.map((a) => (
                        <td key={a} className="p-2 text-center">
                          <Checkbox
                            checked={granted.has(`${m.code}:${a}`)}
                            disabled={toggle.isPending}
                            onCheckedChange={(v) => toggle.mutate({ module: m.code, action: a, on: !!v })}
                            aria-label={`${m.name} ${a}`}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {selectedUser && granted.size > 0 && (
          <div className="flex flex-wrap gap-1">
            {[...granted].map((g) => <Badge key={g} variant="secondary" className="font-mono text-xs">{g}</Badge>)}
          </div>
        )}
        {member && (
          <p className="text-xs text-muted-foreground">
            Changes apply to {member.name} immediately — the sidebar and page access update on their next screen load.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
