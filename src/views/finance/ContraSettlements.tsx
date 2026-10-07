import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useFinancialAccounts } from "@/hooks/use-financial-accounts";
import { FinanceApprovalsPanel } from "@/components/finance/FinanceApprovalsPanel";
import { formatMoneyCode } from "@/lib/money";
import { Link } from "@/lib/router";
import { ArrowLeftRight, Info, Undo2 } from "lucide-react";

/**
 * Contra settlement (set-off) between a counterparty that is both customer and supplier.
 * Accounting policy: IAS 32.42 — receivables and payables stay GROSS in the ledger and
 * are settled by an explicit offset entry through a "Contra Set-off Clearing" account,
 * which nets to zero. Offsetting is only presented when a legally enforceable right of
 * set-off exists and both parties intend to settle net. The rules (netting allowed,
 * evidence required, approval threshold) come from the organisation accounting policy.
 */
export default function ContraSettlements() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: accounts } = useFinancialAccounts();
  const [supplierId, setSupplierId] = useState("");
  const [currency, setCurrency] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [evidenceRef, setEvidenceRef] = useState("");
  const [accountId, setAccountId] = useState("");
  const [cashAmount, setCashAmount] = useState("");
  const [fxRate, setFxRate] = useState("");
  const [bankCharge, setBankCharge] = useState("");
  const [bankChargeNote, setBankChargeNote] = useState("");

  const { data: policy } = useQuery({
    queryKey: ["accounting-policy"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_accounting_policy");
      if (error) throw error;
      return data as any;
    },
  });

  const { data: suppliers } = useQuery({
    queryKey: ["suppliers-contra"],
    queryFn: async () => {
      const { data, error } = await supabase.from("suppliers").select("id, name").eq("is_active", true).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: preview, isFetching } = useQuery({
    queryKey: ["contra-preview", supplierId],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("preview_contra_settlement", { _supplier_id: supplierId });
      if (error) throw error;
      return data as any;
    },
    enabled: !!supplierId,
  });

  const { data: history } = useQuery({
    queryKey: ["contra-settlements"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("contra_settlements")
        .select("*, contra_settlement_lines(*)")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  const totals: any[] = useMemo(() => preview?.totals ?? [], [preview]);
  const selected = totals.find((t) => t.currency === currency) ?? totals[0];
  const offsettable = Number(selected?.offsettable ?? 0);
  const amountNum = parseFloat(amount) || 0;
  const cashNum = parseFloat(cashAmount) || 0;
  const chargeNum = parseFloat(bankCharge) || 0;

  const nettingEnabled = policy?.netting_enabled !== false;
  const evidenceRequired = !!policy?.require_setoff_evidence;
  const threshold = Number(policy?.offset_approval_threshold ?? 0);
  const needsApproval = threshold > 0 && amountNum >= threshold;

  const settlementAccount = (accounts ?? []).find((a: any) => a.id === accountId) as any;
  const accountCurrency = settlementAccount?.currency ? String(settlementAccount.currency).toUpperCase() : undefined;
  const docCurrency = selected?.currency ? String(selected.currency).toUpperCase() : undefined;
  const cashCurrencyMismatch = cashNum > 0 && !!accountCurrency && !!docCurrency && accountCurrency !== docCurrency;
  const fxNum = parseFloat(fxRate) || 0;

  const post = useMutation({
    mutationFn: async () => {
      if (evidenceRequired && !evidenceRef.trim()) throw new Error("A set-off evidence reference is required by policy");
      if (cashNum > 0 && !accountId) throw new Error("Choose the bank / cash account settling the residual");
      if (cashCurrencyMismatch && fxNum <= 0) throw new Error(`Declare the ${accountCurrency}/${docCurrency} rate used`);
      const { data, error } = await (supabase as any).rpc("post_contra_settlement", {
        _supplier_id: supplierId,
        _currency: selected?.currency,
        _amount: amountNum,
        _notes: notes || null,
        _settled_on: null,
        _account_id: accountId || null,
        _cash_amount: cashNum,
        _fx_rate: fxNum > 0 ? fxNum : null,
        _bank_charge: chargeNum,
        _bank_charge_note: bankChargeNote || null,
        _evidence_ref: evidenceRef || null,
      });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (res: any) => {
      ["contra-settlements", "contra-preview", "invoices", "supplier-invoices", "payments", "vendor-payments",
        "finance-approvals", "counterparty-reconciliation", "operating-expenses", "account-balances", "finance-dashboard-metrics"]
        .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      if (res?.status === "pending_approval") {
        toast({ title: "Sent for approval", description: `${formatMoneyCode(Number(res?.amount || 0), res?.currency)} is above the ${formatMoneyCode(threshold, res?.currency)} threshold and posts once approved.` });
      } else {
        toast({ title: `Set-off ${res?.settlement_number} posted`, description: `${formatMoneyCode(Number(res?.amount || 0), res?.currency)} offset against both sides.` });
      }
      setAmount(""); setNotes(""); setEvidenceRef(""); setCashAmount(""); setFxRate(""); setBankCharge(""); setBankChargeNote("");
    },
    onError: (e: any) => toast({ title: "Could not post set-off", description: e.message, variant: "destructive" }),
  });

  const reverse = useMutation({
    mutationFn: async (id: string) => {
      const reason = window.prompt("Reason for reversing this set-off?");
      if (!reason) throw new Error("Reason required");
      const { error } = await (supabase as any).rpc("reverse_contra_settlement", { _settlement_id: id, _reason: reason });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contra-settlements"] });
      qc.invalidateQueries({ queryKey: ["contra-preview"] });
      toast({ title: "Set-off reversed" });
    },
    onError: (e: any) => toast({ title: "Reversal failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <ArrowLeftRight className="h-5 w-5" />Contra settlements
        </h1>
        <p className="text-muted-foreground text-sm">
          Offset what a counterparty owes you against what you owe them, when they are both customer and supplier.
        </p>
      </div>

      <Alert variant={nettingEnabled ? "default" : "destructive"}>
        <Info className="h-4 w-4" />
        <AlertTitle>Accounting policy — IAS 32.42</AlertTitle>
        <AlertDescription className="text-sm space-y-1">
          <p>
            Receivables and payables remain gross in the ledger and on statements. A set-off is posted as an explicit
            settlement through the "Contra Set-off Clearing" account (receipt on the sales invoice, payment on the purchase
            invoice), so both documents show as settled with no cash movement.
          </p>
          <p className="text-xs">
            Current policy: netting {nettingEnabled ? "allowed" : "disabled"} · presentation {policy?.presentation_basis ?? "gross"} ·
            evidence {evidenceRequired ? "required" : "optional"} · approval threshold {threshold > 0 ? formatMoneyCode(threshold, selected?.currency) : "none"} ·{" "}
            <Link className="underline" to="/finance/accounting-policies">edit policy</Link>
          </p>
        </AlertDescription>
      </Alert>

      <FinanceApprovalsPanel docTypes={["contra_settlement"]} />

      <Card>
        <CardHeader>
          <CardTitle>New set-off</CardTitle>
          <CardDescription>Pick the counterparty to see both sides of the position.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2 sm:col-span-2">
              <Label>Counterparty (supplier) *</Label>
              <Select value={supplierId} onValueChange={(v) => { setSupplierId(v); setCurrency(""); setAmount(""); }}>
                <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                <SelectContent>
                  {suppliers?.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Currency</Label>
              <Select value={selected?.currency ?? ""} onValueChange={setCurrency} disabled={!totals.length}>
                <SelectTrigger><SelectValue placeholder={isFetching ? "Loading…" : "—"} /></SelectTrigger>
                <SelectContent>
                  {totals.map((t: any) => <SelectItem key={t.currency} value={t.currency}>{t.currency}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {supplierId && preview && !preview.customer_id && (
            <p className="text-sm text-destructive">
              No matching customer record found for {preview.supplier_name}. Link the supplier to a customer (or create
              one with the same name) before offsetting.
            </p>
          )}

          {selected && (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">They owe you (AR)</div>
                <div className="text-lg font-semibold">{formatMoneyCode(Number(selected.ar_total), selected.currency)}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">You owe them (AP)</div>
                <div className="text-lg font-semibold">{formatMoneyCode(Number(selected.ap_total), selected.currency)}</div>
              </div>
              <div className="rounded-md border p-3 bg-muted/40">
                <div className="text-xs text-muted-foreground">Offsettable</div>
                <div className="text-lg font-semibold">{formatMoneyCode(offsettable, selected.currency)}</div>
              </div>
            </div>
          )}

          {preview && (
            <div className="grid gap-4 lg:grid-cols-2">
              <DocList title="Sales invoices (AR)" rows={(preview.ar ?? []).filter((r: any) => !selected || r.currency === selected.currency)} />
              <DocList title="Purchase invoices (AP)" rows={(preview.ap ?? []).filter((r: any) => !selected || r.currency === selected.currency)} />
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Amount to offset *</Label>
              <Input type="number" step="0.01" min="0" max={offsettable} value={amount} onChange={(e) => setAmount(e.target.value)} />
              {offsettable > 0 && (
                <Button type="button" variant="link" className="h-auto p-0 text-xs" onClick={() => setAmount(String(offsettable))}>
                  Use maximum {formatMoneyCode(offsettable, selected?.currency)}
                </Button>
              )}
            </div>
            <div className="space-y-2">
              <Label>Set-off evidence reference {evidenceRequired ? "*" : ""}</Label>
              <Input value={evidenceRef} onChange={(e) => setEvidenceRef(e.target.value)}
                placeholder="Netting agreement / email ref" />
              <p className="text-xs text-muted-foreground">Proof of the legally enforceable right of set-off.</p>
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
          </div>

          <div className="rounded-md border p-3 space-y-3">
            <div className="text-sm font-medium">Cash settlement of the residual (optional)</div>
            <p className="text-xs text-muted-foreground">
              Pay or receive the balance left after the offset from a real bank / cash account. If that account is in a
              different currency, declare the rate used. Bank charges post to OPEX and hit the P&amp;L.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-2 sm:col-span-2">
                <Label>Settlement account</Label>
                <Select value={accountId} onValueChange={setAccountId}>
                  <SelectTrigger><SelectValue placeholder="Bank / cash account" /></SelectTrigger>
                  <SelectContent>
                    {(accounts ?? []).map((a: any) => <SelectItem key={a.id} value={a.id}>{a.name} ({a.currency})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Cash amount {docCurrency ? `(${docCurrency})` : ""}</Label>
                <Input type="number" step="0.01" min="0" value={cashAmount} onChange={(e) => setCashAmount(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Declared FX rate {cashCurrencyMismatch ? "*" : ""}</Label>
                <Input type="number" step="0.000001" min="0" value={fxRate} onChange={(e) => setFxRate(e.target.value)}
                  placeholder={cashCurrencyMismatch ? `${docCurrency} → ${accountCurrency}` : "Same currency"} />
              </div>
              <div className="space-y-2">
                <Label>Bank charges {accountCurrency ? `(${accountCurrency})` : ""}</Label>
                <Input type="number" step="0.01" min="0" value={bankCharge} onChange={(e) => setBankCharge(e.target.value)} />
              </div>
              <div className="space-y-2 sm:col-span-2 lg:col-span-3">
                <Label>Bank charge note</Label>
                <Input value={bankChargeNote} onChange={(e) => setBankChargeNote(e.target.value)} placeholder="e.g. SWIFT transfer fee" />
              </div>
            </div>
            {cashCurrencyMismatch && (
              <p className="text-xs text-warning">
                The document is in {docCurrency} but the account is in {accountCurrency} — declare the rate actually used by the bank.
              </p>
            )}
          </div>

          {!nettingEnabled && (
            <p className="text-sm text-destructive">Netting is switched off in the accounting policy — no set-off can be posted.</p>
          )}
          {needsApproval && amountNum > 0 && (
            <p className="text-sm text-muted-foreground">
              This set-off is at or above the {formatMoneyCode(threshold, selected?.currency)} threshold and will be routed for approval instead of posting immediately.
            </p>
          )}

          <Button
            disabled={post.isPending || !nettingEnabled || !supplierId || !preview?.customer_id || amountNum <= 0 || amountNum - offsettable > 0.01}
            onClick={() => post.mutate()}
          >
            {needsApproval ? "Submit set-off for approval" : "Post set-off"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Posted set-offs</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Counterparty</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Documents</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(history ?? []).length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">No set-offs posted yet.</TableCell></TableRow>
              )}
              {(history ?? []).map((s: any) => (
                <TableRow key={s.id}>
                  <TableCell className="font-mono text-xs">{s.settlement_number}</TableCell>
                  <TableCell>{s.counterparty_name}</TableCell>
                  <TableCell className="text-sm">{new Date(s.settled_on).toLocaleDateString()}</TableCell>
                  <TableCell className="text-right">{formatMoneyCode(Number(s.amount), s.currency)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {(s.contra_settlement_lines ?? []).map((l: any) => l.document_number).join(", ") || "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={s.status === "posted" ? "secondary" : "outline"}>{s.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {s.status === "posted" && (
                      <Button size="sm" variant="ghost" onClick={() => reverse.mutate(s.id)}>
                        <Undo2 className="h-4 w-4 mr-1" />Reverse
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function DocList({ title, rows }: { title: string; rows: any[] }) {
  return (
    <div className="rounded-md border">
      <div className="border-b px-3 py-2 text-sm font-medium">{title}</div>
      {rows.length === 0 ? (
        <div className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing outstanding.</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Document</TableHead>
              <TableHead>Due</TableHead>
              <TableHead className="text-right">Outstanding</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r: any) => (
              <TableRow key={r.invoice_id ?? r.supplier_invoice_id}>
                <TableCell className="font-mono text-xs">{r.document_number}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.due_at ? new Date(r.due_at).toLocaleDateString() : "—"}</TableCell>
                <TableCell className="text-right text-sm">{formatMoneyCode(Number(r.outstanding), r.currency)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
