import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

type Action = "approve" | "reject";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  payslipId: string;
  action: Action;
  onDone: () => void;
};

export function PayslipApprovalDialog({ open, onOpenChange, payslipId, action, onDone }: Props) {
  const { toast } = useToast();
  const [comment, setComment] = useState("");

  const mut = useMutation({
    mutationFn: async () => {
      const fn = action === "approve" ? "approve_payslip" : "reject_payslip";
      const { error } = await (supabase as any).rpc(fn, { _id: payslipId, _comment: comment || null });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: action === "approve" ? "Payslip approved" : "Payslip rejected" });
      setComment("");
      onOpenChange(false);
      onDone();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{action === "approve" ? "Approve payslip" : "Reject payslip"}</DialogTitle>
          <DialogDescription>
            {action === "approve"
              ? "Add an optional comment. Approval will be recorded in the audit log."
              : "Provide a reason. The payslip will be returned to draft for editing."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Comment {action === "reject" && <span className="text-destructive">*</span>}</Label>
          <Textarea rows={4} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Optional comment…" />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant={action === "reject" ? "destructive" : "default"}
            onClick={() => mut.mutate()}
            disabled={mut.isPending || (action === "reject" && !comment.trim())}
          >
            {action === "approve" ? "Approve" : "Reject"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
