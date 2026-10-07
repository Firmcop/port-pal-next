import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Truck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const STATUS_TONE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  planned: "secondary", dispatched: "outline", in_transit: "default",
  completed: "default", cancelled: "destructive",
};

const empty = {
  trip_date: new Date().toISOString().slice(0, 10),
  carrier_id: "", vehicle_id: "", driver_id: "", route_id: "",
  planned_distance_km: "", odometer_start: "", notes: "",
};

export default function Trips() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(empty);
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const { data: trips } = useQuery({
    queryKey: ["logistics-trips"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("logistics_trips")
        .select("*, logistics_carriers(name), logistics_vehicles(registration), logistics_routes(name), logistics_trip_pnl!inner(revenue,total_cost,gross_margin,margin_pct)")
        .order("trip_date", { ascending: false }).limit(200);
      if (error) {
        // pnl join may fail before view rows exist; retry without
        const { data: d2 } = await supabase.from("logistics_trips").select("*, logistics_carriers(name), logistics_vehicles(registration), logistics_routes(name)").order("trip_date", { ascending: false }).limit(200);
        return d2 ?? [];
      }
      return data ?? [];
    },
  });

  const { data: carriers } = useQuery({ queryKey: ["lcarrier-pick"], queryFn: async () => (await supabase.from("logistics_carriers").select("id,name")).data ?? [] });
  const { data: vehicles } = useQuery({ queryKey: ["lvehicle-pick"], queryFn: async () => (await supabase.from("logistics_vehicles").select("id,registration")).data ?? [] });
  const { data: drivers } = useQuery({ queryKey: ["ldriver-pick"], queryFn: async () => (await supabase.from("logistics_drivers").select("id,name")).data ?? [] });
  const { data: routes } = useQuery({ queryKey: ["lroute-pick"], queryFn: async () => (await supabase.from("logistics_routes").select("id,code,name,distance_km")).data ?? [] });

  const create = useMutation({
    mutationFn: async () => {
      const { data: refData } = await supabase.rpc("logistics_next_ref" as any, { _prefix: "TR" });
      const payload: any = { ...form, ref: refData };
      Object.keys(payload).forEach((k) => { if (payload[k] === "") payload[k] = null; });
      const { error } = await supabase.from("logistics_trips").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["logistics-trips"] }); setOpen(false); setForm(empty); toast({ title: "Trip created" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: any }) => {
      const { error } = await supabase.from("logistics_trips").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["logistics-trips"] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Truck className="h-6 w-6" />Trips</h1>
          <p className="text-muted-foreground">{trips?.length ?? 0} trips</p>
        </div>
        <Button onClick={() => { setForm(empty); setOpen(true); }}><Plus className="mr-1 h-4 w-4" />New Trip</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Ref</TableHead><TableHead>Date</TableHead>
              <TableHead>Route</TableHead><TableHead>Vehicle</TableHead>
              <TableHead>Carrier</TableHead><TableHead>Status</TableHead>
              <TableHead className="text-right">Margin</TableHead>
              <TableHead className="w-44" />
            </TableRow></TableHeader>
            <TableBody>
              {(trips ?? []).map((t: any) => {
                const pnl = Array.isArray(t.logistics_trip_pnl) ? t.logistics_trip_pnl[0] : t.logistics_trip_pnl;
                return (
                <TableRow key={t.id}>
                  <TableCell className="font-mono text-xs">
                    <Link to={`/logistics/trips/${t.id}`} className="text-primary hover:underline">{t.ref}</Link>
                  </TableCell>
                  <TableCell>{t.trip_date}</TableCell>
                  <TableCell>{t.logistics_routes?.name ?? "—"}</TableCell>
                  <TableCell>{t.logistics_vehicles?.registration ?? "—"}</TableCell>
                  <TableCell>{t.logistics_carriers?.name ?? "—"}</TableCell>
                  <TableCell><Badge variant={STATUS_TONE[t.status] ?? "secondary"}>{t.status}</Badge></TableCell>
                  <TableCell className="text-right">
                    {pnl ? (
                      <span className={Number(pnl.gross_margin) < 0 ? "text-destructive font-medium" : ""}>
                        {Number(pnl.gross_margin).toLocaleString()} ({pnl.margin_pct ?? "—"}%)
                      </span>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="space-x-1">
                    {t.status === "planned" && <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ id: t.id, status: "dispatched" })}>Dispatch</Button>}
                    {t.status === "dispatched" && <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ id: t.id, status: "in_transit" })}>Start</Button>}
                    {t.status === "in_transit" && <Button size="sm" onClick={() => setStatus.mutate({ id: t.id, status: "completed" })}>Complete</Button>}
                  </TableCell>
                </TableRow>
              )})}
              {(trips ?? []).length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No trips yet</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>New Trip</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><Label>Date</Label><Input type="date" value={form.trip_date} onChange={(e) => set("trip_date", e.target.value)} /></div>
            <div><Label>Route</Label>
              <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.route_id} onChange={(e) => {
                set("route_id", e.target.value);
                const r = (routes ?? []).find((x: any) => x.id === e.target.value);
                if (r?.distance_km) set("planned_distance_km", r.distance_km);
              }}>
                <option value="">—</option>
                {(routes ?? []).map((r: any) => <option key={r.id} value={r.id}>{r.code} — {r.name}</option>)}
              </select>
            </div>
            <div><Label>Carrier</Label>
              <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.carrier_id} onChange={(e) => set("carrier_id", e.target.value)}>
                <option value="">—</option>
                {(carriers ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div><Label>Vehicle</Label>
              <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.vehicle_id} onChange={(e) => set("vehicle_id", e.target.value)}>
                <option value="">—</option>
                {(vehicles ?? []).map((v: any) => <option key={v.id} value={v.id}>{v.registration}</option>)}
              </select>
            </div>
            <div><Label>Driver</Label>
              <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.driver_id} onChange={(e) => set("driver_id", e.target.value)}>
                <option value="">—</option>
                {(drivers ?? []).map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div><Label>Planned km</Label><Input type="number" value={form.planned_distance_km} onChange={(e) => set("planned_distance_km", e.target.value)} /></div>
            <div><Label>Odometer start</Label><Input type="number" value={form.odometer_start} onChange={(e) => set("odometer_start", e.target.value)} /></div>
            <div className="col-span-2"><Label>Notes</Label><Input value={form.notes} onChange={(e) => set("notes", e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => create.mutate()} disabled={create.isPending}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
