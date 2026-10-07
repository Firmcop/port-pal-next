import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, RefreshCw, Pencil, Repeat } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { Money } from "@/components/Money";
import { RecurringExpenseDialog } from "@/components/finance/RecurringExpenseDialog";

export function RecurringExpensesTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);

  const { data: templates, isLoading } = useQuery({
    queryKey: ["recurring-expense-templates"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("recurring_expense_templates")
        .select("*, suppliers(name), depots(name), recurring_expense_template_lines(amount)")
        .order("next_run_date");
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: runs } = useQuery({
    queryKey: ["recurring-expense-runs"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("recurring_expense_runs")
        .select("*, recurring_expense_templates(name), operating_expenses(expense_number, total_amount, currency, approval_status)")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as any[];
    },
  });

  const generate = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any).rpc("generate_due_recurring_expenses");
      if (error) throw error;
      return data as number;
    },
    onSuccess: (count) => {
      ["recurring-expense-templates", "recurring-expense-runs", "operating-expenses"].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] })
      );
      toast({
        title: count ? `${count} expense${count === 1 ? "" : "s"} generated` : "Nothing due",
        description: count ? "Draft entries were created from the due schedules." : "No schedule is due today.",
      });
    },
    onError: (e: any) => toast({ title: "Generation failed", description: e.message, variant: "destructive" }),
  });

  const toggleActive = useMutation({
    mutationFn: async (t: any) => {
      const { error } = await (supabase as any)
        .from("recurring_expense_templates").update({ is_active: !t.is_active }).eq("id", t.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recurring-expense-templates"] }),
    onError: (e: any) => toast({ title: "Could not update", description: e.message, variant: "destructive" }),
  });

  const runTotal = (t: any) =>
    (t.recurring_expense_template_lines ?? []).reduce((s: number, l: any) => s + Number(l.amount || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Schedule rent, maintenance and other accruals — each period the system drafts the OPEX entry for review.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => generate.mutate()} disabled={generate.isPending}>
            <RefreshCw className={`h-4 w-4 mr-1 ${generate.isPending ? "animate-spin" : ""}`} />Generate due now
          </Button>
          <Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}>
            <Plus className="h-4 w-4 mr-1" />New schedule
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Schedule</TableHead>
                <TableHead>Supplier / payee</TableHead>
                <TableHead>Frequency</TableHead>
                <TableHead>Next run</TableHead>
                <TableHead>Ends</TableHead>
                <TableHead className="text-right">Amount / run</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">Loading…</TableCell></TableRow>
              ) : !(templates ?? []).length ? (
                <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                  No recurring expenses yet — create one for rent, insurance or maintenance accruals.
                </TableCell></TableRow>
              ) : (templates ?? []).map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <div className="font-medium text-sm flex items-center gap-1"><Repeat className="h-3 w-3" />{t.name}</div>
                    {t.depots?.name && <div className="text-xs text-muted-foreground">{t.depots.name}</div>}
                  </TableCell>
                  <TableCell className="text-sm">{t.suppliers?.name ?? t.payee ?? "—"}</TableCell>
                  <TableCell className="text-xs capitalize">
                    {t.interval_count > 1 ? `every ${t.interval_count} × ` : ""}{t.frequency}
                  </TableCell>
                  <TableCell className="text-xs">{t.next_run_date ? format(new Date(t.next_run_date), "dd MMM yyyy") : "—"}</TableCell>
                  <TableCell className="text-xs">{t.end_date ? format(new Date(t.end_date), "dd MMM yyyy") : "—"}</TableCell>
                  <TableCell className="text-right font-mono"><Money amount={runTotal(t)} currency={t.currency} /></TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={t.is_active ? "bg-success/15 text-success" : ""}>
                      {t.is_active ? "active" : "paused"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button variant="ghost" size="sm" onClick={() => { setEditing(t); setOpen(true); }}>
                      <Pencil className="h-4 w-4 mr-1" />Edit
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => toggleActive.mutate(t)}>
                      {t.is_active ? "Pause" : "Resume"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Run date</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Generated expense</TableHead>
                <TableHead>Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!(runs ?? []).length ? (
                <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">No generation history yet.</TableCell></TableRow>
              ) : (runs ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs">{format(new Date(r.run_date), "dd MMM yyyy")}</TableCell>
                  <TableCell className="text-sm">{r.recurring_expense_templates?.name ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{r.period_key}</TableCell>
                  <TableCell className="text-xs">
                    {r.operating_expenses?.expense_number ?? "—"}
                    {r.operating_expenses && (
                      <span className="ml-2 font-mono">
                        <Money amount={r.operating_expenses.total_amount} currency={r.operating_expenses.currency} />
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    <Badge variant="secondary" className={r.status === "failed" ? "bg-destructive/15 text-destructive" : "bg-success/15 text-success"}>
                      {r.status}
                    </Badge>
                    {r.message && <span className="ml-2 text-muted-foreground">{r.message}</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <RecurringExpenseDialog open={open} template={editing} onOpenChange={setOpen} />
    </div>
  );
}
