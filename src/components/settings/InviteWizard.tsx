import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useOrganization } from "@/hooks/use-organization";
import RoleRightsEditor, { type StagedOverride } from "./RoleRightsEditor";
import { ChevronLeft, ChevronRight, UserPlus, KeyRound } from "lucide-react";
import { STAFF_ROLES, ROLE_LABELS } from "@/lib/staff-roles";

type Mode = "invite" | "direct";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: Mode;
}

export default function InviteWizard({ open, onOpenChange, mode }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { organizationId } = useOrganization();
  const [step, setStep] = useState<1 | 2>(1);
  const [form, setForm] = useState({ email: "", displayName: "", password: "" });
  const [roles, setRoles] = useState<string[]>(["viewer"]);
  const [stagedByRole, setStagedByRole] = useState<Record<string, StagedOverride[]>>({});

  const { data: seats } = useQuery({
    queryKey: ["seat-capacity", organizationId],
    enabled: !!organizationId && open,
    queryFn: async () => {
      const { data } = await supabase.rpc("check_seat_capacity", { _org: organizationId! });
      const row = Array.isArray(data) ? data[0] : data;
      return row as { used: number; seat_limit: number; can_add: boolean } | null;
    },
  });

  const reset = () => {
    setStep(1);
    setForm({ email: "", displayName: "", password: "" });
    setRoles(["viewer"]);
    setStagedByRole({});
  };


  const toggleRole = (r: string) => {
    setRoles((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));
  };

  const submit = useMutation({
    mutationFn: async () => {
      const payloadBase = {
        email: form.email,
        displayName: form.displayName,
        role: roles[0],
        roles,
        organization_id: organizationId,
      };
      if (mode === "invite") {
        const { data, error } = await supabase.functions.invoke("invite-staff-user", {
          body: { mode: "create", ...payloadBase },
        });
        if (error) throw error;
        if ((data as any)?.error) throw new Error((data as any).error);
      } else {
        const { data, error } = await supabase.functions.invoke("create-staff-user", {
          body: { ...payloadBase, password: form.password },
        });
        if (error) throw error;
        if ((data as any)?.error) throw new Error((data as any).error);
      }

      // Persist any per-role overrides staged in step 2
      if (organizationId) {
        const rows = Object.entries(stagedByRole).flatMap(([role, staged]) =>
          staged.map((s) => ({
            organization_id: organizationId,
            role: role as any,
            module: s.module,
            action: s.action,
            allowed: s.allowed,
          })),
        );
        if (rows.length) {
          const { error } = await supabase
            .from("role_permission_overrides")
            .upsert(rows as any, { onConflict: "organization_id,role,module,action" });
          if (error) throw error;
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff-invitations"] });
      qc.invalidateQueries({ queryKey: ["profiles-with-roles"] });
      qc.invalidateQueries({ queryKey: ["user-roles-all"] });
      qc.invalidateQueries({ queryKey: ["role-perm-overrides"] });
      toast({
        title: mode === "invite" ? "Invitation sent" : "User created",
        description:
          mode === "invite"
            ? `${form.email} will receive an email shortly.`
            : `${form.email} can now sign in.`,
      });
      onOpenChange(false);
      reset();
    },
    onError: (e: any) => toast({ title: "Action failed", description: e.message, variant: "destructive" }),
  });

  const canProceed =
    !!form.email &&
    roles.length > 0 &&
    (mode !== "direct" || form.password.length >= 8) &&
    (!seats || seats.can_add);


  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === "invite" ? <UserPlus className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
            {mode === "invite" ? "Invite teammate" : "Add user directly"}
            <span className="text-xs font-normal text-muted-foreground ml-auto">Step {step} of 2</span>
          </DialogTitle>
        </DialogHeader>

        {seats && (
          <div className={`text-xs rounded-md px-2 py-1.5 border ${seats.can_add ? "bg-muted/40" : "bg-destructive/10 text-destructive border-destructive/30"}`}>
            Seats: <strong>{seats.used}</strong>
            {seats.seat_limit > 0 ? <> / {seats.seat_limit}</> : <> (unlimited)</>}
            {!seats.can_add && " — limit reached. Upgrade subscription to add users."}
          </div>
        )}

        {step === 1 ? (
          <div className="space-y-3">
            <div>
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <Label>Display name {mode === "invite" ? "(optional)" : ""}</Label>
              <Input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
            </div>


            {mode === "direct" && (
              <div>
                <Label>Temporary password</Label>
                <Input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="min 8 characters" />
                <p className="text-xs text-muted-foreground mt-1">Share securely. User should change it on first login.</p>
              </div>
            )}
            <div>
              <Label>Roles · pick one or more</Label>
              <div className="grid grid-cols-2 gap-1.5 mt-1.5 border rounded-md p-2 max-h-[220px] overflow-auto">
                {STAFF_ROLES.map((r) => (
                  <label key={r} className="flex items-center gap-2 text-sm py-1 px-1 rounded hover:bg-muted cursor-pointer">
                    <Checkbox checked={roles.includes(r)} onCheckedChange={() => toggleRole(r)} />
                    {ROLE_LABELS[r]}
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Permissions from all selected roles are combined (union).</p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm">Review what these roles allow. Tweak any cell to override defaults for your organization.</p>
            {roles.length === 1 ? (
              <RoleRightsEditor
                role={roles[0]}
                organizationId={organizationId}
                onChange={(s) => setStagedByRole((prev) => ({ ...prev, [roles[0]]: s }))}
              />
            ) : (
              <Tabs defaultValue={roles[0]}>
                <TabsList className="flex flex-wrap h-auto">
                  {roles.map((r) => <TabsTrigger key={r} value={r}>{ROLE_LABELS[r]}</TabsTrigger>)}
                </TabsList>
                {roles.map((r) => (
                  <TabsContent key={r} value={r}>
                    <RoleRightsEditor
                      role={r}
                      organizationId={organizationId}
                      onChange={(s) => setStagedByRole((prev) => ({ ...prev, [r]: s }))}
                    />
                  </TabsContent>
                ))}
              </Tabs>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {step === 2 && (
            <Button variant="outline" onClick={() => setStep(1)}><ChevronLeft className="h-4 w-4 mr-1" />Back</Button>
          )}
          <div className="flex-1" />
          <Button variant="ghost" onClick={() => { onOpenChange(false); reset(); }}>Cancel</Button>
          {step === 1 ? (
            <Button disabled={!canProceed} onClick={() => setStep(2)}>
              Next: Rights <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button disabled={submit.isPending} onClick={() => submit.mutate()}>
              {submit.isPending ? "Saving…" : mode === "invite" ? "Send invite" : "Create user"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
