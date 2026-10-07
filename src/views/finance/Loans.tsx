import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useFinancialAccounts } from "@/hooks/use-financial-accounts";
import { formatMoneyCode } from "@/lib/money";
import { exportCSV } from "@/lib/export-utils";
import { Landmark, Plus, FileDown, AlertTriangle, CalendarClock, Wallet } from "lucide-react";
import { format } from "date-fns";

export type LoanBalance = {
  loan_id: string;
  lender_name: string;
  reference: string | null;
  loan_type: string;
  currency: string | null;
  status: string;
  principal_amount: number;
  maturity_date: string | null;
  principal_repaid: number;
  principal_outstanding: number;
  interest_charged: number;
  interest_paid: number;
  accrued_interest: number;
  fees_charged: number;
  arrears_amount: number;
  next_due_date: string | null;
  next_due_amount: number | null;
};

export const LOAN_TYPES = [
  { value: "asset_finance", label: "Asset finance" },
  { value: "unsecured", label: "Unsecured" },
  { value: "mortgage", label: "Mortgage" },
  { value: "overdraft", label: "Overdraft" },
  { value: "shareholder", label: "Shareholder" },
  { value: "other", label: "Other" },
];

export function loanStatusBadge(status: string) {
  const map: Record<string, string> = {
    active: "bg-success/15 text-success",
    in_arrears: "bg-destructive/15 text-destructive",
    draft: "bg-muted text-muted-foreground",
    restructured: "bg-warning/15 text-warning",
    settled: "bg-info/15 text-info",
    written_off: "bg-muted text-muted-foreground",
  };
  return (
    <Badge variant="secondary" className={map[status] ?? ""}>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

function NewLoanDialog() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: accounts } = useFinancialAccounts();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    lender_name: "",
    loan_type: "unsecured",
    reference: "",
    currency: "",
    principal: "",
    interest_rate: "",
    date_granted: format(new Date(), "yyyy-MM-dd"),
    maturity_date: "",
    repayment_amount: "",
    frequency: "monthly",
    payment_day: "",
    financial_account_id: "",
    notes: "",
    post_disbursement: "yes",
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any).rpc("create_loan_facility", {
        _lender_name: form.lender_name.trim(),
        _loan_type: form.loan_type,
        _principal: Number(form.principal || 0),
        _interest_rate: Number(form.interest_rate || 0),
        _date_granted: form.date_granted,
        _maturity_date: form.maturity_date || null,
        _repayment_amount: Number(form.repayment_amount || 0),
        _frequency: form.frequency,
        _payment_day: form.payment_day ? Number(form.payment_day) : null,
        _reference: form.reference || null,
        _currency: form.currency || null,
        _financial_account_id: form.financial_account_id || null,
        _fixed_asset_id: null,
        _supplier_id: null,
        _notes: form.notes || null,
        _post_disbursement: form.post_disbursement === "yes",
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      toast({ title: "Loan facility created", description: "Repayment schedule generated." });
      qc.invalidateQueries({ queryKey: ["loan-balances"] });
      setOpen(false);
    },
    onError: (e: any) => toast({ title: "Could not create loan", description: e.message, variant: "destructive" }),
  });

  const valid = form.lender_name.trim() && Number(form.principal) > 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4 mr-1" />New loan</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>New loan facility</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Lender</Label>
            <Input value={form.lender_name} onChange={(e) => set("lender_name", e.target.value)} placeholder="KCB Bank" />
          </div>
          <div className="space-y-1.5">
            <Label>Loan reference</Label>
            <Input value={form.reference} onChange={(e) => set("reference", e.target.value)} placeholder="AA24358K6P1K" />
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={form.loan_type} onValueChange={(v) => set("loan_type", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {LOAN_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Currency</Label>
            <Input value={form.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} placeholder="Organisation default" />
          </div>
          <div className="space-y-1.5">
            <Label>Principal advanced</Label>
            <Input type="number" step="0.01" value={form.principal} onChange={(e) => set("principal", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Interest rate (% p.a.)</Label>
            <Input type="number" step="0.001" value={form.interest_rate} onChange={(e) => set("interest_rate", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Date granted</Label>
            <Input type="date" value={form.date_granted} onChange={(e) => set("date_granted", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Maturity date</Label>
            <Input type="date" value={form.maturity_date} onChange={(e) => set("maturity_date", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Instalment amount</Label>
            <Input type="number" step="0.01" value={form.repayment_amount} onChange={(e) => set("repayment_amount", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Frequency</Label>
            <Select value={form.frequency} onValueChange={(v) => set("frequency", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="quarterly">Quarterly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Payment day of month</Label>
            <Input type="number" min="1" max="31" value={form.payment_day} onChange={(e) => set("payment_day", e.target.value)} placeholder="23" />
          </div>
          <div className="space-y-1.5">
            <Label>Bank account debited</Label>
            <Select value={form.financial_account_id || "none"} onValueChange={(v) => set("financial_account_id", v === "none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not set</SelectItem>
                {(accounts ?? []).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Post disbursement to the ledger?</Label>
            <Select value={form.post_disbursement} onValueChange={(v) => set("post_disbursement", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="yes">Yes — record the advance</SelectItem>
                <SelectItem value="no">No — I will import a statement</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={!valid || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? "Creating…" : "Create facility"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Loans() {
  const { data: loans, isLoading } = useQuery<LoanBalance[]>({
    queryKey: ["loan-balances"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("loan_balances");
      if (error) throw error;
      return (data ?? []) as LoanBalance[];
    },
  });

  const kpis = useMemo(() => {
    const rows = loans ?? [];
    const cur = rows[0]?.currency ?? undefined;
    const sum = (f: (r: LoanBalance) => number) => rows.reduce((s, r) => s + Number(f(r) || 0), 0);
    const soon = rows.filter((r) => r.next_due_date && new Date(r.next_due_date) <= new Date(Date.now() + 30 * 864e5));
    return {
      currency: cur,
      outstanding: sum((r) => Number(r.principal_outstanding) + Number(r.accrued_interest)),
      principal: sum((r) => Number(r.principal_outstanding)),
      interest: sum((r) => Number(r.accrued_interest)),
      arrears: sum((r) => Number(r.arrears_amount)),
      due30: soon.reduce((s, r) => s + Number(r.next_due_amount || 0), 0),
    };
  }, [loans]);

  const headers = ["Lender", "Reference", "Type", "Currency", "Principal", "Outstanding", "Accrued interest", "Arrears", "Next due", "Status"];
  const rowsForExport = () =>
    (loans ?? []).map((l) => [
      l.lender_name, l.reference ?? "", l.loan_type, l.currency ?? "",
      String(l.principal_amount), String(l.principal_outstanding), String(l.accrued_interest),
      String(l.arrears_amount), l.next_due_date ?? "", l.status,
    ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Landmark className="h-6 w-6" />Loans</h1>
          <p className="text-muted-foreground">Facilities, repayment schedules and outstanding liabilities</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm"><Link to="/finance/commitments"><CalendarClock className="h-4 w-4 mr-1" />Commitments</Link></Button>
          <Button variant="outline" size="sm" disabled={!loans?.length} onClick={() => exportCSV("loans.csv", headers, rowsForExport())}>
            <FileDown className="h-4 w-4 mr-1" />CSV
          </Button>
          <NewLoanDialog />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total outstanding", value: kpis.outstanding, icon: Landmark, color: "text-foreground" },
          { label: "Principal outstanding", value: kpis.principal, icon: Wallet, color: "text-info" },
          { label: "Accrued interest", value: kpis.interest, icon: Wallet, color: "text-warning" },
          { label: "In arrears", value: kpis.arrears, icon: AlertTriangle, color: kpis.arrears > 0 ? "text-destructive" : "text-success" },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <k.icon className={`h-7 w-7 ${k.color}`} />
              <div>
                <p className="text-xs text-muted-foreground">{k.label}</p>
                <p className="text-lg font-bold">{formatMoneyCode(k.value, kpis.currency)}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Facilities {kpis.due30 > 0 && <span className="text-sm font-normal text-muted-foreground">— {formatMoneyCode(kpis.due30, kpis.currency)} due in the next 30 days</span>}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lender</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Principal</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead className="text-right">Accrued interest</TableHead>
                <TableHead className="text-right">Arrears</TableHead>
                <TableHead>Next due</TableHead>
                <TableHead>Maturity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : !loans?.length ? (
                <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">No loan facilities recorded yet</TableCell></TableRow>
              ) : loans.map((l) => (
                <TableRow key={l.loan_id} className="hover:bg-muted/40">
                  <TableCell>
                    <Link to={`/finance/loans/${l.loan_id}`} className="font-medium hover:underline">{l.lender_name}</Link>
                    {l.reference && <div className="text-xs text-muted-foreground font-mono">{l.reference}</div>}
                  </TableCell>
                  <TableCell className="capitalize text-sm">{l.loan_type.replace(/_/g, " ")}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{formatMoneyCode(l.principal_amount, l.currency)}</TableCell>
                  <TableCell className="text-right font-mono text-sm font-medium">{formatMoneyCode(l.principal_outstanding, l.currency)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{formatMoneyCode(l.accrued_interest, l.currency)}</TableCell>
                  <TableCell className={`text-right font-mono text-sm ${Number(l.arrears_amount) > 0 ? "text-destructive font-bold" : ""}`}>
                    {formatMoneyCode(l.arrears_amount, l.currency)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {l.next_due_date ? (
                      <div>
                        <div>{format(new Date(l.next_due_date), "dd MMM yyyy")}</div>
                        <div className="text-xs text-muted-foreground font-mono">{formatMoneyCode(l.next_due_amount ?? 0, l.currency)}</div>
                      </div>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="text-sm">{l.maturity_date ? format(new Date(l.maturity_date), "dd MMM yyyy") : "—"}</TableCell>
                  <TableCell>{loanStatusBadge(l.status)}</TableCell>
                  <TableCell className="text-right">
                    {Number(l.next_due_amount ?? 0) > 0 && !["settled", "written_off"].includes(l.status) ? (
                      <Button asChild variant="outline" size="sm">
                        <Link to={`/finance/loans/${l.loan_id}?pay=1`}>Pay</Link>
                      </Button>
                    ) : null}
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
