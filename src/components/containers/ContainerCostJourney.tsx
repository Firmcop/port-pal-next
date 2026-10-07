import { useQuery } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Route } from "lucide-react";
import { varianceLabel, rateVariance } from "@/lib/container-reference-rates";

const num = (n: any) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (d: any) => (d ? new Date(d).toLocaleDateString() : "—");

export function useContainerCostJourney(containerId?: string | null) {
  return useQuery({
    queryKey: ["container-cost-journey", containerId],
    enabled: !!containerId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("container_cost_journey", { _container_id: containerId });
      if (error) throw error;
      return (data ?? {}) as any;
    },
  });
}

/** Full cost story of one container: purchase, gate events, conversion, sale. */
export function ContainerCostJourney({ containerId, size }: { containerId: string; size?: string | number | null }) {
  const { data: j, isLoading } = useContainerCostJourney(containerId);
  if (isLoading || !j) return null;

  const invoices: any[] = j.invoices ?? [];
  const eirs: any[] = j.eirs ?? [];
  const conversions: any[] = j.conversions ?? [];
  const children: any[] = j.children ?? [];
  const sales: any[] = j.sales ?? [];
  const ccy = j.purchase_currency ?? j.org_currency ?? "";

  const live = invoices.filter((i) => !["cancelled", "credited", "void"].includes(String(i.status)));
  const purchaseTotal = live.filter((i) => i.reason === "purchase").reduce((s, i) => s + Number(i.amount || 0), 0);
  const serviceTotal = live.filter((i) => i.reason !== "purchase").reduce((s, i) => s + Number(i.amount || 0), 0);
  const acquisition = purchaseTotal + serviceTotal;
  const costAdded = conversions.reduce((s, c) => s + Number(c.container_cost || 0) + Number(c.transport_offloading_cost || 0), 0);
  const revenue = sales.reduce((s, x) => s + Number(x.selling_price || 0), 0);
  const margin = revenue ? revenue - acquisition : 0;
  const v = rateVariance(purchaseTotal, size ?? null);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><Route className="h-4 w-4" />Cost journey</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {[
              { l: "Purchase price", v: purchaseTotal },
              { l: "Transport & offloading", v: serviceTotal },
              { l: "Total acquisition", v: acquisition },
              { l: "Revenue", v: revenue },
              { l: "Margin", v: margin },
            ].map((c) => (
              <div key={c.l}>
                <p className="text-xs text-muted-foreground">{c.l}</p>
                <p className={`font-mono font-bold ${c.l === "Margin" ? (margin >= 0 ? "text-success" : "text-destructive") : ""}`}>{num(c.v)}</p>
              </div>
            ))}
          </div>
          {v.reference != null && (
            <p className="mt-3 text-xs text-muted-foreground">
              Standard rate for this size: <span className="font-mono">{ccy} {num(v.reference)}</span>
              {v.kind && v.kind !== "at_rate" && (
                <> — <span className={v.kind === "discount" ? "text-success" : "text-destructive"}>{num(Math.abs(v.variance ?? 0))} {varianceLabel(v.kind)}</span></>
              )}
            </p>
          )}
          {costAdded > 0 && <p className="mt-1 text-xs text-muted-foreground">Cost carried into conversion jobs: <span className="font-mono">{num(costAdded)}</span></p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Purchase, transport & offloading invoices</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead><TableHead>Supplier</TableHead><TableHead>Reason</TableHead>
                <TableHead>Date</TableHead><TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">FX</TableHead><TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!invoices.length ? (
                <TableRow><TableCell colSpan={7} className="py-6 text-center text-muted-foreground">No acquisition invoices</TableCell></TableRow>
              ) : invoices.map((i) => (
                <TableRow key={i.id} className={["cancelled", "credited", "void"].includes(String(i.status)) ? "opacity-50" : ""}>
                  <TableCell className="font-mono text-xs">
                    {i.invoice_number}
                    {i.supplier_ref && <span className="ml-1 text-muted-foreground">({i.supplier_ref})</span>}
                  </TableCell>
                  <TableCell className="text-sm">{i.supplier ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{String(i.reason).replace(/^acquisition_/, "").replace(/_/g, " ")}</TableCell>
                  <TableCell className="text-xs">{day(i.issue_date)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{i.currency} {num(i.amount)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{i.fx_rate ?? "—"}</TableCell>
                  <TableCell><Badge variant="outline" className="text-[10px]">{i.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Gate events</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>EIR</TableHead><TableHead>Type</TableHead><TableHead>Date</TableHead>
                <TableHead>Owner at issue</TableHead><TableHead>New owner</TableHead>
                <TableHead className="text-right">Price on EIR</TableHead><TableHead className="text-right">Gate fee</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!eirs.length ? (
                <TableRow><TableCell colSpan={7} className="py-6 text-center text-muted-foreground">No gate events</TableCell></TableRow>
              ) : eirs.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-mono text-xs">{e.eir_number}</TableCell>
                  <TableCell className="text-xs">{e.eir_type === "gate_in" ? "Gate in" : "Gate out"}</TableCell>
                  <TableCell className="text-xs">{day(e.created_at)}</TableCell>
                  <TableCell className="text-xs">{e.owner_at_issue ?? "—"}</TableCell>
                  <TableCell className="text-xs">{e.new_owner ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {e.purchase_price_snapshot == null ? "—" : `${e.purchase_price_currency ?? ""} ${num(e.purchase_price_snapshot)}`}
                    {e.reference_rate != null && e.purchase_price_snapshot != null && (
                      <span className="ml-1 text-[10px] text-muted-foreground">std {num(e.reference_rate)}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">{e.gate_fee_amount ? `${e.gate_fee_currency ?? ""} ${num(e.gate_fee_amount)}` : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {(conversions.length > 0 || children.length > 0) && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Conversion</CardTitle></CardHeader>
          <CardContent className="space-y-3 p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead><TableHead>Kind</TableHead><TableHead>Status</TableHead>
                  <TableHead>Attached</TableHead><TableHead className="text-right">Cost carried in</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!conversions.length ? (
                  <TableRow><TableCell colSpan={5} className="py-4 text-center text-muted-foreground">Not used on any job</TableCell></TableRow>
                ) : conversions.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="text-sm">
                      <Link className="text-primary hover:underline" to={`/conversions/${c.conversion_id}`}>{c.conversion_number}</Link>
                    </TableCell>
                    <TableCell className="text-xs">{c.job_kind}</TableCell>
                    <TableCell className="text-xs">{c.status}</TableCell>
                    <TableCell className="text-xs">{day(c.attached_at)}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {num(Number(c.container_cost || 0) + Number(c.transport_offloading_cost || 0))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {children.length > 0 && (
              <div className="px-4 pb-4">
                <p className="mb-2 text-xs text-muted-foreground">Split children and their apportioned cost</p>
                <div className="flex flex-wrap gap-2">
                  {children.map((ch) => (
                    <Link key={ch.id} to={`/inventory/${ch.id}`}>
                      <Badge variant="secondary" className="font-mono text-[11px]">
                        {ch.container_number} · {ch.size}ft · {num(ch.acquisition_cost)}
                      </Badge>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {sales.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Sale</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sale</TableHead><TableHead>Buyer</TableHead><TableHead>Status</TableHead>
                  <TableHead className="text-right">Entry price</TableHead><TableHead className="text-right">Selling price</TableHead>
                  <TableHead className="text-right">Margin vs acquisition</TableHead><TableHead>Invoice</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sales.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs">{s.sale_number}</TableCell>
                    <TableCell className="text-sm">{s.buyer_name ?? "—"}</TableCell>
                    <TableCell className="text-xs">{s.status}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{num(s.entry_price)}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{s.currency} {num(s.selling_price)}</TableCell>
                    <TableCell className={`text-right font-mono text-sm ${Number(s.selling_price || 0) - acquisition >= 0 ? "text-success" : "text-destructive"}`}>
                      {num(Number(s.selling_price || 0) - acquisition)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {s.invoice_number ? <Link className="text-primary hover:underline" to="/billing/invoices">{s.invoice_number}</Link> : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
