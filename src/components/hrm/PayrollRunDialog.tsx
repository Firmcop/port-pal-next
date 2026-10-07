import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, PlayCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  start: string;
  end: string;
  division: string | null;
  organizationId: string | null;
  onCompleted?: (runId: string) => void;
}

export function PayrollRunDialog({ open, onOpenChange, start, end, division, organizationId, onCompleted }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);

  const idempotencyKey = useMemo(
    () => `${organizationId ?? "org"}-${start}-${end}-${division ?? "all"}`,
    [organizationId, start, end, division]
  );

  const { data: preview } = useQuery({
    queryKey: ["payroll-run-preview", start, end, division, open],
    enabled: open,
    queryFn: async () => {
      const q = (supabase as any)
        .from("payslips")
        .select("id,approval_status,employee:employees(division)")
        .eq("status", "draft")
        .gte("pay_date", start)
        .lte("pay_date", end);
      const { data } = await q;
      const rows = (data ?? []).filter((r: any) => !division || r.employee?.division === division);
      const requireApproval = rows.filter((r: any) => r.approval_status !== "approved").length;
      const ready = rows.length - requireApproval;
      return { total: rows.length, requireApproval, ready };
    },
  });

  const { data: existing } = useQuery({
    queryKey: ["payroll-run-existing", idempotencyKey, open],
    enabled: open,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("payroll_runs")
        .select("id,status,started_at")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      return data;
    },
  });

  const run = useMutation({
    mutationFn: async () => {
      setRunning(true);
      const { data, error } = await (supabase as any).rpc("execute_payroll_run", {
        _period_start: start,
        _period_end: end,
        _division: division,
        _idempotency_key: idempotencyKey,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (runId) => {
      toast({ title: "Payroll run completed" });
      qc.invalidateQueries({ queryKey: ["payroll-runs-history"] });
      qc.invalidateQueries({ queryKey: ["payroll-run"] });
      onOpenChange(false);
      onCompleted?.(runId);
    },
    onError: (e: any) => toast({ title: "Run failed", description: e.message, variant: "destructive" }),
    onSettled: () => setRunning(false),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><PlayCircle className="h-5 w-5" />Run payroll for {start} → {end}</DialogTitle>
          <DialogDescription>Posts approved drafts and submits the rest for approval. Safe to retry — duplicates are blocked by an idempotency key.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Drafts in period</div><div className="text-2xl font-bold">{preview?.total ?? "—"}</div></div>
            <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Will be posted</div><div className="text-2xl font-bold text-success">{preview?.ready ?? "—"}</div></div>
            <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Need approval</div><div className="text-2xl font-bold text-warning">{preview?.requireApproval ?? "—"}</div></div>
          </div>
          {existing ? (
            <Alert><AlertDescription>A run for this exact period+division already exists ({existing.status}). Re-running will return that same run without creating duplicates.</AlertDescription></Alert>
          ) : null}
          <div className="text-xs text-muted-foreground font-mono">Idempotency key: {idempotencyKey}</div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={running}>Cancel</Button>
          <Button onClick={() => run.mutate()} disabled={running || (preview?.total ?? 0) === 0}>
            {running ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <PlayCircle className="mr-1 h-4 w-4" />}
            Run payroll
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
