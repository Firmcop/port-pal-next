import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, Download, KeyRound, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useOrganization } from "@/hooks/use-organization";
import { ROLE_LABELS } from "@/lib/staff-roles";

type ResetRow = {
  userId: string;
  email: string | null;
  displayName: string | null;
  roles: string[];
  password: string | null;
  ok: boolean;
  error?: string;
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

function csvEscape(v: string) {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function downloadCsv(rows: ResetRow[]) {
  const header = ["email", "display_name", "roles", "temporary_password"];
  const lines = [header.join(",")];
  for (const r of rows) {
    if (!r.ok || !r.password) continue;
    lines.push([
      csvEscape(r.email ?? ""),
      csvEscape(r.displayName ?? ""),
      csvEscape(r.roles.join("|")),
      csvEscape(r.password),
    ].join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `temporary-passwords-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function BulkIssueCredentialsDialog({ open, onOpenChange }: Props) {
  const { toast } = useToast();
  const { organizationId } = useOrganization();
  const [confirmText, setConfirmText] = useState("");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<ResetRow[] | null>(null);

  const { data: candidates, isLoading } = useQuery({
    queryKey: ["bulk-reset-candidates", organizationId],
    enabled: open && !!organizationId,
    queryFn: async () => {
      const { data: mems, error } = await supabase
        .from("organization_members")
        .select("user_id")
        .eq("organization_id", organizationId!)
        .eq("status", "active");
      if (error) throw error;
      const ids = (mems ?? []).map((m) => m.user_id);
      if (!ids.length) return [];
      const { data: me } = await supabase.auth.getUser();
      const meId = me.user?.id;
      const targetIds = ids.filter((u) => u !== meId);
      if (!targetIds.length) return [];
      const [{ data: profs }, { data: roles }] = await Promise.all([
        supabase.from("profiles").select("user_id, display_name").in("user_id", targetIds),
        supabase.from("user_roles").select("user_id, role").in("user_id", targetIds),
      ]);
      const nameMap = new Map<string, string>();
      (profs ?? []).forEach((p) => { if (p.display_name) nameMap.set(p.user_id, p.display_name); });
      const roleMap = new Map<string, string[]>();
      (roles ?? []).forEach((r: { user_id: string; role: string }) => {
        const list = roleMap.get(r.user_id) ?? [];
        list.push(r.role);
        roleMap.set(r.user_id, list);
      });
      return targetIds
        .map((uid) => ({
          userId: uid,
          displayName: nameMap.get(uid) ?? "Unnamed",
          roles: (roleMap.get(uid) ?? []).filter((r) => r !== "customer"),
          isPortalOnly: (() => {
            const rs = roleMap.get(uid) ?? [];
            return rs.length > 0 && rs.every((r) => r === "customer");
          })(),
        }))
        .filter((c) => !c.isPortalOnly);
    },
  });

  const selectedIds = useMemo(
    () => (candidates ?? []).filter((c) => !excluded.has(c.userId)).map((c) => c.userId),
    [candidates, excluded],
  );

  const run = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("admin-bulk-reset-passwords", {
        body: { organization_id: organizationId, userIds: selectedIds },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      return (data as { results: ResetRow[] }).results;
    },
    onSuccess: (rows) => {
      setResults(rows);
      const okRows = rows.filter((r) => r.ok);
      if (okRows.length) downloadCsv(rows);
      toast({
        title: "Passwords reset",
        description: `${okRows.length} of ${rows.length} succeeded. CSV downloaded.`,
      });
    },
    onError: (e: unknown) =>
      toast({ title: "Failed", description: e instanceof Error ? e.message : "Unknown", variant: "destructive" }),
  });

  const reset = () => { setConfirmText(""); setExcluded(new Set()); setResults(null); };
  const close = (v: boolean) => { onOpenChange(v); if (!v) reset(); };

  const canConfirm = confirmText === "RESET" && selectedIds.length > 0 && !run.isPending;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> Issue credentials
          </DialogTitle>
          <DialogDescription>
            Generate a fresh temporary password for each selected user and download a one-time CSV to hand out.
            All current sessions are terminated.
          </DialogDescription>
        </DialogHeader>

        {!results ? (
          <>
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm flex gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              <div>
                This immediately replaces each selected user's password and signs them out of every device.
                Passwords are shown only once in the downloaded CSV and are not stored anywhere.
              </div>
            </div>

            <div className="border rounded-md max-h-[340px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Roles</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={3} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>
                  ) : !candidates?.length ? (
                    <TableRow><TableCell colSpan={3} className="text-center py-6 text-muted-foreground">No eligible users.</TableCell></TableRow>
                  ) : candidates.map((c) => {
                    const included = !excluded.has(c.userId);
                    return (
                      <TableRow key={c.userId}>
                        <TableCell>
                          <Checkbox
                            checked={included}
                            onCheckedChange={(v) => {
                              setExcluded((prev) => {
                                const next = new Set(prev);
                                if (v) next.delete(c.userId); else next.add(c.userId);
                                return next;
                              });
                            }}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{c.displayName}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {(c.roles.length ? c.roles : ["viewer"]).map((r) => (
                              <Badge key={r} variant="secondary" className="text-[10px]">{ROLE_LABELS[r] ?? r}</Badge>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="space-y-1.5">
              <Label>Type <span className="font-mono font-semibold">RESET</span> to confirm</Label>
              <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="RESET" />
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => close(false)}>Cancel</Button>
              <Button variant="destructive" disabled={!canConfirm} onClick={() => run.mutate()}>
                {run.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Reset {selectedIds.length} password{selectedIds.length === 1 ? "" : "s"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              CSV downloaded. These passwords are shown only once — save the file before closing this dialog.
            </div>
            <div className="border rounded-md max-h-[340px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Temporary password</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((r) => (
                    <TableRow key={r.userId}>
                      <TableCell className="text-xs">{r.email ?? "—"}</TableCell>
                      <TableCell>{r.displayName ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{r.password ?? "—"}</TableCell>
                      <TableCell>
                        {r.ok
                          ? <Badge variant="secondary">OK</Badge>
                          : <Badge variant="destructive" title={r.error}>Failed</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => downloadCsv(results)}>
                <Download className="h-4 w-4 mr-2" /> Download CSV again
              </Button>
              <Button onClick={() => close(false)}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
