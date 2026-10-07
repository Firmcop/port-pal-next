import { useMemo, useState } from "react";
import { Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { FileDown, FileText } from "lucide-react";
import { exportCSV, exportPDF } from "@/lib/export-utils";

function startOfMonthISO() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function todayISO() { return new Date().toISOString().slice(0, 10); }

export function LogisticsPnLReport() {
  const [from, setFrom] = useState(startOfMonthISO());
  const [to, setTo] = useState(todayISO());

  const { data: pnl = [] } = useQuery({
    queryKey: ["logistics-pnl-report", from, to],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("logistics_trip_pnl")
        .select("trip_id, ref, trip_date, revenue, total_cost, gross_margin, margin_pct, carrier_id, route_id")
        .gte("trip_date", from)
        .lte("trip_date", to)
        .order("trip_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: costs = [] } = useQuery({
    queryKey: ["logistics-pnl-costs", from, to],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("logistics_trip_costs")
        .select("amount, category, logistics_trips!inner(trip_date)")
        .gte("logistics_trips.trip_date", from)
        .lte("logistics_trips.trip_date", to)
        .limit(5000);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: carriers = [] } = useQuery({
    queryKey: ["pick-carriers-rep"],
    queryFn: async () => (await supabase.from("logistics_carriers").select("id,name")).data ?? [],
  });
  const { data: routes = [] } = useQuery({
    queryKey: ["pick-routes-rep"],
    queryFn: async () => (await supabase.from("logistics_routes").select("id,name")).data ?? [],
  });
  const carrierName = (id: string) => (carriers as any[]).find((c) => c.id === id)?.name ?? "—";
  const routeName = (id: string) => (routes as any[]).find((r) => r.id === id)?.name ?? "—";

  const summary = useMemo(() => {
    const revenue = (pnl as any[]).reduce((s, r) => s + Number(r.revenue || 0), 0);
    const cost = (pnl as any[]).reduce((s, r) => s + Number(r.total_cost || 0), 0);
    const margin = revenue - cost;
    const pct = revenue > 0 ? (margin / revenue) * 100 : 0;
    return { revenue, cost, margin, pct };
  }, [pnl]);

  const byCategory = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of costs as any[]) m[c.category] = (m[c.category] ?? 0) + Number(c.amount || 0);
    return Object.entries(m)
      .map(([name, value]) => ({ name: name.replace(/_/g, " "), value: Number(value.toFixed(2)) }))
      .sort((a, b) => b.value - a.value);
  }, [costs]);

  const byCarrier = useMemo(() => {
    const m: Record<string, { revenue: number; cost: number }> = {};
    for (const r of pnl as any[]) {
      const k = r.carrier_id ?? "none";
      m[k] = m[k] ?? { revenue: 0, cost: 0 };
      m[k].revenue += Number(r.revenue || 0);
      m[k].cost += Number(r.total_cost || 0);
    }
    return Object.entries(m)
      .map(([id, v]) => ({ name: id === "none" ? "Internal" : carrierName(id), revenue: v.revenue, cost: v.cost, margin: v.revenue - v.cost }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);
  }, [pnl, carriers]);

  const byRoute = useMemo(() => {
    const m: Record<string, { revenue: number; cost: number }> = {};
    for (const r of pnl as any[]) {
      const k = r.route_id ?? "none";
      m[k] = m[k] ?? { revenue: 0, cost: 0 };
      m[k].revenue += Number(r.revenue || 0);
      m[k].cost += Number(r.total_cost || 0);
    }
    return Object.entries(m)
      .map(([id, v]) => ({ name: id === "none" ? "Ad-hoc" : routeName(id), revenue: v.revenue, cost: v.cost, margin: v.revenue - v.cost }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);
  }, [pnl, routes]);

  const lossTrips = (pnl as any[]).filter((r) => Number(r.gross_margin) < 0);

  const exportRows = () =>
    (pnl as any[]).map((r) => [
      r.trip_date ?? "",
      r.ref ?? "",
      carrierName(r.carrier_id),
      routeName(r.route_id),
      String(r.revenue ?? 0),
      String(r.total_cost ?? 0),
      String(r.gross_margin ?? 0),
      r.margin_pct != null ? String(r.margin_pct) : "",
    ]);
  const headers = ["Date", "Trip", "Carrier", "Route", "Revenue", "Cost", "Margin", "Margin %"];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-2 flex-row items-end justify-between flex-wrap gap-2">
          <div className="flex gap-2 items-end">
            <div><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={!pnl.length} onClick={() => exportCSV("logistics_pnl.csv", headers, exportRows())}><FileDown className="h-4 w-4 mr-1" />CSV</Button>
            <Button variant="outline" size="sm" disabled={!pnl.length} onClick={() => exportPDF("Logistics P&L", "logistics_pnl.pdf", headers, exportRows(), { landscape: true })}><FileText className="h-4 w-4 mr-1" />PDF</Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-4">
            <div><p className="text-xs text-muted-foreground">Revenue</p><p className="text-2xl font-mono font-bold text-success">{summary.revenue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p></div>
            <div><p className="text-xs text-muted-foreground">Cost</p><p className="text-2xl font-mono font-bold text-destructive">{summary.cost.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p></div>
            <div><p className="text-xs text-muted-foreground">Gross Margin</p><p className={`text-2xl font-mono font-bold ${summary.margin >= 0 ? "text-success" : "text-destructive"}`}>{summary.margin.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p></div>
            <div><p className="text-xs text-muted-foreground">Margin %</p><p className={`text-2xl font-mono font-bold ${summary.pct >= 0 ? "text-success" : "text-destructive"}`}>{summary.pct.toFixed(1)}%</p></div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Cost by category</CardTitle></CardHeader>
        <CardContent>
          {byCategory.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No costs in selected period</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(220, byCategory.length * 36)}>
              <BarChart data={byCategory} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis type="number" tick={{ fontSize: 12 }} />
                <YAxis dataKey="name" type="category" width={140} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value" name="Cost" fill="hsl(0, 72%, 51%)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Margin by Carrier (top 10)</CardTitle></CardHeader>
          <CardContent>
            {byCarrier.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No data</p>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(220, byCarrier.length * 36)}>
                <BarChart data={byCarrier} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis type="number" tick={{ fontSize: 12 }} />
                  <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="revenue" name="Revenue" fill="hsl(142, 72%, 40%)" />
                  <Bar dataKey="cost" name="Cost" fill="hsl(0, 72%, 51%)" />
                  <Bar dataKey="margin" name="Margin" fill="hsl(215, 90%, 42%)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Margin by Route (top 10)</CardTitle></CardHeader>
          <CardContent>
            {byRoute.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No data</p>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(220, byRoute.length * 36)}>
                <BarChart data={byRoute} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis type="number" tick={{ fontSize: 12 }} />
                  <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="revenue" name="Revenue" fill="hsl(142, 72%, 40%)" />
                  <Bar dataKey="cost" name="Cost" fill="hsl(0, 72%, 51%)" />
                  <Bar dataKey="margin" name="Margin" fill="hsl(215, 90%, 42%)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Loss-making trips ({lossTrips.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Date</TableHead><TableHead>Trip</TableHead><TableHead>Carrier</TableHead><TableHead>Route</TableHead>
              <TableHead className="text-right">Revenue</TableHead><TableHead className="text-right">Cost</TableHead>
              <TableHead className="text-right">Margin</TableHead><TableHead className="text-right">%</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {lossTrips.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-6 text-muted-foreground">None — every trip is profitable in this period</TableCell></TableRow>
              ) : lossTrips.map((r: any) => (
                <TableRow key={r.trip_id}>
                  <TableCell className="text-xs">{r.trip_date}</TableCell>
                  <TableCell><Link to={`/logistics/trips/${r.trip_id}`} className="text-primary hover:underline font-mono text-xs">{r.ref}</Link></TableCell>
                  <TableCell>{carrierName(r.carrier_id)}</TableCell>
                  <TableCell>{routeName(r.route_id)}</TableCell>
                  <TableCell className="text-right font-mono">{Number(r.revenue).toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                  <TableCell className="text-right font-mono">{Number(r.total_cost).toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                  <TableCell className="text-right font-mono"><Badge variant="destructive">{Number(r.gross_margin).toLocaleString(undefined, { maximumFractionDigits: 2 })}</Badge></TableCell>
                  <TableCell className="text-right font-mono">{r.margin_pct ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
