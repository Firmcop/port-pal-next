import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Money } from "@/components/Money";
import { format } from "date-fns";

export function useConversionRevenueAudit(conversionId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["conversion-revenue-audit", conversionId],
    enabled: !!conversionId && enabled,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("conversion_revenue_audit")
        .select("*")
        .eq("conversion_id", conversionId)
        .order("changed_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });
}

export function EditConversionRevenueDialog({
  open,
  onOpenChange,
  job,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  job: any;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [amount, setAmount] = useState(String(job?.quoted_price ?? ""));
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) {
      setAmount(String(job?.quoted_price ?? ""));
      setReason("");
    }
  }, [open, job?.id, job?.quoted_price]);

  const reasonOk = reason.trim().length >= 10;

  const mut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("admin_adjust_conversion_revenue" as any, {
        _conversion_id: job.id,
        _new_amount: parseFloat(amount) || 0,
        _reason: reason.trim(),
      });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (res: any) => {
      toast({
        title: "Revenue updated",
        description: res?.ledger_posted ? "Balancing journal entry posted" : "Saved",
      });
      setReason("");
      onSaved();
      onOpenChange(false);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Job Revenue</DialogTitle>
          <DialogDescription>
            Admin-only correction of the quoted price. A reason is required and every change is
            recorded. If revenue has already been posted, a balancing entry is created for the
            difference.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">
            Current: <Money amount={job?.quoted_price} currency={job?.currency} className="font-medium text-foreground" />
          </p>
          <div className="space-y-2">
            <Label>New revenue ({(job?.currency ?? "").toUpperCase() || "org currency"})</Label>
            <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Reason</Label>
            <Textarea
              rows={3}
              value={reason}
              placeholder="Why is this figure being corrected?"
              onChange={(e) => setReason(e.target.value)}
            />
            {!reasonOk && (
              <p className="text-xs text-muted-foreground">At least 10 characters required.</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || !reasonOk}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ConversionRevenueHistory({ conversionId, enabled }: { conversionId: string; enabled: boolean }) {
  const { data } = useConversionRevenueAudit(conversionId, enabled);
  if (!enabled || !data?.length) return null;
  return (
    <div className="col-span-full border-t pt-3">
      <p className="text-xs font-medium text-muted-foreground mb-2">Revenue change history</p>
      <ul className="space-y-1 text-xs">
        {data.map((r) => (
          <li key={r.id} className="flex flex-wrap gap-x-2 text-muted-foreground">
            <span className="font-mono">{format(new Date(r.changed_at), "dd MMM yyyy HH:mm")}</span>
            <span className="text-foreground">
              <Money amount={r.old_amount} currency={r.currency} /> → <Money amount={r.new_amount} currency={r.currency} />
            </span>
            <span>· {r.reason}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
