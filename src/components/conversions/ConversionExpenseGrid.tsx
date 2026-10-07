import { Fragment, useMemo, useState } from "react";
import { Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Download, LayoutGrid } from "lucide-react";
import { exportCSV } from "@/lib/export-utils";
import { format } from "date-fns";

export type BreakdownRow = {
  line_id: string;
  expense_id: string;
  expense_number: string;
  expense_date: string;
  payee: string | null;
  category: string;
  description: string | null;
  amount_base: number;
  currency: string | null;
  amount: number;
  source: "job" | "project";
  approval_status: string | null;
  posted: boolean;
  reversed: boolean;
  counted: boolean;
};

export function useConversionExpenseBreakdown(conversionId?: string | null) {
  return useQuery<BreakdownRow[]>({
    queryKey: ["conversion-expense-breakdown", conversionId],
    enabled: !!conversionId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("conversion_expense_breakdown", {
        _conversion_id: conversionId,
      });
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({
        ...r,
        amount: Number(r.amount || 0),
        amount_base: Number(r.amount_base || 0),
      }));
    },
  });
}

const num = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const stateLabel = (r: BreakdownRow) =>
  r.reversed ? "reversed"
  : r.approval_status === "submitted" ? "awaiting approval"
  : r.approval_status === "rejected" ? "rejected"
  : r.approval_status !== "approved" ? "draft"
  : !r.posted ? "not yet posted"
  : r.source === "job" ? "charged to job"
  : r.counted ? "via project" : "project — not counted";

type Group = {
  category: string;
  job: number;
  project: number;
  pending: number;
  total: number;
  rows: BreakdownRow[];
};

export function ConversionExpenseGrid({ conversionId }: { conversionId: string }) {
  const { data: rows = [], isLoading } = useConversionExpenseBreakdown(conversionId);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    for (const r of rows) {
      const g = map.get(r.category) ?? { category: r.category, job: 0, project: 0, pending: 0, total: 0, rows: [] };
      if (!r.counted) g.pending += r.amount_base;
      else if (r.source === "job") g.job += r.amount_base;
      else g.project += r.amount_base;
      g.total += r.amount_base;
      g.rows.push(r);
      map.set(r.category, g);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [rows]);

  const totals = groups.reduce(
    (t, g) => ({ job: t.job + g.job, project: t.project + g.project, pending: t.pending + g.pending, total: t.total + g.total }),
    { job: 0, project: 0, pending: 0, total: 0 },
  );

  const doExport = () =>
    exportCSV(
      "conversion_expenses_by_category.csv",
      ["Category", "Expense", "Date", "Payee", "Description", "State", "Amount"],
      rows.map((r) => [
        r.category,
        r.expense_number,
        r.expense_date,
        r.payee ?? "",
        r.description ?? "",
        stateLabel(r),
        r.amount_base.toFixed(2),
      ]),
    );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <LayoutGrid className="h-4 w-4" />Expenses by category
        </CardTitle>
        <Button size="sm" variant="outline" disabled={!rows.length} onClick={doExport}>
          <Download className="mr-1 h-3.5 w-3.5" />CSV
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Charged to job</TableHead>
              <TableHead className="text-right">Via project</TableHead>
              <TableHead className="text-right">Pending approval</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">Loading…</TableCell></TableRow>
            ) : !groups.length ? (
              <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">No expenses recorded against this job yet</TableCell></TableRow>
            ) : (
              groups.map((g) => (
                <Fragment key={g.category}>
                  <TableRow className="cursor-pointer" onClick={() => setOpen((o) => ({ ...o, [g.category]: !o[g.category] }))}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-1">
                        {open[g.category] ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        {g.category}
                        <span className="text-xs text-muted-foreground">({g.rows.length})</span>
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">{g.job ? num(g.job) : "—"}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{g.project ? num(g.project) : "—"}</TableCell>
                    <TableCell className="text-right font-mono text-sm text-muted-foreground">{g.pending ? num(g.pending) : "—"}</TableCell>
                    <TableCell className="text-right font-mono text-sm font-medium">{num(g.total)}</TableCell>
                  </TableRow>
                  {open[g.category] && g.rows.map((r) => (
                    <TableRow key={r.line_id} className="bg-muted/30">
                      <TableCell colSpan={3} className="py-1.5 text-xs">
                        <Link className="font-mono underline-offset-2 hover:underline" to={`/finance/operating-expenses?open=${r.expense_id}`}>
                          {r.expense_number}
                        </Link>
                        <span className="ml-2 text-muted-foreground">{format(new Date(r.expense_date), "dd MMM yyyy")}</span>
                        <span className="ml-2">{r.payee ?? "—"}</span>
                        {r.description && <span className="ml-2 text-muted-foreground">{r.description}</span>}
                      </TableCell>
                      <TableCell className="py-1.5 text-right">
                        <Badge variant={r.counted ? "secondary" : "outline"} className="text-[10px]">{stateLabel(r)}</Badge>
                      </TableCell>
                      <TableCell className="py-1.5 text-right font-mono text-xs">{num(r.amount_base)}</TableCell>
                    </TableRow>
                  ))}
                </Fragment>
              ))
            )}
            {!!groups.length && (
              <TableRow className="bg-muted/40 font-medium">
                <TableCell>Total</TableCell>
                <TableCell className="text-right font-mono">{num(totals.job)}</TableCell>
                <TableCell className="text-right font-mono">{num(totals.project)}</TableCell>
                <TableCell className="text-right font-mono text-muted-foreground">{num(totals.pending)}</TableCell>
                <TableCell className="text-right font-mono">{num(totals.total)}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
