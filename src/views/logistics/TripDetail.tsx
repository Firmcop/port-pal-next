import { useState } from "react";
import { useParams, Link } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TripCostAllocationCard } from "@/components/logistics/TripCostAllocationCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronLeft, Plus, DollarSign, Trash2 } from "lucide-react";
import { AddTripCostDialog } from "@/components/logistics/AddTripCostDialog";

export default function TripDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: trip } = useQuery({
    queryKey: ["trip", id],
    queryFn: async () => {
      const { data } = await supabase.from("logistics_trips").select("*, logistics_carriers(name), logistics_vehicles(registration), logistics_drivers(name), logistics_routes(name)").eq("id", id).maybeSingle();
      return data;
    },
    enabled: !!id,
  });

  const { data: costs } = useQuery({
    queryKey: ["trip-costs", id],
    queryFn: async () => (await supabase.from("logistics_trip_costs").select("*").eq("trip_id", id).order("created_at")).data ?? [],
    enabled: !!id,
  });

  const { data: revenue } = useQuery({
    queryKey: ["trip-revenue", id],
    queryFn: async () => (await supabase.from("logistics_trip_revenue").select("*, invoices(invoice_number)").eq("trip_id", id)).data ?? [],
    enabled: !!id,
  });

  const { data: pnl } = useQuery({
    queryKey: ["trip-pnl", id],
    queryFn: async () => (await supabase.from("logistics_trip_pnl").select("*").eq("trip_id", id).maybeSingle()).data,
    enabled: !!id,
  });

  const removeCost = useMutation({
    mutationFn: async (costId: string) => {
      const { error } = await supabase.from("logistics_trip_costs").delete().eq("id", costId);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["trip-costs", id] }); qc.invalidateQueries({ queryKey: ["trip-pnl", id] }); },
  });

  if (!trip) return <div className="text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm"><Link to="/logistics/trips"><ChevronLeft className="h-4 w-4 mr-1" />Back</Link></Button>

      <div className="flex justify-between items-start flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold">Trip {trip.ref}</h1>
          <p className="text-muted-foreground">{trip.trip_date} • {trip.logistics_routes?.name ?? "—"}</p>
        </div>
        <Badge>{trip.status}</Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Revenue</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{Number(pnl?.revenue ?? 0).toLocaleString()}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Costs</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{Number(pnl?.total_cost ?? 0).toLocaleString()}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Margin</CardTitle></CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${Number(pnl?.gross_margin ?? 0) < 0 ? "text-destructive" : ""}`}>
              {Number(pnl?.gross_margin ?? 0).toLocaleString()}
            </div>
            <div className="text-xs text-muted-foreground">{pnl?.margin_pct ?? "—"}%</div>
          </CardContent></Card>
      </div>

      <Card>
        <CardHeader className="flex-row justify-between items-center">
          <CardTitle className="flex items-center gap-2"><DollarSign className="h-5 w-5" />Trip costs</CardTitle>
          <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />Add cost</Button>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Category</TableHead><TableHead>Description</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Posted</TableHead><TableHead className="w-12" />
            </TableRow></TableHeader>
            <TableBody>
              {(costs ?? []).map((c: any) => (
                <TableRow key={c.id}>
                  <TableCell><Badge variant="outline">{c.category}</Badge></TableCell>
                  <TableCell>{c.description ?? "—"}</TableCell>
                  <TableCell className="text-right">{Number(c.amount).toLocaleString()} {c.currency}</TableCell>
                  <TableCell>{c.expense_txn_id ? <Badge variant="default">Posted</Badge> : <Badge variant="secondary">Draft</Badge>}</TableCell>
                  <TableCell><Button variant="ghost" size="icon" onClick={() => removeCost.mutate(c.id)}><Trash2 className="h-4 w-4" /></Button></TableCell>
                </TableRow>
              ))}
              {(costs ?? []).length === 0 && (<TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">No costs yet</TableCell></TableRow>)}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Revenue</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Order</TableHead><TableHead>Invoice</TableHead><TableHead className="text-right">Amount</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {(revenue ?? []).map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.transport_order_id?.slice(0, 8) ?? "—"}</TableCell>
                  <TableCell>{r.invoices?.invoice_number ?? "—"}</TableCell>
                  <TableCell className="text-right">{Number(r.amount).toLocaleString()} {r.currency}</TableCell>
                </TableRow>
              ))}
              {(revenue ?? []).length === 0 && (<TableRow><TableCell colSpan={3} className="text-center py-6 text-muted-foreground">No revenue recorded yet</TableCell></TableRow>)}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <TripCostAllocationCard tripId={id ?? ""} />



      <AddTripCostDialog tripId={id ?? null} open={open} onOpenChange={setOpen} />
    </div>
  );
}
