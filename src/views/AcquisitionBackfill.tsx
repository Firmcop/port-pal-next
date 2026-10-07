import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import { ArrowLeft, Download, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import TransportBackfillPanel from "@/components/inventory/TransportBackfillPanel";
import { recordContainerServiceInvoice } from "@/lib/container-service-costs";
import { acquireContainerFromOwner } from "@/lib/container-acquisition";
import { setContainerAcquisitionCosts } from "@/lib/container-acquisition-edit";
import { isVoidInvoice } from "@/lib/acquisition-costs";
import {
  findInconsistencies,
  planCorrection,
  planOffloading,
  planOwnerFix,
  planPurchase,
  summarise,
  summariseOwnerFix,
  OFFLOADING_VENDOR,
  OWNER_CORRECTION_REASON,
  PURCHASE_FX,
  SELLER_NAME,
  type BackfillContainer,
  type BackfillInvoice,
  type CorrectionRow,
  type OwnerFixRow,
  type PlanRow,
} from "@/lib/acquisition-backfill";

type RunState = Record<string, { status: "done" | "skipped" | "failed"; detail: string }>;

const money = (v: number, currency: string) =>
  `${currency} ${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

const stateBadge = (state: PlanRow["state"]) =>
  state === "ready" ? (
    <Badge variant="default">Will create</Badge>
  ) : state === "skip" ? (
    <Badge variant="secondary">Skipped</Badge>
  ) : (
    <Badge variant="destructive">Blocked</Badge>
  );

function downloadCsv(name: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * One-off admin screen that raises the acquisition purchase invoices missing
 * from existing inventory: Gataru offloading, JJ MES DMCC seller invoices and
 * the single mis-priced correction. Every batch is a dry run until confirmed.
 */
export default function AcquisitionBackfill() {
  const { toast } = useToast();
  const [runs, setRuns] = useState<RunState>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const containersQ = useQuery({
    queryKey: ["acq-backfill", "containers"],
    queryFn: async () => {
      // Split children inherit the mother unit's cost and can never be invoiced.
      const { data, error } = await supabase
        .from("containers")
        .select("id, container_number, size, status, owner")
        .is("parent_container_id", null)
        .order("container_number");
      if (error) throw error;
      return (data ?? []) as unknown as BackfillContainer[];
    },
  });

  const invoicesQ = useQuery({
    queryKey: ["acq-backfill", "invoices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("supplier_invoices")
        .select("id, container_id, reason, status, total_amount, currency, invoice_number, suppliers(name)")
        .not("container_id", "is", null);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        ...r,
        vendor: r.suppliers?.name ?? null,
      })) as BackfillInvoice[];
    },
  });

  const repatQ = useQuery({
    queryKey: ["acq-backfill", "repatriations"],
    queryFn: async () => {
      const { data, error } = await supabase.from("repatriations").select("container_id");
      if (error) throw error;
      return new Set((data ?? []).map((r: any) => r.container_id).filter(Boolean) as string[]);
    },
  });

  const loading = containersQ.isLoading || invoicesQ.isLoading || repatQ.isLoading;
  const containers = containersQ.data ?? [];
  const invoices = invoicesQ.data ?? [];
  const repatriated = repatQ.data ?? new Set<string>();

  const offloadRows = useMemo(() => planOffloading(containers, invoices), [containers, invoices]);
  const purchaseRows = useMemo(
    () => planPurchase(containers, invoices, repatriated),
    [containers, invoices, repatriated],
  );
  const correctionRows = useMemo(() => planCorrection(containers, invoices), [containers, invoices]);
  const ownerRows = useMemo(() => planOwnerFix(containers), [containers]);
  const ownerSummary = useMemo(() => summariseOwnerFix(ownerRows), [ownerRows]);
  const issues = useMemo(
    () => findInconsistencies(containers, invoices, repatriated),
    [containers, invoices, repatriated],
  );

  const refresh = async () => {
    await Promise.all([containersQ.refetch(), invoicesQ.refetch()]);
  };

  const runBatch = async (
    key: string,
    rows: PlanRow[],
    fn: (row: PlanRow) => Promise<string | null>,
  ) => {
    const ready = rows.filter((r) => r.state === "ready");
    if (!ready.length) return;
    setBusy(key);
    setProgress({ done: 0, total: ready.length });
    const results: RunState = {};
    let created = 0;
    let failed = 0;
    for (let i = 0; i < ready.length; i++) {
      const row = ready[i];
      try {
        const id = await fn(row);
        if (id) {
          results[row.containerId] = { status: "done", detail: "Invoice created" };
          created++;
        } else {
          results[row.containerId] = { status: "skipped", detail: "Skipped by the server (already invoiced)" };
        }
      } catch (e: any) {
        results[row.containerId] = { status: "failed", detail: e?.message ?? "Failed" };
        failed++;
      }
      setProgress({ done: i + 1, total: ready.length });
      setRuns((prev) => ({ ...prev, ...results }));
    }
    setBusy(null);
    setProgress(null);
    await refresh();
    toast({
      title: `${created} invoice${created === 1 ? "" : "s"} created`,
      description: failed ? `${failed} failed — see the table` : "All rows processed",
      variant: failed ? "destructive" : "default",
    });
  };

  const runOffloading = () =>
    runBatch("offloading", offloadRows, (row) =>
      recordContainerServiceInvoice({
        containerId: row.containerId,
        vendorName: OFFLOADING_VENDOR,
        amount: row.amount,
        currency: row.currency,
        serviceKind: "crane_offloading",
        reference: row.containerNumber,
      }),
    );

  const runPurchase = () =>
    runBatch("purchase", purchaseRows, (row) =>
      acquireContainerFromOwner({
        containerId: row.containerId,
        amount: row.amount,
        currency: row.currency,
        reason: "purchase",
        reference: row.containerNumber,
        expectedOwner: SELLER_NAME,
        fxRate: row.fxRate ?? undefined,
      }),
    );

  const runCorrection = async (row: CorrectionRow) => {
    setBusy("correction");
    try {
      const live = invoices.filter((i) => i.container_id === row.containerId && !isVoidInvoice(i as any));
      const transport = live.find((i) => i.reason === "acquisition_transport");
      const offloading = live.find((i) => i.reason === "acquisition_crane_offloading");
      await setContainerAcquisitionCosts({
        containerId: row.containerId,
        purchase: row.amount,
        purchaseCurrency: row.currency,
        purchaseFx: row.fxRate,
        transport: Number(transport?.total_amount ?? 0),
        transportVendor: transport?.vendor ?? null,
        transportCurrency: transport?.currency ?? null,
        offloading: Number(offloading?.total_amount ?? 0),
        offloadingVendor: offloading?.vendor ?? null,
        offloadingCurrency: offloading?.currency ?? null,
        currency: row.currency,
        reason: `Correction: ${row.containerNumber} is ${row.size}ft but was invoiced at the 20ft rate`,
      });
      toast({ title: "Invoice corrected", description: row.note });
      await refresh();
    } catch (e: any) {
      toast({ title: "Correction failed", description: e?.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const runOwnerFix = async () => {
    if (!ownerRows.length) return;
    setBusy("owner");
    setProgress({ done: 0, total: ownerRows.length });
    const results: RunState = {};
    let updated = 0;
    let failed = 0;
    for (let i = 0; i < ownerRows.length; i++) {
      const row = ownerRows[i];
      try {
        const { data, error } = await supabase.rpc("correct_container_owner" as any, {
          _container_id: row.containerId,
          _new_owner: row.newOwner,
          _reason: OWNER_CORRECTION_REASON,
        });
        if (error) throw error;
        if (data === false) {
          results[row.containerId] = { status: "skipped", detail: "Already correct" };
        } else {
          results[row.containerId] = { status: "done", detail: `${row.currentOwner} → ${row.newOwner}` };
          updated++;
        }
      } catch (e: any) {
        results[row.containerId] = { status: "failed", detail: e?.message ?? "Failed" };
        failed++;
      }
      setProgress({ done: i + 1, total: ownerRows.length });
      setRuns((prev) => ({ ...prev, ...results }));
    }
    setBusy(null);
    setProgress(null);
    await refresh();
    toast({
      title: `${updated} owner${updated === 1 ? "" : "s"} corrected`,
      description: failed ? `${failed} failed — see the table` : "All rows processed",
      variant: failed ? "destructive" : "default",
    });
  };



  const renderRows = (rows: PlanRow[]) => (
    <div className="rounded-md border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Container</TableHead>
            <TableHead>Size</TableHead>
            <TableHead>Vendor</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Rate</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Note</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const run = runs[r.containerId];
            return (
              <TableRow key={`${r.containerId}-${r.vendor}`}>
                <TableCell className="font-mono text-xs">{r.containerNumber}</TableCell>
                <TableCell>{r.size}ft</TableCell>
                <TableCell>{r.vendor}</TableCell>
                <TableCell className="text-right">{money(r.amount, r.currency)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {r.fxRate ? `${r.fxRate} KES/${r.currency}` : "—"}
                </TableCell>
                <TableCell>
                  {run ? (
                    <Badge variant={run.status === "failed" ? "destructive" : run.status === "done" ? "default" : "secondary"}>
                      {run.status}
                    </Badge>
                  ) : (
                    stateBadge(r.state)
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{run?.detail ?? r.note}</TableCell>
              </TableRow>
            );
          })}
          {!rows.length && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                Nothing to do.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );

  const batchHeader = (title: string, description: string, rows: PlanRow[], onRun: () => void, key: string) => {
    const s = summarise(rows);
    return (
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <Badge variant="default">{s.ready} to create</Badge>
              <Badge variant="secondary">{s.skipped} skipped</Badge>
              {s.blocked > 0 && <Badge variant="destructive">{s.blocked} blocked</Badge>}
              {s.totals.map((t) => (
                <Badge key={t.currency} variant="outline">
                  {money(t.amount, t.currency)}
                </Badge>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadCsv(
                  `${key}-dry-run.csv`,
                  rows.map((r) => ({
                    container: r.containerNumber,
                    size: r.size,
                    vendor: r.vendor,
                    amount: r.amount,
                    currency: r.currency,
                    fx_rate: r.fxRate ?? "",
                    state: r.state,
                    note: r.note,
                  })),
                )
              }
            >
              <Download className="h-4 w-4 mr-1" /> CSV
            </Button>
            <Button size="sm" onClick={onRun} disabled={!!busy || s.ready === 0}>
              {busy === key ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  {progress ? `${progress.done}/${progress.total}` : "Working…"}
                </>
              ) : (
                `Create ${s.ready} invoice${s.ready === 1 ? "" : "s"}`
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent>{renderRows(rows)}</CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/inventory">
            <ArrowLeft className="h-4 w-4 mr-1" /> Inventory
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Acquisition invoice backfill</h1>
          <p className="text-sm text-muted-foreground">
            Raise the missing acquisition purchase invoices. Nothing is written until you confirm a batch.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading inventory…
        </div>
      ) : (
        <Tabs defaultValue="owner">
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="owner">Owner correction ({ownerRows.length})</TabsTrigger>
            <TabsTrigger value="offloading">Offloading (Gataru)</TabsTrigger>
            <TabsTrigger value="transport">Transport</TabsTrigger>
            <TabsTrigger value="purchase">Purchase (JJ MES DMCC)</TabsTrigger>
            <TabsTrigger value="correction">Correction</TabsTrigger>
            <TabsTrigger value="issues">Inconsistencies ({issues.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="owner" className="mt-4">
            <Card>
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle>Owner correction — {SELLER_NAME}</CardTitle>
                  <CardDescription>
                    Every container whose owner is not exactly "{SELLER_NAME}" is re-pointed to the real
                    acquisition supplier, including sold and converted units. No invoices are created or changed.
                  </CardDescription>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <Badge variant="default">{ownerSummary.total} to correct</Badge>
                    {ownerSummary.byOwner.slice(0, 10).map((o) => (
                      <Badge key={o.owner} variant="outline">
                        {o.owner} × {o.count}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!ownerRows.length}
                    onClick={() =>
                      downloadCsv(
                        "owner-correction-dry-run.csv",
                        ownerRows.map((r) => ({
                          container: r.containerNumber,
                          size: r.size,
                          status: r.status ?? "",
                          current_owner: r.currentOwner,
                          new_owner: r.newOwner,
                          note: r.note,
                        })),
                      )
                    }
                  >
                    <Download className="h-4 w-4 mr-1" /> CSV
                  </Button>
                  <Button size="sm" onClick={runOwnerFix} disabled={!!busy || !ownerRows.length}>
                    {busy === "owner" ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        {progress ? `${progress.done}/${progress.total}` : "Working…"}
                      </>
                    ) : (
                      `Correct ${ownerRows.length} owner${ownerRows.length === 1 ? "" : "s"}`
                    )}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Container</TableHead>
                        <TableHead>Size</TableHead>
                        <TableHead>Container status</TableHead>
                        <TableHead>Current owner</TableHead>
                        <TableHead>New owner</TableHead>
                        <TableHead>Result</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ownerRows.map((r: OwnerFixRow) => {
                        const run = runs[r.containerId];
                        return (
                          <TableRow key={r.containerId}>
                            <TableCell className="font-mono text-xs">{r.containerNumber}</TableCell>
                            <TableCell>{r.size}ft</TableCell>
                            <TableCell className="text-xs capitalize">
                              {(r.status ?? "—").replace(/_/g, " ")}
                            </TableCell>
                            <TableCell className="text-xs">{r.currentOwner}</TableCell>
                            <TableCell className="text-xs">{r.newOwner}</TableCell>
                            <TableCell className="text-xs">
                              {run ? (
                                <Badge
                                  variant={
                                    run.status === "failed"
                                      ? "destructive"
                                      : run.status === "done"
                                        ? "default"
                                        : "secondary"
                                  }
                                >
                                  {run.status}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground">{r.note}</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {!ownerRows.length && (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                            All containers already show {SELLER_NAME}.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>


          <TabsContent value="offloading" className="mt-4">
            {batchHeader(
              "Crane / offloading — Gataru Enterprises",
              "KES 4,000 per 40ft and KES 2,000 per 20ft for every container with no offloading invoice.",
              offloadRows,
              runOffloading,
              "offloading",
            )}
          </TabsContent>

          <TabsContent value="transport" className="mt-4">
            <TransportBackfillPanel onDone={refresh} />
          </TabsContent>

          <TabsContent value="purchase" className="mt-4">
            {batchHeader(
              "Container purchase — JJ MES DMCC",
              `USD 1,700 per 40ft and USD 700 per 20ft, converted at ${PURCHASE_FX} KES/USD. Repatriated containers are excluded.`,
              purchaseRows,
              runPurchase,
              "purchase",
            )}
          </TabsContent>

          <TabsContent value="correction" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Mis-priced purchase invoice</CardTitle>
                <CardDescription>
                  A 40ft container invoiced at the 20ft rate. Transport and offloading amounts are preserved.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {correctionRows.length === 0 && (
                  <p className="text-sm text-muted-foreground">Nothing to correct.</p>
                )}
                {correctionRows.map((row) => (
                  <div
                    key={row.invoiceId}
                    className="flex flex-col gap-3 rounded-md border p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="space-y-1">
                      <p className="font-mono text-sm">{row.containerNumber}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.invoiceNumber} — {row.note} ({row.currency}, {row.fxRate} KES/USD)
                      </p>
                    </div>
                    <Button size="sm" disabled={!!busy} onClick={() => runCorrection(row)}>
                      {busy === "correction" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply correction"}
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="issues" className="mt-4">
            <Card>
              <CardHeader className="flex flex-row items-start justify-between">
                <div>
                  <CardTitle>Inconsistencies found</CardTitle>
                  <CardDescription>Reported for review — these are not changed automatically.</CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => downloadCsv("acquisition-inconsistencies.csv", issues as any)}
                  disabled={!issues.length}
                >
                  <Download className="h-4 w-4 mr-1" /> CSV
                </Button>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Container</TableHead>
                        <TableHead>Issue</TableHead>
                        <TableHead>Detail</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {issues.map((i, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="font-mono text-xs">{i.container}</TableCell>
                          <TableCell>{i.issue}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{i.detail}</TableCell>
                        </TableRow>
                      ))}
                      {!issues.length && (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                            No inconsistencies found.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
