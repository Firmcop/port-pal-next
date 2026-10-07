import { useEffect, useState } from "react";
import { getDefaultCurrency } from "@/lib/finance-format";
import { Link, useParams } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, ArrowRight, AlertTriangle, CheckCircle2, Clock, DollarSign, FileText, Link2, Package, Receipt, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AddTripCostDialog } from "@/components/logistics/AddTripCostDialog";
import { formatCurrency, formatDate } from "@/lib/format";
import { InvoiceStatusBadge } from "@/components/logistics/InvoiceStatusBadge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFinancialAccounts } from "@/hooks/use-financial-accounts";

const STATUS_TONE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "secondary", confirmed: "outline", assigned: "outline",
  in_transit: "default", delivered: "default", invoiced: "default", cancelled: "destructive",
};

export default function TransportOrderDetail() {
  const { id = "" } = useParams();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [costTripId, setCostTripId] = useState<string | null>(null);
  const [depositPctDraft, setDepositPctDraft] = useState<string>("");
  const [depositAmtDraft, setDepositAmtDraft] = useState<string>("");
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [payForm, setPayForm] = useState({ amount: "", method: "bank_transfer", financial_account_id: "", reference: "", paid_at: new Date().toISOString().slice(0, 10), notes: "" });
  const [reverseFor, setReverseFor] = useState<any>(null);
  const [reverseReason, setReverseReason] = useState("");
  const { data: financialAccounts } = useFinancialAccounts();

  const { data: order, isLoading } = useQuery({
    queryKey: ["logistics-order", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("logistics_transport_orders")
        .select("*, customers:customers!logistics_transport_orders_customer_id_fkey(company_name), container_owner:customers!logistics_transport_orders_container_owner_customer_id_fkey(company_name), logistics_trip_legs(trip_id, logistics_trips(id, ref, trip_date, status)), deposit_invoice:invoices!logistics_transport_orders_deposit_invoice_id_fkey(id, invoice_number, status, total_amount, partially_paid), balance_invoice:invoices!logistics_transport_orders_balance_invoice_id_fkey(id, invoice_number, status, total_amount, partially_paid), owner_invoice:invoices!logistics_transport_orders_container_owner_invoice_id_fkey(id, invoice_number, status, total_amount, partially_paid, currency)")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const legs = (order?.logistics_trip_legs ?? []).filter((l: any) => l.logistics_trips);
  const tripIds: string[] = legs.map((l: any) => l.logistics_trips.id);
  const currency = order?.currency || getDefaultCurrency();

  const { data: revenue } = useQuery({
    queryKey: ["logistics-order-revenue", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("logistics_trip_revenue")
        .select("id, amount, currency, created_at, trip_id, invoice_id, logistics_trips(ref), invoices(id, invoice_number, status, total_amount, partially_paid)")
        .eq("transport_order_id", id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const invoiceIds: string[] = [order?.deposit_invoice_id, order?.balance_invoice_id, order?.invoice_id].filter(Boolean) as string[];
  const { data: payments } = useQuery({
    queryKey: ["logistics-order-payments", id, invoiceIds.join(",")],
    enabled: invoiceIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("id, payment_number, invoice_id, amount, paid_at, payment_method, reference_number, currency, financial_account_id, reversed_at, reversal_reason, reversed_payment_id, notes, financial_accounts(name)")
        .in("invoice_id", invoiceIds)
        .order("paid_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: costs } = useQuery({
    queryKey: ["logistics-order-costs", id, tripIds.join(",")],
    enabled: tripIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("logistics_trip_costs")
        .select("id, trip_id, amount, currency, category, created_at, logistics_trips(ref)")
        .in("trip_id", tripIds);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Realtime: refresh when payments arrive or order/deposit_status flips (e.g. customer confirms from portal)
  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`order-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "logistics_transport_orders", filter: `id=eq.${id}` }, () => {
        qc.invalidateQueries({ queryKey: ["logistics-order", id] });
        qc.invalidateQueries({ queryKey: ["logistics-order-revenue", id] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "payments" }, (payload: any) => {
        const inv = (payload?.new ?? payload?.old)?.invoice_id;
        if (inv && invoiceIds.includes(inv)) {
          qc.invalidateQueries({ queryKey: ["logistics-order-payments", id] });
          qc.invalidateQueries({ queryKey: ["logistics-order", id] });
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id, invoiceIds.join(","), qc]);

  const updateStatus = useMutation({
    mutationFn: async (status: any) => {
      const { error } = await supabase.from("logistics_transport_orders").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["logistics-order", id] }),
  });

  const saveDepositPct = useMutation({
    mutationFn: async (pct: number) => {
      const { error } = await supabase.from("logistics_transport_orders").update({ deposit_pct: pct }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["logistics-order", id] });
      toast({ title: "Deposit % updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const proposeDeposit = useMutation<void, Error, number | undefined>({
    mutationFn: async (amount) => {
      const args: any = { _order_id: id };
      if (amount && amount > 0) args._amount = amount;
      const { error } = await supabase.rpc("logistics_propose_deposit" as any, args);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["logistics-order", id] });
      setDepositAmtDraft("");
      toast({ title: "Deposit proposal sent", description: "Awaiting customer approval." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const issueBalance = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("logistics_invoice_order_part" as any, { _order_id: id, _part: "balance" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["logistics-order", id] });
      qc.invalidateQueries({ queryKey: ["logistics-order-revenue", id] });
      toast({ title: "Balance invoice issued" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const invoiceOwner = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("logistics_invoice_container_owner" as any, { _order_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["logistics-order", id] });
      qc.invalidateQueries({ queryKey: ["logistics-order-revenue", id] });
      toast({ title: "Container owner invoice issued" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const cancelProposal = useMutation({
    mutationFn: async (reason: string) => {
      const { error } = await supabase.rpc("logistics_customer_dispute_deposit" as any, { _order_id: id, _reason: reason });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["logistics-order", id] });
      setDisputeOpen(false); setDisputeReason("");
      toast({ title: "Deposit proposal cancelled" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const confirmAndPay = useMutation({
    mutationFn: async () => {
      const amt = Number(payForm.amount);
      if (!amt || amt <= 0) throw new Error("Enter a valid amount");
      if (!payForm.financial_account_id) throw new Error("Select a financial account");
      const { error } = await supabase.rpc("logistics_staff_confirm_deposit_and_pay" as any, {
        _order_id: id,
        _amount: amt,
        _account_id: payForm.financial_account_id,
        _method: payForm.method,
        _reference: payForm.reference || null,
        _paid_at: new Date(payForm.paid_at).toISOString(),
        _notes: payForm.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["logistics-order", id] });
      qc.invalidateQueries({ queryKey: ["logistics-order-invoice-payments", id] });
      qc.invalidateQueries({ queryKey: ["logistics-order-revenue", id] });
      setPayOpen(false);
      toast({ title: "Deposit confirmed", description: "Payment recorded against the deposit invoice." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const reversePayment = useMutation({
    mutationFn: async () => {
      if (!reverseFor) throw new Error("No payment selected");
      if (!reverseReason.trim()) throw new Error("Reason is required");
      const { error } = await supabase.rpc("reverse_payment" as any, { _payment_id: reverseFor.id, _reason: reverseReason.trim() });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["logistics-order", id] });
      qc.invalidateQueries({ queryKey: ["logistics-order-payments", id] });
      qc.invalidateQueries({ queryKey: ["logistics-order-revenue", id] });
      setReverseFor(null); setReverseReason("");
      toast({ title: "Payment reversed", description: "An offsetting entry was recorded." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>;
  if (!order) return <div className="text-muted-foreground">Order not found. <Link className="underline" to="/logistics/orders">Back</Link></div>;

  // Per-invoice paid amount
  const paidByInvoice: Record<string, number> = {};
  (payments ?? []).forEach((p: any) => {
    paidByInvoice[p.invoice_id] = (paidByInvoice[p.invoice_id] ?? 0) + Number(p.amount || 0);
  });

  const totalRevenue = (revenue ?? []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
  const totalCosts = (costs ?? []).reduce((s: number, c: any) => s + Number(c.amount || 0), 0);
  const totalCollected = (payments ?? []).reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
  const quoted = Number(order.quoted_price || 0);
  const depositPct = Number(order.deposit_pct ?? 0);
  const depositInv: any = order.deposit_invoice;
  const balanceInv: any = order.balance_invoice;
  const depositAmount = Number(depositInv?.total_amount ?? 0);
  const balanceAmount = Number(balanceInv?.total_amount ?? 0);
  const proposedDepositAmount = depositInv ? depositAmount : Math.round(quoted * depositPct) / 100;
  const invoicedTotal = (order.deposit_status === "approved" ? depositAmount : 0) + balanceAmount;
  const outstanding = invoicedTotal - totalCollected;

  const depositLocked = order.deposit_status === "pending_approval" || order.deposit_status === "approved";
  const canPropose = !order.deposit_invoice_id && depositPct > 0
    && ["confirmed", "assigned", "in_transit", "delivered"].includes(order.status);
  const canRepropose = order.deposit_status === "disputed" && canPropose;
  const canIssueBalance = !order.balance_invoice_id && order.status === "delivered";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
            <Link to="/logistics/orders"><ArrowLeft className="h-4 w-4 mr-1" />Transport Orders</Link>
          </Button>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Package className="h-6 w-6" />
            <span className="font-mono">{order.ref}</span>
            <Badge variant={STATUS_TONE[order.status] ?? "secondary"}>{order.status}</Badge>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Service date: {order.service_date}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {order.status === "draft" && (
            <Button variant="outline" size="sm" onClick={() => updateStatus.mutate("confirmed")}>Confirm</Button>
          )}
          {["confirmed", "assigned"].includes(order.status) && (
            <Button variant="outline" size="sm" onClick={() => updateStatus.mutate("in_transit")}>Mark in transit</Button>
          )}
          {order.status === "in_transit" && (
            <Button variant="outline" size="sm" onClick={() => updateStatus.mutate("delivered")}>Mark delivered</Button>
          )}
          {canPropose && order.deposit_status !== "disputed" && (
            <Button size="sm" onClick={() => proposeDeposit.mutate(Number(depositAmtDraft) || undefined)} disabled={proposeDeposit.isPending}>
              <FileText className="h-4 w-4 mr-1" />Propose deposit ({depositAmtDraft ? formatCurrency(Number(depositAmtDraft), currency) : `${depositPct}%`})
            </Button>
          )}
          {canRepropose && (
            <Button size="sm" onClick={() => proposeDeposit.mutate(Number(depositAmtDraft) || undefined)} disabled={proposeDeposit.isPending}>
              <FileText className="h-4 w-4 mr-1" />Re-propose deposit ({depositAmtDraft ? formatCurrency(Number(depositAmtDraft), currency) : `${depositPct}%`})
            </Button>
          )}
          {canIssueBalance && (
            <Button size="sm" onClick={() => issueBalance.mutate()} disabled={issueBalance.isPending}>
              <FileText className="h-4 w-4 mr-1" />Issue balance
            </Button>
          )}
          {order.container_owner_customer_id && !order.container_owner_invoice_id && Number(order.container_owner_charge) > 0 && (
            <Button size="sm" variant="outline" onClick={() => invoiceOwner.mutate()} disabled={invoiceOwner.isPending}>
              <FileText className="h-4 w-4 mr-1" />Invoice container owner
            </Button>
          )}
          {legs.length === 1 && (
            <Button variant="outline" size="sm" onClick={() => setCostTripId(legs[0].logistics_trips.id)}>
              <DollarSign className="h-4 w-4 mr-1" />Add cost
            </Button>
          )}
        </div>
      </div>

      {order.deposit_status === "pending_approval" && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm flex items-start gap-2">
          <Clock className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="font-medium text-amber-700 dark:text-amber-300">
              Awaiting customer approval — deposit of {formatCurrency(depositAmount, currency)} ({depositPct}%)
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Proposed {order.deposit_proposed_at ? formatDate(order.deposit_proposed_at) : ""}. Revenue is not recognized until the customer confirms.
            </div>
          </div>
          <Button size="sm" onClick={() => { setPayForm((f) => ({ ...f, amount: depositAmount.toFixed(2) })); setPayOpen(true); }}>
            <CheckCircle2 className="h-4 w-4 mr-1" />Record as paid
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDisputeOpen(true)}>
            <XCircle className="h-4 w-4 mr-1" />Cancel proposal
          </Button>
        </div>
      )}

      {order.deposit_status === "disputed" && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="font-medium text-destructive">Deposit proposal disputed</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {order.deposit_dispute_reason || "No reason provided."} — adjust the deposit % below and re-propose.
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Summary</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div><div className="text-muted-foreground text-xs">Cargo customer</div>{(order as any).customers?.company_name || order.customer_name || <span className="text-muted-foreground italic">—</span>}</div>
            <div><div className="text-muted-foreground text-xs">Type</div><Badge variant="outline">{order.order_type}</Badge></div>
            <div className="col-span-2"><div className="text-muted-foreground text-xs">Route</div>{order.pickup_location} <ArrowRight className="inline h-3 w-3" /> {order.dropoff_location}</div>
            <div><div className="text-muted-foreground text-xs">Cargo</div>{order.cargo_description || "—"}</div>
            <div><div className="text-muted-foreground text-xs">Quantity</div>{order.qty}</div>
            <div><div className="text-muted-foreground text-xs">Quoted price</div>{formatCurrency(quoted, currency)} <span className="text-[10px] text-muted-foreground">@ FX {Number(order.fx_rate ?? 1)}</span></div>
            <div><div className="text-muted-foreground text-xs">Billing mode</div>{order.billing_mode}</div>
            <div>
              <div className="text-muted-foreground text-xs">Deposit %</div>
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  className="h-8 w-20"
                  value={depositPctDraft !== "" ? depositPctDraft : depositPct}
                  onChange={(e) => {
                    const v = e.target.value;
                    setDepositPctDraft(v);
                    const n = Number(v);
                    if (v !== "" && !Number.isNaN(n) && quoted > 0) {
                      setDepositAmtDraft((Math.round(quoted * n) / 100).toFixed(2));
                    }
                  }}
                  disabled={depositLocked}
                />
                <span className="text-xs text-muted-foreground">%</span>
                {depositPctDraft !== "" && Number(depositPctDraft) !== depositPct && !depositLocked && (
                  <Button size="sm" variant="ghost" className="h-8" onClick={() => {
                    const v = Math.max(0, Math.min(100, Number(depositPctDraft)));
                    saveDepositPct.mutate(v, { onSuccess: () => setDepositPctDraft("") });
                  }}>Save</Button>
                )}
              </div>
              {depositLocked && (
                <div className="text-[10px] text-muted-foreground mt-1">
                  Locked — {order.deposit_status === "pending_approval" ? "pending customer approval" : "deposit approved"}
                </div>
              )}
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Deposit amount</div>
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  min={0}
                  max={quoted || undefined}
                  step="0.01"
                  className="h-8 w-32"
                  placeholder={proposedDepositAmount ? proposedDepositAmount.toFixed(2) : "0.00"}
                  value={depositAmtDraft}
                  onChange={(e) => {
                    const v = e.target.value;
                    setDepositAmtDraft(v);
                    const n = Number(v);
                    if (v !== "" && !Number.isNaN(n) && quoted > 0) {
                      setDepositPctDraft((Math.round((n / quoted) * 10000) / 100).toString());
                    }
                  }}
                  disabled={depositLocked}
                />
                <span className="text-xs text-muted-foreground">{currency}</span>
              </div>
              {!depositLocked && (
                <div className="text-[10px] text-muted-foreground mt-1">
                  Overrides % when set. Max {formatCurrency(quoted, currency)}.
                </div>
              )}
            </div>
            <div className="col-span-2 border-t pt-3 mt-1">
              <div className="text-muted-foreground text-xs mb-1">Billing</div>
              <div className="flex flex-wrap gap-x-6 gap-y-2 items-center">
                <span className="text-xs">Deposit:</span>
                <InvoiceStatusBadge invoice={depositInv} kind="deposit" depositStatus={order.deposit_status} paidAmount={paidByInvoice[order.deposit_invoice_id] ?? 0} />
                <span className="text-xs">Balance:</span>
                <InvoiceStatusBadge invoice={balanceInv} kind="balance" paidAmount={paidByInvoice[order.balance_invoice_id] ?? 0} />
              </div>
            </div>
            {order.container_owner_customer_id && (
              <div className="col-span-2 border-t pt-3">
                <div className="text-muted-foreground text-xs mb-1">Container owner</div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="font-medium">{(order as any).container_owner?.company_name ?? "—"}</span>
                  {Number(order.container_owner_charge) > 0 && (
                    <span className="text-xs">
                      {formatCurrency(Number(order.container_owner_charge), order.container_owner_currency || currency)}
                      <span className="text-[10px] text-muted-foreground ml-1">@ FX {Number(order.container_owner_fx_rate ?? 1)}</span>
                    </span>
                  )}
                  {(order as any).owner_invoice ? (
                    <InvoiceStatusBadge invoice={(order as any).owner_invoice} kind="balance" paidAmount={paidByInvoice[order.container_owner_invoice_id] ?? 0} />
                  ) : (
                    <span className="text-xs text-muted-foreground italic">Not yet invoiced</span>
                  )}
                </div>
                {order.container_owner_notes && (
                  <div className="text-xs text-muted-foreground mt-1">{order.container_owner_notes}</div>
                )}
              </div>
            )}
            {order.special_instructions && (
              <div className="col-span-2"><div className="text-muted-foreground text-xs">Special instructions</div>{order.special_instructions}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Receipt className="h-4 w-4" />Revenue</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            <div className="text-3xl font-bold">{formatCurrency(totalRevenue, currency)}</div>
            <div className="text-xs text-muted-foreground">of {formatCurrency(quoted, currency)} quoted</div>

            <div className="pt-3 border-t mt-3 space-y-2 text-xs">
              <div className="flex justify-between items-center text-muted-foreground">
                <span>Deposit invoice</span>
                <span className="flex items-center gap-2 font-medium text-foreground">
                  {order.deposit_status === "pending_approval" || depositInv
                    ? formatCurrency(proposedDepositAmount, currency)
                    : `${depositPct}% pending`}
                  <InvoiceStatusBadge invoice={depositInv} kind="deposit" depositStatus={order.deposit_status} paidAmount={paidByInvoice[order.deposit_invoice_id] ?? 0} />
                </span>
              </div>
              <div className="flex justify-between items-center text-muted-foreground">
                <span>Balance invoice</span>
                <span className="flex items-center gap-2 font-medium text-foreground">
                  {balanceInv ? formatCurrency(balanceAmount, currency) : "—"}
                  <InvoiceStatusBadge invoice={balanceInv} kind="balance" paidAmount={paidByInvoice[order.balance_invoice_id] ?? 0} />
                </span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Collected</span>
                <span className="font-medium text-foreground">{formatCurrency(totalCollected, currency)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Outstanding</span>
                <span className={`font-medium ${outstanding > 0 ? "text-destructive" : "text-foreground"}`}>
                  {formatCurrency(outstanding, currency)}
                </span>
              </div>
            </div>

            {!order.deposit_invoice_id && canPropose && (
              <div className="pt-3 mt-3 border-t">
                <Button size="sm" className="w-full" onClick={() => proposeDeposit.mutate(undefined)} disabled={proposeDeposit.isPending}>
                  Propose deposit invoice ({formatCurrency(proposedDepositAmount, currency)})
                </Button>
              </div>
            )}

            <div className="pt-3 border-t mt-3 text-xs text-muted-foreground flex justify-between">
              <span>Costs (linked trips)</span>
              <span className="font-medium text-foreground">{formatCurrency(totalCosts, currency)}</span>
            </div>
            <div className="text-xs text-muted-foreground flex justify-between">
              <span>Margin</span>
              <span className={`font-medium ${totalRevenue - totalCosts >= 0 ? "text-foreground" : "text-destructive"}`}>
                {formatCurrency(totalRevenue - totalCosts, currency)}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Linked trips</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Ref</TableHead><TableHead>Date</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {legs.map((l: any) => {
                const t = l.logistics_trips;
                return (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-xs">{t.ref}</TableCell>
                    <TableCell>{t.trip_date}</TableCell>
                    <TableCell><Badge variant="outline">{t.status}</Badge></TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button size="sm" variant="outline" onClick={() => setCostTripId(t.id)}>
                        <DollarSign className="h-3 w-3 mr-1" />Add cost
                      </Button>
                      <Button size="sm" variant="ghost" asChild>
                        <Link to={`/logistics/trips/${t.id}`}>Open</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {legs.length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground text-sm">
                  <Link2 className="h-4 w-4 inline mr-1" />No trip assigned yet. Assign one from the <Link className="underline" to="/logistics/orders">orders list</Link>.
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Revenue entries</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Trip</TableHead><TableHead>Invoice</TableHead><TableHead>Status</TableHead>
              <TableHead>Recorded</TableHead><TableHead className="text-right">Amount</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {(revenue ?? []).map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.logistics_trips?.ref ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {r.invoices?.invoice_number ? (
                      <Link to="/billing/invoices" className="underline">{r.invoices.invoice_number}</Link>
                    ) : "—"}
                  </TableCell>
                  <TableCell>
                    <InvoiceStatusBadge invoice={r.invoices} paidAmount={paidByInvoice[r.invoice_id] ?? 0} />
                  </TableCell>
                  <TableCell className="text-xs">{formatDate(r.created_at)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(Number(r.amount), r.currency || currency)}</TableCell>
                </TableRow>
              ))}
              {(revenue ?? []).length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground text-sm">
                  No revenue recorded yet. {canPropose
                    ? <Button size="sm" variant="link" className="px-1" onClick={() => proposeDeposit.mutate(undefined)}>Propose deposit invoice ({depositPct}%)</Button>
                    : canIssueBalance
                      ? <Button size="sm" variant="link" className="px-1" onClick={() => issueBalance.mutate()}>Issue balance invoice</Button>
                      : "Revenue is recognized once the customer approves the deposit."}
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Receipt className="h-4 w-4" />Accounting</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="text-xs text-muted-foreground mb-2">Invoices</div>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Type</TableHead><TableHead>Invoice #</TableHead><TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead><TableHead className="text-right">Paid</TableHead><TableHead className="text-right">Balance</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {[
                  { kind: "Deposit", inv: depositInv, id: order.deposit_invoice_id },
                  { kind: "Balance", inv: balanceInv, id: order.balance_invoice_id },
                  { kind: "Owner", inv: (order as any).owner_invoice, id: order.container_owner_invoice_id },
                ].filter((r) => r.inv).map((r) => {
                  const paid = paidByInvoice[r.id] ?? 0;
                  const tot = Number(r.inv.total_amount || 0);
                  return (
                    <TableRow key={r.id}>
                      <TableCell>{r.kind}</TableCell>
                      <TableCell className="font-mono text-xs"><Link to="/billing/invoices" className="underline">{r.inv.invoice_number}</Link></TableCell>
                      <TableCell><InvoiceStatusBadge invoice={r.inv} paidAmount={paid} /></TableCell>
                      <TableCell className="text-right">{formatCurrency(tot, r.inv.currency || currency)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(paid, r.inv.currency || currency)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(tot - paid, r.inv.currency || currency)}</TableCell>
                    </TableRow>
                  );
                })}
                {invoiceIds.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center py-4 text-muted-foreground text-sm">No invoices raised yet.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <div>
            <div className="text-xs text-muted-foreground mb-2">Payments</div>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Date</TableHead><TableHead>Payment #</TableHead><TableHead>Invoice</TableHead>
                <TableHead>Method</TableHead><TableHead>Account</TableHead><TableHead>Reference</TableHead>
                <TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(payments ?? []).map((p: any) => {
                  const invNum = [depositInv, balanceInv, (order as any).owner_invoice].find((i: any) => i?.id === p.invoice_id)?.invoice_number;
                  const isReversal = Number(p.amount) < 0;
                  const isReversed = !!p.reversed_at;
                  return (
                    <TableRow key={p.id} className={isReversal || isReversed ? "text-muted-foreground" : ""}>
                      <TableCell className="text-xs">{formatDate(p.paid_at)}</TableCell>
                      <TableCell className="font-mono text-xs">{p.payment_number || "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{invNum || "—"}</TableCell>
                      <TableCell className="text-xs">{p.payment_method}</TableCell>
                      <TableCell className="text-xs">{p.financial_accounts?.name || "—"}</TableCell>
                      <TableCell className="text-xs">{p.reference_number || "—"}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(Number(p.amount), p.currency || currency)}</TableCell>
                      <TableCell>
                        {isReversal ? <Badge variant="outline">reversal</Badge>
                          : isReversed ? <Badge variant="destructive" title={p.reversal_reason || ""}>reversed</Badge>
                          : <Badge variant="secondary">posted</Badge>}
                      </TableCell>
                      <TableCell className="text-right">
                        {!isReversal && !isReversed && (
                          <Button size="sm" variant="ghost" onClick={() => { setReverseFor(p); setReverseReason(""); }}>
                            Reverse
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {(payments ?? []).length === 0 && (
                  <TableRow><TableCell colSpan={9} className="text-center py-4 text-muted-foreground text-sm">No payments recorded.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm border-t pt-3 justify-end">
            <span className="text-muted-foreground">Invoiced: <span className="font-medium text-foreground">{formatCurrency(invoicedTotal, currency)}</span></span>
            <span className="text-muted-foreground">Paid: <span className="font-medium text-foreground">{formatCurrency(totalCollected, currency)}</span></span>
            <span className="text-muted-foreground">Outstanding: <span className={`font-medium ${outstanding > 0 ? "text-destructive" : "text-foreground"}`}>{formatCurrency(outstanding, currency)}</span></span>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!reverseFor} onOpenChange={(o) => { if (!o) { setReverseFor(null); setReverseReason(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reverse payment</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground text-xs">
              Records an offsetting entry against invoice{" "}
              <span className="font-mono">{reverseFor?.payment_number}</span> for{" "}
              <span className="font-medium text-foreground">{reverseFor ? formatCurrency(Number(reverseFor.amount), reverseFor.currency || currency) : ""}</span>.
              This cannot be undone — a reason is required for the audit trail.
            </p>
            <div>
              <label className="text-xs text-muted-foreground">Reason</label>
              <Textarea value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} placeholder="e.g. entered on the wrong order / duplicate entry" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReverseFor(null)}>Close</Button>
            <Button variant="destructive" disabled={!reverseReason.trim() || reversePayment.isPending} onClick={() => reversePayment.mutate()}>
              Reverse payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={disputeOpen} onOpenChange={setDisputeOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Cancel deposit proposal</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Voids the draft deposit invoice and records why. You can re-propose with a different amount afterwards.
            </p>
            <div>
              <label className="text-xs text-muted-foreground">Reason</label>
              <Textarea value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)} placeholder="e.g. customer requested 30% instead of 50%" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisputeOpen(false)}>Close</Button>
            <Button variant="destructive" disabled={!disputeReason.trim() || cancelProposal.isPending} onClick={() => cancelProposal.mutate(disputeReason.trim())}>
              Cancel proposal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AddTripCostDialog
        tripId={costTripId}
        open={!!costTripId}
        onOpenChange={(o) => !o && setCostTripId(null)}
        onSuccess={() => {
          qc.invalidateQueries({ queryKey: ["logistics-order-costs", id] });
        }}
      />

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record deposit as paid</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground text-xs">
              Confirms the deposit on behalf of the customer and records the payment against invoice{" "}
              <span className="font-mono">{depositInv?.invoice_number}</span>.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Amount ({currency})</label>
                <Input type="number" step="0.01" value={payForm.amount} onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Paid on</label>
                <Input type="date" value={payForm.paid_at} onChange={(e) => setPayForm((f) => ({ ...f, paid_at: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Method</label>
                <Select value={payForm.method} onValueChange={(v) => setPayForm((f) => ({ ...f, method: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bank_transfer">Bank transfer</SelectItem>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="cheque">Cheque</SelectItem>
                    <SelectItem value="credit_card">Card</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Deposit to account</label>
                <Select value={payForm.financial_account_id} onValueChange={(v) => setPayForm((f) => ({ ...f, financial_account_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                  <SelectContent>
                    {(financialAccounts ?? []).map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}{a.currency ? ` (${a.currency})` : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-muted-foreground">Reference #</label>
                <Input value={payForm.reference} onChange={(e) => setPayForm((f) => ({ ...f, reference: e.target.value }))} placeholder="e.g. MPESA / bank ref" />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-muted-foreground">Notes</label>
                <Textarea rows={2} value={payForm.notes} onChange={(e) => setPayForm((f) => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>Cancel</Button>
            <Button disabled={confirmAndPay.isPending || !payForm.financial_account_id || !Number(payForm.amount)} onClick={() => confirmAndPay.mutate()}>
              Confirm & record payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
