import { useEffect, useState } from "react";
import { Link } from "@/lib/router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pencil } from "lucide-react";
import { Money } from "@/components/Money";
import { useAppSettings } from "@/hooks/use-app-settings";
import { useUserStaffRole } from "@/hooks/use-user-staff-role";
import EditAcquisitionCostDialog from "@/components/containers/EditAcquisitionCostDialog";
import { describeFx } from "@/lib/acquisition-fx";
import {
  ACQ_LABELS,
  ACQ_REASONS,
  acquisitionRows,
  computeAcquisitionTotal,
  isVoidInvoice,
  type AcqInvoice,
  type AcqReason,
} from "@/lib/acquisition-costs";



const STATUS_TONE: Record<string, string> = {
  paid: "bg-emerald-500/15 text-emerald-700 border-emerald-300",
  part_paid: "bg-amber-500/15 text-amber-700 border-amber-300",
  partially_paid: "bg-amber-500/15 text-amber-700 border-amber-300",
  issued: "bg-blue-500/15 text-blue-700 border-blue-300",
  draft: "bg-muted text-muted-foreground",
  cancelled: "bg-destructive/10 text-destructive border-destructive/30",
  credited: "bg-purple-500/15 text-purple-700 border-purple-300",
};

export function useAcquisitionInvoices(containerId?: string | null, containerNumber?: string | null) {
  const qc = useQueryClient();
  const key = ["container-acquisition-invoices", containerId];

  const query = useQuery({
    queryKey: key,
    enabled: !!containerId,
    queryFn: async (): Promise<AcqInvoice[]> => {
      let q = supabase
        .from("supplier_invoices")
        .select(
          "id, invoice_number, reason, total_amount, paid_amount, currency, status, fx_rate, base_amount, issue_date, suppliers(name)",
        )

        .in("reason", ACQ_REASONS as unknown as string[]);
      q = containerNumber
        ? q.or(`container_id.eq.${containerId},reference.eq.${containerNumber}`)
        : q.eq("container_id", containerId!);
      const { data } = await q.order("issue_date", { ascending: true });
      return (data ?? []) as unknown as AcqInvoice[];
    },
  });

  // Live updates: any edit / correction / status change to a purchase invoice
  // for this container refreshes the panel and its total.
  useEffect(() => {
    if (!containerId) return;
    const channel = supabase
      .channel(`acq-invoices-${containerId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "supplier_invoices", filter: `container_id=eq.${containerId}` },
        () => qc.invalidateQueries({ queryKey: key }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerId]);

  return query;
}

export default function AcquisitionCostPanel({
  containerId,
  containerNumber,
  overrideNote,
  className,
}: {
  containerId: string;
  containerNumber?: string | null;
  /** Optional note shown when intake defaults were overridden for this container. */
  overrideNote?: string | null;
  className?: string;
}) {
  const { currency: orgCurrency } = useAppSettings();
  const { data: invoices = [], isLoading } = useAcquisitionInvoices(containerId, containerNumber);
  const { isOwnerOrAdmin } = useUserStaffRole();
  const [editing, setEditing] = useState(false);

  // A split child has no acquisition invoices of its own — it carries a share of
  // the mother unit's cost, so no gate-in / transport / crane lines are shown.
  const { data: split } = useQuery({
    queryKey: ["container-split-inheritance", containerId],
    enabled: !!containerId,
    queryFn: async () => {
      const { data } = await supabase
        .from("containers")
        .select("parent_container_id, acquisition_cost")
        .eq("id", containerId)
        .maybeSingle();
      if (!data?.parent_container_id) return null;
      const [{ data: mother }, { data: alloc }] = await Promise.all([
        supabase.from("containers").select("container_number").eq("id", data.parent_container_id).maybeSingle(),
        supabase
          .from("conversion_output_costs")
          .select("container_cost, materials_cost, labour_cost, services_cost, sub_assemblies_cost, total_cost, allocation_basis, snapshot, conversion_id")
          .eq("output_kind", "container")
          .eq("output_id", containerId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      return {
        motherNumber: mother?.container_number ?? null,
        share: Number(alloc?.total_cost ?? data.acquisition_cost ?? 0),
        alloc: alloc as any,
      };
    },
  });

  const rows = acquisitionRows(invoices);
  const totals = computeAcquisitionTotal(invoices, orgCurrency);
  const fxLines = invoices
    .filter((i) => !isVoidInvoice(i))
    .map((i) => ({ key: i.id, label: ACQ_LABELS[i.reason as AcqReason] ?? i.reason, fx: describeFx(i, orgCurrency) }))
    .filter((l) => !!l.fx.text)
    .map((l) => ({ key: l.key, label: l.label, text: l.fx.text as string }));

  if (split) {
    const snap = split.alloc?.snapshot ?? {};
    const basis = String(split.alloc?.allocation_basis ?? snap.basis ?? "size_weighted").replace(/_/g, " ");
    const unit = snap.this_unit ?? null;
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Acquisition cost (inherited)</CardTitle>
          <CardDescription>
            Cost inherited from the split of{" "}
            <span className="font-mono">{split.motherNumber ?? "the mother unit"}</span>. Split children carry no gate-in,
            transport or crane cost of their own.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center justify-between border-t pt-2 font-semibold">
            <span>Allocated acquisition cost</span>
            <Money amount={split.share} currency={orgCurrency} />
          </div>
          <p className="text-xs text-muted-foreground">
            Allocation basis: {basis}
            {unit?.share_pct != null ? ` · ${Number(unit.share_pct).toFixed(2)}% of the job total` : ""}
            {unit?.weight != null ? ` (weight ${unit.weight}ft)` : ""}
            {snap?.currency ? ` · stated in ${snap.currency}` : ""}
          </p>
          {split.alloc?.conversion_id && (
            <Link
              to={`/conversions/${split.alloc.conversion_id}`}
              className="text-xs underline hover:no-underline"
            >
              View the split job and its cost breakdown
            </Link>
          )}
          {overrideNote && <p className="text-xs text-amber-600">{overrideNote}</p>}
        </CardContent>
      </Card>
    );
  }




  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">Acquisition cost</CardTitle>
            <CardDescription>
              Live from the seller, transport and crane / offloading purchase invoices — updates automatically when an
              invoice is edited or corrected.
            </CardDescription>
          </div>
          {isOwnerOrAdmin && (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5 mr-1" />Edit
            </Button>
          )}
        </div>
        {isOwnerOrAdmin && (
          <EditAcquisitionCostDialog
            open={editing}
            onOpenChange={setEditing}
            containerId={containerId}
            containerNumber={containerNumber}
            invoices={invoices}
          />
        )}
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {isLoading && <div className="text-muted-foreground">Loading invoices…</div>}

        {!isLoading &&
          rows.map((row) => (
            <div key={row.reason} className="space-y-1">
              {row.invoices.length === 0 ? (
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{row.label}</div>
                    <div className="text-xs text-muted-foreground">No invoice raised</div>
                  </div>
                  <Badge variant="outline" className="text-muted-foreground">Not raised</Badge>
                </div>
              ) : (
                row.invoices.map((inv) => {
                  const fx = describeFx(inv, orgCurrency);
                  return (
                    <div key={inv.id} className="space-y-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-medium truncate">{row.label}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            {inv.suppliers?.name ?? "—"} ·{" "}
                            <Link to="/finance/supplier-invoices" className="underline hover:no-underline">
                              {inv.invoice_number}
                            </Link>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 whitespace-nowrap">
                          <Badge variant="outline" className={STATUS_TONE[String(inv.status ?? "")] ?? ""}>
                            {String(inv.status ?? "—").replace(/_/g, " ")}
                          </Badge>
                          <span className={`font-medium ${isVoidInvoice(inv) ? "line-through text-muted-foreground" : ""}`}>
                            <Money amount={inv.total_amount} currency={inv.currency} />
                          </span>
                        </div>
                      </div>
                      {!isVoidInvoice(inv) && fx.missing && (
                        <div className="text-xs text-amber-600">
                          Not converted — no {(inv.currency ?? "").toUpperCase()} to {orgCurrency} rate on this invoice.{" "}
                          <Link to="/finance/fx-rates" className="underline hover:no-underline">
                            Add an FX rate
                          </Link>
                        </div>
                      )}
                      {!isVoidInvoice(inv) && fx.text && (
                        <div className="text-xs text-muted-foreground">{fx.text}</div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          ))}

        <div className="flex items-center justify-between border-t pt-2 font-semibold">
          <span>Total acquisition cost</span>
          {totals.mixed ? (
            <span className="text-right">
              {totals.byCurrency.map((b) => (
                <div key={b.currency}>
                  <Money amount={b.amount} currency={b.currency} />
                </div>
              ))}
            </span>
          ) : (
            <Money amount={totals.total ?? 0} currency={totals.currency} />
          )}
        </div>

        {fxLines.length > 0 && (
          <div className="rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground space-y-0.5">
            <div className="font-medium text-foreground">Rates used for the {orgCurrency} total</div>
            {fxLines.map((l) => (
              <div key={l.key}>
                {l.label}: {l.text}
              </div>
            ))}
          </div>
        )}

        {totals.excluded > 0 && (
          <p className="text-xs text-muted-foreground">
            {totals.excluded} cancelled / credited invoice{totals.excluded > 1 ? "s" : ""} excluded from the total.
          </p>
        )}

        {overrideNote && <p className="text-xs text-amber-600">{overrideNote}</p>}
      </CardContent>
    </Card>
  );
}
