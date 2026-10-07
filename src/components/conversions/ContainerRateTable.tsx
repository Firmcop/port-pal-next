import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Gauge, RefreshCw } from "lucide-react";
import { rateVariance, varianceLabel, REFERENCE_RATE_CURRENCY } from "@/lib/container-reference-rates";
import { useConversionCostSync, isDrifted } from "@/hooks/use-conversion-cost-sync";
import { useOrganization } from "@/hooks/use-organization";
import { getFxRate } from "@/lib/fx";

const num = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Row = { container_id: string; container_number: string; size: string; stored: number; live: number | null; drift: boolean };

/**
 * Per-container purchase price vs the standard (EIR) rate for a conversion job,
 * with a rollup for the project the job belongs to.
 */
type EirCostRow = {
  container_id: string;
  container_number: string | null;
  eir_number: string | null;
  pending: boolean;
  purchase_price: number;
  gate_fee: number;
  repair_cost: number;
  eir_total: number;
  stored_cost: number;
  difference: number;
};

/** Approved gate-in (EIR) costs per container on a conversion job. */
export function useConversionEirCosts(conversionId?: string | null) {
  return useQuery<EirCostRow[]>({
    queryKey: ["conversion-eir-costs", conversionId],
    enabled: !!conversionId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("conversion_eir_costs", { _conversion_id: conversionId });
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({
        ...r,
        purchase_price: Number(r.purchase_price || 0),
        gate_fee: Number(r.gate_fee || 0),
        repair_cost: Number(r.repair_cost || 0),
        eir_total: Number(r.eir_total || 0),
        stored_cost: Number(r.stored_cost || 0),
        difference: Number(r.difference || 0),
      }));
    },
  });
}

export function ContainerRateTable({ job, linkedContainers }: { job: any; linkedContainers: any[] }) {
  const { data: sync = [] } = useConversionCostSync(job?.id);
  const { data: eirCosts = [] } = useConversionEirCosts(job?.id);
  const qc = useQueryClient();
  const { toast } = useToast();

  const refreshFromGateIn = useMutation({
    mutationFn: async () => {
      const reason = window.prompt("Reason for refreshing container costs from gate-in records?");
      if (!reason) throw new Error("cancelled");
      const { data, error } = await (supabase as any).rpc("resync_conversion_container_costs_from_eir", {
        _conversion_id: job.id,
        _reason: reason,
        _container_id: null,
      });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (res: any) => {
      ["conversion-eir-costs", "conversion-cost-sync", "conversion-detail", "conversion-containers", "accounting-transactions"].forEach(
        (k) => qc.invalidateQueries({ queryKey: [k] }),
      );
      toast({
        title: `Updated ${res?.updated ?? 0} container${res?.updated === 1 ? "" : "s"}`,
        description: res?.skipped_pending ? `${res.skipped_pending} skipped — gate-in not approved yet.` : undefined,
      });
    },
    onError: (e: any) => {
      if (e.message === "cancelled") return;
      toast({ title: "Could not refresh", description: e.message, variant: "destructive" });
    },
  });


  const rows: Row[] = useMemo(() => {
    return linkedContainers.map((r: any) => {
      const s = sync.find((x) => x.container_id === r.container_id);
      return {
        container_id: r.container_id,
        container_number: r.containers?.container_number ?? "—",
        size: String(r.containers?.size ?? ""),
        stored: Number(r.container_cost || 0),
        live: s?.live_purchase ?? null,
        drift: s ? isDrifted(s) : false,
      };
    });
  }, [linkedContainers, sync]);

  const totals = useMemo(() => {
    let actual = 0, reference = 0;
    for (const r of rows) {
      const a = r.live ?? r.stored;
      const v = rateVariance(a, r.size);
      actual += a;
      if (v.reference != null) reference += v.reference;
    }
    return { actual, reference, variance: actual - reference };
  }, [rows]);

  const { data: project } = useQuery({
    queryKey: ["project-container-rates", job?.project_id],
    enabled: !!job?.project_id,
    queryFn: async () => {
      const { data: jobs, error: e1 } = await supabase
        .from("container_conversions" as any)
        .select("id")
        .eq("project_id", job.project_id);
      if (e1) throw e1;
      const ids = (jobs as any[]).map((j) => j.id);
      if (!ids.length) return { count: 0, actual: 0, reference: 0 };
      const { data, error } = await supabase
        .from("conversion_containers" as any)
        .select("container_cost, containers:container_id(size)")
        .in("conversion_id", ids);
      if (error) throw error;
      let actual = 0, reference = 0;
      for (const r of (data as any[]) ?? []) {
        actual += Number(r.container_cost || 0);
        const ref = rateVariance(0, r.containers?.size).reference;
        if (ref != null) reference += ref;
      }
      return { count: ((data as any[]) ?? []).length, actual, reference };
    },
  });

  const ccy = job?.currency || REFERENCE_RATE_CURRENCY;
  const { organizationId } = useOrganization();

  // Reference rates are quoted in USD; convert them for jobs kept in another currency.
  const { data: fx = 1 } = useQuery({
    queryKey: ["reference-rate-fx", organizationId, ccy],
    enabled: !!organizationId && ccy !== REFERENCE_RATE_CURRENCY,
    queryFn: () => getFxRate(organizationId!, REFERENCE_RATE_CURRENCY, ccy).catch(() => 1),
  });

  if (!linkedContainers.length) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Gauge className="h-4 w-4" />Container rates vs standard
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          disabled={refreshFromGateIn.isPending}
          onClick={() => refreshFromGateIn.mutate()}
          title="Restate each container's cost on this job from its approved gate-in record"
        >
          <RefreshCw className="h-4 w-4 mr-1" />Refresh from gate-in
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Container</TableHead>
              <TableHead>Size</TableHead>
              <TableHead className="text-right">Purchase price</TableHead>
              <TableHead className="text-right">Standard (EIR) rate</TableHead>
              <TableHead className="text-right">Rate used</TableHead>
              <TableHead className="text-right">Variance</TableHead>
              <TableHead className="text-right">%</TableHead>
              <TableHead className="text-right">Gate-in cost</TableHead>
              <TableHead className="text-right">Gate-in vs stored</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const actual = r.live ?? r.stored;
              const base = rateVariance(actual, r.size);
              const reference = base.reference == null ? null : base.reference * fx;
              const variance = reference == null ? null : Math.round((actual - reference) * 100) / 100;
              const variancePct = reference ? Math.round(((variance as number) / reference) * 1000) / 10 : null;
              const v = {
                reference,
                variance,
                variancePct,
                kind: variance == null ? null : Math.abs(variance) < 0.01 ? "at_rate" : variance < 0 ? "discount" : "over",
              } as ReturnType<typeof rateVariance>;
              return (
                <TableRow key={r.container_id}>
                  <TableCell className="font-mono text-sm">
                    {r.container_number}
                    {r.drift && (
                      <Badge variant="outline" className="ml-2 border-amber-500 text-[10px] text-amber-600" title="The cost stored on this job differs from the container's live acquisition invoices — use Re-sync costs.">
                        drift
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{r.size ? `${r.size}ft` : "—"}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{num(actual)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{v.reference == null ? "—" : num(v.reference)}</TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">
                    {ccy === REFERENCE_RATE_CURRENCY ? "—" : `1 ${REFERENCE_RATE_CURRENCY} = ${fx} ${ccy}`}
                  </TableCell>
                  <TableCell className={`text-right font-mono text-sm font-medium ${v.variance == null ? "" : v.variance < 0 ? "text-success" : v.variance > 0 ? "text-destructive" : ""}`}>
                    {v.variance == null ? "—" : `${num(v.variance)}`}
                    {v.kind && v.kind !== "at_rate" && <span className="ml-1 text-[10px] text-muted-foreground">{varianceLabel(v.kind)}</span>}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">
                    {v.variancePct == null ? "—" : `${v.variancePct}%`}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {(() => {
                      const g = eirCosts.find((x) => x.container_id === r.container_id);
                      if (!g) return "—";
                      return (
                        <>
                          {num(g.eir_total)}
                          {g.pending && (
                            <Badge variant="outline" className="ml-2 text-[10px]" title="Gate-in record is not approved yet — not counted">
                              pending
                            </Badge>
                          )}
                        </>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {(() => {
                      const g = eirCosts.find((x) => x.container_id === r.container_id);
                      if (!g || g.pending) return "—";
                      return (
                        <span className={g.difference === 0 ? "text-muted-foreground" : g.difference > 0 ? "text-destructive" : "text-success"}>
                          {num(g.difference)}
                        </span>
                      );
                    })()}
                  </TableCell>
                </TableRow>
              );
            })}
            <TableRow className="bg-muted/40 font-medium">
              <TableCell colSpan={2}>Job total ({ccy})</TableCell>
              <TableCell className="text-right font-mono">{num(totals.actual)}</TableCell>
              <TableCell className="text-right font-mono">{num(totals.reference * fx)}</TableCell>
              <TableCell />
              <TableCell className={`text-right font-mono ${totals.actual - totals.reference * fx < 0 ? "text-success" : totals.actual - totals.reference * fx > 0 ? "text-destructive" : ""}`}>
                {num(totals.actual - totals.reference * fx)}
              </TableCell>
              <TableCell />
              <TableCell className="text-right font-mono">
                {num(eirCosts.filter((g) => !g.pending).reduce((s, g) => s + g.eir_total, 0))}
              </TableCell>
              <TableCell className="text-right font-mono">
                {num(eirCosts.filter((g) => !g.pending).reduce((s, g) => s + g.difference, 0))}
              </TableCell>
            </TableRow>
            {project && project.count > 0 && (
              <TableRow className="text-muted-foreground">
                <TableCell colSpan={2} className="text-xs">Project total ({project.count} containers)</TableCell>
                <TableCell className="text-right font-mono text-xs">{num(project.actual)}</TableCell>
                <TableCell className="text-right font-mono text-xs">{num(project.reference * fx)}</TableCell>
                <TableCell />
                <TableCell className="text-right font-mono text-xs">{num(project.actual - project.reference * fx)}</TableCell>
                <TableCell />
                <TableCell />
                <TableCell />
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
