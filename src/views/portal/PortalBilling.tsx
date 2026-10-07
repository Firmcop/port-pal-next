import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePortalAuth } from "@/hooks/use-portal-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, XCircle, ArrowRight } from "lucide-react";
import { format } from "date-fns";
import { Money, MoneyTotals } from "@/components/Money";
import { formatMoney } from "@/lib/app-settings";

const invoiceStatusColors: Record<string, string> = {
  draft: "bg-gray-500/15 text-gray-700",
  sent: "bg-info/15 text-info",
  issued: "bg-info/15 text-info",
  paid: "bg-success/15 text-success",
  overdue: "bg-destructive/15 text-destructive",
  cancelled: "bg-gray-500/15 text-gray-700",
};

export default function PortalBilling() {
  const { customerId } = usePortalAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [disputeOrder, setDisputeOrder] = useState<any>(null);
  const [reason, setReason] = useState("");

  const { data: pendingDeposits, isLoading: loadingPending } = useQuery({
    queryKey: ["portal-pending-deposits", customerId],
    enabled: !!customerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("logistics_transport_orders")
        .select("id, ref, service_date, pickup_location, dropoff_location, quoted_price, currency, deposit_pct, deposit_proposed_at, deposit_invoice_id, deposit_invoice:invoices!logistics_transport_orders_deposit_invoice_id_fkey(id, invoice_number, total_amount)")
        .eq("customer_id", customerId!)
        .eq("deposit_status", "pending_approval")
        .order("deposit_proposed_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: invoices, isLoading: loadingInv } = useQuery({
    queryKey: ["portal-invoices", customerId],
    enabled: !!customerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  const { data: payments, isLoading: loadingPay } = useQuery({
    queryKey: ["portal-payments", customerId],
    enabled: !!customerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("*, invoices(invoice_number)")
        .order("paid_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  const confirmDeposit = useMutation({
    mutationFn: async (orderId: string) => {
      const { error } = await supabase.rpc("logistics_customer_confirm_deposit" as any, { _order_id: orderId });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-pending-deposits"] });
      qc.invalidateQueries({ queryKey: ["portal-invoices"] });
      toast({ title: "Deposit confirmed", description: "The invoice is now active." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const disputeDeposit = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await supabase.rpc("logistics_customer_dispute_deposit" as any, { _order_id: id, _reason: reason });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-pending-deposits"] });
      setDisputeOrder(null); setReason("");
      toast({ title: "Dispute sent", description: "The carrier has been notified." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const outstandingRows = (invoices ?? [])
    .filter((i: any) => (i.status === "sent" || i.status === "issued" || i.status === "overdue") && !i.partially_paid)
    .map((i: any) => ({ amount: Number(i.total_amount), currency: i.currency }));

  const pendingCount = pendingDeposits?.length ?? 0;
  const defaultTab = pendingCount > 0 ? "pending" : "invoices";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Billing & Payments</h1>
        <p className="text-muted-foreground">Outstanding balance: <MoneyTotals className="font-semibold text-foreground" rows={outstandingRows} /></p>
      </div>

      <Tabs defaultValue={defaultTab}>
        <TabsList>
          <TabsTrigger value="pending">
            Pending approvals
            {pendingCount > 0 && <Badge className="ml-2 bg-amber-500/20 text-amber-700 dark:text-amber-300 border-transparent">{pendingCount}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Deposit proposals awaiting your confirmation</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Route</TableHead>
                    <TableHead className="text-right">Quoted</TableHead>
                    <TableHead className="text-right">Deposit</TableHead>
                    <TableHead>Proposed</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingPending ? (
                    <TableSkeleton columns={6} />
                  ) : pendingCount === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-sm">
                      Nothing waiting on you right now.
                    </TableCell></TableRow>
                  ) : pendingDeposits!.map((o: any) => {
                    const depAmt = Number(o.deposit_invoice?.total_amount ?? (Number(o.quoted_price) * Number(o.deposit_pct) / 100));
                    return (
                      <TableRow key={o.id}>
                        <TableCell className="font-mono text-xs">{o.ref}<div className="text-[10px] text-muted-foreground">{o.service_date}</div></TableCell>
                        <TableCell className="text-xs">{o.pickup_location} <ArrowRight className="inline h-3 w-3" /> {o.dropoff_location}</TableCell>
                        <TableCell className="text-right">{formatMoney(o.quoted_price, o.currency)}</TableCell>
                        <TableCell className="text-right font-medium">
                          {formatMoney(depAmt, o.currency)}
                          <div className="text-[10px] text-muted-foreground">{o.deposit_pct}%</div>
                        </TableCell>
                        <TableCell className="text-xs">{o.deposit_proposed_at ? format(new Date(o.deposit_proposed_at), "dd MMM yyyy") : "—"}</TableCell>
                        <TableCell className="text-right space-x-1">
                          <Button size="sm" variant="outline" onClick={() => { setDisputeOrder(o); setReason(""); }}>
                            <XCircle className="h-3 w-3 mr-1" />Dispute
                          </Button>
                          <Button size="sm" disabled={confirmDeposit.isPending} onClick={() => confirmDeposit.mutate(o.id)}>
                            <CheckCircle2 className="h-3 w-3 mr-1" />Confirm
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="invoices">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Issued</TableHead>
                    <TableHead>Due</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingInv ? (
                    <TableSkeleton columns={6} />
                  ) : !invoices?.length ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No invoices</TableCell></TableRow>
                  ) : invoices.map((inv: any) => {
                    const label = inv.status === "paid"
                      ? "Paid"
                      : inv.partially_paid ? "Partially collected" : (inv.status ?? "—");
                    const cls = inv.status === "paid"
                      ? "bg-success/15 text-success"
                      : inv.partially_paid
                        ? "bg-blue-500/15 text-blue-700 dark:text-blue-300"
                        : (invoiceStatusColors[inv.status] ?? "");
                    return (
                      <TableRow key={inv.id}>
                        <TableCell className="font-mono font-medium text-sm">{inv.invoice_number}</TableCell>
                        <TableCell className="capitalize text-sm">{inv.invoice_type?.replace("_", " ")}</TableCell>
                        <TableCell className="font-medium"><Money amount={inv.total_amount} currency={inv.currency} /></TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cls}>{label}</Badge>
                        </TableCell>
                        <TableCell className="text-sm">{inv.issued_at ? format(new Date(inv.issued_at), "dd MMM yyyy") : "—"}</TableCell>
                        <TableCell className="text-sm">{inv.due_at ? format(new Date(inv.due_at), "dd MMM yyyy") : "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payments">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Payment #</TableHead>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingPay ? (
                    <TableSkeleton columns={5} />
                  ) : !payments?.length ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No payments</TableCell></TableRow>
                  ) : payments.map((p: any) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono font-medium text-sm">{p.payment_number}</TableCell>
                      <TableCell className="font-mono text-sm">{(p as any).invoices?.invoice_number ?? "—"}</TableCell>
                      <TableCell className="font-medium"><Money amount={p.amount} currency={(p as any).currency} /></TableCell>
                      <TableCell className="capitalize text-sm">{p.payment_method?.replace("_", " ")}</TableCell>
                      <TableCell className="text-sm">{format(new Date(p.paid_at), "dd MMM yyyy")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!disputeOrder} onOpenChange={(o) => { if (!o) { setDisputeOrder(null); setReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dispute deposit on {disputeOrder?.ref}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Let the carrier know what's wrong with this deposit. They can adjust the percentage and re-propose.
            </p>
            <Textarea
              placeholder="e.g. We agreed on 30%, not 50%"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisputeOrder(null)}>Close</Button>
            <Button
              variant="destructive"
              disabled={!reason.trim() || disputeDeposit.isPending}
              onClick={() => disputeDeposit.mutate({ id: disputeOrder.id, reason: reason.trim() })}
            >
              Send dispute
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
