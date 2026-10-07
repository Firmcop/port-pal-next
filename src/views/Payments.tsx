import { useState, useMemo } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Search, DollarSign, TrendingUp, TrendingDown, Clock, Printer, ArrowDownLeft, ArrowUpRight, AlertCircle, Wallet } from "lucide-react";
import { LumpsumPaymentDialog } from "@/components/finance/LumpsumPaymentDialog";
import { FinanceApprovalsPanel } from "@/components/finance/FinanceApprovalsPanel";
import { printReceipt, printVendorReceipt } from "@/lib/document-templates";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { useFinancialAccounts } from "@/hooks/use-financial-accounts";
import { format } from "date-fns";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { Money } from "@/components/Money";
import { getCurrencySymbol, formatMoney } from "@/lib/app-settings";
import { formatAccountTypeLabel } from "@/lib/format";
import { mapRepatriationError } from "@/lib/repatriation-errors";
import PayPoDialog from "@/components/procurement/PayPoDialog";


const methodLabels: Record<string, string> = {
  bank_transfer: "Bank Transfer",
  cash: "Cash",
  cheque: "Cheque",
  credit_card: "Credit Card",
  other: "Other",
};

// ─── Customer Receipts Tab ──────────────────────────
function CustomerReceiptsTab() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  useAuth();
  const { data: accounts } = useFinancialAccounts();

  useRealtimeInvalidate([
    { table: "payments", queryKeys: ["payments", "payments-summary", "unpaid-invoices", "unrecorded-payments"] },
    { table: "vendor_payments", queryKeys: ["vendor-payments", "vendor-payments-summary", "supplier-pos", "unpaid-pos-summary", "unrecorded-payments"] },
    { table: "invoices", queryKeys: ["unpaid-invoices", "unrecorded-payments"] },
    { table: "purchase_orders", queryKeys: ["supplier-pos", "unpaid-pos-summary", "unrecorded-payments"] },
  ], "payments-rt");



  const { data: payments, isLoading } = useQuery({
    queryKey: ["payments", search],
    queryFn: async () => {
      let q = supabase
        .from("payments")
        .select("*, invoices(invoice_number, customer_name, total_amount, currency), financial_accounts:financial_account_id(name, account_type, currency)")
        .order("paid_at", { ascending: false });
      if (search) q = q.ilike("payment_number", `%${search}%`);
      const { data, error } = await q.limit(100);
      if (error) throw error;
      return data;
    },
  });

  const { data: unpaidInvoices } = useQuery({
    queryKey: ["unpaid-invoices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("id, invoice_number, customer_name, total_amount, currency")
        .in("status", ["sent", "overdue"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const [form, setForm] = useState<any>({
    invoice_id: "", amount: "", payment_method: "bank_transfer", financial_account_id: "",
    reference_number: "", paid_at: "", notes: "",
  });
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const handleInvoiceSelect = (invId: string) => {
    const inv = unpaidInvoices?.find((i) => i.id === invId);
    if (inv) {
      set("invoice_id", invId);
      set("amount", String(inv.total_amount));
    }
  };

  const recordPayment = useMutation({
    mutationFn: async (form: any) => {
      if (!form.financial_account_id) throw new Error("Select the receiving account");
      const { error } = await supabase.rpc("record_customer_payment" as any, {
        _invoice_id: form.invoice_id,
        _amount: parseFloat(form.amount),
        _account_id: form.financial_account_id,
        _method: form.payment_method,
        _reference: form.reference_number || null,
        _paid_at: form.paid_at ? new Date(form.paid_at).toISOString() : new Date().toISOString(),
        _notes: form.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payments"] });
      queryClient.invalidateQueries({ queryKey: ["unpaid-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["unrecorded-payments"] });
      queryClient.invalidateQueries({ queryKey: ["finance-dashboard-metrics"] });
      toast({ title: "Payment recorded" });
      setDialogOpen(false);
      setForm({ invoice_id: "", amount: "", payment_method: "bank_transfer", financial_account_id: "", reference_number: "", paid_at: "", notes: "" });
    },
    onError: (e: any) => toast({ title: "Error", description: mapRepatriationError(e), variant: "destructive" }),
  });

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search payment number..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="mr-1 h-4 w-4" />Record Payment</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Record Customer Payment</DialogTitle></DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); recordPayment.mutate(form); }} className="space-y-4">
              <div className="space-y-2">
                <Label>Invoice *</Label>
                <Select onValueChange={handleInvoiceSelect}>
                  <SelectTrigger><SelectValue placeholder="Select unpaid invoice" /></SelectTrigger>
                  <SelectContent>
                    {unpaidInvoices?.map((inv) => (
                      <SelectItem key={inv.id} value={inv.id}>
                        {inv.invoice_number} — {inv.customer_name} ({formatMoney(inv.total_amount, (inv as any).currency)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Amount ({getCurrencySymbol()}) *</Label>
                  <Input type="number" step="0.01" min="0" value={form.amount} onChange={(e) => set("amount", e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label>Method</Label>
                  <Select value={form.payment_method} onValueChange={(v) => set("payment_method", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="cheque">Cheque</SelectItem>
                      <SelectItem value="credit_card">Credit Card</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Receiving account *</Label>
                  <Select value={form.financial_account_id} onValueChange={(v) => set("financial_account_id", v)}>
                    <SelectTrigger><SelectValue placeholder={accounts?.length ? "Select bank / cash" : "Create an account first"} /></SelectTrigger>
                    <SelectContent>
                      {accounts?.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name} <span className="text-xs text-muted-foreground ml-1">({formatAccountTypeLabel(a.account_type)} · {a.currency})</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Reference #</Label>
                  <Input value={form.reference_number} onChange={(e) => set("reference_number", e.target.value)} placeholder="Transaction ID" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Payment Date</Label>
                <Input type="datetime-local" value={form.paid_at} onChange={(e) => set("paid_at", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} />
              </div>
              <Button type="submit" className="w-full" disabled={recordPayment.isPending}>Record Payment</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Payment #</TableHead>
                <TableHead>Invoice</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableSkeleton columns={9} />
              ) : !payments?.length ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No payments recorded</TableCell></TableRow>
              ) : (
                payments.map((p: any) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-sm font-medium">{p.payment_number}</TableCell>
                    <TableCell className="font-mono text-sm">{p.invoices?.invoice_number ?? "—"}</TableCell>
                    <TableCell className="text-sm">{p.invoices?.customer_name ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{p.invoices?.currency ?? ""} {parseFloat(p.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                    <TableCell className="text-sm">{p.financial_accounts?.name ?? <span className="text-destructive text-xs">— missing —</span>}</TableCell>
                    <TableCell className="text-sm">{methodLabels[p.payment_method] ?? p.payment_method}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{p.reference_number ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{format(new Date(p.paid_at), "PPp")}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => printReceipt({
                        payment_number: p.payment_number,
                        amount: parseFloat(p.amount),
                        payment_method: p.payment_method,
                        reference_number: p.reference_number,
                        paid_at: p.paid_at,
                        notes: p.notes,
                        invoice_number: p.invoices?.invoice_number,
                        customer_name: p.invoices?.customer_name,
                        invoice_total: p.invoices?.total_amount ? parseFloat(p.invoices.total_amount) : null,
                      })}>
                        <Printer className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

// ─── Vendor Payments Tab ────────────────────────────
/** Received purchase orders that still have no (or partial) vendor payment recorded. */
function AwaitingPoPayments() {
  const [payPoId, setPayPoId] = useState<string | null>(null);

  const { data: rows } = useQuery({
    queryKey: ["pos-awaiting-payment"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("purchase_orders")
        .select("id, po_number, total_cost, currency, status, order_date, suppliers:supplier_id(name)")
        .in("status", ["received", "partially_received"])
        .order("order_date", { ascending: false })
        .limit(100);
      if (error) throw error;
      const ids = (data ?? []).map((p: any) => p.id);
      if (!ids.length) return [];
      const { data: vp, error: vErr } = await (supabase as any)
        .from("vendor_payments")
        .select("po_id, amount")
        .in("po_id", ids);
      if (vErr) throw vErr;
      const paidBy = new Map<string, number>();
      (vp ?? []).forEach((r: any) => paidBy.set(r.po_id, (paidBy.get(r.po_id) ?? 0) + Number(r.amount ?? 0)));
      return (data ?? [])
        .map((p: any) => ({ ...p, paid: paidBy.get(p.id) ?? 0, balance: Number(p.total_cost ?? 0) - (paidBy.get(p.id) ?? 0) }))
        .filter((p: any) => p.balance > 0.005);
    },
  });

  if (!rows?.length) return null;

  // Outstanding never gets blended across currencies — one subtotal per currency.
  const byCurrency = new Map<string, number>();
  rows.forEach((p: any) => {
    const c = (p.currency || "").toUpperCase() || "—";
    byCurrency.set(c, (byCurrency.get(c) ?? 0) + Number(p.balance ?? 0));
  });

  return (
    <Card className="border-warning/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <AlertCircle className="h-4 w-4 text-warning" />
          Purchase orders awaiting payment
          <Badge variant="secondary">{rows.length}</Badge>
          {Array.from(byCurrency, ([c, amt]) => (
            <Badge key={c} variant="outline" className="font-mono text-xs">
              {formatMoney(amt, c === "—" ? undefined : c)}
            </Badge>
          ))}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>PO #</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p: any) => (
              <TableRow key={p.id}>
                <TableCell className="font-mono text-sm">{p.po_number}</TableCell>
                <TableCell className="text-sm">{p.suppliers?.name ?? "—"}</TableCell>
                <TableCell className="text-right font-mono text-sm">{formatMoney(p.total_cost, p.currency || undefined)}</TableCell>
                <TableCell className="text-right font-mono text-sm">{formatMoney(p.paid, p.currency || undefined)}</TableCell>
                <TableCell className="text-right font-mono text-sm font-medium">{formatMoney(p.balance, p.currency || undefined)}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="outline" onClick={() => setPayPoId(p.id)}>Pay supplier</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      <PayPoDialog poId={payPoId} open={!!payPoId} onOpenChange={(o) => !o && setPayPoId(null)} />
    </Card>
  );
}

function VendorPaymentsTab() {

  const [dialogOpen, setDialogOpen] = useState(false);
  const [lumpsumOpen, setLumpsumOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  useAuth();
  const { data: accounts } = useFinancialAccounts();

  const { data: vendorPayments, isLoading } = useQuery({
    queryKey: ["vendor-payments", search],
    queryFn: async () => {
      let q = supabase
        .from("vendor_payments")
        .select("*, suppliers(name), purchase_orders:po_id(po_number, total_cost, currency, conversion_id), container_conversions:conversion_id(conversion_number), financial_accounts:financial_account_id(name, account_type, currency)")
        .order("paid_at", { ascending: false });
      if (search) q = q.ilike("payment_number", `%${search}%`);
      const { data, error } = await q.limit(100);
      if (error) throw error;
      return data;
    },
  });

  const { data: allocMap } = useQuery({
    queryKey: ["vendor-payment-unallocated"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("vendor_payment_unallocated").select("*");
      if (error) throw error;
      const map: Record<string, any> = {};
      (data ?? []).forEach((r: any) => { map[r.payment_id] = r; });
      return map;
    },
  });

  const allocateMut = useMutation({
    mutationFn: async (paymentId: string) => {
      const { data, error } = await (supabase as any).rpc("auto_allocate_vendor_payment", { _payment_id: paymentId });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ["vendor-payment-unallocated"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-invoices"] });
      const trail: any[] = res?.trail ?? [];
      const lines = trail.map((t) =>
        t.rule === "unallocated_credit"
          ? `Left as credit: ${Number(t.amount).toFixed(2)}`
          : t.rule === "skipped_currency_mismatch"
            ? `${t.invoice_number}: skipped (${t.payment_currency} vs ${t.invoice_currency})`
            : `${t.invoice_number}: ${Number(t.amount).toFixed(2)} (${t.rule === "po_match" ? "matched PO" : "oldest open invoice"})`
      );
      toast({
        title: `Allocated ${Number(res?.allocated || 0).toFixed(2)} ${res?.currency ?? ""}`.trim(),
        description: lines.length ? lines.join(" · ") : "No open purchase invoices matched this payment.",
      });
    },
    onError: (e: any) => toast({ title: "Allocation failed", description: e.message, variant: "destructive" }),
  });

  const { data: suppliers } = useQuery({
    queryKey: ["suppliers-active"],
    queryFn: async () => {
      const { data, error } = await supabase.from("suppliers").select("id, name").eq("is_active", true).order("name");
      if (error) throw error;
      return data;
    },
  });

  const [form, setForm] = useState<any>({
    supplier_id: "", po_id: "", amount: "", payment_method: "bank_transfer", financial_account_id: "",
    reference_number: "", paid_at: "", notes: "",
  });
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const { data: supplierPOs } = useQuery({
    queryKey: ["supplier-pos", form.supplier_id],
    queryFn: async () => {
      if (!form.supplier_id) return [];
      const { data, error } = await supabase
        .from("purchase_orders")
        .select("id, po_number, total_cost, currency, conversion_id, container_conversions:conversion_id(conversion_number)")
        .eq("supplier_id", form.supplier_id)
        .in("status", ["approved", "confirmed", "received"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!form.supplier_id,
  });

  const handlePOSelect = (poId: string) => {
    const po = supplierPOs?.find((p: any) => p.id === poId);
    if (po) {
      set("po_id", poId);
      set("amount", String(po.total_cost));
    }
  };

  const recordVendorPayment = useMutation({
    mutationFn: async (f: any) => {
      if (!f.financial_account_id) throw new Error("Select the account paying this vendor");
      const { error } = await supabase.rpc("record_vendor_payment" as any, {
        _po_id: f.po_id,
        _amount: parseFloat(f.amount),
        _account_id: f.financial_account_id,
        _method: f.payment_method,
        _reference: f.reference_number || null,
        _paid_at: f.paid_at ? new Date(f.paid_at).toISOString() : new Date().toISOString(),
        _notes: f.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vendor-payments"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-pos"] });
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["unrecorded-payments"] });
      queryClient.invalidateQueries({ queryKey: ["finance-dashboard-metrics"] });
      toast({ title: "Vendor payment recorded" });
      setDialogOpen(false);
      setForm({ supplier_id: "", po_id: "", amount: "", payment_method: "bank_transfer", financial_account_id: "", reference_number: "", paid_at: "", notes: "" });
    },
    onError: (e: any) => toast({ title: "Error", description: mapRepatriationError(e), variant: "destructive" }),
  });

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search voucher number..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setLumpsumOpen(true)}>
          <Wallet className="mr-1 h-4 w-4" />Lumpsum Payment
        </Button>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="mr-1 h-4 w-4" />Pay Vendor</Button>
          </DialogTrigger>

          <DialogContent>
            <DialogHeader><DialogTitle>Record Vendor Payment</DialogTitle></DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); recordVendorPayment.mutate(form); }} className="space-y-4">
              <div className="space-y-2">
                <Label>Supplier *</Label>
                <Select value={form.supplier_id} onValueChange={(v) => { set("supplier_id", v); set("po_id", ""); set("amount", ""); }}>
                  <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                  <SelectContent>
                    {suppliers?.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Purchase Order *</Label>
                <Select value={form.po_id} onValueChange={handlePOSelect} disabled={!form.supplier_id}>
                  <SelectTrigger><SelectValue placeholder={form.supplier_id ? "Select PO" : "Select supplier first"} /></SelectTrigger>
                  <SelectContent>
                    {supplierPOs?.map((po: any) => (
                      <SelectItem key={po.id} value={po.id}>
                        {po.po_number} — {formatMoney(po.total_cost, (po as any).currency)} {po.container_conversions?.conversion_number ? `(${po.container_conversions.conversion_number})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Amount ({getCurrencySymbol()}) *</Label>
                  <Input type="number" step="0.01" min="0" value={form.amount} onChange={(e) => set("amount", e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label>Method</Label>
                  <Select value={form.payment_method} onValueChange={(v) => set("payment_method", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="cheque">Cheque</SelectItem>
                      <SelectItem value="credit_card">Credit Card</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Paid from account *</Label>
                  <Select value={form.financial_account_id} onValueChange={(v) => set("financial_account_id", v)}>
                    <SelectTrigger><SelectValue placeholder={accounts?.length ? "Select bank / cash" : "Create an account first"} /></SelectTrigger>
                    <SelectContent>
                      {accounts?.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name} <span className="text-xs text-muted-foreground ml-1">({formatAccountTypeLabel(a.account_type)} · {a.currency})</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Reference #</Label>
                  <Input value={form.reference_number} onChange={(e) => set("reference_number", e.target.value)} placeholder="Transaction ID" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Payment Date</Label>
                <Input type="datetime-local" value={form.paid_at} onChange={(e) => set("paid_at", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} />
              </div>
              <Button type="submit" className="w-full" disabled={recordVendorPayment.isPending || !form.po_id}>Record Payment</Button>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <LumpsumPaymentDialog open={lumpsumOpen} onOpenChange={setLumpsumOpen} />

      <AwaitingPoPayments />


      <Card>

        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Voucher #</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>PO #</TableHead>
                <TableHead>Job</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Allocated</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableSkeleton columns={10} />
              ) : !vendorPayments?.length ? (
                <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">No vendor payments recorded</TableCell></TableRow>
              ) : (
                vendorPayments.map((vp: any) => (
                  <TableRow key={vp.id}>
                    <TableCell className="font-mono text-sm font-medium">{vp.payment_number}</TableCell>
                    <TableCell className="text-sm font-medium">{vp.suppliers?.name ?? "—"}</TableCell>
                    <TableCell className="font-mono text-sm">{vp.purchase_orders?.po_number ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{vp.container_conversions?.conversion_number ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono text-sm text-destructive">
                      {parseFloat(vp.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      <span className="ml-1 text-[10px] text-muted-foreground">{vp.currency ?? ""}</span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {(() => {
                        const a = allocMap?.[vp.id];
                        const alloc = Number(a?.allocated || 0);
                        const un = Number(a?.unallocated ?? vp.amount);
                        return (
                          <>
                            <div>{alloc.toFixed(2)}</div>
                            {un > 0.009 && <div className="text-warning">credit {un.toFixed(2)}</div>}
                          </>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="text-sm">{vp.financial_accounts?.name ?? <span className="text-destructive text-xs">— missing —</span>}</TableCell>
                    <TableCell className="text-sm">{methodLabels[vp.payment_method] ?? vp.payment_method}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{format(new Date(vp.paid_at), "PPp")}</TableCell>
                    <TableCell className="flex items-center gap-1">
                      {Number(allocMap?.[vp.id]?.unallocated ?? vp.amount) > 0.009 && (
                        <Button size="sm" variant="outline" disabled={allocateMut.isPending} onClick={() => allocateMut.mutate(vp.id)}>Allocate</Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => printVendorReceipt({
                        payment_number: vp.payment_number,
                        amount: parseFloat(vp.amount),
                        payment_method: vp.payment_method,
                        reference_number: vp.reference_number,
                        paid_at: vp.paid_at,
                        notes: vp.notes,
                        po_number: vp.purchase_orders?.po_number,
                        supplier_name: vp.suppliers?.name,
                        po_total: vp.purchase_orders?.total_cost ? parseFloat(vp.purchase_orders.total_cost) : null,
                        conversion_number: vp.container_conversions?.conversion_number,
                      })}>
                        <Printer className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

// ─── All Transactions Tab ───────────────────────────
function AllTransactionsTab() {
  const { data: custPayments } = useQuery({
    queryKey: ["payments", ""],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("id, payment_number, amount, payment_method, paid_at, invoices(invoice_number, customer_name)")
        .order("paid_at", { ascending: false }).limit(200);
      if (error) throw error;
      return data;
    },
  });

  const { data: vendorPays } = useQuery({
    queryKey: ["vendor-payments", ""],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vendor_payments")
        .select("id, payment_number, amount, payment_method, paid_at, suppliers(name), purchase_orders:po_id(po_number)")
        .order("paid_at", { ascending: false }).limit(200);
      if (error) throw error;
      return data;
    },
  });

  const allTxns = useMemo(() => {
    const incoming = (custPayments ?? []).map((p: any) => ({
      id: p.id,
      number: p.payment_number,
      direction: "in" as const,
      counterparty: p.invoices?.customer_name ?? "—",
      reference: p.invoices?.invoice_number ?? "—",
      amount: parseFloat(p.amount),
      method: p.payment_method,
      date: p.paid_at,
    }));
    const outgoing = (vendorPays ?? []).map((vp: any) => ({
      id: vp.id,
      number: vp.payment_number,
      direction: "out" as const,
      counterparty: vp.suppliers?.name ?? "—",
      reference: vp.purchase_orders?.po_number ?? "—",
      amount: parseFloat(vp.amount),
      method: vp.payment_method,
      date: vp.paid_at,
    }));
    return [...incoming, ...outgoing].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [custPayments, vendorPays]);

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Direction</TableHead>
              <TableHead>Number</TableHead>
              <TableHead>Counterparty</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!allTxns.length ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No transactions</TableCell></TableRow>
            ) : allTxns.map((t) => (
              <TableRow key={t.id}>
                <TableCell>
                  {t.direction === "in" ? (
                    <Badge variant="secondary" className="bg-success/15 text-success dark:bg-success/30 dark:text-success">
                      <ArrowDownLeft className="mr-1 h-3 w-3" />IN
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="bg-destructive/15 text-destructive dark:bg-destructive/30 dark:text-destructive">
                      <ArrowUpRight className="mr-1 h-3 w-3" />OUT
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="font-mono text-sm">{t.number}</TableCell>
                <TableCell className="text-sm font-medium">{t.counterparty}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{t.reference}</TableCell>
                <TableCell className={`text-right font-mono text-sm ${t.direction === "out" ? "text-destructive" : "text-success"}`}>
                  {t.direction === "out" ? "-" : "+"}<Money amount={t.amount} currency={(t as any).currency} />
                </TableCell>
                <TableCell className="text-sm">{methodLabels[t.method] ?? t.method}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{format(new Date(t.date), "PPp")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ─── Unrecorded Payments Tab ────────────────────────
function UnrecordedPaymentsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: accounts } = useFinancialAccounts();
  const [target, setTarget] = useState<any>(null);
  const [form, setForm] = useState<any>({ amount: "", payment_method: "bank_transfer", financial_account_id: "", reference_number: "", paid_at: "", notes: "" });

  const { data: rows, isLoading } = useQuery({
    queryKey: ["unrecorded-payments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_unrecorded_payments" as any).select("*").order("marked_at", { ascending: false }).limit(200);
      if (error) throw error;
      return data as any[];
    },
  });

  const reconcile = useMutation({
    mutationFn: async () => {
      if (!form.financial_account_id) throw new Error("Select the account");
      const rpc = target.doc_type === "invoice" ? "record_customer_payment" : "record_vendor_payment";
      const args: any = {
        _amount: parseFloat(form.amount),
        _account_id: form.financial_account_id,
        _method: form.payment_method,
        _reference: form.reference_number || null,
        _paid_at: form.paid_at ? new Date(form.paid_at).toISOString() : new Date().toISOString(),
        _notes: form.notes || null,
      };
      if (target.doc_type === "invoice") args._invoice_id = target.doc_id;
      else args._po_id = target.doc_id;
      const { error } = await supabase.rpc(rpc as any, args);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["unrecorded-payments"] });
      queryClient.invalidateQueries({ queryKey: ["payments"] });
      queryClient.invalidateQueries({ queryKey: ["vendor-payments"] });
      queryClient.invalidateQueries({ queryKey: ["payments-summary"] });
      queryClient.invalidateQueries({ queryKey: ["vendor-payments-summary"] });
      toast({ title: "Payment record created" });
      setTarget(null);
      setForm({ amount: "", payment_method: "bank_transfer", financial_account_id: "", reference_number: "", paid_at: "", notes: "" });
    },
    onError: (e: any) => toast({ title: "Error", description: mapRepatriationError(e), variant: "destructive" }),
  });

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-warning" />
            Documents marked paid without a payment record
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Doc #</TableHead>
                <TableHead>Counterparty</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Marked</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableSkeleton columns={6} />
              ) : !rows?.length ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">All paid documents are reconciled</TableCell></TableRow>
              ) : (
                rows.map((r: any) => (
                  <TableRow key={`${r.doc_type}-${r.doc_id}`}>
                    <TableCell><Badge variant="outline">{r.doc_type === "invoice" ? "Invoice" : "Purchase Order"}</Badge></TableCell>
                    <TableCell className="font-mono text-sm">{r.doc_number}</TableCell>
                    <TableCell className="text-sm">{r.counterparty ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{r.currency ?? ""} {parseFloat(r.amount ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.marked_at ? format(new Date(r.marked_at), "PP") : "—"}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" onClick={() => { setTarget(r); setForm({ amount: String(r.amount ?? ""), payment_method: "bank_transfer", financial_account_id: "", reference_number: "", paid_at: "", notes: "" }); }}>
                        Attach account
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create missing payment record</DialogTitle></DialogHeader>
          {target && (
            <form onSubmit={(e) => { e.preventDefault(); reconcile.mutate(); }} className="space-y-4">
              <p className="text-sm text-muted-foreground">{target.doc_number} · {target.counterparty ?? ""}</p>
              <div className="space-y-2">
                <Label>{target.doc_type === "invoice" ? "Receiving account *" : "Paid from account *"}</Label>
                <Select value={form.financial_account_id} onValueChange={(v) => setForm((f: any) => ({ ...f, financial_account_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                  <SelectContent>
                    {(accounts ?? []).map((a: any) => (
                      <SelectItem key={a.id} value={a.id}>{a.name} ({formatAccountTypeLabel(a.account_type)}{a.currency ? ` · ${a.currency}` : ""})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Amount *</Label>
                  <Input type="number" step="0.01" min="0" required value={form.amount} onChange={(e) => setForm((f: any) => ({ ...f, amount: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Method</Label>
                  <Select value={form.payment_method} onValueChange={(v) => setForm((f: any) => ({ ...f, payment_method: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bank_transfer">Bank transfer</SelectItem>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="cheque">Cheque</SelectItem>
                      <SelectItem value="credit_card">Credit card</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Reference</Label>
                  <Input value={form.reference_number} onChange={(e) => setForm((f: any) => ({ ...f, reference_number: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Paid at</Label>
                  <Input type="datetime-local" value={form.paid_at} onChange={(e) => setForm((f: any) => ({ ...f, paid_at: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea value={form.notes} onChange={(e) => setForm((f: any) => ({ ...f, notes: e.target.value }))} />
              </div>
              <Button type="submit" className="w-full" disabled={reconcile.isPending}>Create payment record</Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Main Payments Page ─────────────────────────────
export default function Payments() {
  const { data: payments } = useQuery({
    queryKey: ["payments-summary"],
    queryFn: async () => {
      const { data, error } = await supabase.from("payments").select("amount");
      if (error) throw error;
      return data;
    },
  });

  const { data: vendorPayments } = useQuery({
    queryKey: ["vendor-payments-summary"],
    queryFn: async () => {
      const { data, error } = await supabase.from("vendor_payments").select("amount");
      if (error) throw error;
      return data;
    },
  });

  const { data: unpaidInvoices } = useQuery({
    queryKey: ["unpaid-invoices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("total_amount")
        .in("status", ["sent", "overdue"]);
      if (error) throw error;
      return data;
    },
  });

  const { data: unpaidPOs } = useQuery({
    queryKey: ["unpaid-pos-summary"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_orders")
        .select("total_cost")
        .in("status", ["confirmed", "received"]);
      if (error) throw error;
      return data;
    },
  });

  const { data: unrecordedCount } = useQuery({
    queryKey: ["unrecorded-payments", "count"],
    queryFn: async () => {
      const { count, error } = await (supabase as any)
        .from("v_unrecorded_payments")
        .select("*", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
  });


  const totalReceived = payments?.reduce((s: number, p: any) => s + parseFloat(p.amount), 0) ?? 0;
  const totalPaidOut = vendorPayments?.reduce((s: number, p: any) => s + parseFloat(p.amount), 0) ?? 0;
  const netCashFlow = totalReceived - totalPaidOut;
  const outstandingPayables = unpaidPOs?.reduce((s: number, p: any) => s + parseFloat(p.total_cost), 0) ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Payments</h1>
        <p className="text-muted-foreground">Customer receipts, vendor payments & cash flow</p>
      </div>

      <FinanceApprovalsPanel docTypes={["payment_allocation"]} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Received</CardTitle>
            <ArrowDownLeft className="h-5 w-5 text-success" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold text-success"><Money amount={totalReceived} /></div></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Paid Out</CardTitle>
            <ArrowUpRight className="h-5 w-5 text-destructive" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold text-destructive"><Money amount={totalPaidOut} /></div></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Net Cash Flow</CardTitle>
            <TrendingUp className="h-5 w-5 text-primary" />
          </CardHeader>
          <CardContent><div className={`text-2xl font-bold ${netCashFlow >= 0 ? "text-success" : "text-destructive"}`}><Money amount={netCashFlow} /></div></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Outstanding Payables</CardTitle>
            <Clock className="h-5 w-5 text-warning" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold"><Money amount={outstandingPayables} /></div></CardContent>
        </Card>
      </div>

      <Tabs defaultValue="customer" className="space-y-4">
        <TabsList>
          <TabsTrigger value="customer">Customer Receipts</TabsTrigger>
          <TabsTrigger value="vendor">Vendor Payments</TabsTrigger>
          <TabsTrigger value="all">All Transactions</TabsTrigger>
          <TabsTrigger value="unrecorded">
            Needs Payment Record
            {!!unrecordedCount && <Badge variant="secondary" className="ml-2">{unrecordedCount}</Badge>}
          </TabsTrigger>

        </TabsList>
        <TabsContent value="customer"><CustomerReceiptsTab /></TabsContent>
        <TabsContent value="vendor"><VendorPaymentsTab /></TabsContent>
        <TabsContent value="all"><AllTransactionsTab /></TabsContent>
        <TabsContent value="unrecorded"><UnrecordedPaymentsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
