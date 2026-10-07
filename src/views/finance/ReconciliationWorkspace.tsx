import { useEffect, useMemo, useState } from "react";
import { useParams, Link, useNavigate } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, ClipboardCheck, CheckCircle, AlertTriangle, ShieldCheck, Undo2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { format, differenceInDays } from "date-fns";
import { SuggestedMatchesPanel } from "@/components/finance/SuggestedMatchesPanel";
import { BulkClearConfirmDialog } from "@/components/finance/BulkClearConfirmDialog";

const CONFLICT_RESOLVERS: Record<string, { label: string; action: string }> = {
  "linked to other reconciliation": { label: "Detach & re-link", action: "detach_relink" },
  "possible duplicate amount": { label: "Mark duplicate", action: "mark_duplicate" },
  "date outside window": { label: "Accept anyway", action: "accept_anyway" },
};

export default function ReconciliationWorkspace() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: recon } = useQuery({
    queryKey: ["recon", id],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("bank_reconciliations").select("*, account:financial_accounts(*)").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: lines, refetch: refetchLines } = useQuery({
    queryKey: ["recon-lines", id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("bank_reconciliation_lines")
        .select("*, transaction:accounting_transactions(*)")
        .eq("reconciliation_id", id);
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const seedMut = useMutation({
    mutationFn: async () => {
      if (!recon) return;
      const { data: candidates, error: ce } = await supabase
        .from("accounting_transactions")
        .select("id")
        .eq("financial_account_id", recon.account_id)
        .gte("transaction_date", recon.statement_start)
        .lte("transaction_date", `${recon.statement_end}T23:59:59`)
        .is("cleared_at", null);
      if (ce) throw ce;
      if (!candidates?.length) return;
      const rows = candidates.map((c: any) => ({ reconciliation_id: id, transaction_id: c.id, cleared: false }));
      const { error } = await (supabase as any).from("bank_reconciliation_lines").insert(rows);
      if (error && !error.message?.includes("duplicate")) throw error;
    },
    onSuccess: () => refetchLines(),
  });

  useEffect(() => {
    if (recon && lines && lines.length === 0 && recon.status === "in_progress") {
      seedMut.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recon?.id, lines?.length]);

  const toggleLine = useMutation({
    mutationFn: async ({ lineId, cleared }: { lineId: string; cleared: boolean }) => {
      const { error } = await (supabase as any).from("bank_reconciliation_lines").update({ cleared }).eq("id", lineId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recon-lines", id] }),
  });

  const resolveMut = useMutation({
    mutationFn: async ({ lineId, action }: { lineId: string; action: string }) => {
      const { error } = await (supabase as any).rpc("resolve_reconciliation_conflict", {
        _line_id: lineId, _action: action, _note: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recon-lines", id] });
      toast({ title: "Conflict resolved" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const completeMut = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).rpc("complete_bank_reconciliation", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Reconciliation completed" });
      qc.invalidateQueries({ queryKey: ["recon", id] });
      qc.invalidateQueries({ queryKey: ["financial-account-balances"] });
      navigate("/finance/reconciliations");
    },
    onError: (e: any) => toast({ title: "Cannot complete", description: e.message, variant: "destructive" }),
  });

  const clearedTotal = useMemo(() => {
    return (lines ?? []).filter((l: any) => l.cleared).reduce((s: number, l: any) => {
      return s + (Number(l.transaction?.debit_amount || 0) - Number(l.transaction?.credit_amount || 0));
    }, 0);
  }, [lines]);

  const expected = recon ? Number(recon.statement_closing_balance) - Number(recon.statement_opening_balance) : 0;
  const diff = expected - clearedTotal;
  const balanced = Math.abs(diff) < 0.01;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);

  const conflictsFor = useMemo(() => {
    const m: Record<string, string[]> = {};
    if (!lines || !recon) return m;
    const amounts = new Map<string, number>();
    for (const l of lines as any[]) {
      const t = l.transaction;
      if (!t) continue;
      const sig = `${Math.round((Number(t.debit_amount || 0) - Number(t.credit_amount || 0)) * 100)}`;
      amounts.set(sig, (amounts.get(sig) ?? 0) + 1);
    }
    for (const l of lines as any[]) {
      if (l.resolved_at || l.excluded) continue;
      const c: string[] = [];
      const t = l.transaction;
      if (!t) continue;
      if (t.reconciliation_id && t.reconciliation_id !== recon.id) c.push("linked to other reconciliation");
      const sig = `${Math.round((Number(t.debit_amount || 0) - Number(t.credit_amount || 0)) * 100)}`;
      if ((amounts.get(sig) ?? 0) > 1) c.push("possible duplicate amount");
      const dStart = differenceInDays(new Date(t.transaction_date), new Date(recon.statement_start));
      const dEnd = differenceInDays(new Date(recon.statement_end), new Date(t.transaction_date));
      if (dStart < -7 || dEnd < -7) c.push("date outside window");
      if (c.length) m[l.id] = c;
    }
    return m;
  }, [lines, recon]);

  const selectionStats = useMemo(() => {
    const sel = (lines ?? []).filter((l: any) => selected.has(l.id));
    const totalDebit = sel.reduce((s: number, l: any) => s + Number(l.transaction?.debit_amount || 0), 0);
    const totalCredit = sel.reduce((s: number, l: any) => s + Number(l.transaction?.credit_amount || 0), 0);
    const conflictCount = sel.filter((l: any) => conflictsFor[l.id]).length;
    return { totalDebit, totalCredit, conflictCount };
  }, [lines, selected, conflictsFor]);

  const bulkClear = useMutation({
    mutationFn: async (skipConflicts: boolean) => {
      const ids = Array.from(selected);
      const { data, error } = await (supabase as any).rpc("bulk_clear_reconciliation_lines_v2", {
        _recon_id: id, _line_ids: ids, _skip_conflicts: skipConflicts,
      });
      if (error) throw error;
      return { result: data as any, ids };
    },
    onSuccess: ({ result, ids }) => {
      const cleared = result?.cleared ?? 0;
      const skipped = (result?.skipped as any[])?.length ?? 0;
      const skippedIds = new Set((result?.skipped as any[] ?? []).map((s: any) => s.line_id));
      // Keep only skipped rows selected so user can address them
      setSelected(new Set(ids.filter((x) => skippedIds.has(x))));
      qc.invalidateQueries({ queryKey: ["recon-lines", id] });
      setBulkOpen(false);

      const clearedIds = ids.filter((x) => !skippedIds.has(x));
      toast({
        title: `${cleared} cleared${skipped ? `, ${skipped} skipped` : ""}`,
        description: skipped ? "Skipped rows had unresolved conflicts." : undefined,
        action: cleared > 0 ? (
          <Button size="sm" variant="outline" onClick={async () => {
            const { error } = await (supabase as any).rpc("undo_bulk_clear", { _recon_id: id, _line_ids: clearedIds });
            if (error) {
              toast({ title: "Undo failed", description: error.message, variant: "destructive" });
            } else {
              qc.invalidateQueries({ queryKey: ["recon-lines", id] });
              toast({ title: "Undone" });
            }
          }}>
            <Undo2 className="mr-1 h-3 w-3" />Undo
          </Button>
        ) : undefined,
      });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (!recon) return <div className="p-8 text-muted-foreground">Loading…</div>;

  const allSelectable = (lines as any[] | undefined)?.filter((l) => !l.cleared && !l.excluded) ?? [];
  const allChecked = allSelectable.length > 0 && allSelectable.every((l) => selected.has(l.id));

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild><Link to="/finance/reconciliations"><ArrowLeft className="mr-1 h-4 w-4" />Back</Link></Button>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2"><ClipboardCheck className="h-6 w-6" />{recon.account?.name}</h1>
              <p className="text-sm text-muted-foreground">
                {format(new Date(recon.statement_start), "yyyy-MM-dd")} → {format(new Date(recon.statement_end), "yyyy-MM-dd")} · <Badge variant="secondary">{recon.status.replace("_"," ")}</Badge>
              </p>
            </div>
          </div>
          {recon.status === "in_progress" && (
            <Button onClick={() => completeMut.mutate()} disabled={!balanced || completeMut.isPending}>
              <CheckCircle className="mr-1 h-4 w-4" />Complete Reconciliation
            </Button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Statement Δ (Close − Open)</p><p className="text-xl font-mono">{expected.toFixed(2)}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Cleared in System</p><p className="text-xl font-mono">{clearedTotal.toFixed(2)}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Difference</p><p className={`text-xl font-mono font-bold ${balanced ? "text-success" : "text-destructive"}`}>{diff.toFixed(2)}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Lines</p><p className="text-xl font-mono">{(lines as any[] | undefined)?.filter((l: any) => l.cleared).length ?? 0} / {lines?.length ?? 0}</p></CardContent></Card>
        </div>

        <SuggestedMatchesPanel reconciliationId={id!} disabled={recon.status !== "in_progress"} />

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base">System Transactions</CardTitle>
            {recon.status === "in_progress" && selected.size > 0 && (
              <Button size="sm" onClick={() => setBulkOpen(true)}>
                <CheckCircle className="mr-1 h-4 w-4" />Mark {selected.size} cleared
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <Checkbox checked={allChecked} disabled={recon.status !== "in_progress" || !allSelectable.length}
                      onCheckedChange={(v) => setSelected(v ? new Set(allSelectable.map((l: any) => l.id)) : new Set())} />
                  </TableHead>
                  <TableHead className="w-12">Cleared</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Txn #</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!lines?.length ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No transactions in this window.</TableCell></TableRow>
                ) : (lines as any[]).map((l: any) => {
                  const conf = conflictsFor[l.id];
                  const isResolved = !!l.resolved_at;
                  const isExcluded = !!l.excluded;
                  return (
                    <TableRow key={l.id} className={isExcluded ? "opacity-50" : conf ? "bg-warning/5" : ""}>
                      <TableCell>
                        <Checkbox disabled={recon.status !== "in_progress" || l.cleared || isExcluded}
                          checked={selected.has(l.id)}
                          onCheckedChange={(v) => {
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (v) next.add(l.id); else next.delete(l.id);
                              return next;
                            });
                          }} />
                      </TableCell>
                      <TableCell>
                        <Checkbox checked={l.cleared} disabled={recon.status !== "in_progress" || isExcluded} onCheckedChange={(v) => toggleLine.mutate({ lineId: l.id, cleared: !!v })} />
                      </TableCell>
                      <TableCell className="text-xs">{l.transaction ? format(new Date(l.transaction.transaction_date), "yyyy-MM-dd") : "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{l.transaction?.transaction_number}</TableCell>
                      <TableCell>
                        <div>{l.transaction?.description}</div>
                        {isExcluded && (
                          <Badge variant="outline" className="mt-1 text-xs">excluded · {l.override_reason ?? "duplicate"}</Badge>
                        )}
                        {isResolved && !isExcluded && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant="secondary" className="mt-1 bg-success/15 text-success text-xs">
                                <ShieldCheck className="h-3 w-3 mr-1" />resolved
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-xs">{l.override_reason ?? "—"}</p>
                              <p className="text-xs text-muted-foreground">{format(new Date(l.resolved_at), "yyyy-MM-dd HH:mm")}</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                        {conf && !isResolved && !isExcluded && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {conf.map((c) => {
                              const meta = CONFLICT_RESOLVERS[c];
                              return (
                                <span key={c} className="inline-flex items-center gap-1">
                                  <Badge variant="secondary" className="bg-warning/15 text-warning text-xs">
                                    <AlertTriangle className="h-3 w-3 mr-1" />{c}
                                  </Badge>
                                  {meta && recon.status === "in_progress" && (
                                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs"
                                      disabled={resolveMut.isPending}
                                      onClick={() => resolveMut.mutate({ lineId: l.id, action: meta.action })}>
                                      {meta.label}
                                    </Button>
                                  )}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">{Number(l.transaction?.debit_amount || 0) > 0 ? Number(l.transaction.debit_amount).toFixed(2) : ""}</TableCell>
                      <TableCell className="text-right font-mono">{Number(l.transaction?.credit_amount || 0) > 0 ? Number(l.transaction.credit_amount).toFixed(2) : ""}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <BulkClearConfirmDialog
          open={bulkOpen}
          onOpenChange={setBulkOpen}
          count={selected.size}
          totalDebit={selectionStats.totalDebit}
          totalCredit={selectionStats.totalCredit}
          conflictCount={selectionStats.conflictCount}
          loading={bulkClear.isPending}
          onConfirm={(skip) => bulkClear.mutate(skip)}
        />
      </div>
    </TooltipProvider>
  );
}
