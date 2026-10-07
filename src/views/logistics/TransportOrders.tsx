import { useState, useEffect } from "react";
import { getDefaultCurrency } from "@/lib/finance-format";
import { getFxRate } from "@/lib/fx";
import { useOrganization } from "@/hooks/use-organization";
import { CurrencySelect } from "@/components/CurrencySelect";
import { Link } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, Package, FileText, ArrowRight, DollarSign, Link2, ChevronDown, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AddTripCostDialog } from "@/components/logistics/AddTripCostDialog";
import { InvoiceStatusBadge } from "@/components/logistics/InvoiceStatusBadge";

const STATUS_TONE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "secondary", confirmed: "outline", assigned: "outline",
  in_transit: "default", delivered: "default", invoiced: "default", cancelled: "destructive",
};

const empty = {
  customer_id: "", customer_name: "", order_type: "custom",
  service_date: new Date().toISOString().slice(0, 10),
  pickup_location: "", dropoff_location: "", route_id: "",
  cargo_description: "", qty: 1, quoted_price: 0, currency: getDefaultCurrency(),
  fx_rate: 1,
  container_owner_customer_id: "", container_owner_charge: 0,
  container_owner_currency: getDefaultCurrency(), container_owner_fx_rate: 1,
  container_owner_notes: "",
  billing_mode: "per_trip", special_instructions: "",
};

export default function TransportOrders() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { organizationId } = useOrganization();
  const orgCurrency = getDefaultCurrency();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(empty);
  const [costTripId, setCostTripId] = useState<string | null>(null);
  const [assignFor, setAssignFor] = useState<any>(null); // order being assigned to a trip
  const [pickedTripId, setPickedTripId] = useState<string>("");
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  // Auto-fill FX rates when currency changes
  const refreshFx = async (currency: string, key: "fx_rate" | "container_owner_fx_rate") => {
    if (!organizationId || !currency) return;
    try {
      const r = await getFxRate(organizationId, currency, orgCurrency, form.service_date);
      set(key, r);
    } catch { /* leave user to type */ }
  };
  useEffect(() => { if (form.currency) refreshFx(form.currency, "fx_rate"); /* eslint-disable-next-line */ }, [form.currency, form.service_date, organizationId]);
  useEffect(() => { if (form.container_owner_currency && form.container_owner_customer_id) refreshFx(form.container_owner_currency, "container_owner_fx_rate"); /* eslint-disable-next-line */ }, [form.container_owner_currency, form.container_owner_customer_id, form.service_date, organizationId]);


  const { data: orders } = useQuery({
    queryKey: ["logistics-orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("logistics_transport_orders")
        .select("*, customers:customers!logistics_transport_orders_customer_id_fkey(company_name), container_owner:customers!logistics_transport_orders_container_owner_customer_id_fkey(company_name), logistics_trip_legs(trip_id, logistics_trips(id, ref, trip_date, status)), deposit_invoice:invoices!logistics_transport_orders_deposit_invoice_id_fkey(id, status, total_amount, partially_paid), balance_invoice:invoices!logistics_transport_orders_balance_invoice_id_fkey(id, status, total_amount, partially_paid), owner_invoice:invoices!logistics_transport_orders_container_owner_invoice_id_fkey(id, status, total_amount, partially_paid, currency)")
        .order("service_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: customers } = useQuery({
    queryKey: ["customers-pick"],
    queryFn: async () => (await supabase.from("customers").select("id,company_name,logistics_billing_mode").order("company_name")).data ?? [],
  });

  const { data: routes } = useQuery({
    queryKey: ["logistics-routes-pick"],
    queryFn: async () => (await supabase.from("logistics_routes").select("id,code,name,origin,destination,default_rate,currency").eq("is_active", true).order("name")).data ?? [],
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!form.customer_id && !form.container_owner_customer_id) {
        throw new Error("Assign at least a cargo customer or a container owner.");
      }
      const { data: refData } = await supabase.rpc("logistics_next_ref" as any, { _prefix: "TO" });
      const payload: any = { ...form, ref: refData };
      // Strip empty strings → null
      Object.keys(payload).forEach((k) => { if (payload[k] === "") payload[k] = null; });
      payload.qty = Number(payload.qty || 1);
      payload.quoted_price = Number(payload.quoted_price || 0);
      payload.fx_rate = Number(payload.fx_rate || 1);
      payload.container_owner_charge = Number(payload.container_owner_charge || 0);
      payload.container_owner_fx_rate = Number(payload.container_owner_fx_rate || 1);
      if (!payload.container_owner_customer_id) {
        payload.container_owner_charge = 0;
        payload.container_owner_currency = null;
        payload.container_owner_fx_rate = null;
      }
      const { error } = await supabase.from("logistics_transport_orders").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["logistics-orders"] });
      setOpen(false); setForm(empty);
      toast({ title: "Transport order created" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: any }) => {
      const { error } = await supabase.from("logistics_transport_orders").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["logistics-orders"] }),
  });

  const issuePart = useMutation({
    mutationFn: async ({ id, part }: { id: string; part: "deposit" | "balance" }) => {
      if (part === "deposit") {
        const { error } = await supabase.rpc("logistics_propose_deposit" as any, { _order_id: id });
        if (error) throw error;
      } else {
        const { error } = await supabase.rpc("logistics_invoice_order_part" as any, { _order_id: id, _part: part });
        if (error) throw error;
      }
      return part;
    },
    onSuccess: (part) => {
      qc.invalidateQueries({ queryKey: ["logistics-orders"] });
      toast({ title: part === "deposit" ? "Deposit proposed — awaiting customer approval" : "Balance invoice issued" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const invoiceOwner = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("logistics_invoice_container_owner" as any, { _order_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["logistics-orders"] });
      toast({ title: "Container owner invoice issued" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const onPickRoute = (rid: string) => {
    set("route_id", rid);
    const r = (routes ?? []).find((x: any) => x.id === rid);
    if (r) {
      if (!form.pickup_location) set("pickup_location", r.origin);
      if (!form.dropoff_location) set("dropoff_location", r.destination);
      if (!form.quoted_price) set("quoted_price", r.default_rate);
      if (r.currency) set("currency", r.currency);
    }
  };

  const onPickCustomer = (cid: string) => {
    set("customer_id", cid);
    const c = (customers ?? []).find((x: any) => x.id === cid);
    if (c) {
      set("customer_name", c.company_name);
      if (c.logistics_billing_mode) set("billing_mode", c.logistics_billing_mode);
    }
  };

  const { data: tripsForAssign } = useQuery({
    queryKey: ["trips-for-assign", assignFor?.service_date, assignFor?.route_id],
    enabled: !!assignFor,
    queryFn: async () => {
      let q = supabase.from("logistics_trips").select("id, ref, trip_date, status, route_id").order("trip_date", { ascending: false }).limit(50);
      if (assignFor?.route_id) q = q.eq("route_id", assignFor.route_id);
      return (await q).data ?? [];
    },
  });

  const assignTrip = useMutation({
    mutationFn: async ({ orderId, tripId }: { orderId: string; tripId: string }) => {
      const order = (orders ?? []).find((x: any) => x.id === orderId);
      const { error } = await supabase.from("logistics_trip_legs").insert({
        trip_id: tripId,
        transport_order_id: orderId,
        sequence: 1,
        pickup_location: order?.pickup_location,
        dropoff_location: order?.dropoff_location,
      });
      if (error) throw error;
      // bump order status to assigned if still draft/confirmed
      if (order && (order.status === "draft" || order.status === "confirmed")) {
        await supabase.from("logistics_transport_orders").update({ status: "assigned" }).eq("id", orderId);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["logistics-orders"] });
      setAssignFor(null); setPickedTripId("");
      toast({ title: "Order assigned to trip" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Package className="h-6 w-6" />Transport Orders</h1>
          <p className="text-muted-foreground">{orders?.length ?? 0} orders</p>
        </div>
        <Button onClick={() => { setForm(empty); setOpen(true); }}><Plus className="mr-1 h-4 w-4" />New Order</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Ref</TableHead><TableHead>Date</TableHead><TableHead>Customer</TableHead>
              <TableHead>Route</TableHead><TableHead>Type</TableHead>
              <TableHead className="text-right">Price</TableHead><TableHead>Billing</TableHead>
              <TableHead>Status</TableHead><TableHead>Deposit</TableHead><TableHead>Balance</TableHead><TableHead className="w-64" />
            </TableRow></TableHeader>
            <TableBody>
              {(orders ?? []).map((o: any) => (
                <TableRow key={o.id}>
                  <TableCell className="font-mono text-xs">
                    <Link to={`/logistics/orders/${o.id}`} className="underline hover:text-primary">{o.ref}</Link>
                  </TableCell>
                  <TableCell>{o.service_date}</TableCell>
                  <TableCell>
                    {o.customers?.company_name || o.customer_name || (o.container_owner?.company_name ? <span className="text-muted-foreground italic">Owner-only</span> : "—")}
                    {o.container_owner?.company_name && (
                      <div className="text-[10px] text-muted-foreground">
                        Owner: {o.container_owner.company_name}
                        {Number(o.container_owner_charge) > 0 && ` · ${Number(o.container_owner_charge).toLocaleString()} ${o.container_owner_currency || o.currency}`}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">{o.pickup_location} <ArrowRight className="inline h-3 w-3" /> {o.dropoff_location}</TableCell>
                  <TableCell><Badge variant="outline">{o.order_type}</Badge></TableCell>
                  <TableCell className="text-right">{Number(o.quoted_price).toLocaleString()} {o.currency}</TableCell>
                  <TableCell className="text-xs">{o.billing_mode}</TableCell>
                  <TableCell><Badge variant={STATUS_TONE[o.status] ?? "secondary"}>{o.status}</Badge></TableCell>
                  <TableCell><InvoiceStatusBadge invoice={o.deposit_invoice} kind="deposit" depositStatus={o.deposit_status} /></TableCell>
                  <TableCell><InvoiceStatusBadge invoice={o.balance_invoice} kind="balance" /></TableCell>
                  <TableCell className="space-x-1">
                    {(() => {
                      const legs = (o.logistics_trip_legs ?? []).filter((l: any) => l.logistics_trips);
                      if (legs.length === 1) {
                        const t = legs[0].logistics_trips;
                        return (
                          <>
                            <Button size="sm" variant="outline" onClick={() => setCostTripId(t.id)}>
                              <DollarSign className="h-3 w-3 mr-1" />Add cost
                            </Button>
                            <Button size="sm" variant="ghost" asChild>
                              <Link to={`/logistics/trips/${t.id}`}>{t.ref}</Link>
                            </Button>
                          </>
                        );
                      }
                      if (legs.length > 1) {
                        return (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="sm" variant="outline"><DollarSign className="h-3 w-3 mr-1" />Add cost <ChevronDown className="h-3 w-3 ml-1" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                              {legs.map((l: any) => (
                                <DropdownMenuItem key={l.trip_id} onClick={() => setCostTripId(l.logistics_trips.id)}>
                                  {l.logistics_trips.ref} • {l.logistics_trips.trip_date}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        );
                      }
                      return (
                        <Button size="sm" variant="outline" onClick={() => setAssignFor(o)}>
                          <Link2 className="h-3 w-3 mr-1" />Assign trip
                        </Button>
                      );
                    })()}
                    {o.status === "draft" && <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: o.id, status: "confirmed" })}>Confirm</Button>}
                    {(() => {
                      const canDep = !o.deposit_invoice_id && Number(o.deposit_pct ?? 0) > 0
                        && o.deposit_status !== "pending_approval"
                        && ["confirmed","assigned","in_transit","delivered"].includes(o.status);
                      const canBal = !o.balance_invoice_id && o.status === "delivered";
                      if (!canDep && !canBal) return null;
                      return (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm"><FileText className="h-3 w-3 mr-1" />Invoice <ChevronDown className="h-3 w-3 ml-1" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            {canDep && (
                              <DropdownMenuItem onClick={() => issuePart.mutate({ id: o.id, part: "deposit" })}>
                                Propose deposit ({o.deposit_pct}%)
                              </DropdownMenuItem>
                            )}
                            {canBal && (
                              <DropdownMenuItem onClick={() => issuePart.mutate({ id: o.id, part: "balance" })}>
                                Issue balance
                              </DropdownMenuItem>
                            )}
                            {o.container_owner_customer_id && !o.container_owner_invoice_id && Number(o.container_owner_charge) > 0 && (
                              <DropdownMenuItem onClick={() => invoiceOwner.mutate(o.id)}>
                                Invoice container owner
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      );
                    })()}
                  </TableCell>
                </TableRow>
              ))}
              {(orders ?? []).length === 0 && (
                <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground">No transport orders yet</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>New Transport Order</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <Label>Customer</Label>
              <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.customer_id} onChange={(e) => onPickCustomer(e.target.value)}>
                <option value="">— select —</option>
                {(customers ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
              </select>
            </div>
            <div>
              <Label>Type</Label>
              <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.order_type} onChange={(e) => set("order_type", e.target.value)}>
                <option value="custom">Custom</option>
                <option value="shuttle">Shuttle</option>
              </select>
            </div>
            <div>
              <Label>Service date</Label>
              <Input type="date" value={form.service_date} onChange={(e) => set("service_date", e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <Label>Route (optional preset)</Label>
              <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.route_id} onChange={(e) => onPickRoute(e.target.value)}>
                <option value="">—</option>
                {(routes ?? []).map((r: any) => <option key={r.id} value={r.id}>{r.code} — {r.name}</option>)}
              </select>
            </div>
            <div>
              <Label>Pickup</Label>
              <Input value={form.pickup_location} onChange={(e) => set("pickup_location", e.target.value)} />
            </div>
            <div>
              <Label>Dropoff</Label>
              <Input value={form.dropoff_location} onChange={(e) => set("dropoff_location", e.target.value)} />
            </div>
            <div>
              <Label>Cargo description</Label>
              <Input value={form.cargo_description} onChange={(e) => set("cargo_description", e.target.value)} />
            </div>
            <div>
              <Label>Qty</Label>
              <Input type="number" value={form.qty} onChange={(e) => set("qty", e.target.value)} />
            </div>
            <div>
              <Label>Quoted price (cargo customer)</Label>
              <Input type="number" value={form.quoted_price} onChange={(e) => set("quoted_price", e.target.value)} />
            </div>
            <div>
              <Label>Currency</Label>
              <CurrencySelect value={form.currency} onChange={(v) => set("currency", v)} />
            </div>
            <div>
              <Label>FX rate → {orgCurrency}</Label>
              <div className="flex gap-1">
                <Input type="number" step="0.0001" value={form.fx_rate} onChange={(e) => set("fx_rate", e.target.value)} />
                <Button type="button" size="icon" variant="outline" onClick={() => refreshFx(form.currency, "fx_rate")} title="Refresh from FX table">
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div>
              <Label>Billing mode</Label>
              <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.billing_mode} onChange={(e) => set("billing_mode", e.target.value)}>
                <option value="per_trip">Per trip</option>
                <option value="periodic">Periodic (batch)</option>
              </select>
            </div>

            <div className="sm:col-span-2 border-t pt-4">
              <div className="text-sm font-semibold">Container owner (optional)</div>
              <p className="text-xs text-muted-foreground mb-2">
                Use when the container belongs to a third party (e.g. shipping line repositioning/repatriation) and cargo is delivered en route. The owner is billed separately for the container leg.
              </p>
            </div>
            <div className="sm:col-span-2">
              <Label>Container owner</Label>
              <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.container_owner_customer_id} onChange={(e) => set("container_owner_customer_id", e.target.value)}>
                <option value="">— none —</option>
                {(customers ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
              </select>
            </div>
            <div>
              <Label>Owner charge</Label>
              <Input type="number" value={form.container_owner_charge} disabled={!form.container_owner_customer_id} onChange={(e) => set("container_owner_charge", e.target.value)} />
            </div>
            <div>
              <Label>Owner currency</Label>
              <CurrencySelect value={form.container_owner_currency} onChange={(v) => set("container_owner_currency", v)} />
            </div>
            <div>
              <Label>Owner FX → {orgCurrency}</Label>
              <div className="flex gap-1">
                <Input type="number" step="0.0001" value={form.container_owner_fx_rate} disabled={!form.container_owner_customer_id} onChange={(e) => set("container_owner_fx_rate", e.target.value)} />
                <Button type="button" size="icon" variant="outline" disabled={!form.container_owner_customer_id} onClick={() => refreshFx(form.container_owner_currency, "container_owner_fx_rate")}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="sm:col-span-2">
              <Label>Owner notes</Label>
              <Input value={form.container_owner_notes} disabled={!form.container_owner_customer_id} onChange={(e) => set("container_owner_notes", e.target.value)} />
            </div>

            <div className="sm:col-span-2">
              <Label>Special instructions</Label>
              <Textarea value={form.special_instructions} onChange={(e) => set("special_instructions", e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => create.mutate()} disabled={create.isPending}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AddTripCostDialog
        tripId={costTripId}
        open={!!costTripId}
        onOpenChange={(o) => !o && setCostTripId(null)}
      />

      <Dialog open={!!assignFor} onOpenChange={(o) => { if (!o) { setAssignFor(null); setPickedTripId(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Assign order to a trip</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Order <span className="font-mono">{assignFor?.ref}</span> · {assignFor?.service_date}
            </p>
            <div>
              <Label>Pick a trip {assignFor?.route_id ? "(filtered by route)" : ""}</Label>
              <select
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={pickedTripId}
                onChange={(e) => setPickedTripId(e.target.value)}
              >
                <option value="">— select a trip —</option>
                {(tripsForAssign ?? []).map((t: any) => (
                  <option key={t.id} value={t.id}>{t.ref} · {t.trip_date} · {t.status}</option>
                ))}
              </select>
            </div>
            <p className="text-xs text-muted-foreground">
              Need a new trip? Go to <Link to="/logistics/trips" className="underline">Trips</Link> to create one, then return here.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAssignFor(null); setPickedTripId(""); }}>Cancel</Button>
            <Button
              disabled={!pickedTripId || assignTrip.isPending}
              onClick={() => assignTrip.mutate({ orderId: assignFor.id, tripId: pickedTripId })}
            >
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
