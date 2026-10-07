import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatAccountTypeLabel } from "@/lib/format";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: any;
};

export function RecurringTransferDialog({ open, onOpenChange, initial }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isEdit = !!initial?.id;
  const [form, setForm] = useState<any>({
    name: initial?.name ?? "",
    from_account_id: initial?.from_account_id ?? "",
    to_account_id: initial?.to_account_id ?? "",
    amount: initial?.amount ?? "",
    fx_rate: initial?.fx_rate ?? "1",
    fees: initial?.fees ?? "0",
    description: initial?.description ?? "",
    reference: initial?.reference ?? "",
    frequency: initial?.frequency ?? "monthly",
    interval_count: initial?.interval_count ?? 1,
    start_date: initial?.start_date ?? new Date().toISOString().slice(0, 10),
    end_date: initial?.end_date ?? "",
    next_run_at: initial?.next_run_at?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
  });
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const { data: accounts } = useQuery({
    queryKey: ["financial-accounts-active"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("financial_accounts").select("id, name, account_type, currency").eq("is_active", true).order("name");
      if (error) throw error;
      return data;
    },
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      if (form.from_account_id === form.to_account_id) throw new Error("From/To accounts must differ");
      const payload = {
        name: form.name,
        from_account_id: form.from_account_id,
        to_account_id: form.to_account_id,
        amount: parseFloat(form.amount) || 0,
        fx_rate: parseFloat(form.fx_rate) || 1,
        fees: parseFloat(form.fees) || 0,
        description: form.description || null,
        reference: form.reference || null,
        frequency: form.frequency,
        interval_count: parseInt(form.interval_count) || 1,
        start_date: form.start_date,
        end_date: form.end_date || null,
        next_run_at: new Date(form.next_run_at).toISOString(),
      };
      if (isEdit) {
        const { error } = await (supabase as any).from("recurring_transfers").update(payload).eq("id", initial.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from("recurring_transfers").insert({ ...payload, created_by: user?.id });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recurring-transfers"] });
      toast({ title: isEdit ? "Schedule updated" : "Schedule created" });
      onOpenChange(false);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{isEdit ? "Edit Schedule" : "New Recurring Transfer"}</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); saveMut.mutate(); }} className="space-y-3">
          <div className="space-y-1"><Label>Name *</Label><Input required value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Monthly rent sweep" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>From Account *</Label>
                <Select value={form.from_account_id} onValueChange={(v) => set("from_account_id", v)}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{accounts?.map((a: any) => <SelectItem key={a.id} value={a.id}>{a.name} ({formatAccountTypeLabel(a.account_type)})</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>To Account *</Label>
                <Select value={form.to_account_id} onValueChange={(v) => set("to_account_id", v)}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{accounts?.map((a: any) => <SelectItem key={a.id} value={a.id}>{a.name} ({formatAccountTypeLabel(a.account_type)})</SelectItem>)}</SelectContent>
                </Select>
            </div>
            <div className="space-y-1"><Label>Amount *</Label><Input type="number" step="0.01" required value={form.amount} onChange={(e) => set("amount", e.target.value)} /></div>
            <div className="space-y-1"><Label>FX Rate</Label><Input type="number" step="0.0001" value={form.fx_rate} onChange={(e) => set("fx_rate", e.target.value)} /></div>
            <div className="space-y-1"><Label>Fees</Label><Input type="number" step="0.01" value={form.fees} onChange={(e) => set("fees", e.target.value)} /></div>
            <div className="space-y-1">
              <Label>Frequency</Label>
              <Select value={form.frequency} onValueChange={(v) => set("frequency", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Every (interval)</Label><Input type="number" min="1" value={form.interval_count} onChange={(e) => set("interval_count", e.target.value)} /></div>
            <div className="space-y-1"><Label>Next Run *</Label><Input type="date" required value={form.next_run_at} onChange={(e) => set("next_run_at", e.target.value)} /></div>
            <div className="space-y-1"><Label>Start Date *</Label><Input type="date" required value={form.start_date} onChange={(e) => set("start_date", e.target.value)} /></div>
            <div className="space-y-1"><Label>End Date</Label><Input type="date" value={form.end_date} onChange={(e) => set("end_date", e.target.value)} /></div>
            <div className="space-y-1 col-span-2"><Label>Reference</Label><Input value={form.reference} onChange={(e) => set("reference", e.target.value)} /></div>
            <div className="space-y-1 col-span-2"><Label>Description</Label><Textarea rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} /></div>
          </div>
          <Button type="submit" className="w-full" disabled={saveMut.isPending}>{isEdit ? "Save Changes" : "Create Schedule"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
