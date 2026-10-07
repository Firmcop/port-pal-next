import { useMemo, useState } from "react";
import { Link } from "@/lib/router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useUserStaffRole } from "@/hooks/use-user-staff-role";
import { useAllConversionCostSync, isDrifted } from "@/hooks/use-conversion-cost-sync";
import { resyncConversionContainerCosts } from "@/lib/conversion-cost-sync";
import { fmtMoney } from "@/lib/finance-format";

/**
 * Admin screen: every conversion job container whose stored cost snapshot has
 * drifted from its live acquisition invoices, with a bulk re-sync action.
 */
export default function ConversionCostSync() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { role } = useUserStaffRole();
  const isAdmin = role === "admin";
  const { data: rows = [], isLoading, refetch } = useAllConversionCostSync();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState("");

  const drifted = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter(isDrifted)
      .filter((r) =>
        !q ||
        (r.container_number ?? "").toLowerCase().includes(q) ||
        (r.conversion_number ?? "").toLowerCase().includes(q),
      );
  }, [rows, search]);

  const errored = rows.filter((r) => !!r.error);
  const selectedRows = drifted.filter((r) => selected[r.link_id]);
  const netDelta = selectedRows.reduce((s, r) => s + Number(r.delta ?? 0), 0);

  const syncMut = useMutation({
    mutationFn: async () => {
      const byJob = new Map<string, string[]>();
      for (const r of selectedRows) {
        byJob.set(r.conversion_id, [...(byJob.get(r.conversion_id) ?? []), r.container_id]);
      }
      let updated = 0;
      for (const [conversionId, containerIds] of byJob) {
        for (const containerId of containerIds) {
          const res = await resyncConversionContainerCosts({ conversionId, containerId, reason: reason.trim() });
          updated += Number(res?.updated ?? 0);
        }
      }
      return updated;
    },
    onSuccess: (updated) => {
      toast({ title: `${updated} container cost${updated === 1 ? "" : "s"} refreshed` });
      setConfirmOpen(false); setReason(""); setSelected({});
      qc.invalidateQueries({ queryKey: ["conversion-cost-sync"] });
      qc.invalidateQueries({ queryKey: ["conversions"] });
      refetch();
    },
    onError: (e: any) => toast({ title: "Re-sync failed", description: e.message, variant: "destructive" }),
  });

  if (!isAdmin) {
    return <div className="p-8 text-muted-foreground">Admins only.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild><Link to="/conversions"><ArrowLeft className="mr-1 h-4 w-4" />Back</Link></Button>
        <div>
          <h1 className="text-2xl font-bold">Conversion cost alignment</h1>
          <p className="text-sm text-muted-foreground">
            Containers whose job cost snapshot no longer matches their acquisition invoices. Re-syncing restates the job cost and, for completed jobs, posts the difference to the ledger.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Out of date</p><p className="text-xl font-mono">{drifted.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Selected net change</p><p className={`text-xl font-mono ${netDelta >= 0 ? "text-destructive" : "text-success"}`}>{fmtMoney(netDelta)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Blocked (FX / data)</p><p className="text-xl font-mono">{errored.length}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base">Drifted container costs</CardTitle>
          <div className="flex items-center gap-2">
            <Input placeholder="Search container or job…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-56" />
            <Button size="sm" disabled={!selectedRows.length} onClick={() => { setReason(""); setConfirmOpen(true); }}>
              <RefreshCw className="h-4 w-4 mr-1" />Re-sync {selectedRows.length || ""}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox
                    checked={!!drifted.length && selectedRows.length === drifted.length}
                    onCheckedChange={(v) =>
                      setSelected(v ? Object.fromEntries(drifted.map((r) => [r.link_id, true])) : {})
                    }
                  />
                </TableHead>
                <TableHead>Job</TableHead>
                <TableHead>Container</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Stored</TableHead>
                <TableHead className="text-right">Invoices</TableHead>
                <TableHead className="text-right">Change</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : !drifted.length ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">All conversion job costs match their acquisition invoices.</TableCell></TableRow>
              ) : drifted.map((r) => (
                <TableRow key={r.link_id}>
                  <TableCell>
                    <Checkbox
                      checked={!!selected[r.link_id]}
                      onCheckedChange={(v) => setSelected((s) => ({ ...s, [r.link_id]: !!v }))}
                    />
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    <Link to={`/conversions/${r.conversion_id}`} className="underline">{r.conversion_number ?? r.conversion_id.slice(0, 8)}</Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.container_number ?? "—"}</TableCell>
                  <TableCell><Badge variant="secondary">{r.job_status?.replace("_", " ")}</Badge></TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {fmtMoney(r.stored_purchase + r.stored_transport, r.currency)}
                    <div className="text-[10px] text-muted-foreground">{fmtMoney(r.stored_purchase, r.currency)} + {fmtMoney(r.stored_transport, r.currency)}</div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {fmtMoney((r.live_purchase ?? 0) + (r.live_transport ?? 0), r.currency)}
                    <div className="text-[10px] text-muted-foreground">{fmtMoney(r.live_purchase ?? 0, r.currency)} + {fmtMoney(r.live_transport ?? 0, r.currency)}</div>
                  </TableCell>
                  <TableCell className={`text-right font-mono text-xs ${Number(r.delta ?? 0) >= 0 ? "text-destructive" : "text-success"}`}>
                    {Number(r.delta ?? 0) >= 0 ? "+" : ""}{fmtMoney(r.delta ?? 0, r.currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {errored.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Cannot be compared</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-xs">
            {errored.map((r) => (
              <p key={r.link_id}>
                <span className="font-mono">{r.container_number ?? r.container_id.slice(0, 8)}</span> on{" "}
                <Link to={`/conversions/${r.conversion_id}`} className="underline font-mono">{r.conversion_number ?? "job"}</Link> — {r.error}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog open={confirmOpen} onOpenChange={(v) => { if (!v && !syncMut.isPending) setConfirmOpen(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Re-sync {selectedRows.length} container cost{selectedRows.length === 1 ? "" : "s"}</DialogTitle>
            <DialogDescription>
              Job costs move by a net {fmtMoney(netDelta)}. Completed jobs also get a ledger adjustment. A reason is stored on each job's change history.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Reason</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. align job costs with corrected acquisition invoices" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={syncMut.isPending}>Cancel</Button>
            <Button onClick={() => syncMut.mutate()} disabled={!reason.trim() || syncMut.isPending}>
              {syncMut.isPending ? "Re-syncing…" : "Re-sync selected"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
