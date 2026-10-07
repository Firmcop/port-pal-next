import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, ClipboardList, Hammer } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "@/lib/router";
import { format } from "date-fns";

const statusColor: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  confirmed: "bg-info/15 text-info",
  in_production: "bg-warning/15 text-warning",
  completed: "bg-success/15 text-success",
  cancelled: "bg-destructive/15 text-destructive",
};

const STATUSES = ["pending", "confirmed", "in_production", "completed", "cancelled"] as const;

export default function SalesOrders() {
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ customer_id: "", total_amount: "", notes: "" });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const { data: orders, isLoading } = useQuery({
    queryKey: ["sales-orders"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sales_orders").select("*, customers(company_name), quotes(quote_number)").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: customers } = useQuery({
    queryKey: ["customers-list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("id, company_name").eq("is_active", true).order("company_name");
      if (error) throw error;
      return data;
    },
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const num = `SO-${Date.now().toString(36).toUpperCase()}`;
      const { error } = await supabase.from("sales_orders").insert({
        order_number: num,
        customer_id: form.customer_id,
        total_amount: parseFloat(form.total_amount) || 0,
        notes: form.notes || null,
        created_by: user?.id,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sales-orders"] });
      toast({ title: "Sales order created" });
      setOpen(false);
      setForm({ customer_id: "", total_amount: "", notes: "" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("sales_orders").update({ status } as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sales-orders"] }); toast({ title: "Status updated" }); },
  });

  const createProductionOrder = useMutation({
    mutationFn: async (order: any) => {
      const { error } = await supabase.from("container_conversions").insert({

        customer_id: order.customer_id,
        sales_order_id: order.id,
        quoted_price: order.total_amount || 0,
        created_by: user?.id,
        description: `Production for SO ${order.order_number}`,
      } as any);
      if (error) throw error;
      // Update SO status
      await supabase.from("sales_orders").update({ status: "in_production" } as any).eq("id", order.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sales-orders"] });
      qc.invalidateQueries({ queryKey: ["conversions"] });
      toast({ title: "Production order created" });
      navigate("/conversions");
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><ClipboardList className="h-6 w-6" />Sales Orders</h1>
          <p className="text-muted-foreground">{orders?.length ?? 0} orders</p>
        </div>
        <Button onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" />New Order</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Quote</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : !orders?.length ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No sales orders yet</TableCell></TableRow>
              ) : orders.map((o: any) => (
                <TableRow key={o.id}>
                  <TableCell className="font-mono text-xs">{o.order_number}</TableCell>
                  <TableCell className="font-medium">{o.customers?.company_name ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground font-mono">{o.quotes?.quote_number ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono">{Number(o.total_amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                  <TableCell>
                    <Select value={o.status} onValueChange={(v) => updateStatus.mutate({ id: o.id, status: v })}>
                      <SelectTrigger className="h-7 w-36"><Badge className={statusColor[o.status] ?? ""} variant="secondary">{o.status?.replace("_", " ")}</Badge></SelectTrigger>
                      <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{format(new Date(o.created_at), "dd MMM yyyy")}</TableCell>
                  <TableCell>
                    {o.status === "confirmed" && (
                      <Button size="sm" variant="outline" onClick={() => createProductionOrder.mutate(o)}>
                        <Hammer className="mr-1 h-3 w-3" />Production
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Sales Order</DialogTitle></DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); createMut.mutate(); }} className="space-y-4">
            <div className="space-y-2">
              <Label>Customer *</Label>
              <Select value={form.customer_id} onValueChange={(v) => set("customer_id", v)}>
                <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                <SelectContent>{customers?.map((c) => <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Total Amount</Label><Input type="number" value={form.total_amount} onChange={(e) => set("total_amount", e.target.value)} /></div>
            <div className="space-y-2"><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} /></div>
            <Button type="submit" className="w-full" disabled={createMut.isPending || !form.customer_id}>Create Order</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
