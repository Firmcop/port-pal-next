import { useMemo, useState } from "react";
import { Link } from "@/lib/router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DollarSign, FileDown, FileText, Filter, Send, RefreshCw } from "lucide-react";
import { format } from "date-fns";
import { exportCSV, exportPDF } from "@/lib/export-utils";
import { toast } from "sonner";

const CATS = ["all","fuel","driver_allowance","tolls","parking","repairs","subcontractor","loading","permits","other"];

function startOfMonthISO() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function todayISO() { return new Date().toISOString().slice(0, 10); }

export default function LogisticsCosts() {
  const qc = useQueryClient();
  const [from, setFrom] = useState(startOfMonthISO());
  const [to, setTo] = useState(todayISO());
  const [category, setCategory] = useState("all");
  const [carrierId, setCarrierId] = useState("all");
  const [vehicleId, setVehicleId] = useState("all");
  const [driverId, setDriverId] = useState("all");
  const [posted, setPosted] = useState("all"); // all | posted | draft

  const postOne = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("logistics_post_trip_cost" as any, { _cost_id: id });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Cost posted to ledger"); qc.invalidateQueries({ queryKey: ["logistics-costs"] }); },
    onError: (e: any) => toast.error(e.message ?? "Failed to post"),
  });

  const backfill = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("logistics_backfill_unposted_costs" as any);
      if (error) throw error;
      return data as number;
    },
    onSuccess: (n) => { toast.success(`${n} cost(s) posted to ledger`); qc.invalidateQueries({ queryKey: ["logistics-costs"] }); },
    onError: (e: any) => toast.error(e.message ?? "Backfill failed"),
  });

  const { data: carriers } = useQuery({
    queryKey: ["pick-carriers"],
    queryFn: async () => (await supabase.from("logistics_carriers").select("id,name").order("name")).data ?? [],
  });
  const { data: vehicles } = useQuery({
    queryKey: ["pick-vehicles"],
    queryFn: async () => (await supabase.from("logistics_vehicles").select("id,registration").order("registration")).data ?? [],
  });
  const { data: drivers } = useQuery({
    queryKey: ["pick-drivers"],
    queryFn: async () => (await supabase.from("logistics_drivers").select("id,name").order("name")).data ?? [],
  });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["logistics-costs", from, to, category, carrierId, vehicleId, driverId, posted],
    queryFn: async () => {
      let q = supabase
        .from("logistics_trip_costs")
        .select(
          "id, category, description, amount, currency, expense_txn_id, created_at, supplier_id, suppliers(name), logistics_trips!inner(id, ref, trip_date, carrier_id, vehicle_id, driver_id, logistics_carriers(name), logistics_vehicles(registration), logistics_drivers(name))"
        )
        .gte("logistics_trips.trip_date", from)
        .lte("logistics_trips.trip_date", to)
        .order("created_at", { ascending: false })
        .limit(2000);
      if (category !== "all") q = q.eq("category", category as any);
      if (carrierId !== "all") q = q.eq("logistics_trips.carrier_id", carrierId);
      if (vehicleId !== "all") q = q.eq("logistics_trips.vehicle_id", vehicleId);
      if (driverId !== "all") q = q.eq("logistics_trips.driver_id", driverId);
      const { data, error } = await q;
      if (error) throw error;
      let r = data ?? [];
      if (posted === "posted") r = r.filter((x: any) => !!x.expense_txn_id);
      if (posted === "draft") r = r.filter((x: any) => !x.expense_txn_id);
      return r;
    },
  });

  const totals = useMemo(() => {
    let total = 0;
    const byCat: Record<string, number> = {};
    for (const r of rows as any[]) {
      const a = Number(r.amount || 0);
      total += a;
      byCat[r.category] = (byCat[r.category] ?? 0) + a;
    }
    return { total, byCat, count: rows.length };
  }, [rows]);

  const headers = ["Date", "Trip", "Category", "Description", "Supplier", "Carrier", "Vehicle", "Driver", "Amount", "Currency", "Posted"];
  const toRows = () =>
    (rows as any[]).map((r) => [
      r.logistics_trips?.trip_date ?? "",
      r.logistics_trips?.ref ?? "",
      r.category ?? "",
      r.description ?? "",
      r.suppliers?.name ?? "",
      r.logistics_trips?.logistics_carriers?.name ?? "",
      r.logistics_trips?.logistics_vehicles?.registration ?? "",
      r.logistics_trips?.logistics_drivers?.name ?? "",
      String(r.amount ?? 0),
      r.currency ?? "",
      r.expense_txn_id ? "Yes" : "No",
    ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><DollarSign className="h-6 w-6" />Logistics Costs</h1>
          <p className="text-muted-foreground">All trip costs across carriers, vehicles and drivers</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={backfill.isPending} onClick={() => backfill.mutate()}>
            <RefreshCw className={`h-4 w-4 mr-1 ${backfill.isPending ? "animate-spin" : ""}`} />Post drafts to ledger
          </Button>
          <Button variant="outline" size="sm" disabled={!rows.length} onClick={() => exportCSV("logistics_costs.csv", headers, toRows())}>
            <FileDown className="h-4 w-4 mr-1" />CSV
          </Button>
          <Button variant="outline" size="sm" disabled={!rows.length} onClick={() => exportPDF("Logistics Costs", "logistics_costs.pdf", headers, toRows(), { landscape: true })}>
            <FileText className="h-4 w-4 mr-1" />PDF
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Filter className="h-4 w-4" />Filters</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-7">
            <div><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            <div>
              <Label className="text-xs">Category</Label>
              <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs">Carrier</Label>
              <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={carrierId} onChange={(e) => setCarrierId(e.target.value)}>
                <option value="all">All</option>
                {(carriers ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs">Vehicle</Label>
              <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                <option value="all">All</option>
                {(vehicles ?? []).map((v: any) => <option key={v.id} value={v.id}>{v.registration}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs">Driver</Label>
              <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                <option value="all">All</option>
                {(drivers ?? []).map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={posted} onChange={(e) => setPosted(e.target.value)}>
                <option value="all">All</option>
                <option value="posted">Posted</option>
                <option value="draft">Draft</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total cost</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold font-mono">{totals.total.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
            <p className="text-xs text-muted-foreground">{totals.count} entries</p></CardContent></Card>
        {Object.entries(totals.byCat).slice(0, 3).map(([k, v]) => (
          <Card key={k}><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground capitalize">{k.replace(/_/g, " ")}</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-bold font-mono">{v.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
              <p className="text-xs text-muted-foreground">{((v / Math.max(totals.total, 1)) * 100).toFixed(1)}% of total</p></CardContent></Card>
        ))}
      </div>

      {Object.keys(totals.byCat).length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">By category</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {Object.entries(totals.byCat)
              .sort(([, a], [, b]) => b - a)
              .map(([k, v]) => (
                <div key={k} className="flex items-center gap-3">
                  <span className="text-sm capitalize w-40 shrink-0">{k.replace(/_/g, " ")}</span>
                  <div className="flex-1 h-2 bg-muted rounded">
                    <div className="h-2 bg-primary rounded" style={{ width: `${(v / Math.max(totals.total, 1)) * 100}%` }} />
                  </div>
                  <span className="font-mono text-sm w-32 text-right">{v.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                  <span className="text-xs text-muted-foreground w-14 text-right">{((v / Math.max(totals.total, 1)) * 100).toFixed(1)}%</span>
                </div>
              ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Trip</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Carrier</TableHead>
                <TableHead>Vehicle</TableHead>
                <TableHead>Driver</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Posted</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : !rows.length ? (
                <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground">No costs match the filters</TableCell></TableRow>
              ) : (rows as any[]).map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs">{r.logistics_trips?.trip_date ? format(new Date(r.logistics_trips.trip_date), "dd MMM yyyy") : "—"}</TableCell>
                  <TableCell><Link to={`/logistics/trips/${r.logistics_trips?.id}`} className="text-primary hover:underline font-mono text-xs">{r.logistics_trips?.ref ?? "—"}</Link></TableCell>
                  <TableCell><Badge variant="outline" className="capitalize">{r.category?.replace(/_/g, " ")}</Badge></TableCell>
                  <TableCell className="max-w-[220px] truncate">{r.description ?? "—"}</TableCell>
                  <TableCell>{r.suppliers?.name ?? "—"}</TableCell>
                  <TableCell>{r.logistics_trips?.logistics_carriers?.name ?? "—"}</TableCell>
                  <TableCell>{r.logistics_trips?.logistics_vehicles?.registration ?? "—"}</TableCell>
                  <TableCell>{r.logistics_trips?.logistics_drivers?.name ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono">{Number(r.amount).toLocaleString(undefined, { maximumFractionDigits: 2 })} {r.currency}</TableCell>
                  <TableCell>{r.expense_txn_id ? <Badge>Posted</Badge> : <Badge variant="secondary">Draft</Badge>}</TableCell>
                  <TableCell>
                    {!r.expense_txn_id && (
                      <Button size="sm" variant="ghost" disabled={postOne.isPending} onClick={() => postOne.mutate(r.id)}>
                        <Send className="h-3 w-3 mr-1" />Post
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
