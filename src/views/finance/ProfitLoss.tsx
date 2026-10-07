import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { TrendingUp, FileDown, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { fmtMoney } from "@/lib/finance-format";
import { exportCSV } from "@/lib/export-utils";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { FinanceDataStatus } from "@/components/finance/FinanceDataStatus";

export default function ProfitLoss() {
  useRealtimeInvalidate([{ table: "accounting_transactions", queryKeys: ["account-balances"] }], "pl-rt");
  const [drill, setDrill] = useState<{ id: string; label: string } | null>(null);

  const { data: rows } = useQuery({
    queryKey: ["account-balances"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_account_balances" as any).select("*").order("code");
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: journalLines, isLoading: drillLoading } = useQuery({
    queryKey: ["pl-drilldown", drill?.id],
    enabled: !!drill?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("v_expense_journal_lines")
        .select("*")
        .eq("gl_account_id", drill!.id)
        .order("transaction_date", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data as any[];
    },
  });

  const sections = useMemo(() => {
    const filter = (type: string) => (rows ?? []).filter((r) => r.account_type === type && Number(r.balance) !== 0);
    const revenue = filter("revenue");
    const cogs = filter("cost_of_goods");
    const expense = filter("expense");
    const sum = (arr: any[]) => arr.reduce((s, r) => s + Number(r.balance || 0), 0);
    const totRev = sum(revenue);
    const totCogs = sum(cogs);
    const totExp = sum(expense);
    const grossProfit = totRev - totCogs;
    const netIncome = grossProfit - totExp;
    return { revenue, cogs, expense, totRev, totCogs, totExp, grossProfit, netIncome };
  }, [rows]);

  const Row = ({ r, drillable }: { r: any; drillable?: boolean }) => (
    <button
      type="button"
      disabled={!drillable}
      onClick={() => drillable && setDrill({ id: r.gl_account_id, label: `${r.code} — ${r.name}` })}
      className={`flex w-full justify-between py-1 text-sm ${drillable ? "rounded hover:bg-muted/60 cursor-pointer" : "cursor-default"}`}
    >
      <span className="flex items-center gap-1 text-left">
        <span className="font-mono text-xs text-muted-foreground mr-1">{r.code}</span>{r.name}
        {drillable && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
      </span>
      <span className="font-mono">{fmtMoney(r.balance)}</span>
    </button>
  );

  const drillTotal = (journalLines ?? []).reduce((s, l) => s + Number(l.debit_amount || 0) - Number(l.credit_amount || 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><TrendingUp className="h-6 w-6" />Profit &amp; Loss</h1>
        <p className="text-muted-foreground">All-time income statement. Click any cost line to see the journal entries behind it. <a href="/finance/reports/project-pnl" className="text-primary underline">View by project</a></p>
      </div>
      <FinanceDataStatus queryKeys={["account-balances"]} />

      <Card>
        <CardHeader className="py-3"><CardTitle className="text-base">Revenue</CardTitle></CardHeader>
        <CardContent>
          {sections.revenue.map((r) => <Row key={r.gl_account_id} r={r} />)}
          <div className="flex justify-between py-2 border-t mt-2 font-semibold"><span>Total Revenue</span><span className="font-mono">{fmtMoney(sections.totRev)}</span></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3"><CardTitle className="text-base">Cost of Goods Sold</CardTitle></CardHeader>
        <CardContent>
          {sections.cogs.map((r) => <Row key={r.gl_account_id} r={r} drillable />)}
          <div className="flex justify-between py-2 border-t mt-2 font-semibold"><span>Total COGS</span><span className="font-mono">{fmtMoney(sections.totCogs)}</span></div>
          <div className="flex justify-between py-2 border-t mt-2 font-semibold"><span>Gross Profit</span><span className="font-mono">{fmtMoney(sections.grossProfit)}</span></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3"><CardTitle className="text-base">Operating Expenses</CardTitle></CardHeader>
        <CardContent>
          {sections.expense.map((r) => <Row key={r.gl_account_id} r={r} drillable />)}
          <div className="flex justify-between py-2 border-t mt-2 font-semibold"><span>Total Expenses</span><span className="font-mono">{fmtMoney(sections.totExp)}</span></div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex justify-between py-4 text-lg font-bold">
          <span>Net Income</span><span className="font-mono">{fmtMoney(sections.netIncome)}</span>
        </CardContent>
      </Card>

      <Sheet open={!!drill} onOpenChange={(v) => !v && setDrill(null)}>
        <SheetContent className="w-full sm:max-w-3xl overflow-y-auto">
          <SheetHeader><SheetTitle>{drill?.label}</SheetTitle></SheetHeader>
          <div className="mt-2 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{(journalLines ?? []).length} journal lines</span>
            <div className="flex items-center gap-2">
              <span className="font-mono font-semibold">{fmtMoney(drillTotal)}</span>
              <Button
                variant="outline"
                size="sm"
                disabled={!(journalLines ?? []).length}
                onClick={() =>
                  exportCSV(
                    "pl_drilldown.csv",
                    ["Date", "Entry", "Description", "Source", "Debit", "Credit"],
                    (journalLines ?? []).map((l) => [
                      l.transaction_date, l.transaction_number, l.description ?? "",
                      l.expense_number ?? l.reference_type ?? "", String(l.debit_amount ?? 0), String(l.credit_amount ?? 0),
                    ])
                  )
                }
              >
                <FileDown className="h-4 w-4 mr-1" />CSV
              </Button>
            </div>
          </div>
          <Table className="mt-4">
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Entry</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {drillLoading ? (
                <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Loading…</TableCell></TableRow>
              ) : !(journalLines ?? []).length ? (
                <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">No journal entries for this account.</TableCell></TableRow>
              ) : (journalLines ?? []).map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="text-xs">{format(new Date(l.transaction_date), "dd MMM yyyy")}</TableCell>
                  <TableCell className="font-mono text-xs">{l.transaction_number}</TableCell>
                  <TableCell className="text-xs max-w-[240px] truncate">{l.description}</TableCell>
                  <TableCell className="text-xs">
                    {l.expense_number
                      ? <a className="underline" href="/finance/operating-expenses">{l.expense_number}</a>
                      : (l.reference_type ?? "—")}
                    {l.supplier_name && <span className="block text-muted-foreground">{l.supplier_name}</span>}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {fmtMoney(Number(l.debit_amount || 0) - Number(l.credit_amount || 0), l.currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SheetContent>
      </Sheet>
    </div>
  );
}
