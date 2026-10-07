import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { CurrencySelect } from "@/components/CurrencySelect";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  kind: "sales" | "purchase";
  invoiceId: string;
  invoiceNumber?: string;
  currentCurrency?: string | null;
  onSuccess?: () => void;
};

export function CurrencyOverrideDialog({
  open, onOpenChange, kind, invoiceId, invoiceNumber, currentCurrency, onSuccess,
}: Props) {
  const [target, setTarget] = useState<string>(currentCurrency ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!target || target === currentCurrency) {
      toast.error("Pick a different currency"); return;
    }
    if (reason.trim().length < 5) {
      toast.error("Reason must be at least 5 characters"); return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("override_invoice_currency" as any, {
      _kind: kind, _invoice_id: invoiceId, _new_currency: target, _reason: reason.trim(),
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Currency overridden to ${target}`);
    onSuccess?.();
    onOpenChange(false);
    setReason("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Override invoice currency</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Invoice <span className="font-mono">{invoiceNumber ?? invoiceId.slice(0, 8)}</span> is
            currently in <span className="font-mono">{currentCurrency ?? "—"}</span>. Overrides are
            audited (who, when, from → to, reason).
          </p>
          <div className="space-y-1">
            <Label>New currency</Label>
            <CurrencySelect value={target} onChange={setTarget} />
          </div>
          <div className="space-y-1">
            <Label>Reason <span className="text-destructive">*</span></Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Customer's billing entity changed to their EU subsidiary — invoice in EUR"
              rows={3}
              maxLength={500}
            />
            <p className="text-xs text-muted-foreground">{reason.trim().length}/500 (min 5)</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Saving…" : "Override & audit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
