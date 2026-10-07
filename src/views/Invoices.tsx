import { getOrgCurrency, getPrintDepot } from "@/lib/app-settings";
import { roundMoney, assertTotalsMatch, formatMoneyCode } from "@/lib/money";
import { formatAccountTypeLabel } from "@/lib/format";
import { useUserStaffRole } from "@/hooks/use-user-staff-role";
import { CurrencyOverrideDialog } from "@/components/finance/CurrencyOverrideDialog";
import { EditTransferFeesDialog } from "@/components/repatriation/EditTransferFeesDialog";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Send, Download, FileDown, FileText, Printer, FileCode2, RefreshCw, AlertCircle, Ship, Pencil } from "lucide-react";
import { Link } from "@/lib/router";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { exportCSV, exportPDF } from "@/lib/export-utils";
import { printInvoice } from "@/lib/document-templates";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { useFinancialAccounts } from "@/hooks/use-financial-accounts";
import { format, differenceInDays } from "date-fns";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { mapRepatriationError } from "@/lib/repatriation-errors";

const statusColors: Record<string, string> = {
  draft: "bg-gray-500/15 text-gray-700 border-gray-300",
  sent: "bg-info/15 text-info border-info/30",
  paid: "bg-success/15 text-success border-success/30",
  overdue: "bg-destructive/15 text-destructive border-destructive/30",
  cancelled: "bg-gray-500/15 text-gray-500 border-gray-300",
  credited: "bg-purple-500/15 text-purple-700 border-purple-300",
};

function generateInvoiceNumber() {
  const d = new Date();
  return `INV-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}-${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;
}

export default function Invoices() {
  const { t } = useTranslation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [storageDialogOpen, setStorageDialogOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [containerFilter, setContainerFilter] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { data: financialAccounts } = useFinancialAccounts();
  // Banking details are stored separately and only readable by finance roles.
  const { data: accountBankDetails } = useQuery({
    queryKey: ["financial-account-bank-details"],
    retry: false,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("financial_account_bank_details")
        .select("account_id, bank_name, account_number, branch, swift_bic");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });


  useRealtimeInvalidate([
    { table: "invoices", queryKeys: ["invoices"] },
    { table: "payments", queryKeys: ["invoices"] },
  ], "invoices-rt");



  // Branding always comes from the user's active working depot (falls back to
  // organization branding). We no longer query a random depot row here.
  const depot = getPrintDepot();

  // All containers attached to an invoice (container sale = 1, conversion project = 1..n)
  const invoiceContainers = (inv: any): Array<{ id: string; container_number: string }> => {
    const out = new Map<string, { id: string; container_number: string }>();
    if (inv?.containers?.container_number) {
      out.set(inv.containers.id ?? inv.container_id, { id: inv.containers.id ?? inv.container_id, container_number: inv.containers.container_number });
    }
    for (const link of (inv?.invoice_containers ?? []) as any[]) {
      const c = link?.containers;
      if (c?.container_number) out.set(c.id ?? link.container_id, { id: c.id ?? link.container_id, container_number: c.container_number });
    }
    return Array.from(out.values());
  };




  const { data: invoices, isLoading } = useQuery({
    queryKey: ["invoices", search, statusFilter],
    queryFn: async () => {
      let q = supabase
        .from("invoices")
        .select("*, containers(id, container_number), invoice_containers(container_id, containers(id, container_number)), invoice_line_items(id, description, quantity, unit_price, total_price, charge_type), edi_exports(id, status, payload, interchange_control_ref, error, generated_at, downloaded_at), payments(id, amount, payment_method, reference_number, paid_at, financial_account_id)")
        .order("created_at", { ascending: false });
      if (search) q = q.or(`invoice_number.ilike.%${search}%,customer_name.ilike.%${search}%`);
      if (statusFilter !== "all") q = q.eq("status", statusFilter as any);
      const { data, error } = await q.limit(100);
      if (error) throw error;
      return data;
    },
  });

  const { data: containers } = useQuery({
    queryKey: ["containers-for-invoice"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("containers")
        .select("id, container_number, size, category, height_class, owner, shipping_line, gate_in_at")
        .not("gate_in_at", "is", null)
        .order("container_number");
      if (error) throw error;
      return data;
    },
  });

  const { data: tariffs } = useQuery({
    queryKey: ["tariffs-active"],
    queryFn: async () => {
      const { data, error } = await supabase.from("tariffs").select("*").eq("is_active", true);
      if (error) throw error;
      return data;
    },
  });

  const { data: customersList } = useQuery({
    queryKey: ["customers-for-invoice"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, company_name, currency")
        .eq("is_active", true)
        .order("company_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: workOrders } = useQuery({
    queryKey: ["completed-work-orders-for-billing"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_orders")
        .select("id, wo_number, container_id, actual_cost, containers(container_number), damage_estimates(total_cost, description)")
        .eq("status", "completed")
        .order("completed_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Create manual invoice
  const createInvoice = useMutation({
    mutationFn: async (form: any) => {
      if (form.is_container_billing && (form.container_ids ?? []).length === 0) {
        throw new Error("Container sale / conversion project invoices must have at least one linked container.");
      }
      const currency = form.currency;
      const subtotal = roundMoney(parseFloat(form.subtotal || 0), currency);
      const taxRate = parseFloat(form.tax_rate || 0);
      const taxAmount = roundMoney(subtotal * (taxRate / 100), currency);
      const totalAmount = roundMoney(subtotal + taxAmount, currency);
      assertTotalsMatch({ subtotal, taxAmount, total: totalAmount }, currency);
      const payload = {
        invoice_number: generateInvoiceNumber(),
        customer_name: form.customer_name,
        customer_id: form.customer_pick || null,
        customer_reference: form.customer_reference || null,
        container_id: (form.container_ids?.[0] as string) || null,
        invoice_type: form.invoice_type,
        subtotal,
        tax_rate: taxRate,
        tax_amount: taxAmount,
        total_amount: totalAmount,
        currency,
        status: "draft" as const,
        notes: form.notes || null,
        created_by: user?.id,
      };
      const { data: inv, error } = await supabase.from("invoices").insert(payload).select().single();
      if (error) throw error;


      // Add a single line item
      if (inv) {
        await supabase.from("invoice_line_items").insert({
          invoice_id: inv.id,
          description: form.line_description || `${form.invoice_type} charge`,
          quantity: parseFloat(form.quantity || 1),
          unit_price: parseFloat(form.unit_price || subtotal),
          total_price: subtotal,
          charge_type: form.invoice_type,
        });

        const ids = (form.container_ids ?? []) as string[];
        if (ids.length > 0) {
          await supabase
            .from("invoice_containers")
            .upsert(
              ids.map((cid) => ({ invoice_id: inv.id, container_id: cid })),
              { onConflict: "invoice_id,container_id", ignoreDuplicates: true }
            );
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast({ title: "Invoice created" });
      setDialogOpen(false);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // Auto-generate storage invoice
  const generateStorageInvoice = useMutation({
    mutationFn: async ({ containerId, taxRate }: { containerId: string; taxRate: number }) => {
      const container = containers?.find((c) => c.id === containerId);
      if (!container || !container.gate_in_at) throw new Error("Container not found or no gate-in date");

      const tariff = tariffs?.find((t: any) =>
        t.container_size === container.size &&
        t.container_category === container.category &&
        (container.category !== "dry" || t.height_class === container.height_class)
      );
      if (!tariff) throw new Error(`No active tariff for ${container.size}' ${container.category}${container.category === "dry" && container.height_class ? ` · ${container.height_class}` : ""}`);

      const dwellDays = differenceInDays(new Date(), new Date(container.gate_in_at));
      const billableDays = Math.max(0, dwellDays - Number(tariff.free_days));
      const currency = tariff.currency;
      const subtotal = roundMoney(billableDays * Number(tariff.rate_per_day), currency);
      const taxAmount = roundMoney(subtotal * (taxRate / 100), currency);
      const totalAmount = roundMoney(subtotal + taxAmount, currency);
      assertTotalsMatch({ subtotal, taxAmount, total: totalAmount }, currency);

      const { data: inv, error } = await supabase.from("invoices").insert({
        invoice_number: generateInvoiceNumber(),
        customer_name: container.owner || container.shipping_line || "Unknown",
        container_id: containerId,
        invoice_type: "storage" as const,
        subtotal,
        tax_rate: taxRate,
        tax_amount: taxAmount,
        total_amount: totalAmount,
        currency,
        status: "draft" as const,
        created_by: user?.id,
      }).select().single();
      if (error) throw error;


      if (inv) {
        await supabase.from("invoice_line_items").insert({
          invoice_id: inv.id,
          description: `Storage: ${container.container_number} — ${billableDays} days @ ${formatMoneyCode(tariff.rate_per_day, getOrgCurrency())}/day (${tariff.free_days} free days)`,
          quantity: billableDays,
          unit_price: Number(tariff.rate_per_day),
          total_price: subtotal,
          charge_type: "storage" as const,
          period_from: container.gate_in_at,
          period_to: new Date().toISOString(),
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast({ title: "Storage invoice generated" });
      setStorageDialogOpen(false);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const update: any = { status };
      if (status === "sent") update.issued_at = new Date().toISOString();
      if (status === "paid") update.paid_at = new Date().toISOString();
      const { error } = await supabase.from("invoices").update(update).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast({ title: "Invoice updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const downloadEdi = useMutation({
    mutationFn: async (inv: any) => {
      const exports = (inv.edi_exports ?? []).filter((e: any) => e.status !== "failed")
        .sort((a: any, b: any) => new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime());
      const latest = exports[0];
      if (!latest?.payload) throw new Error("No EDI payload available");
      const blob = new Blob([latest.payload], { type: "application/EDIFACT" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${inv.invoice_number}.edi`; a.click();
      URL.revokeObjectURL(url);
      const { error } = await supabase.rpc("mark_edi_downloaded" as any, { _export_id: latest.id });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast({ title: "EDI downloaded" });
    },
    onError: (e: any) => toast({ title: "EDI error", description: e.message, variant: "destructive" }),
  });

  const regenerateEdi = useMutation({
    mutationFn: async (invoiceId: string) => {
      const { error } = await supabase.rpc("generate_gate_in_edi" as any, { _invoice_id: invoiceId });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast({ title: "EDI regenerated" });
    },
    onError: (e: any) => toast({ title: "EDI error", description: e.message, variant: "destructive" }),
  });

  const issueGateFee = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("issue_gate_fee_invoice" as any, { _invoice_id: id });
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["invoices"] }); toast({ title: "Invoice issued" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const voidGateFee = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await supabase.rpc("void_gate_fee_invoice" as any, { _invoice_id: id, _reason: reason });
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["invoices"] }); toast({ title: "Invoice voided" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const creditNote = useMutation({
    mutationFn: async ({ id, amount, reason }: { id: string; amount: number | null; reason: string }) => {
      const { error } = await (supabase as any).rpc("create_credit_note", { _invoice_id: id, _amount: amount, _reason: reason });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast({ title: "Credit note issued" });
    },
    onError: (e: any) => toast({ title: "Could not issue credit note", description: e.message, variant: "destructive" }),
  });

  const [payDialog, setPayDialog] = useState<any>(null);
  const [payForm, setPayForm] = useState({ amount: "", method: "bank_transfer", financial_account_id: "", reference: "", notes: "" });
  const [payErrorMsg, setPayErrorMsg] = useState<string | null>(null);
  const payAmountNum = parseFloat(payForm.amount);
  const payTotal = payDialog ? parseFloat(payDialog.total_amount) : 0;
  const payPaid = payDialog ? (payDialog.payments ?? []).reduce((s: number, p: any) => s + parseFloat(p.amount), 0) : 0;
  const payBalance = Math.max(0, payTotal - payPaid);
  const payAmountError =
    !payForm.amount || isNaN(payAmountNum)
      ? "Enter an amount."
      : payAmountNum <= 0
        ? "Amount must be greater than zero."
        : payAmountNum > payBalance + 0.01
          ? `Amount exceeds balance due (${payDialog?.currency ?? ""} ${payBalance.toFixed(2)}).`
          : null;
  const recordPayment = useMutation({
    mutationFn: async () => {
      if (!payForm.financial_account_id) throw new Error("financial_account_required");
      if (payAmountError) throw new Error(payAmountError);
      const rpc = payDialog.invoice_type === "gate_fee" ? "record_gate_fee_payment" : "record_customer_payment";
      const { error } = await supabase.rpc(rpc as any, {
        _invoice_id: payDialog.id,
        _amount: payAmountNum,
        _account_id: payForm.financial_account_id,
        _method: payForm.method as any,
        _reference: payForm.reference || null,
        _notes: payForm.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["payments"] });
      queryClient.invalidateQueries({ queryKey: ["unrecorded-payments"] });
      queryClient.invalidateQueries({ queryKey: ["repatriation-invoices-batch"] });
      queryClient.invalidateQueries({ queryKey: ["repatriation-invoice-payments-batch"] });
      toast({ title: "Payment recorded" });
      setPayDialog(null);
      setPayErrorMsg(null);
      setPayForm({ amount: "", method: "bank_transfer", financial_account_id: "", reference: "", notes: "" });
    },
    onError: (e: any) => {
      const msg = mapRepatriationError(e);
      setPayErrorMsg(msg);
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  const handleExportInvoice = (inv: any) => {
    const cur = (inv.currency || getOrgCurrency()).toUpperCase();
    const text = [
      `INVOICE`,
      `================================`,
      `Invoice #: ${inv.invoice_number}`,
      `Currency: ${cur}`,
      `Status: ${inv.status.toUpperCase()}`,
      `Date: ${inv.issued_at ? format(new Date(inv.issued_at), "PPpp") : format(new Date(inv.created_at), "PPpp")}`,
      ``,
      `Customer: ${inv.customer_name}`,
      `${inv.customer_reference ? `Reference: ${inv.customer_reference}` : ""}`,
      `Container(s): ${invoiceContainers(inv).map((c) => c.container_number).join(", ") || "N/A"}`,
      `Type: ${inv.invoice_type}`,
      ``,
      `Subtotal: ${formatMoneyCode(inv.subtotal, cur)}`,
      `Tax (${parseFloat(inv.tax_rate).toFixed(1)}%): ${formatMoneyCode(inv.tax_amount, cur)}`,
      `================================`,
      `TOTAL — ${formatMoneyCode(inv.total_amount, cur)}`,
      ``,
      `All amounts in ${cur}.`,
      `${inv.notes ? `Notes: ${inv.notes}` : ""}`,
    ].filter(Boolean).join("\n");

    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${inv.invoice_number}.txt`; a.click();
  };

  const [form, setForm] = useState<any>({
    customer_pick: "", customer_name: "", customer_reference: "", container_ids: [] as string[], invoice_type: "storage",
    is_container_billing: false,
    line_description: "", quantity: "1", unit_price: "", subtotal: "", tax_rate: "21", currency: getOrgCurrency(), notes: "",
  });
  const containerBillingInvalid = form.is_container_billing && (form.container_ids as string[]).length === 0;

  const visibleInvoices = (invoices ?? []).filter((inv: any) => {
    const needle = containerFilter.trim().toLowerCase();
    if (!needle) return true;
    return invoiceContainers(inv).some((c) => c.container_number.toLowerCase().includes(needle));
  });
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const [storageForm, setStorageForm] = useState({ container_id: "", tax_rate: "21" });

  const outstandingByCurrency = (invoices ?? [])
    .filter((i: any) => i.status === "sent" || i.status === "overdue")
    .reduce((acc: Record<string, number>, i: any) => {
      const c = (i.currency || getOrgCurrency()).toUpperCase();
      acc[c] = (acc[c] ?? 0) + parseFloat(i.total_amount);
      return acc;
    }, {} as Record<string, number>);
  const draftCount = invoices?.filter((i: any) => i.status === "draft").length ?? 0;
  const { isOwnerOrAdmin } = useUserStaffRole();
  const [overrideFor, setOverrideFor] = useState<any>(null);
  const [transferEditFor, setTransferEditFor] = useState<{ id: string; invoice_number: string } | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("nav.invoices")}</h1>
          <p className="text-muted-foreground">
            {draftCount} drafts · outstanding{" "}
            {Object.keys(outstandingByCurrency).length === 0
              ? "—"
              : Object.entries(outstandingByCurrency)
                  .map(([c, v]) => formatMoneyCode(v, c))
                  .join(" · ")}
          </p>
        </div>

        <div className="flex gap-2">
          {/* Auto Storage Invoice */}
          <Dialog open={storageDialogOpen} onOpenChange={setStorageDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">Auto Storage Invoice</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Generate Storage Invoice</DialogTitle></DialogHeader>
              <p className="text-sm text-muted-foreground mb-4">
                Automatically calculate storage charges based on dwell time and active tariff rates.
              </p>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Container</Label>
                  <Select value={storageForm.container_id} onValueChange={(v) => setStorageForm((f) => ({ ...f, container_id: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select container" /></SelectTrigger>
                    <SelectContent>
                      {containers?.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.container_number} ({c.size}' {c.category}) — {c.gate_in_at ? `${differenceInDays(new Date(), new Date(c.gate_in_at))}d` : "N/A"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Tax Rate (%)</Label>
                  <Input type="number" step="0.1" value={storageForm.tax_rate} onChange={(e) => setStorageForm((f) => ({ ...f, tax_rate: e.target.value }))} />
                </div>
                <Button
                  className="w-full"
                  disabled={!storageForm.container_id || generateStorageInvoice.isPending}
                  onClick={() => generateStorageInvoice.mutate({ containerId: storageForm.container_id, taxRate: parseFloat(storageForm.tax_rate) })}
                >
                  Generate Invoice
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Manual Invoice */}
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="mr-1 h-4 w-4" />Manual Invoice</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Create Invoice</DialogTitle></DialogHeader>
              <form onSubmit={(e) => { e.preventDefault(); createInvoice.mutate(form); }} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Customer *</Label>
                    <Select
                      value={form.customer_pick || "__walkin__"}
                      onValueChange={(v) => {
                        if (v === "__walkin__") {
                          setForm((f: any) => ({ ...f, customer_pick: "", customer_name: "", currency: getOrgCurrency() }));
                        } else {
                          const c = customersList?.find((x: any) => x.id === v);
                          setForm((f: any) => ({
                            ...f,
                            customer_pick: v,
                            customer_name: c?.company_name ?? "",
                            currency: c?.currency || getOrgCurrency(),
                          }));
                        }
                      }}
                    >
                      <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__walkin__">Walk-in / custom name</SelectItem>
                        {customersList?.map((c: any) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.company_name}{c.currency ? ` · ${c.currency}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!form.customer_pick && (
                      <Input
                        value={form.customer_name}
                        onChange={(e) => set("customer_name", e.target.value)}
                        placeholder="Customer name"
                        required
                      />
                    )}
                    <p className="text-xs text-muted-foreground">
                      Currency: <span className="font-mono">{form.currency}</span>
                      {form.customer_pick ? " — from customer profile" : " — organization default"}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Customer Ref</Label>
                    <Input value={form.customer_reference} onChange={(e) => set("customer_reference", e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Container(s)</Label>
                    <div className="max-h-40 overflow-y-auto rounded-md border p-2 space-y-1">
                      {(containers ?? []).length === 0 && (
                        <p className="text-xs text-muted-foreground">No containers available</p>
                      )}
                      {containers?.map((c) => {
                        const checked = (form.container_ids as string[]).includes(c.id);
                        return (
                          <label key={c.id} className="flex cursor-pointer items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5"
                              checked={checked}
                              onChange={(e) =>
                                set(
                                  "container_ids",
                                  e.target.checked
                                    ? [...(form.container_ids as string[]), c.id]
                                    : (form.container_ids as string[]).filter((id) => id !== c.id)
                                )
                              }
                            />
                            <span className="font-mono">{c.container_number}</span>
                          </label>
                        );
                      })}
                    </div>
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5"
                        checked={!!form.is_container_billing}
                        onChange={(e) => set("is_container_billing", e.target.checked)}
                      />
                      Container sale / conversion project invoice
                    </label>
                    <p className={`text-xs ${containerBillingInvalid ? "text-destructive" : "text-muted-foreground"}`}>
                      {containerBillingInvalid
                        ? "Select at least one container — required for container sale / project invoices."
                        : (form.container_ids as string[]).length > 0
                          ? `${(form.container_ids as string[]).length} selected — first one is the primary container`
                          : "Optional — select one or more for container sales / conversion projects"}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Charge Type</Label>
                    <Select value={form.invoice_type} onValueChange={(v) => set("invoice_type", v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="storage">Storage</SelectItem>
                        <SelectItem value="repair">Repair</SelectItem>
                        <SelectItem value="handling">Handling</SelectItem>
                        <SelectItem value="gate_fee">Gate Fee</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Line Item Description</Label>
                  <Input value={form.line_description} onChange={(e) => set("line_description", e.target.value)} placeholder="Description of the charge" />
                </div>
                <div className="grid grid-cols-4 gap-3">
                  <div className="space-y-2">
                    <Label>Qty</Label>
                    <Input type="number" min="1" value={form.quantity} onChange={(e) => set("quantity", e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Unit Price</Label>
                    <Input type="number" step="0.01" value={form.unit_price} onChange={(e) => set("unit_price", e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Subtotal</Label>
                    <Input type="number" step="0.01" value={form.subtotal} onChange={(e) => set("subtotal", e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label>Tax %</Label>
                    <Input type="number" step="0.1" value={form.tax_rate} onChange={(e) => set("tax_rate", e.target.value)} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} />
                </div>
                <Button type="submit" className="w-full" disabled={createInvoice.isPending || containerBillingInvalid}>Create Invoice</Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search invoice or customer..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <div className="relative sm:w-56">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Filter by container #..."
                value={containerFilter}
                onChange={(e) => setContainerFilter(e.target.value)}
                className="pl-9 font-mono"
              />
            </div>
            <Button variant="outline" size="sm" onClick={() => {
              if (!invoices?.length) return;
              const headers = ["Invoice #","Date","Customer","Type","Status","Subtotal","Tax","Total","Currency"];
              const rows = invoices.map((i: any) => [i.invoice_number, i.issued_at ? format(new Date(i.issued_at),"yyyy-MM-dd") : "", i.customer_name, i.invoice_type, i.status, String(i.subtotal), String(i.tax_amount), String(i.total_amount), i.currency]);
              exportCSV("invoices.csv", headers, rows);
            }}><FileDown className="h-4 w-4 mr-1" />CSV</Button>
            <Button variant="outline" size="sm" onClick={() => {
              if (!invoices?.length) return;
              const headers = ["Invoice #","Date","Customer","Type","Status","Subtotal","Tax","Total","Currency"];
              const rows = invoices.map((i: any) => [i.invoice_number, i.issued_at ? format(new Date(i.issued_at),"yyyy-MM-dd") : "", i.customer_name, i.invoice_type, i.status, String(i.subtotal), String(i.tax_amount), String(i.total_amount), i.currency]);
              exportPDF("Invoices Report", "invoices.pdf", headers, rows, { landscape: true });
            }}><FileText className="h-4 w-4 mr-1" />PDF</Button>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
                <SelectItem value="credited">Credited</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Container</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableSkeleton columns={8} />
              ) : !visibleInvoices.length ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No invoices found</TableCell></TableRow>
              ) : (
                visibleInvoices.map((inv: any) => {
                  const isRep = typeof inv.invoice_number === "string" && inv.invoice_number.startsWith("REP-");
                  const repRef = isRep ? inv.invoice_number.slice(4) : null;
                  const invContainers = invoiceContainers(inv);
                  return (
                  <TableRow key={inv.id}>
                    <TableCell className="font-mono text-sm font-medium">
                      <div className="flex items-center gap-2">
                        <span>{inv.invoice_number}</span>
                        {isRep && (
                          <TooltipProvider delayDuration={200}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Link to={`/repatriation?highlight=${encodeURIComponent(repRef!)}`}>
                                  <Badge variant="outline" className="gap-1 border-purple-300 bg-purple-500/10 text-purple-700 hover:bg-purple-500/20">
                                    <Ship className="h-3 w-3" /> REP
                                  </Badge>
                                </Link>
                              </TooltipTrigger>
                              <TooltipContent>Linked to repatriation {repRef}</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{inv.customer_name}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {invContainers.length === 0 ? "—" : (
                        <TooltipProvider delayDuration={200}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex items-center gap-1">
                                <Link to={`/containers/${invContainers[0].id}`} className="text-info hover:underline">
                                  {invContainers[0].container_number}
                                </Link>
                                {invContainers.length > 1 && (
                                  <Badge variant="outline" className="text-[10px]">+{invContainers.length - 1}</Badge>
                                )}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {invContainers.map((c) => c.container_number).join(", ")}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </TableCell>
                    <TableCell className="capitalize text-sm">{inv.invoice_type.replace("_", " ")}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      <span className="text-xs text-muted-foreground mr-1">{(inv.currency ?? "").toUpperCase()}</span>
                      {parseFloat(inv.total_amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {(() => {
                        const paid = ((inv.payments ?? []) as any[]).reduce((s, p) => s + parseFloat(p.amount), 0);
                        const bal = Math.max(0, parseFloat(inv.total_amount) - paid);
                        const cls = bal <= 0.01 ? "text-success" : bal < parseFloat(inv.total_amount) ? "text-warning" : "";
                        return <span className={cls}>{bal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>;
                      })()}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusColors[inv.status] ?? ""}>{inv.status}</Badge>
                    </TableCell>

                    <TableCell className="text-sm text-muted-foreground">{format(new Date(inv.created_at), "PP")}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {inv.status === "draft" && (
                          inv.invoice_type === "gate_fee" ? (
                            <Button size="sm" variant="outline" title="Issue (draft → issued)" onClick={() => issueGateFee.mutate(inv.id)}>
                              <Send className="h-3.5 w-3.5" />
                            </Button>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: inv.id, status: "sent" })}>
                              <Send className="h-3.5 w-3.5" />
                            </Button>
                          )
                        )}
                        {(inv.status === "sent" || inv.status === "overdue") && !inv.credit_of_invoice_id && (() => {
                          const paidSoFar = (inv.payments ?? []).reduce((s: number, p: any) => s + parseFloat(p.amount), 0);
                          const bal = Math.max(0, parseFloat(inv.total_amount) - paidSoFar);
                          return (
                            <Button size="sm" variant="outline" onClick={() => { setPayDialog(inv); setPayForm({ amount: bal.toFixed(2), method: "bank_transfer", financial_account_id: "", reference: "", notes: "" }); }}>
                              Record Payment
                            </Button>
                          );
                        })()}
                        {!inv.credit_of_invoice_id && ["sent","overdue","paid"].includes(inv.status) && (
                          <Button size="sm" variant="ghost" title="Issue a credit note against this invoice" onClick={() => {
                            const raw = window.prompt(`Credit note amount for ${inv.invoice_number} (leave blank to credit the whole unpaid balance)`, "");
                            if (raw === null) return;
                            const amount = raw.trim() === "" ? null : Number(raw.replace(/,/g, ""));
                            if (amount !== null && (!Number.isFinite(amount) || amount <= 0)) {
                              toast({ title: "Enter a positive amount", variant: "destructive" });
                              return;
                            }
                            const reason = window.prompt("Reason for the credit note?", "") ?? "";
                            creditNote.mutate({ id: inv.id, amount, reason });
                          }}>Credit</Button>
                        )}
                        {inv.invoice_type === "gate_fee" && !["cancelled","credited"].includes(inv.status) && (
                          <Button size="sm" variant="ghost" title="Void / Refund" onClick={() => {
                            const reason = window.prompt("Void reason?", "Manual void");
                            if (reason !== null) voidGateFee.mutate({ id: inv.id, reason });
                          }}>Void</Button>
                        )}
                        {isOwnerOrAdmin && !["paid","cancelled","credited"].includes(inv.status) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Override currency (admin, audited)"
                            onClick={() => setOverrideFor(inv)}
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {isOwnerOrAdmin
                          && typeof inv.invoice_number === "string"
                          && inv.invoice_number.startsWith("RPT-")
                          && !["paid","cancelled","credited"].includes(inv.status) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Edit transfer fees (admin, audited)"
                            onClick={() => setTransferEditFor({ id: inv.id, invoice_number: inv.invoice_number })}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => handleExportInvoice(inv)}>
                          <Download className="h-3.5 w-3.5" />
                        </Button>

                        <Button size="sm" variant="ghost" onClick={() => {
                          const invCur = (inv.currency || "").toUpperCase();
                          const accts = (financialAccounts ?? []) as any[];
                          const bankAcct =
                            accts.find(a => a.is_active && a.account_type === "bank" && (a.currency || "").toUpperCase() === invCur && a.is_default) ||
                            accts.find(a => a.is_active && a.account_type === "bank" && (a.currency || "").toUpperCase() === invCur) ||
                            accts.find(a => a.is_active && a.account_type === "bank" && a.is_default) ||
                            accts.find(a => a.is_active && a.account_type === "bank");
                          const bankInfo = bankAcct
                            ? ((accountBankDetails ?? []).find((b: any) => b.account_id === bankAcct.id) ?? null)
                            : null;

                          const pays = ((inv.payments ?? []) as any[])
                            .slice()
                            .sort((a, b) => new Date(a.paid_at).getTime() - new Date(b.paid_at).getTime());
                          const paidSoFar = pays.reduce((s, p) => s + parseFloat(p.amount), 0);
                          const total = parseFloat(inv.total_amount);
                          printInvoice({
                            invoice_number: inv.invoice_number,
                            status: inv.status,
                            customer_name: inv.customer_name,
                            customer_reference: inv.customer_reference,
                            container_number: invoiceContainers(inv)[0]?.container_number,
                            container_numbers: invoiceContainers(inv).map((c) => c.container_number),
                            invoice_type: inv.invoice_type,
                            line_items: ((inv as any).invoice_line_items ?? []).map((li: any) => ({
                              description: li.description,
                              quantity: Number(li.quantity),
                              unit_price: Number(li.unit_price),
                              total_price: Number(li.total_price),
                              charge_type: li.charge_type,
                            })),
                            subtotal: parseFloat(inv.subtotal),
                            tax_rate: parseFloat(inv.tax_rate),
                            tax_amount: parseFloat(inv.tax_amount),
                            total_amount: total,
                            currency: inv.currency,
                            notes: inv.notes,
                            issued_at: inv.issued_at,
                            due_at: inv.due_at,
                            created_at: inv.created_at,
                            depot: depot ? { name: depot.name, location: depot.location, logo_url: depot.logo_url } : null,
                            bank_account: bankAcct ? {
                              bank_name: bankInfo?.bank_name ?? null,
                              account_name: bankAcct.name,
                              account_number: bankInfo?.account_number ?? null,
                              branch: bankInfo?.branch ?? null,
                              swift_bic: bankInfo?.swift_bic ?? null,
                              currency: bankAcct.currency,
                            } : null,

                            payments: pays.map(p => ({
                              paid_at: p.paid_at,
                              amount: parseFloat(p.amount),
                              method: p.payment_method,
                              reference: p.reference_number,
                            })),
                            amount_paid: paidSoFar,
                            balance_due: Math.max(0, total - paidSoFar),
                          });
                        }}>
                          <Printer className="h-3.5 w-3.5" />
                        </Button>
                        {inv.invoice_type === "gate_fee" && (() => {
                          const exports = (inv.edi_exports ?? []) as any[];
                          const latest = exports.slice().sort((a, b) =>
                            new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime())[0];
                          const failed = latest?.status === "failed";
                          return (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                title={failed ? `EDI failed: ${latest?.error ?? ""}` : `EDI ${latest?.status ?? "n/a"}`}
                                disabled={!latest || failed || downloadEdi.isPending}
                                onClick={() => downloadEdi.mutate(inv)}
                              >
                                <FileCode2 className={`h-3.5 w-3.5 ${failed ? "text-destructive" : latest?.status === "downloaded" ? "text-success" : ""}`} />
                              </Button>
                              {(failed || !latest) && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  title="Regenerate EDI"
                                  disabled={regenerateEdi.isPending}
                                  onClick={() => regenerateEdi.mutate(inv.id)}
                                >
                                  <RefreshCw className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!payDialog} onOpenChange={(o) => { if (!o) { setPayDialog(null); setPayErrorMsg(null); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Payment</DialogTitle></DialogHeader>
          {payDialog && (
            <form onSubmit={(e) => { e.preventDefault(); recordPayment.mutate(); }} className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {payDialog.invoice_number} · {payDialog.customer_name}<br />
                Total {payDialog.currency} {payTotal.toFixed(2)} · Paid {payDialog.currency} {payPaid.toFixed(2)} · <strong>Balance {payDialog.currency} {payBalance.toFixed(2)}</strong>
              </p>
              {payErrorMsg && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{payErrorMsg}</AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <Label>Receiving account *</Label>
                <Select value={payForm.financial_account_id} onValueChange={(v) => { setPayForm((f) => ({ ...f, financial_account_id: v })); setPayErrorMsg(null); }}>
                  <SelectTrigger><SelectValue placeholder="Select bank / cash account" /></SelectTrigger>
                  <SelectContent>
                    {(financialAccounts ?? []).map((a: any) => (
                      <SelectItem key={a.id} value={a.id}>{a.name} ({formatAccountTypeLabel(a.account_type)}{a.currency ? ` · ${a.currency}` : ""})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Amount *</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max={payTotal}
                    required
                    value={payForm.amount}
                    onChange={(e) => { setPayForm((f) => ({ ...f, amount: e.target.value })); setPayErrorMsg(null); }}
                    aria-invalid={!!payAmountError}
                  />
                  {payAmountError && (
                    <p className="text-xs text-destructive">{payAmountError}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Method</Label>
                  <Select value={payForm.method} onValueChange={(v) => setPayForm((f) => ({ ...f, method: v }))}>
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
              <div className="space-y-2">
                <Label>Reference</Label>
                <Input value={payForm.reference} onChange={(e) => setPayForm((f) => ({ ...f, reference: e.target.value }))} placeholder="Bank ref / cheque no." />
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea value={payForm.notes} onChange={(e) => setPayForm((f) => ({ ...f, notes: e.target.value }))} />
              </div>
              <Button type="submit" className="w-full" disabled={recordPayment.isPending || !!payAmountError || !payForm.financial_account_id}>
                Record Payment
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
      {overrideFor && (
        <CurrencyOverrideDialog
          open={!!overrideFor}
          onOpenChange={(o) => !o && setOverrideFor(null)}
          kind="sales"
          invoiceId={overrideFor.id}
          invoiceNumber={overrideFor.invoice_number}
          currentCurrency={overrideFor.currency}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: ["invoices"] })}
        />
      )}
      <EditTransferFeesDialog invoice={transferEditFor} onOpenChange={(o) => !o && setTransferEditFor(null)} />

    </div>
  );
}
