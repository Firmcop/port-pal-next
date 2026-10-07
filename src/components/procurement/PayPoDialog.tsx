import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useFinancialAccounts } from "@/hooks/use-financial-accounts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { formatMoney } from "@/lib/app-settings";

const METHODS = [
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "cash", label: "Cash" },
  { value: "cheque", label: "Cheque" },
  { value: "credit_card", label: "Credit card" },
  { value: "other", label: "Other" },
];

/** Records an actual vendor payment against a purchase order (account, amount, date, reference). */
export default function PayPoDialog({
  poId,
  open,
  onOpenChange,
}: {
  poId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: accounts } = useFinancialAccounts();

  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [fxRate, setFxRate] = useState("");
  const [bankCharge, setBankCharge] = useState("");
  const [bankChargeNote, setBankChargeNote] = useState("");

  const { data: po } = useQuery({
    queryKey: ["po-pay-target", poId],
    enabled: !!poId && open,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("purchase_orders")
        .select("id, po_number, total_cost, currency, status, suppliers:supplier_id(name)")
        .eq("id", poId!)
        .maybeSingle();
      if (error) throw error;
      const { data: paid, error: pErr } = await (supabase as any)
        .from("vendor_payments")
        .select("amount")
        .eq("po_id", poId!);
      if (pErr) throw pErr;
      const alreadyPaid = (paid ?? []).reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0);
      return { ...data, already_paid: alreadyPaid, balance: Number(data?.total_cost ?? 0) - alreadyPaid };
    },
  });

  const poCurrency: string | undefined = po?.currency ? String(po.currency).toUpperCase() : undefined;
  const selectedAccount = (accounts ?? []).find((a: any) => a.id === accountId) as any;
  const accountCurrency = selectedAccount?.currency ? String(selectedAccount.currency).toUpperCase() : undefined;
  const currencyMismatch = !!poCurrency && !!accountCurrency && poCurrency !== accountCurrency;

  useEffect(() => {
    if (po && open) setAmount(String(Math.max(0, Number(po.balance ?? 0)).toFixed(2)));
  }, [po?.id, open]);

  const fxNum = parseFloat(fxRate) || 0;
  const chargeNum = parseFloat(bankCharge) || 0;

  const pay = useMutation({
    mutationFn: async () => {
      if (!accountId) throw new Error("Choose the account the supplier is paid from");
      const amt = parseFloat(amount);
      if (!amt || amt <= 0) throw new Error("Enter the amount paid");
      if (currencyMismatch && fxNum <= 0) throw new Error(`Declare the ${poCurrency}/${accountCurrency} rate used`);
      const { error } = await (supabase as any).rpc("record_vendor_payment", {
        _po_id: poId,
        _amount: amt,
        _account_id: accountId,
        _method: method,
        _reference: reference || null,
        _paid_at: new Date(paidAt).toISOString(),
        _notes: notes || null,
        _currency: poCurrency || null,
        _fx_rate: fxNum > 0 ? fxNum : null,
        _bank_charge: chargeNum,
        _bank_charge_note: bankChargeNote || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      [
        "purchase-orders", "po-status-events", "vendor-payments", "vendor-payments-summary",
        "supplier-pos", "unpaid-pos-summary", "unrecorded-payments", "pos-awaiting-payment",
        "account-balances", "accounting-transactions", "operating-expenses", "finance-dashboard-metrics", "po-pay-target",
      ].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast({ title: "Vendor payment recorded", description: "The ledger, bank balance and PO status are updated." });
      onOpenChange(false);
      setReference(""); setNotes(""); setFxRate(""); setBankCharge(""); setBankChargeNote("");
    },
    onError: (e: any) => toast({ title: "Payment failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pay supplier{po?.po_number ? ` — ${po.po_number}` : ""}</DialogTitle>
          <DialogDescription>
            {po
              ? `${po.suppliers?.name ?? "Supplier"} · total ${formatMoney(po.total_cost, poCurrency)} · outstanding ${formatMoney(po.balance, poCurrency)}`
              : "Loading purchase order…"}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label>Pay from account *</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger><SelectValue placeholder="Cash / bank account" /></SelectTrigger>
              <SelectContent>
                {(accounts ?? []).map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.name}{a.currency ? ` (${a.currency})` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Amount *{poCurrency ? ` (${poCurrency})` : ""}</Label>
            <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Payment date</Label>
            <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Method</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Reference</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Cheque / transfer ref" />
          </div>
          <div className="space-y-1">
            <Label>Declared FX rate {currencyMismatch ? "*" : ""}</Label>
            <Input type="number" step="0.000001" min="0" value={fxRate} onChange={(e) => setFxRate(e.target.value)}
              placeholder={currencyMismatch ? `${poCurrency} → ${accountCurrency}` : "Same currency"} />
          </div>
          <div className="space-y-1">
            <Label>Bank charges{accountCurrency ? ` (${accountCurrency})` : ""}</Label>
            <Input type="number" step="0.01" min="0" value={bankCharge} onChange={(e) => setBankCharge(e.target.value)} />
          </div>
          {chargeNum > 0 && (
            <div className="space-y-1 sm:col-span-2">
              <Label>Bank charge note</Label>
              <Input value={bankChargeNote} onChange={(e) => setBankChargeNote(e.target.value)} placeholder="e.g. SWIFT transfer fee" />
            </div>
          )}
          <div className="space-y-1 sm:col-span-2">
            <Label>Notes</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {currencyMismatch && (
            <p className="sm:col-span-2 text-xs text-warning">
              This purchase order is in {poCurrency} but the selected account is in {accountCurrency} — declare the rate
              the bank actually used so the ledger matches the statement.
            </p>
          )}
          {chargeNum > 0 && (
            <p className="sm:col-span-2 text-xs text-muted-foreground">
              Bank charges are posted as a paid operating expense and appear in the P&amp;L.
            </p>
          )}
          {po && parseFloat(amount || "0") > 0 && parseFloat(amount) < Number(po.balance) && (
            <p className="sm:col-span-2 text-xs text-muted-foreground">
              This is a part payment — the purchase order stays open with a balance of{" "}
              {formatMoney(Number(po.balance) - parseFloat(amount), poCurrency)}.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={pay.isPending} onClick={() => pay.mutate()}>
            {pay.isPending ? "Recording…" : "Record payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
