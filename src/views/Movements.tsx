import { getOrgCurrency } from "@/lib/app-settings";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { format } from "date-fns";
import { useEffect } from "react";
import type { Database } from "@/integrations/supabase/types";

type MovementType = Database["public"]["Enums"]["movement_type"];

export default function Movements() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const { data: movements, isLoading } = useQuery({
    queryKey: ["movements"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("container_movements")
        .select("*, containers(container_number), invoices:invoices!invoices_source_movement_id_fkey(id, invoice_number, status, total_amount, currency)")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  const { data: containers } = useQuery({
    queryKey: ["containers-list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("containers").select("id, container_number, shipping_line, owner").order("container_number");
      if (error) throw error;
      return data;
    },
  });

  const { data: blocks } = useQuery({
    queryKey: ["blocks-list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("yard_blocks").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });

  const createMovement = useMutation({
    mutationFn: async (form: { container_id: string; movement_type: MovementType; to_block_id?: string; to_bay?: number; to_row?: number; to_tier?: number; notes?: string; charge_fee?: boolean; fee_amount?: number; fee_currency?: string; customer_name?: string }) => {
      const { data: movRow, error } = await supabase.from("container_movements").insert({
        container_id: form.container_id,
        movement_type: form.movement_type,
        to_block_id: form.to_block_id,
        to_bay: form.to_bay,
        to_row: form.to_row,
        to_tier: form.to_tier,
        notes: form.notes,
        performed_by: user?.id,
      }).select("id").single();
      if (error) throw error;

      // Update container location if gate_in or reposition
      if (form.movement_type === "gate_in" || form.movement_type === "reposition" || form.movement_type === "stack") {
        const update: any = {};
        if (form.to_block_id) update.block_id = form.to_block_id;
        if (form.to_bay) update.bay = form.to_bay;
        if (form.to_row) update.row = form.to_row;
        if (form.to_tier) update.tier = form.to_tier;
        if (form.movement_type === "gate_in") update.gate_in_at = new Date().toISOString();
        await supabase.from("containers").update(update).eq("id", form.container_id);
      }
      if (form.movement_type === "gate_out") {
        await supabase.from("containers").update({ block_id: null, bay: null, row: null, tier: null, gate_out_at: new Date().toISOString() }).eq("id", form.container_id);
      }

      // Optional gate-in fee billing
      if (form.movement_type === "gate_in" && form.charge_fee && form.fee_amount && form.fee_amount > 0 && form.customer_name) {
        const { error: billErr } = await supabase.rpc("bill_gate_in" as any, {
          _container_id: form.container_id,
          _customer_name: form.customer_name,
          _amount: form.fee_amount,
          _currency: form.fee_currency || getOrgCurrency(),
          _source_movement_id: movRow?.id,
        });
        if (billErr) throw billErr;
        return { billed: true } as const;
      }
      return { billed: false } as const;
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["movements"] });
      queryClient.invalidateQueries({ queryKey: ["containers"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast({ title: res?.billed ? "Movement recorded & gate-in fee invoiced" : "Movement recorded" });
      setDialogOpen(false);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const [form, setForm] = useState<any>({ container_id: "", movement_type: "gate_in", to_block_id: "", to_bay: "", to_row: "", to_tier: "", notes: "", charge_fee: false, fee_amount: "", fee_currency: getOrgCurrency(), customer_name: "" });
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const selectedContainer = containers?.find((c: any) => c.id === form.container_id) as any;

  // Auto-prefill fee + customer when gate_in & container chosen
  useEffect(() => {
    if (form.movement_type !== "gate_in" || !form.container_id) return;
    const customer = selectedContainer?.shipping_line || selectedContainer?.owner || "";
    (async () => {
      const { data } = await supabase.rpc("lookup_gate_in_fee", { _container_id: form.container_id });
      const row: any = Array.isArray(data) ? data[0] : data;
      const amt = row?.amount ? Number(row.amount) : 0;
      const cur = row?.currency || getOrgCurrency();
      setForm((f: any) => ({
        ...f,
        fee_amount: amt > 0 ? String(amt) : "",
        fee_currency: cur,
        customer_name: f.customer_name || customer,
        charge_fee: amt > 0 && !!customer,
      }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.container_id, form.movement_type]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Movements</h1>
          <p className="text-muted-foreground">Container movement log</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="mr-1 h-4 w-4" />Record Movement</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Record Movement</DialogTitle></DialogHeader>
            <form onSubmit={(e) => {
              e.preventDefault();
              createMovement.mutate({
                container_id: form.container_id,
                movement_type: form.movement_type,
                to_block_id: form.to_block_id || undefined,
                to_bay: form.to_bay ? parseInt(form.to_bay) : undefined,
                to_row: form.to_row ? parseInt(form.to_row) : undefined,
                to_tier: form.to_tier ? parseInt(form.to_tier) : undefined,
                notes: form.notes || undefined,
                charge_fee: form.movement_type === "gate_in" && !!form.charge_fee,
                fee_amount: form.fee_amount ? parseFloat(form.fee_amount) : undefined,
                fee_currency: form.fee_currency,
                customer_name: form.customer_name?.trim() || undefined,
              });
            }} className="space-y-4">
              <div className="space-y-2">
                <Label>Container</Label>
                <Select value={form.container_id} onValueChange={(v) => set("container_id", v)}>
                  <SelectTrigger><SelectValue placeholder="Select container" /></SelectTrigger>
                  <SelectContent>
                    {containers?.map((c) => <SelectItem key={c.id} value={c.id}>{c.container_number}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={form.movement_type} onValueChange={(v) => set("movement_type", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gate_in">Gate In</SelectItem>
                    <SelectItem value="gate_out">Gate Out</SelectItem>
                    <SelectItem value="reposition">Reposition</SelectItem>
                    <SelectItem value="stack">Stack</SelectItem>
                    <SelectItem value="unstack">Unstack</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.movement_type !== "gate_out" && (
                <>
                  <div className="space-y-2">
                    <Label>Destination Block</Label>
                    <Select value={form.to_block_id} onValueChange={(v) => set("to_block_id", v)}>
                      <SelectTrigger><SelectValue placeholder="Select block" /></SelectTrigger>
                      <SelectContent>
                        {blocks?.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-2"><Label>Bay</Label><Input type="number" min={1} value={form.to_bay} onChange={(e) => set("to_bay", e.target.value)} /></div>
                    <div className="space-y-2"><Label>Row</Label><Input type="number" min={1} value={form.to_row} onChange={(e) => set("to_row", e.target.value)} /></div>
                    <div className="space-y-2"><Label>Tier</Label><Input type="number" min={1} value={form.to_tier} onChange={(e) => set("to_tier", e.target.value)} /></div>
                  </div>
                </>
              )}
              <div className="space-y-2"><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} /></div>
              {form.movement_type === "gate_in" && (
                <div className="space-y-3 rounded-md border p-3 bg-muted/30">
                  <div className="flex items-center gap-2">
                    <Checkbox id="charge_fee" checked={!!form.charge_fee} onCheckedChange={(v) => set("charge_fee", !!v)} />
                    <Label htmlFor="charge_fee" className="font-medium cursor-pointer">Charge gate-in fee</Label>
                  </div>
                  {form.charge_fee && (
                    <>
                      <div className="space-y-2">
                        <Label>Bill to (shipping line / owner)</Label>
                        <Input value={form.customer_name} onChange={(e) => set("customer_name", e.target.value)} placeholder="Customer name" required={form.charge_fee} />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label>Amount</Label>
                          <Input type="number" step="0.01" min="0" value={form.fee_amount} onChange={(e) => set("fee_amount", e.target.value)} required={form.charge_fee} />
                        </div>
                        <div className="space-y-2">
                          <Label>Currency</Label>
                          <Input value={form.fee_currency} onChange={(e) => set("fee_currency", e.target.value)} />
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">A draft invoice will be created on the customer.</p>
                    </>
                  )}
                </div>
              )}
              <Button type="submit" className="w-full" disabled={createMovement.isPending}>Record Movement</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Container</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Gate Fee</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableSkeleton columns={5} />
              ) : !movements?.length ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No movements recorded</TableCell></TableRow>
              ) : (
                movements.map((m: any) => {
                  const inv = Array.isArray(m.invoices) ? m.invoices[0] : m.invoices;
                  const tone =
                    !inv ? "bg-muted text-muted-foreground" :
                    inv.status === "paid" ? "bg-success/15 text-success border-success/30" :
                    inv.status === "sent" ? "bg-info/15 text-info border-info/30" :
                    inv.status === "draft" ? "bg-warning/15 text-warning border-warning/30" :
                    inv.status === "cancelled" || inv.status === "credited" ? "bg-destructive/15 text-destructive border-destructive/30" :
                    "bg-muted";
                  return (
                  <TableRow key={m.id}>
                    <TableCell className="font-mono">{m.containers?.container_number}</TableCell>
                    <TableCell className="capitalize">{m.movement_type.replace("_", " ")}</TableCell>
                    <TableCell className="text-muted-foreground">{format(new Date(m.created_at), "PPp")}</TableCell>
                    <TableCell>
                      {m.movement_type === "gate_in" ? (
                        inv ? (
                          <a href="/billing/invoices" className={`inline-flex px-2 py-0.5 rounded border text-xs capitalize ${tone}`} title={`${inv.invoice_number} — ${inv.currency} ${inv.total_amount}`}>
                            {inv.status === "sent" ? "Issued" : inv.status === "cancelled" ? "Voided" : inv.status === "credited" ? "Refunded" : inv.status}
                          </a>
                        ) : (
                          <span className="text-xs text-muted-foreground">Unbilled</span>
                        )
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm max-w-[200px] truncate">{m.notes ?? "—"}</TableCell>
                  </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
