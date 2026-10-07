import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Banknote, Scale as ScaleIcon } from "lucide-react";
import { format } from "date-fns";
import { Money } from "@/components/Money";
import { useToast } from "@/hooks/use-toast";
import { fmtMoney } from "@/lib/finance-format";

export function PayablesSettlementTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [selected, setSelected] = useState<string[]>([]);
  const [accountId, setAccountId] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const monthStart = new Date();
  const [from, setFrom] = useState(new Date(monthStart.getFullYear(), 0, 1).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));

  const { data: bills, isLoading } = useQuery({
    queryKey: ["opex-payables"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("operating_expenses")
        .select("*, suppliers(name)")
        .eq("approval_status", "approved")
        .neq("status", "reversed")
        .order("expense_date");
      if (error) throw error;
      return (data as any[]).filter((r) => Number(r.total_amount) - Number(r.amount_paid) > 0.005);
    },
  });

  const { data: accounts } = useQuery({
    queryKey: ["financial-accounts-settle"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("financial_accounts")
        .select("id,name,currency,account_type,gl_account_id")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: recon, isFetching: reconLoading } = useQuery({
    queryKey: ["opex-pl-reconciliation", from, to],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("opex_pl_reconciliation", { _from: from, _to: to });
      if (error) throw error;
      return data as any[];
    },
  });

  const selectedBills = useMemo(() => (bills ?? []).filter((b) => selected.includes(b.id)), [bills, selected]);
  const selectedTotal = selectedBills.reduce((s, b) => s + (Number(b.total_amount) - Number(b.amount_paid)), 0);

  const settle = useMutation({
    mutationFn: async () => {
      if (!accountId) throw new Error("Choose the cash or bank account to pay from");
      if (!selected.length) throw new Error("Select at least one bill");
      const { data, error } = await (supabase as any).rpc("settle_operating_expenses", {
        _expense_ids: selected,
        _financial_account_id: accountId,
        _payment_date: paymentDate,
        _reference: reference || null,
      });
      if (error) throw error;
      return Number(data);
    },
    onSuccess: (amount) => {
      ["opex-payables", "operating-expenses", "accounting-transactions", "account-balances", "opex-pl-reconciliation"].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] })
      );
      setSelected([]);
      setReference("");
      toast({ title: "Bills settled", description: `${fmtMoney(amount)} paid — ledger, bank balance and P&L updated.` });
    },
    onError: (e: any) => toast({ title: "Settlement failed", description: e.message, variant: "destructive" }),
  });

  const allSelected = !!(bills ?? []).length && selected.length === (bills ?? []).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label className="text-xs">Pay from account *</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger><SelectValue placeholder="Cash / bank account" /></SelectTrigger>
              <SelectContent>
                {(accounts ?? []).map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name} {a.currency ? `(${a.currency})` : ""}{a.gl_account_id ? "" : " — no GL mapping"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs">Payment date</Label><Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} /></div>
          <div><Label className="text-xs">Reference</Label><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Cheque / transfer ref" /></div>
          <div className="flex items-end">
            <Button className="w-full" disabled={!selected.length || settle.isPending} onClick={() => settle.mutate()}>
              <Banknote className="h-4 w-4 mr-1" />
              {settle.isPending ? "Settling…" : `Settle ${selected.length || ""} (${fmtMoney(selectedTotal)})`}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={(v) => setSelected(v ? (bills ?? []).map((b) => b.id) : [])}
                    aria-label="Select all bills"
                  />
                </TableHead>
                <TableHead>Expense #</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Supplier / payee</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Loading…</TableCell></TableRow>
              ) : !(bills ?? []).length ? (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No approved bills outstanding.</TableCell></TableRow>
              ) : (bills ?? []).map((b) => {
                const outstanding = Number(b.total_amount) - Number(b.amount_paid);
                const overdue = b.due_date && b.due_date < new Date().toISOString().slice(0, 10);
                return (
                  <TableRow key={b.id}>
                    <TableCell>
                      <Checkbox
                        checked={selected.includes(b.id)}
                        onCheckedChange={(v) => setSelected(v ? [...selected, b.id] : selected.filter((id) => id !== b.id))}
                        aria-label={`Select ${b.expense_number}`}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{b.expense_number}</TableCell>
                    <TableCell className="text-xs">{format(new Date(b.expense_date), "dd MMM yyyy")}</TableCell>
                    <TableCell className="text-sm">{b.suppliers?.name ?? b.payee ?? "—"}</TableCell>
                    <TableCell className="text-xs">
                      {b.due_date ? format(new Date(b.due_date), "dd MMM yyyy") : "—"}
                      {overdue && <Badge variant="secondary" className="ml-2 bg-destructive/15 text-destructive">overdue</Badge>}
                    </TableCell>
                    <TableCell className="text-right font-mono"><Money amount={b.total_amount} currency={b.currency} /></TableCell>
                    <TableCell className="text-right font-mono"><Money amount={outstanding} currency={b.currency} /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex items-center gap-2 font-semibold"><ScaleIcon className="h-4 w-4" />OPEX ↔ P&amp;L reconciliation</div>
            <div className="flex gap-2">
              <div><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            </div>
          </div>
          <Table>
            <TableBody>
              {reconLoading ? (
                <TableRow><TableCell colSpan={3} className="py-4 text-center text-muted-foreground">Calculating…</TableCell></TableRow>
              ) : (recon ?? []).map((r) => (
                <TableRow key={r.metric} className={r.metric.includes("difference") && Math.abs(Number(r.amount)) > 0.005 ? "bg-destructive/5" : ""}>
                  <TableCell className="text-sm">{r.label}</TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">{r.count_value ? `${r.count_value} docs` : ""}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{fmtMoney(r.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
