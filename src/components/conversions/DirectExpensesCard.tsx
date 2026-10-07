import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Receipt } from "lucide-react";
import { format } from "date-fns";

export type DirectExpenseRow = {
  expense_id: string;
  line_id: string;
  expense_number: string;
  expense_date: string;
  payee: string | null;
  category: string | null;
  description: string | null;
  amount: number;
  tax_amount: number;
  currency: string | null;
  fx_rate: number;
  amount_base: number;
};

/** Approved, posted operating expenses charged directly to a conversion job. */
export function useConversionDirectExpenses(conversionId?: string | null) {
  return useQuery<DirectExpenseRow[]>({
    queryKey: ["conversion-direct-expenses", conversionId],
    enabled: !!conversionId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("conversion_direct_expenses", {
        _conversion_id: conversionId,
      });
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({
        ...r,
        amount: Number(r.amount || 0),
        tax_amount: Number(r.tax_amount || 0),
        fx_rate: Number(r.fx_rate || 1),
        amount_base: Number(r.amount_base || 0),
      }));
    },
  });
}

export type PendingExpenseRow = {
  expense_id: string;
  expense_number: string;
  expense_date: string;
  payee: string | null;
  approval_status: string | null;
  posted: boolean;
  reversed: boolean;
  amount: number;
  currency: string | null;
};

/** Expenses tagged to this job that are not yet approved, posted, or were reversed. */
export function useConversionPendingExpenses(conversionId?: string | null) {
  return useQuery<PendingExpenseRow[]>({
    queryKey: ["conversion-pending-expenses", conversionId],
    enabled: !!conversionId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("conversion_pending_expenses", {
        _conversion_id: conversionId,
      });
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({ ...r, amount: Number(r.amount || 0) }));
    },
  });
}

export type ProjectExpenseRow = DirectExpenseRow & {
  approval_status: string | null;
  posted: boolean;
  reversed: boolean;
  project_job_count: number;
};

const isCounted = (r: ProjectExpenseRow) => r.posted && !r.reversed && r.approval_status === "approved";

/**
 * Combined expense cost for a job: expenses charged to the job itself plus
 * approved, posted expenses charged to its project — the latter only when the
 * project has a single job, so nothing is counted twice.
 */
export function useConversionCombinedExpenseTotal(conversionId?: string | null) {
  const { data: direct = [] } = useConversionDirectExpenses(conversionId);
  const { data: projectRows = [] } = useConversionProjectExpenses(conversionId);
  const jobTotal = direct.reduce((s, r) => s + r.amount_base, 0);
  const countable = (projectRows[0]?.project_job_count ?? 0) === 1;
  const projectTotal = projectRows.filter(isCounted).reduce((s, r) => s + r.amount_base, 0);
  const counted = countable ? projectTotal : 0;
  return { jobTotal, projectTotal, countable, total: jobTotal + counted };
}

/** Expenses tagged to this job's project but not to the job itself. */
export function useConversionProjectExpenses(conversionId?: string | null) {
  return useQuery<ProjectExpenseRow[]>({
    queryKey: ["conversion-project-expenses", conversionId],
    enabled: !!conversionId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("conversion_project_expenses", {
        _conversion_id: conversionId,
      });
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({
        ...r,
        amount: Number(r.amount || 0),
        tax_amount: Number(r.tax_amount || 0),
        fx_rate: Number(r.fx_rate || 1),
        amount_base: Number(r.amount_base || 0),
      }));
    },
  });
}

const num = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const pendingLabel = (r: PendingExpenseRow) =>
  r.reversed ? "reversed"
  : r.approval_status === "submitted" ? "awaiting approval"
  : r.approval_status === "rejected" ? "rejected"
  : !r.posted ? "not yet posted"
  : "draft";

export function DirectExpensesCard({ conversionId, projectId }: { conversionId: string; projectId?: string | null }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: rows = [] } = useConversionDirectExpenses(conversionId);
  const { data: pending = [] } = useConversionPendingExpenses(conversionId);
  const { data: projectRows = [] } = useConversionProjectExpenses(conversionId);
  const total = rows.reduce((s, r) => s + r.amount_base, 0);
  const projectApproved = projectRows.filter(isCounted);
  const projectOther = projectRows.filter((r) => !isCounted(r));
  const projectTotal = projectApproved.reduce((s, r) => s + r.amount_base, 0);
  const projectCountable = (projectRows[0]?.project_job_count ?? 0) === 1;

  const attach = useMutation({
    mutationFn: async (expenseId: string) => {
      const { error } = await (supabase as any).rpc("set_expense_conversion", {
        _expense_id: expenseId,
        _conversion_id: conversionId,
        _project_id: projectId ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Expense attached to this job" });
      qc.invalidateQueries({ queryKey: ["conversion-direct-expenses"] });
      qc.invalidateQueries({ queryKey: ["conversion-pending-expenses"] });
      qc.invalidateQueries({ queryKey: ["conversion-project-expenses"] });
      qc.invalidateQueries({ queryKey: ["operating-expenses"] });
    },
    onError: (e: any) => toast({ title: "Could not attach expense", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Receipt className="h-4 w-4" />Direct expenses charged to this job
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Expense</TableHead>
              <TableHead>Payee</TableHead>
              <TableHead>Category / description</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!rows.length ? (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                  No approved expenses tagged to this job yet
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.line_id}>
                  <TableCell className="text-sm">{format(new Date(r.expense_date), "dd MMM yyyy")}</TableCell>
                  <TableCell className="font-mono text-sm">
                    <Link className="underline-offset-2 hover:underline" to={`/finance/operating-expenses?open=${r.expense_id}`}>
                      {r.expense_number}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">{r.payee ?? "—"}</TableCell>
                  <TableCell className="text-sm">
                    {r.category ?? "—"}
                    {r.description && <span className="block text-xs text-muted-foreground">{r.description}</span>}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {r.currency} {num(r.amount + r.tax_amount)}
                    {r.fx_rate !== 1 && (
                      <span className="block text-[10px] text-muted-foreground">@ {r.fx_rate} → {num(r.amount_base)}</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
            {!!rows.length && (
              <TableRow className="bg-muted/40 font-medium">
                <TableCell colSpan={4}>Total direct expenses</TableCell>
                <TableCell className="text-right font-mono">{num(total)}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {!!pending.length && (
          <div className="border-t p-3 text-sm">
            <p className="mb-1 font-medium">Tagged to this job but not counted yet</p>
            <ul className="space-y-1">
              {pending.map((p) => (
                <li key={p.expense_id} className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Link className="font-mono underline-offset-2 hover:underline" to={`/finance/operating-expenses?open=${p.expense_id}`}>
                    {p.expense_number}
                  </Link>
                  <span>{format(new Date(p.expense_date), "dd MMM yyyy")}</span>
                  <span>{p.payee ?? "—"}</span>
                  <span className="font-mono">{p.currency} {num(p.amount)}</span>
                  <Badge variant="outline" className="text-[10px]">{pendingLabel(p)}</Badge>
                </li>
              ))}
            </ul>
          </div>
        )}
        {!!projectRows.length && (
          <div className="border-t p-3 space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium">Charged to this job&apos;s project</p>
              <p className="text-xs text-muted-foreground">
                Approved and posted: <span className="font-mono">{num(projectTotal)}</span>
                {projectCountable
                  ? " — included in this job's cost"
                  : " — not counted: this project has more than one job, attach each expense to the right job"}
              </p>
            </div>
            <ul className="space-y-1">
              {[...projectApproved, ...projectOther].map((r) => {
                const counted = r.posted && !r.reversed && r.approval_status === "approved";
                return (
                  <li key={r.line_id} className="flex flex-wrap items-center gap-2 border-t pt-1 text-xs">
                    <Link className="font-mono underline-offset-2 hover:underline" to={`/finance/operating-expenses?open=${r.expense_id}`}>
                      {r.expense_number}
                    </Link>
                    <span className="text-muted-foreground">{format(new Date(r.expense_date), "dd MMM yyyy")}</span>
                    <span className="flex-1 min-w-[10rem]">{r.description ?? r.category ?? "—"}</span>
                    <span className="font-mono">{r.currency} {num(r.amount + r.tax_amount)}</span>
                    <Badge variant={counted ? "secondary" : "outline"} className="text-[10px]">
                      {counted ? "via project" : pendingLabel(r as any)}
                    </Badge>
                    <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]"
                      disabled={attach.isPending}
                      onClick={() => attach.mutate(r.expense_id)}>
                      Attach to this job
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
