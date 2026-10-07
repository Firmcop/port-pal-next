import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PlayCircle, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function LogisticsBillingRun() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);
  const [from, setFrom] = useState(firstDay);
  const [to, setTo] = useState(lastDay);

  const { data: pending } = useQuery({
    queryKey: ["logistics-billing-pending", from, to],
    queryFn: async () => {
      const { data } = await supabase
        .from("logistics_transport_orders")
        .select("id, ref, customer_id, customer_name, quoted_price, currency, service_date, billing_mode, customers:customers!logistics_transport_orders_customer_id_fkey(company_name, logistics_billing_mode)")
        .eq("status", "delivered")
        .is("invoice_id", null)
        .gte("service_date", from)
        .lte("service_date", to);
      return data ?? [];
    },
  });

  // Group by (customer, currency) for periodic billing — never merge KES + USD
  const periodic = (pending ?? []).filter((o: any) =>
    o.billing_mode === "periodic" || o.customers?.logistics_billing_mode === "periodic"
  );
  const groups = new Map<string, { key: string; customer_id: string; name: string; orders: any[]; total: number; currency: string }>();
  for (const o of periodic) {
    if (!o.customer_id) continue;
    const curr = (o.currency || "USD").toUpperCase();
    const key = `${o.customer_id}::${curr}`;
    const g = groups.get(key) ?? { key, customer_id: o.customer_id, name: o.customers?.company_name ?? o.customer_name, orders: [], total: 0, currency: curr };
    g.orders.push(o);
    g.total += Number(o.quoted_price);
    groups.set(key, g);
  }

  const runBatch = useMutation({
    mutationFn: async ({ customer_id, currency }: { customer_id: string; currency: string }) => {
      const { error } = await supabase.rpc("logistics_run_batch_billing" as any, { _customer_id: customer_id, _from: from, _to: to, _currency: currency });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["logistics-billing-pending"] }); toast({ title: "Batch invoice created" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><PlayCircle className="h-6 w-6" />Logistics Billing Run</h1>
        <p className="text-muted-foreground">Aggregate delivered orders for periodic-billing customers into batch invoices</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Period</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-md">
          <div><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Customers ready to bill ({groups.size})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Customer</TableHead><TableHead>Currency</TableHead><TableHead className="text-right">Orders</TableHead>
              <TableHead className="text-right">Total</TableHead><TableHead className="w-32" />
            </TableRow></TableHeader>
            <TableBody>
              {Array.from(groups.values()).map((g) => (
                <TableRow key={g.key}>
                  <TableCell>{g.name}</TableCell>
                  <TableCell><span className="font-mono text-xs">{g.currency}</span></TableCell>
                  <TableCell className="text-right">{g.orders.length}</TableCell>
                  <TableCell className="text-right">{g.total.toLocaleString()} {g.currency}</TableCell>
                  <TableCell>
                    <Button size="sm" onClick={() => runBatch.mutate({ customer_id: g.customer_id, currency: g.currency })} disabled={runBatch.isPending}>
                      <FileText className="h-3 w-3 mr-1" />Invoice
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {groups.size === 0 && (
                <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No periodic customers with delivered uninvoiced orders in this period</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
