import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { mapRepatriationError } from "@/lib/repatriation-errors";
import { formatAccountTypeLabel } from "@/lib/format";

type Props = {
  repatriationId: string | null;
  repatriationNumber?: string;
  outstanding: number;
  currency: string;
  onOpenChange: (open: boolean) => void;
};

const METHODS = ["bank_transfer", "cash", "cheque", "credit_card", "other"] as const;

export function RepatriationRecordPaymentDialog({
  repatriationId, repatriationNumber, outstanding, currency, onOpenChange,
}: Props) {
  const qc = useQueryClient();
  const [accountId, setAccountId] = useState("");
  const [method, setMethod] = useState<(typeof METHODS)[number]>("bank_transfer");
  const [reference, setReference] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [notes, setNotes] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { data: accounts } = useQuery({
    queryKey: ["financial-accounts-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financial_accounts")
        .select("id, name, account_type, currency")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Validation — the RPC always settles the full outstanding balance, so we
  // block the action whenever the balance is zero/negative or no account is chosen.
  const validationError =
    outstanding <= 0
      ? "Outstanding balance is zero — nothing to pay."
      : !accountId
        ? "Select the receiving account."
        : null;

  const settle = useMutation({
    mutationFn: async () => {
      if (!repatriationId) throw new Error("Missing repatriation");
      if (validationError) throw new Error(validationError);
      const { data, error } = await supabase.rpc("mark_repatriation_invoice_paid" as any, {
        _repatriation_id: repatriationId,
        _account_id: accountId,
        _method: method,
        _reference: reference || null,
        _paid_at: paidAt ? new Date(paidAt).toISOString() : new Date().toISOString(),
        _notes: notes || null,
      });
      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: () => {
      toast.success("Payment recorded — repatriation settled");
      qc.invalidateQueries({ queryKey: ["repatriations"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["repatriation-invoice"] });
      qc.invalidateQueries({ queryKey: ["repatriation-invoice-payments"] });
      qc.invalidateQueries({ queryKey: ["repatriation-invoices-batch"] });
      qc.invalidateQueries({ queryKey: ["repatriation-invoice-payments-batch"] });
      setErrorMsg(null);
      onOpenChange(false);
    },
    onError: (e: any) => {
      const msg = mapRepatriationError(e);
      setErrorMsg(msg);
      toast.error(msg);
    },
  });

  return (
    <Dialog open={!!repatriationId} onOpenChange={(o) => { if (!o) setErrorMsg(null); onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Mark as paid {repatriationNumber ? `— ${repatriationNumber}` : ""}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
            Outstanding: <span className="font-mono font-semibold">{currency} {outstanding.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          {errorMsg && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{errorMsg}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label>Receiving account</Label>
            <Select value={accountId} onValueChange={(v) => { setAccountId(v); setErrorMsg(null); }}>
              <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
              <SelectContent>
                {accounts?.map((a: any) => (
                  <SelectItem key={a.id} value={a.id}>{a.name} <span className="ml-2 text-xs text-muted-foreground">{formatAccountTypeLabel(a.account_type)}{a.currency ? ` · ${a.currency}` : ""}</span></SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Method</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {METHODS.map(m => <SelectItem key={m} value={m} className="capitalize">{m.replace("_", " ")}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label>Reference</Label><Input value={reference} onChange={e => setReference(e.target.value)} /></div>
            <div className="space-y-2"><Label>Paid at</Label><Input type="datetime-local" value={paidAt} onChange={e => setPaidAt(e.target.value)} /></div>
          </div>
          <div className="space-y-2"><Label>Notes</Label><Input value={notes} onChange={e => setNotes(e.target.value)} /></div>
          {validationError && !errorMsg && (
            <p className="text-xs text-muted-foreground">{validationError}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => settle.mutate()} disabled={settle.isPending || !!validationError}>
            {settle.isPending ? "Recording…" : `Pay ${currency} ${outstanding.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
