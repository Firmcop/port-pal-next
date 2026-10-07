import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useFinancialAccounts } from "@/hooks/use-financial-accounts";
import { formatMoneyCode } from "@/lib/money";
import { Wallet } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type PreviewLine = {
  supplier_invoice_id: string;
  invoice_number: string;
  currency: string;
  due_date: string | null;
  total_amount: number;
  paid_amount: number;
  due: number;
  proposed: number;
};

/**
 * Records a supplier payment that is NOT tied to a single purchase order.
 * The backend proposes an oldest-invoice-first split; the operator can override
 * each line before saving. Anything left over stays as a supplier credit.
 */
export function LumpsumPaymentDialog({ open, onOpenChange }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: accounts } = useFinancialAccounts();

  const [supplierId, setSupplierId] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("");
  const [accountId, setAccountId] = useState("");
  const [method, setMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [notes, setNotes] = useState("");
  const [manual, setManual] = useState(false);
  const [split, setSplit] = useState<Record<string, string>>({});
  const [fxRate, setFxRate] = useState("");
  const [bankCharge, setBankCharge] = useState("");
  const [bankChargeNote, setBankChargeNote] = useState("");

  const { data: suppliers } = useQuery({
    queryKey: ["suppliers-active-lumpsum"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers").select("id, name, currency").eq("is_active", true).order("name");
      if (error) throw error;
      return data ?? [];
    },
    enabled: open,
  });

  const amountNum = parseFloat(amount) || 0;

  const { data: preview, isFetching } = useQuery({
    queryKey: ["lumpsum-preview", supplierId, amountNum, currency],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("preview_supplier_payment_allocation", {
        _supplier_id: supplierId,
        _amount: amountNum,
        _currency: currency || null,
      });
      if (error) throw error;
      return data as any;
    },
    enabled: open && !!supplierId && amountNum > 0,
  });

  const lines: PreviewLine[] = useMemo(() => preview?.lines ?? [], [preview]);

  useEffect(() => {
    if (!manual) {
      const next: Record<string, string> = {};
      lines.forEach((l) => { next[l.supplier_invoice_id] = String(l.proposed ?? 0); });
      setSplit(next);
    }
  }, [lines, manual]);

  const cur = preview?.currency || currency || "";
  const allocated = Object.values(split).reduce((s, v) => s + (parseFloat(v) || 0), 0);
  const unallocated = Math.max(amountNum - allocated, 0);
  const overAllocated = allocated - amountNum > 0.01;
  const chargeNum = parseFloat(bankCharge) || 0;
  const fxNum = parseFloat(fxRate) || 0;

  const account = (accounts ?? []).find((a: any) => a.id === accountId) as any;
  const accountCurrency = account?.currency ? String(account.currency).toUpperCase() : undefined;
  const payCurrency = (cur || currency || "").toUpperCase();
  const currencyMismatch = !!accountCurrency && !!payCurrency && accountCurrency !== payCurrency;

  const deviates = useMemo(() => {
    if (!manual) return false;
    return lines.some((l) => Math.abs((parseFloat(split[l.supplier_invoice_id] || "0") || 0) - Number(l.proposed || 0)) > 0.01);
  }, [manual, lines, split]);

  const reset = () => {
    setSupplierId(""); setAmount(""); setCurrency(""); setAccountId("");
    setMethod("bank_transfer"); setReference(""); setPaidAt(""); setNotes("");
    setManual(false); setSplit({}); setFxRate(""); setBankCharge(""); setBankChargeNote("");
  };

  const record = useMutation({
    mutationFn: async () => {
      if (!supplierId) throw new Error("Select a supplier");
      if (amountNum <= 0) throw new Error("Enter an amount");
      if (!accountId) throw new Error("Select the account paying this supplier");
      if (overAllocated) throw new Error("Allocated amount exceeds the payment");
      if (currencyMismatch && fxNum <= 0) throw new Error(`Declare the ${payCurrency}/${accountCurrency} rate used`);

      const allocations = manual
        ? lines
            .map((l) => ({ supplier_invoice_id: l.supplier_invoice_id, amount: parseFloat(split[l.supplier_invoice_id] || "0") || 0 }))
            .filter((a) => a.amount > 0)
        : null;

      const { data, error } = await (supabase as any).rpc("record_supplier_onaccount_payment", {
        _supplier_id: supplierId,
        _amount: amountNum,
        _account_id: accountId,
        _method: method,
        _reference: reference || null,
        _paid_at: paidAt ? new Date(paidAt).toISOString() : new Date().toISOString(),
        _notes: notes || null,
        _currency: currency || null,
        _fx_rate: fxNum > 0 ? fxNum : null,
        _allocations: allocations,
        _bank_charge: chargeNum,
        _bank_charge_note: bankChargeNote || null,
      });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (res: any) => {
      ["vendor-payments", "vendor-payment-unallocated", "supplier-invoices", "purchase-orders",
        "finance-approvals", "operating-expenses", "account-balances", "counterparty-reconciliation", "finance-dashboard-metrics"]
        .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      if (res?.allocation_status === "pending_approval") {
        toast({
          title: `Payment ${res?.payment_number ?? ""} recorded — allocation pending approval`.trim(),
          description: "The manual split differs from the proposed allocation, so it waits for a finance approval before it is applied to the invoices.",
        });
      } else {
        toast({
          title: `Payment ${res?.payment_number ?? ""} recorded`.trim(),
          description: `Allocated ${formatMoneyCode(Number(res?.allocated || 0), res?.currency)} · on account ${formatMoneyCode(Number(res?.unallocated || 0), res?.currency)}`,
        });
      }
      reset();
      onOpenChange(false);
    },
    onError: (e: any) => toast({ title: "Could not record payment", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Wallet className="h-4 w-4" />Record lumpsum supplier payment</DialogTitle>
          <DialogDescription>
            One payment covering several invoices. The system proposes an oldest-first split; adjust it if the supplier
            specified which invoices to settle. Anything unallocated is held as a supplier credit.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Supplier *</Label>
              <Select value={supplierId} onValueChange={(v) => { setSupplierId(v); setManual(false); const s = suppliers?.find((x: any) => x.id === v); setCurrency((s as any)?.currency || ""); }}>
                <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                <SelectContent>
                  {suppliers?.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2 space-y-2">
                <Label>Amount paid *</Label>
                <Input type="number" step="0.01" min="0" value={amount} onChange={(e) => { setAmount(e.target.value); setManual(false); }} />
              </div>
              <div className="space-y-2">
                <Label>Currency</Label>
                <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} placeholder="KES" />
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Paid from account *</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger><SelectValue placeholder="Select bank / cash" /></SelectTrigger>
                <SelectContent>
                  {accounts?.map((a: any) => <SelectItem key={a.id} value={a.id}>{a.name} ({a.currency})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label>Method</Label>
                <Select value={method} onValueChange={setMethod}>
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
              <div className="space-y-2">
                <Label>Reference #</Label>
                <Input value={reference} onChange={(e) => setReference(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Payment date</Label>
              <Input type="datetime-local" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Declared FX rate {currencyMismatch ? "*" : ""}</Label>
              <Input type="number" step="0.000001" min="0" value={fxRate} onChange={(e) => setFxRate(e.target.value)}
                placeholder={currencyMismatch ? `${payCurrency} → ${accountCurrency}` : "Same currency"} />
            </div>
            <div className="space-y-2">
              <Label>Bank charges {accountCurrency ? `(${accountCurrency})` : ""}</Label>
              <Input type="number" step="0.01" min="0" value={bankCharge} onChange={(e) => setBankCharge(e.target.value)} />
              <p className="text-xs text-muted-foreground">Posted to OPEX as a bank charge.</p>
            </div>
          </div>

          {chargeNum > 0 && (
            <div className="space-y-2">
              <Label>Bank charge note</Label>
              <Input value={bankChargeNote} onChange={(e) => setBankChargeNote(e.target.value)} placeholder="e.g. SWIFT transfer fee" />
            </div>
          )}

          {currencyMismatch && (
            <p className="text-xs text-warning">
              This payment is in {payCurrency} but the account is in {accountCurrency} — declare the rate the bank actually used.
            </p>
          )}

          <div className="rounded-md border">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
              <div className="text-sm font-medium">Proposed allocation {isFetching ? "…" : ""}</div>
              <div className="flex items-center gap-2 text-xs">
                <Badge variant="secondary">Allocated {formatMoneyCode(allocated, cur)}</Badge>
                <Badge variant={unallocated > 0.01 ? "outline" : "secondary"}>On account {formatMoneyCode(unallocated, cur)}</Badge>
                <Button type="button" size="sm" variant={manual ? "default" : "outline"} onClick={() => setManual((m) => !m)}>
                  {manual ? "Manual split" : "Auto (oldest first)"}
                </Button>
              </div>
            </div>
            {lines.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                {supplierId && amountNum > 0 ? "No open invoices in this currency — the full amount will be held as a supplier credit." : "Pick a supplier and amount to see the proposed split."}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                    <TableHead className="text-right w-36">Allocate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l) => (
                    <TableRow key={l.supplier_invoice_id}>
                      <TableCell className="font-mono text-xs">{l.invoice_number}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{l.due_date ? new Date(l.due_date).toLocaleDateString() : "—"}</TableCell>
                      <TableCell className="text-right text-sm">{formatMoneyCode(Number(l.due), l.currency)}</TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number" step="0.01" min="0" max={l.due}
                          className="h-8 text-right"
                          disabled={!manual}
                          value={split[l.supplier_invoice_id] ?? "0"}
                          onChange={(e) => setSplit((s) => ({ ...s, [l.supplier_invoice_id]: e.target.value }))}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          {overAllocated && (
            <p className="text-sm text-destructive">Allocated amount exceeds the payment by {formatMoneyCode(allocated - amountNum, cur)}.</p>
          )}

          {deviates && (
            <p className="text-sm text-muted-foreground">
              This split differs from the proposed oldest-first allocation, so it is submitted for approval. The payment
              is still recorded against the bank account; the invoices are settled once the allocation is approved.
            </p>
          )}

          <div className="space-y-2">
            <Label>Notes {deviates ? "(reason for the manual split)" : ""}</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Bank slip, remittance advice reference…" />
          </div>

          <Button
            className="w-full"
            disabled={record.isPending || !supplierId || amountNum <= 0 || !accountId || overAllocated}
            onClick={() => record.mutate()}
          >
            {deviates ? "Record payment & submit allocation for approval" : "Record payment"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default LumpsumPaymentDialog;
