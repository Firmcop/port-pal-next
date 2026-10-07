import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { JobCombobox } from "@/components/finance/JobCombobox";

/** Tag one or more already-recorded expenses against a conversion job. */
export function AssignExpensesToJobDialog({
  open,
  onOpenChange,
  expenseIds,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  expenseIds: string[];
  onDone?: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [jobId, setJobId] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);

  const assign = useMutation({
    mutationFn: async () => {
      for (const id of expenseIds) {
        const { error } = await (supabase as any).rpc("set_expense_conversion", {
          _expense_id: id,
          _conversion_id: jobId || null,
          _project_id: projectId,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      ["operating-expenses", "conversion-direct-expenses", "conversion-pending-expenses", "opex-audit"].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      );
      toast({ title: `Assigned ${expenseIds.length} expense${expenseIds.length === 1 ? "" : "s"}` });
      setJobId("");
      onOpenChange(false);
      onDone?.();
    },
    onError: (e: any) => toast({ title: "Could not assign", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Assign to job</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {expenseIds.length} expense{expenseIds.length === 1 ? "" : "s"} selected. Ledger amounts stay exactly as they are —
            only the job they are reported against changes.
          </p>
          <div>
            <Label>Job</Label>
            <JobCombobox
              value={jobId}
              onChange={(id, job) => { setJobId(id); setProjectId(job?.project_id ?? null); }}
              placeholder="Search job number or customer"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!jobId || !expenseIds.length || assign.isPending} onClick={() => assign.mutate()}>
            {assign.isPending ? "Assigning…" : "Assign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
