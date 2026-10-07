import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/lib/router";
import { AlertTriangle } from "lucide-react";

type Row = {
  repatriation_id: string;
  repatriation_number: string;
  container_number: string | null;
  origin: string | null;
  destination: string | null;
  shipping_line: string | null;
  status: string;
  execution_mode: string;
  charge_amount: number;
  handling_amount: number;
  revenue: number;
  direct_cost: number;
  allocated_trip_cost: number;
  margin: number;
  margin_pct: number;
  currency: string;
  invoice_id: string | null;
  invoice_number: string | null;
  invoice_status: string | null;
  invoice_total: number | null;
  cost_basis: "actual" | "no_trip_costs" | "estimated" | string;
  fx_ok: boolean;
  carrier_cost: number;
  carrier_cost_currency: string | null;
  carrier_cost_converted: number;
  carrier_fx_ok: boolean;
};


export default function RepatProfitability() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const { data: rows, isLoading } = useQuery({
    queryKey: ["repat-profitability", from, to],
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase.rpc("repat_profitability" as any, {
        _from: from || null,
        _to: to || null,
      });
      if (error) throw error;
      return (data as Row[]) ?? [];
    },
  });

  const money = (n: number, cur: string) =>
    `${cur} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Totals are grouped per currency — repat routes bill in their own currency (USD routes stay USD).
  const totalsByCurrency = Object.values(
    (rows ?? []).reduce((acc: Record<string, { currency: string; revenue: number; cost: number; margin: number }>, r) => {
      const c = r.currency || "USD";
      acc[c] ??= { currency: c, revenue: 0, cost: 0, margin: 0 };
      acc[c].revenue += Number(r.revenue || 0);
      acc[c].cost += Number(r.direct_cost || 0) + Number(r.allocated_trip_cost || 0);
      acc[c].margin += Number(r.margin || 0);
      return acc;
    }, {}),
  );
  const uninvoiced = (rows ?? []).filter((r) => !r.invoice_id).length;
  const fxIssues = (rows ?? []).filter((r) => r.fx_ok === false || r.carrier_fx_ok === false).length;


  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Repatriation Profitability</h1>
        <p className="text-muted-foreground">Charged vs hired-carrier cost and allocated own-truck trip cost.</p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 pt-6">
          <div><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <div className="ml-auto space-y-2">
            {totalsByCurrency.length === 0 ? (
              <div className="text-sm text-muted-foreground">No data in range.</div>
            ) : (
              totalsByCurrency.map((t) => (
                <div key={t.currency} className="grid grid-cols-3 gap-6 text-right">
                  <div><div className="text-xs uppercase text-muted-foreground">Revenue ({t.currency})</div><div className="font-mono font-semibold">{money(t.revenue, t.currency)}</div></div>
                  <div><div className="text-xs uppercase text-muted-foreground">Cost</div><div className="font-mono font-semibold">{money(t.cost, t.currency)}</div></div>
                  <div>
                    <div className="text-xs uppercase text-muted-foreground">Margin</div>
                    <div className={`font-mono font-semibold ${t.margin >= 0 ? "text-success" : "text-destructive"}`}>{money(t.margin, t.currency)}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {(uninvoiced > 0 || fxIssues > 0) && (
        <div className="flex flex-wrap gap-2">
          {uninvoiced > 0 && (
            <Badge variant="secondary" className="gap-1">
              <AlertTriangle className="h-3 w-3" /> {uninvoiced} repat{uninvoiced === 1 ? "" : "s"} not yet invoiced
            </Badge>
          )}
          {fxIssues > 0 && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" /> {fxIssues} row{fxIssues === 1 ? "" : "s"} with missing FX rate — trip share approximated
            </Badge>
          )}
        </div>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">By repatriation</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Repat</TableHead>
                  <TableHead>Container</TableHead>
                  <TableHead>Route</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead className="text-right">Transport</TableHead>
                  <TableHead className="text-right">Handling</TableHead>
                  <TableHead className="text-right">Direct cost</TableHead>
                  <TableHead className="text-right">Trip share</TableHead>
                  <TableHead>Basis</TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                  <TableHead className="text-right">%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableSkeleton columns={12} />
                ) : !rows?.length ? (
                  <TableRow><TableCell colSpan={12} className="py-8 text-center text-muted-foreground">No repatriations in range.</TableCell></TableRow>
                ) : (
                  rows.map((r) => (
                    <TableRow key={r.repatriation_id}>
                      <TableCell className="font-mono">{r.repatriation_number}</TableCell>
                      <TableCell className="font-mono">{r.container_number ?? "—"}</TableCell>
                      <TableCell className="text-sm">{[r.origin, r.destination].filter(Boolean).join(" → ") || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{r.execution_mode === "subcontracted" ? "Hired truck" : "Own truck"}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">{money(r.charge_amount, r.currency)}</TableCell>
                      <TableCell className="text-right font-mono">{money(r.handling_amount, r.currency)}</TableCell>
                      <TableCell className="text-right font-mono">
                        {money(r.direct_cost, r.currency)}
                        {Number(r.carrier_cost || 0) > 0 && (r.carrier_cost_currency ?? r.currency) !== r.currency && (
                          <div className="text-[10px] text-muted-foreground">
                            carrier {money(r.carrier_cost, r.carrier_cost_currency ?? r.currency)}
                            {r.carrier_fx_ok === false && <AlertTriangle className="ml-1 inline h-3 w-3 text-destructive" />}
                          </div>
                        )}
                      </TableCell>

                      <TableCell className="text-right font-mono">
                        {money(r.allocated_trip_cost, r.currency)}
                        {r.fx_ok === false && <AlertTriangle className="ml-1 inline h-3 w-3 text-destructive" />}
                      </TableCell>
                      <TableCell>
                        <Badge variant={r.cost_basis === "actual" ? "default" : "outline"} className="text-[10px]">
                          {r.cost_basis === "actual" ? "Actual" : r.cost_basis === "no_trip_costs" ? "Trip, no costs" : "Estimated"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.invoice_id ? (
                          <Link to={`/finance/invoices?id=${r.invoice_id}`} className="font-mono text-primary hover:underline">
                            {r.invoice_number ?? "View"}
                          </Link>
                        ) : (
                          <Badge variant="secondary" className="text-[10px]">Not invoiced</Badge>
                        )}
                      </TableCell>
                      <TableCell className={`text-right font-mono font-medium ${Number(r.margin) >= 0 ? "text-success" : "text-destructive"}`}>
                        {money(r.margin, r.currency)}
                      </TableCell>
                      <TableCell className="text-right font-mono">{Number(r.margin_pct || 0).toFixed(1)}%</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
