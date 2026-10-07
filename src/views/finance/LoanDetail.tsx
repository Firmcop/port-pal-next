import { useMemo, useState } from "react";
import { useParams, Link, useSearchParams } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { formatMoneyCode } from "@/lib/money";
import { parseLoanStatement, summariseRows } from "@/lib/loan-statement-import";
import LoanInterestBreakdown from "@/components/finance/LoanInterestBreakdown";
import { LoanPayInstalmentDialog } from "@/components/finance/LoanPayInstalmentDialog";
import LoanAmortizationTimeline from "@/components/finance/LoanAmortizationTimeline";
import LoanReconciliationPanel from "@/components/finance/LoanReconciliationPanel";
import { loanStatusBadge } from "./Loans";
import { ArrowLeft, Upload, RefreshCw, Plus, Trash2, AlertTriangle, Landmark } from "lucide-react";
import { format } from "date-fns";

const TXN_TYPES = [
  "disbursement", "charges", "stamp_duty", "insurance",
  "interest_due", "penalty_interest_due",
  "principal_payment", "interest_payment", "penalty_payment", "adjustment",
];

const scheduleBadge = (s: string) => {
  const map: Record<string, string> = {
    paid: "bg-success/15 text-success",
    part_paid: "bg-warning/15 text-warning",
    overdue: "bg-destructive/15 text-destructive",
    expected: "bg-muted text-muted-foreground",
    cancelled: "bg-muted text-muted-foreground",
  };
  return <Badge variant="secondary" className={map[s] ?? ""}>{s.replace(/_/g, " ")}</Badge>;
};

export default function LoanDetail() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [pasted, setPasted] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [txnOpen, setTxnOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(searchParams.get("pay") === "1");
  const [txn, setTxn] = useState({ txn_date: format(new Date(), "yyyy-MM-dd"), txn_type: "principal_payment", amount: "", description: "" });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["loan", id] });
    qc.invalidateQueries({ queryKey: ["loan-schedule", id] });
    qc.invalidateQueries({ queryKey: ["loan-txns", id] });
    qc.invalidateQueries({ queryKey: ["loan-postings", id] });
    qc.invalidateQueries({ queryKey: ["loan-balances"] });
  };

  const { data: loan } = useQuery({
    queryKey: ["loan", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("loan_facilities").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: balance } = useQuery({
    queryKey: ["loan-balance-row", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("loan_balances");
      if (error) throw error;
      return (data ?? []).find((r: any) => r.loan_id === id) ?? null;
    },
  });

  const { data: schedule } = useQuery({
    queryKey: ["loan-schedule", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("loan_schedule_lines").select("*").eq("loan_id", id).order("seq");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: txns } = useQuery({
    queryKey: ["loan-txns", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("loan_transactions").select("*").eq("loan_id", id)
        .order("txn_date").order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: postings } = useQuery({
    queryKey: ["loan-postings", id, (txns ?? []).length],
    enabled: !!txns?.length,
    queryFn: async () => {
      const ids = (txns ?? []).map((t: any) => t.id);
      const { data, error } = await supabase
        .from("accounting_transactions").select("*")
        .eq("reference_type", "loan_transaction").in("reference_id", ids)
        .order("transaction_date");
      if (error) throw error;
      return data ?? [];
    },
  });

  const currency = loan?.currency ?? balance?.currency ?? undefined;

  const parsed = useMemo(() => (pasted.trim() ? parseLoanStatement(pasted) : null), [pasted]);
  const parsedSummary = parsed ? summariseRows(parsed.rows) : null;

  const importMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any).rpc("import_loan_statement", {
        _loan_id: id,
        _rows: parsed?.rows ?? [],
      });
      if (error) throw error;
      return data as { inserted: number; skipped: number };
    },
    onSuccess: (r) => {
      toast({ title: "Statement imported", description: `${r.inserted} movement(s) added, ${r.skipped} already recorded.` });
      setPasted("");
      setImportOpen(false);
      invalidate();
    },
    onError: (e: any) => toast({ title: "Import failed", description: e.message, variant: "destructive" }),
  });

  const addTxn = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).rpc("post_loan_transaction", {
        _loan_id: id,
        _txn_date: txn.txn_date,
        _txn_type: txn.txn_type,
        _amount: Number(txn.amount || 0),
        _description: txn.description || null,
        _financial_account_id: null,
        _external_ref: null,
        _statement_balance: null,
        _source: "manual",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Movement recorded", description: "The journal entry has been posted." });
      setTxn({ ...txn, amount: "", description: "" });
      setTxnOpen(false);
      invalidate();
    },
    onError: (e: any) => toast({ title: "Could not record movement", description: e.message, variant: "destructive" }),
  });

  const delTxn = useMutation({
    mutationFn: async (txnId: string) => {
      const { error } = await (supabase as any).rpc("delete_loan_transaction", { _txn_id: txnId });
      if (error) throw error;
    },
    onSuccess: () => { toast({ title: "Movement removed" }); invalidate(); },
    onError: (e: any) => toast({ title: "Could not remove movement", description: e.message, variant: "destructive" }),
  });

  const regen = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).rpc("generate_loan_schedule", { _loan_id: id });
      if (error) throw error;
    },
    onSuccess: () => { toast({ title: "Schedule regenerated" }); invalidate(); },
    onError: (e: any) => toast({ title: "Could not regenerate", description: e.message, variant: "destructive" }),
  });

  if (!loan) {
    return <div className="p-6 text-muted-foreground">Loading loan…</div>;
  }

  const facts = [
    ["Principal advanced", formatMoneyCode(loan.principal_amount, currency)],
    ["Outstanding", formatMoneyCode(balance?.principal_outstanding ?? 0, currency)],
    ["Accrued interest", formatMoneyCode(balance?.accrued_interest ?? 0, currency)],
    ["Interest charged to date", formatMoneyCode(balance?.interest_charged ?? 0, currency)],
    ["Fees & duty", formatMoneyCode(balance?.fees_charged ?? 0, currency)],
    ["Interest rate", `${Number(loan.interest_rate).toFixed(2)}% p.a.`],
    ["Instalment", `${formatMoneyCode(loan.repayment_amount, currency)} · ${loan.frequency}${loan.payment_day ? ` on day ${loan.payment_day}` : ""}`],
    ["Granted", format(new Date(loan.date_granted), "dd MMM yyyy")],
    ["Matures", loan.maturity_date ? format(new Date(loan.maturity_date), "dd MMM yyyy") : "—"],
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-1 -ml-2">
            <Link to="/finance/loans"><ArrowLeft className="h-4 w-4 mr-1" />All loans</Link>
          </Button>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Landmark className="h-6 w-6" />{loan.lender_name}
            {loanStatusBadge(loan.status)}
          </h1>
          <p className="text-muted-foreground font-mono text-sm">
            {loan.reference ?? "No reference"} · {loan.loan_type.replace(/_/g, " ")} · {currency}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => regen.mutate()} disabled={regen.isPending}>
            <RefreshCw className="h-4 w-4 mr-1" />Regenerate schedule
          </Button>

          <Dialog open={payOpen} onOpenChange={(o) => { setPayOpen(o); if (searchParams.get("pay")) setSearchParams({}, { replace: true }); }}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={loan.status === "settled" || loan.status === "written_off"}>
                Pay instalment
              </Button>
            </DialogTrigger>
          </Dialog>

          <Dialog open={txnOpen} onOpenChange={setTxnOpen}>
            <DialogTrigger asChild><Button variant="outline" size="sm"><Plus className="h-4 w-4 mr-1" />Movement</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Record a loan movement</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Date</Label>
                  <Input type="date" value={txn.txn_date} onChange={(e) => setTxn({ ...txn, txn_date: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Type</Label>
                  <Select value={txn.txn_type} onValueChange={(v) => setTxn({ ...txn, txn_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TXN_TYPES.map((t) => <SelectItem key={t} value={t} className="capitalize">{t.replace(/_/g, " ")}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Amount</Label>
                  <Input type="number" step="0.01" value={txn.amount} onChange={(e) => setTxn({ ...txn, amount: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Description</Label>
                  <Input value={txn.description} onChange={(e) => setTxn({ ...txn, description: e.target.value })} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setTxnOpen(false)}>Cancel</Button>
                <Button disabled={!Number(txn.amount) || addTxn.isPending} onClick={() => addTxn.mutate()}>Post movement</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={importOpen} onOpenChange={setImportOpen}>
            <DialogTrigger asChild><Button size="sm"><Upload className="h-4 w-4 mr-1" />Import statement</Button></DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Import loan statement</DialogTitle></DialogHeader>
              <p className="text-sm text-muted-foreground">
                Paste the statement rows (Date · Narration · Value date · Money in · Payment · Money out · Running balance).
                Receipt lines such as "Loan Repayment" are skipped — the principal, interest and penalty applications are what get posted.
                Movements already recorded are ignored, so re-importing is safe.
              </p>
              <Textarea rows={10} value={pasted} onChange={(e) => setPasted(e.target.value)} className="font-mono text-xs"
                placeholder="23 JAN 2025	Interest Due	23 JAN 2025	0.00	0.00	-47,608.80	-3,047,608.80" />
              {parsed && (
                <Alert>
                  <AlertTitle>{parsed.rows.length} movement(s) detected</AlertTitle>
                  <AlertDescription className="text-xs space-y-1">
                    <div>Disbursed {formatMoneyCode(parsedSummary!.disbursed, currency)} · Principal paid {formatMoneyCode(parsedSummary!.principalPaid, currency)} · Interest charged {formatMoneyCode(parsedSummary!.interestCharged, currency)} · Fees {formatMoneyCode(parsedSummary!.fees, currency)}</div>
                    {parsed.ignored > 0 && <div>{parsed.ignored} receipt/settlement line(s) skipped.</div>}
                  </AlertDescription>
                </Alert>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setImportOpen(false)}>Cancel</Button>
                <Button disabled={!parsed?.rows.length || importMut.isPending} onClick={() => importMut.mutate()}>
                  {importMut.isPending ? "Importing…" : `Import ${parsed?.rows.length ?? 0} movement(s)`}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {Number(balance?.arrears_amount ?? 0) > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Facility in arrears</AlertTitle>
          <AlertDescription>
            {formatMoneyCode(balance!.arrears_amount, currency)} of scheduled instalments is past due.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {facts.map(([k, v]) => (
            <div key={k}>
              <p className="text-xs text-muted-foreground">{k}</p>
              <p className="text-sm font-medium font-mono">{v}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <LoanPayInstalmentDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        loanId={id}
        loan={loan}
        schedule={(schedule ?? []) as any}
      />

      <LoanInterestBreakdown loanId={id!} currency={currency} />

      <Tabs defaultValue="schedule">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="schedule">Schedule</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="postings">Postings</TabsTrigger>
          <TabsTrigger value="reconciliation">Reconciliation</TabsTrigger>
        </TabsList>

        <TabsContent value="timeline">
          <LoanAmortizationTimeline
            schedule={(schedule ?? []) as any}
            currency={currency}
            onSelect={(seq) => document.getElementById(`instalment-${seq}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
          />
        </TabsContent>

        <TabsContent value="reconciliation">
          <LoanReconciliationPanel
            loanId={id!}
            currency={currency}
            stmtBalance={loan?.stmt_principal_outstanding ?? null}
            systemBalance={balance?.principal_outstanding ?? null}
          />
        </TabsContent>


        <TabsContent value="schedule">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Repayment schedule</CardTitle></CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Due date</TableHead>
                    <TableHead className="text-right">Opening</TableHead>
                    <TableHead className="text-right">Principal</TableHead>
                    <TableHead className="text-right">Interest</TableHead>
                    <TableHead className="text-right">Instalment</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Closing</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!schedule?.length ? (
                    <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No schedule — set the instalment amount and regenerate</TableCell></TableRow>
                  ) : schedule.map((s: any) => (
                    <TableRow key={s.id}>
                      <TableCell className="text-xs text-muted-foreground">{s.seq}</TableCell>
                      <TableCell className="text-sm">{format(new Date(s.due_date), "dd MMM yyyy")}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{formatMoneyCode(s.opening_balance, currency)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{formatMoneyCode(s.principal_due, currency)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{formatMoneyCode(s.interest_due, currency)}</TableCell>
                      <TableCell className="text-right font-mono text-sm font-medium">{formatMoneyCode(s.total_due, currency)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{formatMoneyCode(s.paid_amount, currency)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{formatMoneyCode(s.closing_balance, currency)}</TableCell>
                      <TableCell>{scheduleBadge(s.status)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="transactions">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Statement movements</CardTitle></CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Bank balance</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!txns?.length ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No movements recorded</TableCell></TableRow>
                  ) : txns.map((t: any) => (
                    <TableRow key={t.id}>
                      <TableCell className="text-sm">{format(new Date(t.txn_date), "dd MMM yyyy")}</TableCell>
                      <TableCell className="capitalize text-sm">{t.txn_type.replace(/_/g, " ")}</TableCell>
                      <TableCell className="text-sm max-w-[240px] truncate">{t.description}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{formatMoneyCode(t.amount, t.currency ?? currency)}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">
                        {t.statement_balance != null ? formatMoneyCode(t.statement_balance, t.currency ?? currency) : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{t.source}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => delTxn.mutate(t.id)} disabled={delTxn.isPending}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="postings">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Ledger postings</CardTitle></CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Txn #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!postings?.length ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No postings yet</TableCell></TableRow>
                  ) : postings.map((p: any) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-xs">{p.transaction_number}</TableCell>
                      <TableCell className="text-xs">{format(new Date(p.transaction_date), "dd MMM yyyy")}</TableCell>
                      <TableCell className="text-sm capitalize">{p.account_type?.replace(/_/g, " ")}</TableCell>
                      <TableCell className="text-sm capitalize">{p.category?.replace(/_/g, " ")}</TableCell>
                      <TableCell className="text-sm max-w-[240px] truncate">{p.description}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{Number(p.debit_amount) > 0 ? formatMoneyCode(p.debit_amount, p.currency) : "—"}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{Number(p.credit_amount) > 0 ? formatMoneyCode(p.credit_amount, p.currency) : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
