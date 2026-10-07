import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useFinancialAccounts } from "@/hooks/use-financial-accounts";
import { formatMoneyCode } from "@/lib/money";
import { CalendarCheck } from "lucide-react";
import { format } from "date-fns";

type ScheduleLine = {
  id: string;
  seq: number;
  due_date: string;
  principal_due: number | string;
  interest_due: number | string;
  total_due: number | string;
  paid_amount: number | string;
  status: string;
};

type LoanLike = {
  id: string;
  financial_account_id?: string | null;
  currency?: string | null;
  status?: string;
} | null;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loanId?: string;
  loan: LoanLike;
  schedule: ScheduleLine[];
}

const num = (v: number | string | null | undefined) => Number(v ?? 0);

/** Mirrors pay_loan_instalment: proportional split, penalty absorbs the remainder. */
export function instalmentSplit(line: ScheduleLine, total: number) {
  const ratio = num(line.total_due) > 0 ? total / num(line.total_due) : 0;
  let principal = Math.round(num(line.principal_due) * ratio * 100) / 100;
  let interest = Math.round(num(line.interest_due) * ratio * 100) / 100;
  let penalty = Math.round((total - principal - interest) * 100) / 100;
  if (penalty < 0) {
    interest = Math.max(Math.round((interest + penalty) * 100) / 100, 0);
    penalty = 0;
  }
  return { principal, interest, penalty };
}

export function LoanPayInstalmentDialog({ open, onOpenChange, loanId, loan, schedule }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: accounts } = useFinancialAccounts();

  const unpaid = useMemo(
    () => schedule.filter((s) => s.status !== "cancelled" && num(s.total_due) - num(s.paid_amount) > 0.005),
    [schedule]
  );

  const [lineId, setLineId] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [payDate, setPayDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [accountId, setAccountId] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

  const line = unpaid.find((s) => s.id === lineId) ?? unpaid[0] ?? null;
  const outstanding = line ? Math.round((num(line.total_due) - num(line.paid_amount)) * 100) / 100 : 0;
  const amountNum = parseFloat(amount) || 0;
  const currency = loan?.currency ?? undefined;

  useEffect(() => {
    if (!open) return;
    setLineId(unpaid[0]?.id ?? "");
    setAmount(unpaid[0] ? String(Math.round((num(unpaid[0].total_due) - num(unpaid[0].paid_amount)) * 100) / 100) : "");
    setPayDate(format(new Date(), "yyyy-MM-dd"));
    setAccountId(loan?.financial_account_id ?? "");
    setReference("");
    setNote("");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const split = line && amountNum > 0 ? instalmentSplit(line, Math.min(amountNum, outstanding)) : null;

  const account = (accounts ?? []).find((a: any) => a.id === accountId) as any;
  const accountCurrency = account?.currency ? String(account.currency).toUpperCase() : undefined;
  const payCurrency = (currency ?? "").toUpperCase();
  const currencyMismatch = !!accountCurrency && !!payCurrency && accountCurrency !== payCurrency;

  const invalidate = () => {
    ["loan", "loan-schedule", "loan-txns", "loan-postings", "loan-balances", "loan-balance-row", "financial-account-balances", "commitments-due"]
      .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };

  const pay = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any).rpc("pay_loan_instalment", {
        _loan_id: loanId,
        _schedule_line_id: line!.id,
        _txn_date: payDate || null,
        _total_amount: amountNum,
        _financial_account_id: accountId || null,
        _external_ref: reference || null,
        _description: note || null,
      });
      if (error) throw error;
      return data as {
        principal: number; interest: number; penalty: number; total: number; seq: number; currency: string;
        already_recorded?: boolean; skipped?: string[];
      };
    },
    onSuccess: (r) => {
      if (r.already_recorded) {
        toast({
          title: `Instalment #${r.seq} is already recorded`,
          description: "This exact payment was already saved earlier, so nothing was added again. The schedule and balances already include it.",
        });
      } else {
        const skipped = (r.skipped ?? []).length
          ? ` The ${(r.skipped ?? []).join(" and ")} part was already recorded, so it was not added again.`
          : "";
        toast({
          title: `Instalment #${r.seq} paid`,
          description: `Posted ${formatMoneyCode(r.total, r.currency)} — principal ${formatMoneyCode(r.principal, r.currency)}, interest ${formatMoneyCode(r.interest, r.currency)}${r.penalty > 0 ? `, penalty ${formatMoneyCode(r.penalty, r.currency)}` : ""}. Schedule, ledger and bank account updated.${skipped}`,
        });
      }
      invalidate();
      onOpenChange(false);
    },
    onError: (e: any) => {
      const friendly: Record<string, string> = {
        instalment_already_paid: "That instalment is already fully paid — pick another one.",
        loan_not_active: "This facility is settled or written off, so no further instalments can be paid.",
        amount_must_be_positive: "Enter a payment amount.",
      };
      toast({ title: "Could not record payment", description: friendly[e.message] ?? e.message, variant: "destructive" });
    },
  });

  const canPay = !!line && amountNum > 0 && !pay.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CalendarCheck className="h-4 w-4" />Pay instalment</DialogTitle>
          <DialogDescription>
            The deducted amount is split into principal and interest from the schedule and posted in one step —
            the schedule, loan liability and bank account all update automatically.
          </DialogDescription>
        </DialogHeader>

        {!unpaid.length ? (
          <Alert>
            <AlertTitle>Nothing to pay</AlertTitle>
            <AlertDescription>Every instalment on this facility is already fully paid.</AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-4">
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Due date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {unpaid.map((s) => {
                    const due = Math.round((num(s.total_due) - num(s.paid_amount)) * 100) / 100;
                    return (
                      <TableRow
                        key={s.id}
                        className={`cursor-pointer ${s.id === line?.id ? "bg-muted/60" : "hover:bg-muted/40"}`}
                        onClick={() => { setLineId(s.id); setAmount(String(due)); }}
                      >
                        <TableCell className="text-xs text-muted-foreground">{s.seq}</TableCell>
                        <TableCell className="text-sm">{format(new Date(s.due_date), "dd MMM yyyy")}</TableCell>
                        <TableCell><Badge variant="secondary" className="capitalize text-xs">{s.status.replace(/_/g, " ")}</Badge></TableCell>
                        <TableCell className="text-right font-mono text-sm">{formatMoneyCode(due, currency)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Amount deducted *</Label>
                <Input type="number" step="0.01" min="0" max={outstanding} value={amount}
                  onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Payment date</Label>
                <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Paid from account</Label>
                <Select value={accountId || "none"} onValueChange={(v) => setAccountId(v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder={loan?.financial_account_id ? undefined : "Loan default"} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Loan default</SelectItem>
                    {(accounts ?? []).map((a: any) => <SelectItem key={a.id} value={a.id}>{a.name} ({a.currency})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Bank reference</Label>
                <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Slip / transaction ref" />
              </div>
              <div className="space-y-1.5">
                <Label>Note</Label>
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional description on the postings" />
              </div>
            </div>

            {currencyMismatch && (
              <p className="text-xs text-warning">
                The selected account is in {accountCurrency} but this loan is in {payCurrency} — the ledger will record it in the loan's currency.
              </p>
            )}

            {split && (
              <div className="rounded-md border px-3 py-2 text-sm flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="font-medium">Will post:</span>
                <span className="font-mono text-xs">Principal {formatMoneyCode(split.principal, currency)}</span>
                <span className="font-mono text-xs">Interest {formatMoneyCode(split.interest, currency)}</span>
                {split.penalty > 0 && <span className="font-mono text-xs text-destructive">Penalty {formatMoneyCode(split.penalty, currency)}</span>}
                <span className="font-mono text-xs font-bold ml-auto">Total {formatMoneyCode(split.principal + split.interest + split.penalty, currency)}</span>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!canPay} onClick={() => pay.mutate()}>
            {pay.isPending ? "Posting…" : "Post payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default LoanPayInstalmentDialog;
