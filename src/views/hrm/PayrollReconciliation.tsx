import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Banknote, Link as LinkIcon, AlertTriangle, FileSpreadsheet } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { exportCSV } from "@/lib/export-utils";

function periodToRange(p: string) {
  const [y, m] = p.split("-").map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10), end: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
}

export default function HRMPayrollReconciliation() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const today = new Date();
  const [period, setPeriod] = useState(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`);
  const [accountId, setAccountId] = useState<string>("");
  const [selectedPayslip, setSelectedPayslip] = useState<string | null>(null);
  const { start, end } = periodToRange(period);

  const { data: accounts = [] } = useQuery({
    queryKey: ["recon-accounts"],
    queryFn: async () => (await (supabase as any).from("financial_accounts").select("id,name,account_type").eq("is_active", true).order("name")).data ?? [],
  });

  const { data: payslips = [] } = useQuery({
    queryKey: ["recon-payslips", start, end],
    queryFn: async () => (await (supabase as any)
      .from("payslips")
      .select("*, employee:employees(name)")
      .in("status", ["posted", "paid"])
      .gte("pay_date", start).lte("pay_date", end)
      .order("pay_date")).data ?? [],
  });

  const { data: txns = [] } = useQuery({
    queryKey: ["recon-txns", accountId, start, end],
    enabled: !!accountId,
    queryFn: async () => (await (supabase as any)
      .from("accounting_transactions")
      .select("id,transaction_date,description,debit_amount,credit_amount,reference_type,reference_id")
      .eq("financial_account_id", accountId)
      .gte("transaction_date", start).lte("transaction_date", end + "T23:59:59")
      .gt("credit_amount", 0)
      .order("transaction_date")).data ?? [],
  });

  const link = useMutation({
    mutationFn: async ({ payslip_id, txn_id }: { payslip_id: string; txn_id: string }) => {
      const { error } = await (supabase as any).rpc("link_payslip_payment", { _payslip_id: payslip_id, _txn_id: txn_id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Payment linked" });
      setSelectedPayslip(null);
      qc.invalidateQueries({ queryKey: ["recon-payslips"] });
      qc.invalidateQueries({ queryKey: ["recon-txns"] });
    },
    onError: (e: any) => toast({ title: "Link failed", description: e.message, variant: "destructive" }),
  });

  const linkedTxnIds = new Set(payslips.filter((p: any) => p.accounting_transaction_id).map((p: any) => p.accounting_transaction_id));
  const unmatchedPayslips = payslips.filter((p: any) => !p.accounting_transaction_id);
  const unexplainedTxns = txns.filter((t: any) => !linkedTxnIds.has(t.id) && t.reference_type !== "payslip");

  const discrepancies = useMemo(() => {
    return payslips
      .filter((p: any) => p.accounting_transaction_id)
      .map((p: any) => {
        const txn = txns.find((t: any) => t.id === p.accounting_transaction_id);
        if (!txn) return null;
        const diff = Math.abs(Number(txn.credit_amount) - Number(p.net_pay));
        return diff > 0.01 ? { reference: p.reference, expected: p.net_pay, actual: txn.credit_amount, diff } : null;
      })
      .filter(Boolean);
  }, [payslips, txns]);

  const exportSummary = () => {
    exportCSV(`payroll-reconciliation-${period}.csv`,
      ["Reference", "Employee", "Net pay", "Status", "Linked txn", "Paid at"],
      payslips.map((p: any) => [p.reference, p.employee?.name ?? "", Number(p.net_pay).toFixed(2), p.status, p.accounting_transaction_id ?? "", p.paid_at ?? ""]));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Banknote className="h-6 w-6" />Payment Reconciliation</h1>
          <p className="text-muted-foreground">Match approved/paid payslips against bank transfers and surface discrepancies.</p>
        </div>
        <Button variant="outline" onClick={exportSummary}><FileSpreadsheet className="mr-1 h-4 w-4" />Export CSV</Button>
      </div>

      <Card><CardContent className="p-4 flex flex-wrap gap-3 items-end">
        <div className="space-y-1"><Label>Period</Label><Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="w-[180px]" /></div>
        <div className="space-y-1"><Label>Bank account</Label>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger className="w-[260px]"><SelectValue placeholder="Pick a bank account…" /></SelectTrigger>
            <SelectContent>{accounts.map((a: any) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </CardContent></Card>

      {discrepancies.length > 0 && (
        <Card className="border-destructive/40">
          <CardHeader><CardTitle className="text-base flex items-center gap-2 text-destructive"><AlertTriangle className="h-4 w-4" />Discrepancies ({discrepancies.length})</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            {discrepancies.map((d: any) => (
              <div key={d.reference} className="font-mono">{d.reference}: expected {Number(d.expected).toFixed(2)} vs actual {Number(d.actual).toFixed(2)} (diff {d.diff.toFixed(2)})</div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Posted payslips ({unmatchedPayslips.length} unmatched)</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Reference</TableHead><TableHead>Employee</TableHead><TableHead className="text-right">Net</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {payslips.map((p: any) => (
                  <TableRow key={p.id} onClick={() => setSelectedPayslip(p.id)}
                    className={`cursor-pointer ${selectedPayslip === p.id ? "bg-primary/10" : ""} ${p.accounting_transaction_id ? "opacity-60" : ""}`}>
                    <TableCell className="font-mono text-xs">{p.reference}</TableCell>
                    <TableCell>{p.employee?.name ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono">{Number(p.net_pay).toFixed(2)}</TableCell>
                    <TableCell><Badge variant="secondary">{p.status}</Badge></TableCell>
                  </TableRow>
                ))}
                {payslips.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">No posted payslips.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Bank credits ({unexplainedTxns.length} unexplained)</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Description</TableHead><TableHead className="text-right">Amount</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {!accountId && <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">Pick a bank account to load transactions.</TableCell></TableRow>}
                {accountId && txns.map((t: any) => (
                  <TableRow key={t.id} className={linkedTxnIds.has(t.id) ? "opacity-60" : ""}>
                    <TableCell className="text-xs">{t.transaction_date?.slice(0, 10)}</TableCell>
                    <TableCell className="text-sm">{t.description}</TableCell>
                    <TableCell className="text-right font-mono">{Number(t.credit_amount).toFixed(2)}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" disabled={!selectedPayslip || linkedTxnIds.has(t.id) || link.isPending}
                        onClick={() => selectedPayslip && link.mutate({ payslip_id: selectedPayslip, txn_id: t.id })}>
                        <LinkIcon className="h-3 w-3 mr-1" />Link
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {accountId && txns.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">No bank credits in period.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
