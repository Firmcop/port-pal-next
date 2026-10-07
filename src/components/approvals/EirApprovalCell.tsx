import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ApprovalBadge } from "@/components/ApprovalBadge";
import { useToast } from "@/hooks/use-toast";

/**
 * Approval status plus staff approve/reject actions for one EIR, acting on
 * behalf of the owner through the generic approval request framework.
 */
export function EirApprovalCell({ eir }: { eir: any }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const decide = useMutation({
    mutationFn: async (decision: "approved" | "rejected") => {
      if (!eir.approval_request_id) throw new Error("This receipt has no approval request.");
      const { error } = await supabase.rpc("decide_approval_request" as any, {
        _request_id: eir.approval_request_id,
        _decision: decision,
        _notes: decision === "rejected" ? "Rejected by depot staff on behalf of the owner" : null,
      });
      if (error) throw error;
    },
    onMutate: () => setBusy(true),
    onSettled: () => setBusy(false),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["eir-records"] });
      qc.invalidateQueries({ queryKey: ["approval-requests"] });
      toast({ title: "Decision recorded" });
    },
    onError: (e: any) => toast({ title: "Could not save", description: e.message, variant: "destructive" }),
  });

  if (eir.approval_status !== "pending") {
    if (!eir.approval_status || eir.approval_status === "not_required") {
      return <span className="text-xs text-muted-foreground">—</span>;
    }
    return <ApprovalBadge status={eir.approval_status} />;
  }

  return (
    <div className="flex items-center gap-1">
      <ApprovalBadge status="pending" />
      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={busy} onClick={() => decide.mutate("approved")}>
        Approve
      </Button>
      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-destructive" disabled={busy} onClick={() => decide.mutate("rejected")}>
        Reject
      </Button>
    </div>
  );
}
