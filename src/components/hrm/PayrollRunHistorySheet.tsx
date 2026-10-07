import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  runId: string | null;
}

const statusColor: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  approving: "bg-warning/15 text-warning",
  posted: "bg-success/15 text-success",
  partial: "bg-info/15 text-info",
  failed: "bg-destructive/15 text-destructive",
};

const actionColor: Record<string, string> = {
  posted: "bg-success/15 text-success",
  submitted: "bg-warning/15 text-warning",
  skipped: "bg-muted text-muted-foreground",
  failed: "bg-destructive/15 text-destructive",
};

export function PayrollRunHistorySheet({ open, onOpenChange, runId }: Props) {
  const { data: run } = useQuery({
    queryKey: ["payroll-run-detail", runId],
    enabled: open && !!runId,
    queryFn: async () => {
      const { data } = await (supabase as any).from("payroll_runs").select("*").eq("id", runId).maybeSingle();
      return data;
    },
  });

  const { data: items = [] } = useQuery({
    queryKey: ["payroll-run-items", runId],
    enabled: open && !!runId,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("payroll_run_items")
        .select("*, payslip:payslips(reference, employee:employees(name))")
        .eq("run_id", runId);
      return data ?? [];
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[640px] sm:max-w-[640px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            Payroll Run
            {run ? <Badge className={statusColor[run.status]} variant="secondary">{run.status}</Badge> : null}
          </SheetTitle>
        </SheetHeader>
        {run ? (
          <div className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><div className="text-xs text-muted-foreground">Period</div><div>{run.period_start} → {run.period_end}</div></div>
              <div><div className="text-xs text-muted-foreground">Division</div><div>{run.division ?? "All"}</div></div>
              <div><div className="text-xs text-muted-foreground">Started</div><div>{format(new Date(run.started_at), "dd MMM yyyy HH:mm")}</div></div>
              <div><div className="text-xs text-muted-foreground">Completed</div><div>{run.completed_at ? format(new Date(run.completed_at), "dd MMM yyyy HH:mm") : "—"}</div></div>
            </div>
            <div className="grid grid-cols-4 gap-2 text-center">
              <div className="rounded-md border p-2"><div className="text-xs text-muted-foreground">Total</div><div className="font-bold">{run.total_payslips}</div></div>
              <div className="rounded-md border p-2"><div className="text-xs text-muted-foreground">Posted</div><div className="font-bold text-success">{run.posted_count}</div></div>
              <div className="rounded-md border p-2"><div className="text-xs text-muted-foreground">Pending</div><div className="font-bold text-warning">{run.pending_approval_count}</div></div>
              <div className="rounded-md border p-2"><div className="text-xs text-muted-foreground">Failed</div><div className="font-bold text-destructive">{run.failed_count}</div></div>
            </div>

            <Table>
              <TableHeader><TableRow>
                <TableHead>Reference</TableHead><TableHead>Employee</TableHead><TableHead>Action</TableHead><TableHead>Error</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {items.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No payslips processed.</TableCell></TableRow>
                ) : items.map((it: any) => (
                  <TableRow key={it.id}>
                    <TableCell className="font-mono text-xs">{it.payslip?.reference ?? "—"}</TableCell>
                    <TableCell>{it.payslip?.employee?.name ?? "—"}</TableCell>
                    <TableCell><Badge className={actionColor[it.action]} variant="secondary">{it.action}</Badge></TableCell>
                    <TableCell className="text-xs text-destructive">{it.error ?? ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="text-muted-foreground p-6">Loading…</div>
        )}
      </SheetContent>
    </Sheet>
  );
}
