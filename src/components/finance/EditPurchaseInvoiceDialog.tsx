import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  invoice: any;
  onSuccess?: () => void;
};

export function EditPurchaseInvoiceDialog({ open, onOpenChange, invoice, onSuccess }: Props) {
  const [f, setF] = useState({
    issue_date: invoice?.issue_date ?? "",
    due_date: invoice?.due_date ?? "",
    subtotal: String(invoice?.subtotal ?? ""),
    tax_amount: String(invoice?.tax_amount ?? "0"),
    reference: invoice?.reference ?? "",
    supplier_ref: invoice?.supplier_ref ?? "",
    notes: invoice?.notes ?? "",
  });
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  const subtotal = Number(f.subtotal) || 0;
  const tax = Number(f.tax_amount) || 0;
  const total = Number((subtotal + tax).toFixed(2));

  const submit = async () => {
    if (reason.trim().length < 5) { toast.error("Reason must be at least 5 characters"); return; }
    if (total <= 0) { toast.error("Total must be greater than zero"); return; }
    setBusy(true);
    const { error } = await supabase.rpc("admin_update_supplier_invoice" as any, {
      _invoice_id: invoice.id,
      _patch: {
        issue_date: f.issue_date || null,
        due_date: f.due_date || null,
        subtotal,
        tax_amount: tax,
        total_amount: total,
        reference: f.reference,
        supplier_ref: f.supplier_ref?.trim() || null,
        notes: f.notes,
      },
      _reason: reason.trim(),
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Purchase invoice updated — change recorded in the audit trail");
    onSuccess?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit purchase invoice {invoice?.invoice_number}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Issue date</Label><Input type="date" value={f.issue_date ?? ""} onChange={(e) => set("issue_date", e.target.value)} /></div>
            <div className="space-y-1"><Label>Due date</Label><Input type="date" value={f.due_date ?? ""} onChange={(e) => set("due_date", e.target.value)} /></div>
            <div className="space-y-1"><Label>Subtotal</Label><Input type="number" value={f.subtotal} onChange={(e) => set("subtotal", e.target.value)} /></div>
            <div className="space-y-1"><Label>Tax</Label><Input type="number" value={f.tax_amount} onChange={(e) => set("tax_amount", e.target.value)} /></div>
            <div className="space-y-1"><Label>Total ({String(invoice?.currency ?? "").toUpperCase()})</Label><Input value={total.toFixed(2)} readOnly className="bg-muted font-mono" /></div>
            <div className="space-y-1"><Label>Reference</Label><Input value={f.reference ?? ""} onChange={(e) => set("reference", e.target.value)} /></div>
            <div className="space-y-1"><Label>Supplier invoice no.</Label><Input value={f.supplier_ref ?? ""} placeholder="e.g. DD-SE20260103-0006" onChange={(e) => set("supplier_ref", e.target.value)} /></div>
          </div>
          <div className="space-y-1"><Label>Notes</Label><Textarea rows={2} value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} /></div>
          <div className="space-y-1">
            <Label>Reason for change <span className="text-destructive">*</span></Label>
            <Textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Supplier issued a corrected bill — freight was overstated" />
            <p className="text-xs text-muted-foreground">{reason.trim().length}/500 (min 5). Every edit is audited and the payable ledger is updated.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "Saving…" : "Save & audit"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
