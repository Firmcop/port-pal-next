import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Boxes, LogOut, Check, Scale } from "lucide-react";
import { StockAdjustmentDialog } from "@/components/inventory/StockAdjustmentDialog";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

const STATUSES = ["in_production","in_stock","reserved","sold","leased","scrapped","gated_out"] as const;
const TYPES = ["office","home","coldroom","workshop","ablution","guard_house","other"] as const;

const statusColor: Record<string, string> = {
  in_stock: "bg-info/15 text-info",
  in_production: "bg-warning/15 text-warning",
  reserved: "bg-warning/15 text-warning",
  sold: "bg-success/15 text-success",
  leased: "bg-success/15 text-success",
  scrapped: "bg-muted text-muted-foreground",
  gated_out: "bg-primary/15 text-primary",
};

// Type-specific gate-out checklists (extends a common base)
const BASE_CHECKS = [
  { key: "external_paint_ok", label: "External paint & branding acceptable" },
  { key: "doors_locks_ok", label: "Doors, hinges & locks operational" },
  { key: "flooring_ok", label: "Flooring undamaged" },
  { key: "lighting_ok", label: "Lighting & sockets tested" },
  { key: "cleaning_done", label: "Interior cleaned" },
  { key: "handover_pack", label: "Handover pack & keys ready" },
];
const TYPE_CHECKS: Record<string, { key: string; label: string }[]> = {
  office: [
    { key: "aircon_tested", label: "Air-conditioning tested" },
    { key: "network_points_ok", label: "Data / network points working" },
  ],
  coldroom: [
    { key: "refrigeration_tested", label: "Refrigeration unit reaches setpoint" },
    { key: "temp_probe_calibrated", label: "Temperature probe calibrated" },
    { key: "door_seal_ok", label: "Door seal & gasket intact" },
  ],
  ablution: [
    { key: "plumbing_tested", label: "Plumbing pressure-tested (no leaks)" },
    { key: "drainage_ok", label: "Drainage flowing" },
    { key: "water_heater_ok", label: "Water heater operational" },
  ],
  workshop: [
    { key: "power_3phase_ok", label: "3-phase power tested" },
    { key: "ventilation_ok", label: "Ventilation / extractor tested" },
  ],
  home: [
    { key: "kitchen_ok", label: "Kitchen fittings operational" },
    { key: "bathroom_ok", label: "Bathroom operational" },
  ],
  guard_house: [
    { key: "windows_ok", label: "Windows & viewing panels intact" },
  ],
};

export default function FinishedProducts() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [type, setType] = useState<string>("all");
  const [gateOutFor, setGateOutFor] = useState<any | null>(null);
  const [adjustFor, setAdjustFor] = useState<any | null>(null);

  const { data = [], isLoading } = useQuery({
    queryKey: ["finished-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("finished_products" as any)
        .select("*, customers:customer_id(company_name), source_conversion:source_conversion_id(conversion_number)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const filtered = data.filter((p: any) => {
    if (status !== "all" && p.status !== status) return false;
    if (type !== "all" && p.product_type !== type) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!`${p.product_number} ${p.name ?? ""} ${p.serial_no ?? ""}`.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Boxes className="h-6 w-6" />Finished Products</h1>
          <p className="text-muted-foreground">Offices, cold rooms, bitutainers and other finished goods</p>
        </div>
      </div>

      <Card>
        <CardContent className="p-4 flex flex-wrap gap-3">
          <Input placeholder="Search by number, name or serial…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {TYPES.map((t) => <SelectItem key={t} value={t} className="capitalize">{t.replace("_"," ")}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUSES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s.replace("_"," ")}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Source Job</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total Cost</TableHead>
                <TableHead className="text-right">List Price</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : !filtered.length ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No finished products yet</TableCell></TableRow>
              ) : filtered.map((p: any) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono text-xs">{p.product_number}</TableCell>
                  <TableCell className="capitalize">{p.product_type?.replace("_"," ")}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{p.source_conversion?.conversion_number ?? "—"}</TableCell>
                  <TableCell>{p.customers?.company_name ?? "—"}</TableCell>
                  <TableCell><Badge className={statusColor[p.status] ?? ""} variant="secondary">{p.status?.replace("_"," ")}</Badge></TableCell>
                  <TableCell className="text-right font-mono">{Number(p.total_cost).toLocaleString(undefined,{minimumFractionDigits:2})}</TableCell>
                  <TableCell className="text-right font-mono">{Number(p.list_price).toLocaleString(undefined,{minimumFractionDigits:2})}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{format(new Date(p.created_at),"dd MMM yyyy")}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {p.gated_out_at ? (
                        <Badge variant="outline" className="gap-1"><Check className="h-3 w-3" />Gated out</Badge>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => setGateOutFor(p)}
                          disabled={p.status === "in_production" || p.status === "scrapped"}>
                          <LogOut className="mr-1 h-3.5 w-3.5" />Gate Out
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => setAdjustFor(p)}>
                        <Scale className="mr-1 h-3.5 w-3.5" />
                        {p.status === "scrapped" ? "Restore" : "Adjust"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <GateOutDialog product={gateOutFor} onClose={() => setGateOutFor(null)} />
      {adjustFor && (
        <StockAdjustmentDialog
          open={!!adjustFor}
          onOpenChange={(v) => !v && setAdjustFor(null)}
          itemType="finished_product"
          itemId={adjustFor.id}
          itemLabel={adjustFor.name || adjustFor.product_number}
          currentQty={["scrapped","sold","leased"].includes(adjustFor.status) ? 0 : 1}
          currentUnitCost={Number(adjustFor.total_cost ?? 0)}
          allowedTypes={adjustFor.status === "scrapped" ? ["write_on"] : ["write_off"]}
        />
      )}
    </div>
  );
}

function GateOutDialog({ product, onClose }: { product: any | null; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const open = !!product;

  const checklist = useMemo(() => {
    if (!product) return [] as { key: string; label: string }[];
    return [...BASE_CHECKS, ...(TYPE_CHECKS[product.product_type] ?? [])];
  }, [product]);

  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [truck, setTruck] = useState("");
  const [driver, setDriver] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  const [transporter, setTransporter] = useState("");
  const [signer, setSigner] = useState("");
  const [notes, setNotes] = useState("");

  // reset when product changes
  useMemo(() => {
    setChecks({}); setTruck(""); setDriver(""); setDriverPhone("");
    setTransporter(""); setSigner(""); setNotes("");
  }, [product?.id]);

  const allChecked = checklist.length > 0 && checklist.every((c) => checks[c.key]);

  const submit = useMutation({
    mutationFn: async () => {
      const payload: Record<string, boolean> = {};
      checklist.forEach((c) => { payload[c.key] = !!checks[c.key]; });
      const { error } = await (supabase as any).rpc("gate_out_finished_product", {
        _finished_product_id: product.id,
        _checklist: payload,
        _truck_plate: truck,
        _driver_name: driver,
        _driver_phone: driverPhone || null,
        _transporter: transporter || null,
        _indemnity_signer: signer,
        _notes: notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Gate-out recorded" });
      qc.invalidateQueries({ queryKey: ["finished-products"] });
      onClose();
    },
    onError: (e: any) => toast({ title: "Gate-out failed", description: e.message, variant: "destructive" }),
  });

  if (!product) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Gate Out: {product.product_number}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border p-3 bg-muted/20 text-sm">
            <div className="font-medium capitalize">{product.product_type?.replace("_"," ")}</div>
            <div className="text-muted-foreground">
              {product.customers?.company_name ? `For ${product.customers.company_name}` : "No customer linked"}
            </div>
          </div>

          <div>
            <Label className="text-sm font-semibold">Inspection checklist</Label>
            <p className="text-xs text-muted-foreground mb-2">Every item must be verified before the unit can leave the yard.</p>
            <div className="space-y-2">
              {checklist.map((c) => (
                <label key={c.key} className="flex items-start gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={!!checks[c.key]}
                    onCheckedChange={(v) => setChecks((prev) => ({ ...prev, [c.key]: !!v }))}
                  />
                  <span>{c.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Truck plate *</Label>
              <Input value={truck} onChange={(e) => setTruck(e.target.value)} />
            </div>
            <div>
              <Label>Transporter</Label>
              <Input value={transporter} onChange={(e) => setTransporter(e.target.value)} />
            </div>
            <div>
              <Label>Driver name *</Label>
              <Input value={driver} onChange={(e) => setDriver(e.target.value)} />
            </div>
            <div>
              <Label>Driver phone</Label>
              <Input value={driverPhone} onChange={(e) => setDriverPhone(e.target.value)} />
            </div>
          </div>

          <div className="rounded-md border border-warning/40 bg-warning/5 p-3 space-y-2">
            <div className="text-sm font-medium">Transporter indemnity</div>
            <p className="text-xs text-muted-foreground">
              The transporter accepts custody of the unit in the condition inspected above and assumes liability
              for any in-transit damage until delivered at the agreed destination.
            </p>
            <div>
              <Label>Signed by (name) *</Label>
              <Input value={signer} onChange={(e) => setSigner(e.target.value)} placeholder="Driver / transporter representative" />
            </div>
          </div>

          <div>
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => submit.mutate()}
            disabled={submit.isPending || !allChecked || !truck || !driver || !signer}
          >
            {submit.isPending ? "Recording…" : "Confirm gate-out"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
