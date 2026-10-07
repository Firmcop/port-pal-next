import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { FileDown, Scale, Wand2, ReceiptText, Tag, Ban, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { exportCSV } from "@/lib/export-utils";
import { formatMoneyCode } from "@/lib/money";
import {
  parseStatement, classifyStatement, bundleSummaries, planHistoricalBundles,
  normalizeContainer, STATUS_LABEL, JJ_MES_STATEMENT,
  type ClassifiedLine, type LineStatus, type OurContainer, type OurInvoice, type BundleDraft,
} from "@/lib/supplier-statement";

const STATUS_STYLE: Record<LineStatus, string> = {
  matched: "bg-success/15 text-success",
  amount_differs: "bg-warning/15 text-warning",
  no_invoice: "bg-destructive/15 text-destructive",
  not_in_inventory: "bg-muted text-muted-foreground",
  likely_typo: "bg-info/15 text-info",
  duplicate: "bg-destructive/15 text-destructive",
};

const DEFAULT_SUPPLIER = "JJ MES DMCC";

export default function SupplierStatementReconciliation() {
  const qc = useQueryClient();
  const [supplierId, setSupplierId] = useState<string>("");
  const [currency, setCurrency] = useState("USD");
  const [statementText, setStatementText] = useState(JJ_MES_STATEMENT);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [bundleFor, setBundleFor] = useState<BundleDraft | null>(null);
  const [refFor, setRefFor] = useState<ClassifiedLine | null>(null);

  const { data: suppliers } = useQuery({
    queryKey: ["stmt-suppliers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("suppliers" as any).select("id, name, currency").order("name");
      if (error) throw error;
      const list = (data ?? []) as any[];
      if (!supplierId) {
        const jj = list.find((s) => String(s.name).toUpperCase().includes("JJ MES"));
        if (jj) { setSupplierId(jj.id); setCurrency(String(jj.currency ?? "USD").toUpperCase()); }
      }
      return list;
    },
  });

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["stmt-recon-data", supplierId],
    enabled: !!supplierId,
    queryFn: async () => {
      const [containers, invoices] = await Promise.all([
        supabase.from("containers" as any).select("id, container_number, size, status, owner"),
        supabase.from("supplier_invoices" as any)
          .select("id, invoice_number, container_id, total_amount, currency, status, supplier_ref, reason")
          .eq("supplier_id", supplierId)
          .eq("reason", "purchase"),
      ]);
      if (containers.error) throw containers.error;
      if (invoices.error) throw invoices.error;
      return {
        containers: (containers.data ?? []) as unknown as OurContainer[],
        invoices: (invoices.data ?? []) as unknown as OurInvoice[],
      };
    },
  });

  const rows = useMemo(() => {
    if (!data) return [];
    return classifyStatement({
      lines: parseStatement(statementText),
      containers: data.containers,
      invoices: data.invoices,
    });
  }, [data, statementText]);

  const bundles = useMemo(() => bundleSummaries(rows), [rows]);
  const drafts = useMemo(() => planHistoricalBundles(rows), [rows]);
  const visible = useMemo(
    () => (statusFilter === "all" ? rows : rows.filter((r) => r.status === statusFilter)),
    [rows, statusFilter],
  );

  const counts = useMemo(() => {
    const acc: Record<string, number> = {};
    rows.forEach((r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; });
    return acc;
  }, [rows]);

  const supplierName = suppliers?.find((s: any) => s.id === supplierId)?.name ?? DEFAULT_SUPPLIER;

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch (e: any) { toast.error(e?.message ?? "Something went wrong"); }
    setBusy(null);
  };

  const applyTypo = (r: ClassifiedLine) =>
    run(`typo-${r.containerNumber}`, async () => {
      const { error } = await supabase.rpc("correct_container_number" as any, {
        _container_id: r.containerId,
        _new_number: r.containerNumber,
        _reason: `Container number corrected to match supplier invoice ${r.supplierRef}`,
      });
      if (error) throw error;
      toast.success(`${r.ourContainerNumber} → ${r.containerNumber}`);
      await refetch();
      qc.invalidateQueries({ queryKey: ["supplier-invoices"] });
    });

  const assignRef = (r: ClassifiedLine) =>
    run(`ref-${r.containerNumber}`, async () => {
      const { data: n, error } = await supabase.rpc("set_supplier_invoice_refs" as any, {
        _invoice_ids: r.invoices.map((i) => i.id),
        _supplier_ref: r.supplierRef,
        _reason: `Supplier invoice number ${r.supplierRef} recorded from the supplier statement`,
      });
      if (error) throw error;
      toast.success(`${n ?? 0} invoice(s) tagged ${r.supplierRef}`);
      await refetch();
    });

  const assignAllRefs = () =>
    run("ref-all", async () => {
      const byRef = new Map<string, string[]>();
      rows.forEach((r) => {
        if (!r.invoices.length) return;
        const list = byRef.get(r.supplierRef) ?? [];
        r.invoices.forEach((i) => { if (i.supplier_ref !== r.supplierRef) list.push(i.id); });
        byRef.set(r.supplierRef, list);
      });
      let total = 0;
      for (const [ref, ids] of byRef) {
        if (!ids.length) continue;
        const { data: n, error } = await supabase.rpc("set_supplier_invoice_refs" as any, {
          _invoice_ids: ids,
          _supplier_ref: ref,
          _reason: `Supplier invoice number ${ref} recorded from the supplier statement`,
        });
        if (error) throw error;
        total += Number(n ?? 0);
      }
      toast.success(`${total} purchase invoice(s) tagged with the supplier's number`);
      await refetch();
    });

  const cancelDuplicate = (r: ClassifiedLine, invoiceId: string) =>
    run(`dup-${invoiceId}`, async () => {
      const { error } = await supabase.rpc("reverse_duplicate_acquisition_invoice" as any, {
        _invoice_id: invoiceId,
        _reason: `Duplicate acquisition invoice for ${r.containerNumber} — supplier billed it once on ${r.supplierRef}`,
      });
      if (error) throw error;
      toast.success("Duplicate cancelled and reversed");
      await refetch();
      qc.invalidateQueries({ queryKey: ["supplier-invoices"] });
    });

  const raiseMissing = (r: ClassifiedLine) =>
    run(`missing-${r.containerNumber}`, async () => {
      const bundle = bundles.find((b) => b.supplierRef === r.supplierRef);
      const amount = Number(bundle?.residual ?? 0);
      if (!(amount > 0)) throw new Error("Nothing left to bill on this supplier invoice");
      const { error } = await supabase.rpc("acquire_container_from_owner" as any, {
        _container_id: r.containerId,
        _amount: amount,
        _currency: currency,
        _reason: "purchase",
        _reference: r.containerNumber,
      });
      if (error) throw error;
      toast.success(`Purchase invoice raised for ${r.containerNumber}`);
      await refetch();
      qc.invalidateQueries({ queryKey: ["supplier-invoices"] });
    });

  const csv = () => exportCSV(
    "supplier_statement_reconciliation.csv",
    ["Supplier invoice", "Container (theirs)", "Container (ours)", "Type", "Bundle total", "Our amount", "Status", "Note", "Our invoices"],
    visible.map((r) => [
      r.supplierRef, r.containerNumber, r.ourContainerNumber ?? "", r.type,
      r.bundleAmount.toFixed(2), r.ourAmount.toFixed(2), STATUS_LABEL[r.status], r.note,
      r.invoices.map((i) => i.invoice_number).join(" / "),
    ]),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Scale className="h-6 w-6" /> Supplier Statement Reconciliation
          </h1>
          <p className="text-sm text-muted-foreground">
            Match a supplier's bundled invoices against the purchase invoices we raised, container by container.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={assignAllRefs} disabled={busy === "ref-all" || !rows.length}>
            {busy === "ref-all" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Tag className="h-4 w-4 mr-2" />}
            Tag all with supplier numbers
          </Button>
          <Button variant="outline" onClick={csv} disabled={!visible.length}>
            <FileDown className="h-4 w-4 mr-2" /> Export CSV
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Statement</CardTitle>
          <CardDescription>
            One row per container: supplier invoice number, bundle total, container number, type.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label>Supplier</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                <SelectContent>
                  {(suppliers ?? []).map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Statement currency</Label>
              <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} className="font-mono" />
            </div>
            <div className="space-y-1">
              <Label>Show</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All lines ({rows.length})</SelectItem>
                  {(Object.keys(STATUS_LABEL) as LineStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>{STATUS_LABEL[s]} ({counts[s] ?? 0})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Textarea rows={5} className="font-mono text-xs" value={statementText}
            onChange={(e) => setStatementText(e.target.value)} />
          <p className="text-xs text-muted-foreground">
            {rows.length} statement line(s) parsed for {supplierName}. Amount differences are reported only — correct
            those on the purchase invoice itself.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bundle totals</CardTitle>
          <CardDescription>Their invoice total against what we have on the ledger.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Supplier invoice</TableHead>
                <TableHead className="text-right">Theirs</TableHead>
                <TableHead className="text-right">Ours</TableHead>
                <TableHead className="text-right">Gap</TableHead>
                <TableHead className="text-right">Lines</TableHead>
                <TableHead className="text-right">Missing</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!bundles.length ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Paste a statement above.</TableCell></TableRow>
              ) : bundles.map((b) => {
                const draft = drafts.find((d) => d.supplierRef === b.supplierRef);
                return (
                  <TableRow key={b.supplierRef}>
                    <TableCell className="font-mono text-xs">{b.supplierRef}</TableCell>
                    <TableCell className="text-right font-mono">{formatMoneyCode(b.theirTotal, currency)}</TableCell>
                    <TableCell className="text-right font-mono">{formatMoneyCode(b.ourTotal, currency)}</TableCell>
                    <TableCell className={`text-right font-mono ${Math.abs(b.gap) > 0.01 ? "text-destructive" : "text-success"}`}>
                      {formatMoneyCode(b.gap, currency)}
                    </TableCell>
                    <TableCell className="text-right text-xs">{b.lines}</TableCell>
                    <TableCell className="text-right text-xs">{b.missingLines || "—"}</TableCell>
                    <TableCell className="text-right">
                      {draft && (
                        <Button size="sm" variant="outline" onClick={() => setBundleFor(draft)}>
                          <ReceiptText className="h-4 w-4 mr-2" /> Bundle invoice
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Statement lines</CardTitle>
          <CardDescription>{visible.length} line(s)</CardDescription>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Supplier invoice</TableHead>
                <TableHead>Container (theirs)</TableHead>
                <TableHead>Ours</TableHead>
                <TableHead className="text-right">Our amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Note</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : !visible.length ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Nothing to show.</TableCell></TableRow>
              ) : visible.map((r, idx) => (
                <TableRow key={`${r.supplierRef}-${r.containerNumber}-${idx}`}>
                  <TableCell className="font-mono text-xs">{r.supplierRef}</TableCell>
                  <TableCell className="font-mono text-xs">{r.containerNumber}</TableCell>
                  <TableCell className="font-mono text-xs">{r.ourContainerNumber ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {r.ourAmount ? formatMoneyCode(r.ourAmount, r.invoices[0]?.currency ?? currency) : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={STATUS_STYLE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[22rem]">{r.note}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end flex-wrap">
                      {r.status === "likely_typo" && (
                        <Button size="sm" variant="outline" disabled={busy === `typo-${r.containerNumber}`}
                          onClick={() => applyTypo(r)}>
                          <Wand2 className="h-4 w-4 mr-1" /> Correct number
                        </Button>
                      )}
                      {r.status === "no_invoice" && (
                        <Button size="sm" variant="outline" disabled={busy === `missing-${r.containerNumber}`}
                          onClick={() => raiseMissing(r)}>
                          <ReceiptText className="h-4 w-4 mr-1" /> Raise invoice
                        </Button>
                      )}
                      {r.status === "duplicate" && r.invoices.slice(1).map((i) => (
                        <Button key={i.id} size="sm" variant="outline" disabled={busy === `dup-${i.id}`}
                          onClick={() => cancelDuplicate(r, i.id)}>
                          <Ban className="h-4 w-4 mr-1" /> Cancel {i.invoice_number}
                        </Button>
                      ))}
                      {!!r.invoices.length && r.invoices.some((i) => i.supplier_ref !== r.supplierRef) && (
                        <Button size="sm" variant="ghost" disabled={busy === `ref-${r.containerNumber}`}
                          onClick={() => assignRef(r)}>
                          <Tag className="h-4 w-4 mr-1" /> Tag
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {bundleFor && (
        <BundledInvoiceDialog
          draft={bundleFor}
          supplierId={supplierId}
          supplierName={supplierName}
          currency={currency}
          onOpenChange={(o) => !o && setBundleFor(null)}
          onDone={async () => { setBundleFor(null); await refetch(); qc.invalidateQueries({ queryKey: ["supplier-invoices"] }); }}
        />
      )}
    </div>
  );
}

function BundledInvoiceDialog({
  draft, supplierId, supplierName, currency, onOpenChange, onDone,
}: {
  draft: BundleDraft;
  supplierId: string;
  supplierName: string;
  currency: string;
  onOpenChange: (o: boolean) => void;
  onDone: () => void | Promise<void>;
}) {
  const [lines, setLines] = useState(draft.lines.map((l) => ({ ...l, amount: String(l.amount) })));
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  const total = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);

  const submit = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("create_bundled_supplier_invoice" as any, {
      _supplier_id: supplierId,
      _supplier_ref: draft.supplierRef,
      _currency: currency,
      _lines: lines.map((l) => ({ container_number: l.containerNumber, amount: Number(l.amount) || 0 })),
      _issue_date: issueDate,
      _reason: `Historical bundle for supplier invoice ${draft.supplierRef} — containers acquired before the system went live`,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Bundled purchase invoice created for ${draft.supplierRef}`);
    await onDone();
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Bundle invoice {draft.supplierRef}</DialogTitle>
          <DialogDescription>
            Payable to {supplierName} for containers that were never received into inventory. No container records,
            gate-in or EIR are created — this is a historical payable only.
          </DialogDescription>
        </DialogHeader>
        {!draft.postable ? (
          <p className="text-sm text-destructive">{draft.blockedReason}</p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Invoice date</Label>
              <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={l.containerNumber} className="flex items-center gap-2">
                  <Input className="font-mono text-xs" value={l.containerNumber}
                    onChange={(e) => setLines((p) => p.map((x, j) => j === i ? { ...x, containerNumber: normalizeContainer(e.target.value) } : x))} />
                  <Input className="w-32 font-mono" type="number" value={l.amount}
                    onChange={(e) => setLines((p) => p.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} />
                </div>
              ))}
            </div>
            <div className="flex justify-between text-sm font-semibold">
              <span>Total</span>
              <span className="font-mono">{formatMoneyCode(total, currency)}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Residual on this supplier invoice after what we already billed: {formatMoneyCode(draft.residual, currency)}.
            </p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !draft.postable || total <= 0}>
            {busy ? "Creating…" : "Create purchase invoice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
