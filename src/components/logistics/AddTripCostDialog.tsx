import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useOrgCurrency } from "@/hooks/use-org-currency";

const COST_CATS = ["fuel", "mileage", "driver_salary", "driver_allowance", "tolls", "parking", "repairs", "subcontractor", "loading", "permits", "other"];
const CAT_LABELS: Record<string, string> = {
  fuel: "Fuel",
  mileage: "Mileage (distance x rate)",
  driver_salary: "Driver salary / wages",
  driver_allowance: "Driver allowance",
  tolls: "Tolls",
  parking: "Parking",
  repairs: "Repairs",
  subcontractor: "Subcontractor",
  loading: "Loading",
  permits: "Permits",
  other: "Other",
};

interface Props {
  tripId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

const emptyForm = { category: "fuel", description: "", amount: "" as string | number, supplier_id: "", quantity_litres: "", unit_price: "", odometer_km: "", distance_km: "", rate_per_km: "" };

export function AddTripCostDialog({ tripId, open, onOpenChange, onSuccess }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { currency } = useOrgCurrency();
  const [form, setForm] = useState<any>(emptyForm);

  useEffect(() => {
    if (open) setForm(emptyForm);
  }, [open]);

  // Auto-calc amount for fuel when litres + unit price both entered
  useEffect(() => {
    if (form.category !== "fuel") return;
    const l = Number(form.quantity_litres);
    const u = Number(form.unit_price);
    if (l > 0 && u > 0) {
      setForm((f: any) => ({ ...f, amount: (l * u).toFixed(2) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.quantity_litres, form.unit_price, form.category]);

  const { data: trip } = useQuery({
    queryKey: ["trip-distance", tripId],
    enabled: !!tripId && open,
    queryFn: async () =>
      (await supabase
        .from("logistics_trips")
        .select("actual_distance_km, planned_distance_km, odometer_start, odometer_end")
        .eq("id", tripId!)
        .maybeSingle()).data,
  });

  // Prefill mileage distance from the trip's odometer readings / recorded distance.
  useEffect(() => {
    if (!open || form.category !== "mileage" || form.distance_km) return;
    const odo =
      trip?.odometer_start != null && trip?.odometer_end != null
        ? Number(trip.odometer_end) - Number(trip.odometer_start)
        : null;
    const km = Number(trip?.actual_distance_km ?? trip?.planned_distance_km ?? (odo && odo > 0 ? odo : 0));
    if (km > 0) setForm((f: any) => ({ ...f, distance_km: String(km) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, form.category, trip]);

  // Auto-calc amount for mileage from distance x rate
  useEffect(() => {
    if (form.category !== "mileage") return;
    const d = Number(form.distance_km);
    const r = Number(form.rate_per_km);
    if (d > 0 && r > 0) setForm((f: any) => ({ ...f, amount: (d * r).toFixed(2) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.distance_km, form.rate_per_km, form.category]);

  const { data: suppliers } = useQuery({
    queryKey: ["suppliers-pick"],
    queryFn: async () => (await supabase.from("suppliers").select("id,name").order("name")).data ?? [],
  });

  const addCost = useMutation({
    mutationFn: async () => {
      if (!tripId) throw new Error("No trip selected");
      const payload: any = {
        trip_id: tripId,
        category: form.category,
        description: form.description,
        amount: Number(form.amount),
        currency,
      };
      if (form.supplier_id) payload.supplier_id = form.supplier_id;
      if (form.category === "fuel") {
        if (form.quantity_litres) payload.quantity_litres = Number(form.quantity_litres);
        if (form.unit_price) payload.unit_price = Number(form.unit_price);
        if (form.odometer_km) payload.odometer_km = Number(form.odometer_km);
      }
      if (form.category === "mileage") {
        if (form.distance_km) payload.odometer_km = Number(form.distance_km);
        if (form.rate_per_km) payload.unit_price = Number(form.rate_per_km);
        if (!payload.description) {
          payload.description = `Mileage ${form.distance_km || 0} km @ ${form.rate_per_km || 0}/km`;
        }
      }
      const { data: row, error } = await supabase.from("logistics_trip_costs").insert(payload).select().single();
      if (error) throw error;
      await supabase.rpc("logistics_post_trip_cost" as any, { _cost_id: row.id });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trip-costs", tripId] });
      qc.invalidateQueries({ queryKey: ["trip-pnl", tripId] });
      qc.invalidateQueries({ queryKey: ["logistics-orders"] });
      qc.invalidateQueries({ queryKey: ["logistics-trips"] });
      onOpenChange(false);
      toast({ title: "Cost recorded & posted to ledger" });
      onSuccess?.();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const isFuel = form.category === "fuel";
  const isMileage = form.category === "mileage";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add trip cost</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Category</Label>
            <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {COST_CATS.map((c) => <option key={c} value={c}>{CAT_LABELS[c] ?? c}</option>)}
            </select>
          </div>
          <div><Label>Description</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>

          {isFuel && (
            <div className="grid grid-cols-3 gap-2 rounded-md border p-3 bg-muted/30">
              <div>
                <Label className="text-xs">Litres</Label>
                <Input type="number" step="0.01" value={form.quantity_litres} onChange={(e) => setForm({ ...form, quantity_litres: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Unit price ({currency}/L)</Label>
                <Input type="number" step="0.0001" value={form.unit_price} onChange={(e) => setForm({ ...form, unit_price: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Odometer (km)</Label>
                <Input type="number" step="0.1" value={form.odometer_km} onChange={(e) => setForm({ ...form, odometer_km: e.target.value })} />
              </div>
              <div className="col-span-3 text-[11px] text-muted-foreground">
                Amount auto-fills from Litres × Unit price. You can override it below if the receipt total differs.
              </div>
            </div>
          )}

          {isMileage && (
            <div className="grid grid-cols-2 gap-2 rounded-md border p-3 bg-muted/30">
              <div>
                <Label className="text-xs">Distance (km)</Label>
                <Input type="number" step="0.1" value={form.distance_km} onChange={(e) => setForm({ ...form, distance_km: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Rate ({currency}/km)</Label>
                <Input type="number" step="0.0001" value={form.rate_per_km} onChange={(e) => setForm({ ...form, rate_per_km: e.target.value })} />
              </div>
              <div className="col-span-2 text-[11px] text-muted-foreground">
                Distance is prefilled from the trip's recorded distance or odometer readings. Amount = distance x rate.
              </div>
            </div>
          )}

          <div><Label>Amount ({currency})</Label><Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
          <div>
            <Label>Supplier (optional)</Label>
            <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}>
              <option value="">—</option>
              {(suppliers ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => addCost.mutate()} disabled={addCost.isPending || !tripId || !Number(form.amount)}>Add &amp; post</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
