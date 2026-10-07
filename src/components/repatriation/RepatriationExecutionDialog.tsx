import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Truck } from "lucide-react";
import { format } from "date-fns";
import { Link } from "@/lib/router";
import { CreateCarrierDialog } from "@/components/logistics/CreateCarrierDialog";
import FxRateInput from "@/components/containers/FxRateInput";
import { useOrganization } from "@/hooks/use-organization";

const CURRENCIES = ["USD", "KES", "EUR", "UGX", "TZS", "GBP"];

type Props = {
  repatriation: any | null;
  onOpenChange: (open: boolean) => void;
};

export function RepatriationExecutionDialog({ repatriation, onOpenChange }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { organizationId } = useOrganization();
  const [mode, setMode] = useState<"own_truck" | "subcontracted">("own_truck");
  const [carrierId, setCarrierId] = useState("");
  const [carrierCost, setCarrierCost] = useState("");
  const [carrierCurrency, setCarrierCurrency] = useState("USD");
  const [carrierFx, setCarrierFx] = useState("");
  const [tripId, setTripId] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [newCarrierOpen, setNewCarrierOpen] = useState(false);

  useEffect(() => {
    if (!repatriation) return;
    setMode((repatriation.execution_mode as any) ?? "own_truck");
    setCarrierId(repatriation.carrier_id ?? "");
    setCarrierCost(repatriation.carrier_cost ? String(repatriation.carrier_cost) : "");
    setTripId(repatriation.trip_id ?? "");
    setCurrency(repatriation.currency ?? "USD");
    setCarrierCurrency(repatriation.carrier_cost_currency ?? repatriation.currency ?? "USD");
    setCarrierFx(repatriation.carrier_fx_rate ? String(repatriation.carrier_fx_rate) : "");
  }, [repatriation]);


  const { data: carriers = [] } = useQuery({
    queryKey: ["logistics-carriers-active"],
    enabled: !!repatriation,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("logistics_carriers")
        .select("id, name, type, default_currency")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Default the carrier-cost currency to the carrier's own billing currency.
  useEffect(() => {
    if (!carrierId) return;
    const c = (carriers as any[]).find((x) => x.id === carrierId);
    if (c?.default_currency && !repatriation?.carrier_cost_currency) setCarrierCurrency(c.default_currency);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carrierId, carriers]);

  const { data: trips = [] } = useQuery({
    queryKey: ["logistics-trips-recent"],
    enabled: !!repatriation,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("logistics_trips")
        .select("id, ref, trip_date, status")
        .order("trip_date", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("set_repatriation_execution" as any, {
        _repatriation_id: repatriation.id,
        _mode: mode,
        _carrier_id: mode === "subcontracted" ? carrierId || null : null,
        _carrier_cost: mode === "subcontracted" ? Number(carrierCost) || 0 : 0,
        _trip_id: mode === "own_truck" ? tripId || null : null,
        _carrier_cost_currency: mode === "subcontracted" ? carrierCurrency || null : null,
        _carrier_fx_rate: mode === "subcontracted" && Number(carrierFx) > 0 ? Number(carrierFx) : null,
      });
      if (error) throw error;


      // Billing currency for this repat (rate-card currency, e.g. USD routes).
      if (currency && currency !== repatriation.currency) {
        const { error: curErr } = await (supabase as any)
          .from("repatriations")
          .update({ currency })
          .eq("id", repatriation.id);
        if (curErr) throw curErr;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["repatriations"] });
      qc.invalidateQueries({ queryKey: ["repat-profitability"] });
      toast({ title: "Execution details saved" });
      onOpenChange(false);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={!!repatriation} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5" /> Execution & costing
            {repatriation && <span className="font-mono text-sm text-muted-foreground">{repatriation.repatriation_number}</span>}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div>
            <Label>Billing currency</Label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["USD", "KES", "EUR", "UGX", "TZS"].map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">
              Charges, handling and the owner invoice are billed in this currency.
            </p>
          </div>

          {repatriation?.invoice_id && (
            <div className="rounded-md border bg-muted/30 p-3 text-xs">
              Invoiced to owner —{" "}
              <Link to={`/finance/invoices?id=${repatriation.invoice_id}`} className="font-mono text-primary hover:underline">
                view invoice
              </Link>
            </div>
          )}

          <div>
            <Label>How is this move executed?</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="own_truck">Our own truck (share trip costs)</SelectItem>
                <SelectItem value="subcontracted">Hired carrier (pay from the repat charge)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {mode === "subcontracted" ? (
            <>
              <div>
                <div className="flex items-center justify-between">
                  <Label>Carrier *</Label>
                  <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => setNewCarrierOpen(true)}>
                    <Plus className="h-3 w-3" /> New carrier
                  </Button>
                </div>
                <Select value={carrierId} onValueChange={setCarrierId}>
                  <SelectTrigger><SelectValue placeholder="Select carrier" /></SelectTrigger>
                  <SelectContent>
                    {carriers.map((c: any) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}{c.type ? ` (${c.type})` : ""}{c.default_currency ? ` — ${c.default_currency}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <Label>Agreed carrier cost</Label>
                  <Input type="number" step="0.01" value={carrierCost} onChange={(e) => setCarrierCost(e.target.value)} />
                </div>
                <div>
                  <Label>Currency</Label>
                  <Select value={carrierCurrency} onValueChange={setCarrierCurrency}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <p className="col-span-3 text-xs text-muted-foreground">
                  Deducted from the repat charge when computing margin.
                </p>
              </div>

              <FxRateInput
                amount={Number(carrierCost) || 0}
                currency={carrierCurrency}
                baseCurrency={currency}
                value={carrierFx}
                onChange={setCarrierFx}
                organizationId={organizationId}
              />
            </>
          ) : (

            <div>
              <Label>Linked trip</Label>
              <Select value={tripId} onValueChange={setTripId}>
                <SelectTrigger><SelectValue placeholder="Select trip (optional)" /></SelectTrigger>
                <SelectContent>
                  {trips.map((t: any) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.ref} — {format(new Date(t.trip_date), "dd MMM yyyy")} ({t.status})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                Repat revenue joins the trip so fuel, tolls and driver costs are shared with the cargo revenue.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || (mode === "subcontracted" && !carrierId)}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>

        <CreateCarrierDialog
          open={newCarrierOpen}
          onOpenChange={setNewCarrierOpen}
          onCreated={(id) => setCarrierId(id)}
        />
      </DialogContent>
    </Dialog>

  );
}
