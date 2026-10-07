import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (id: string) => void;
};

export function PayslipDialog({ open, onOpenChange, onCreated }: Props) {
  const { toast } = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = today.slice(0, 8) + "01";
  const [form, setForm] = useState<any>({
    employee_id: "", pay_date: today, period_start: firstOfMonth, period_end: today, description: "",
  });
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!open) setForm({ employee_id: "", pay_date: today, period_start: firstOfMonth, period_end: today, description: "" });
  }, [open]);

  const { data: employees = [] } = useQuery({
    queryKey: ["hrm-active-employees"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("employees").select("id,name,daily_rate").eq("is_active", true).order("name");
      if (error) return [];
      return data ?? [];
    },
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any).from("payslips").insert({
        employee_id: form.employee_id,
        pay_date: form.pay_date,
        period_start: form.period_start,
        period_end: form.period_end,
        description: form.description || null,
      }).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: (id) => { onCreated(id); onOpenChange(false); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>New Payslip</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} className="space-y-3">
          <div className="space-y-1">
            <Label>Employee *</Label>
            <Select value={form.employee_id} onValueChange={(v) => set("employee_id", v)}>
              <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
              <SelectContent>
                {employees.map((e: any) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1"><Label>Pay date</Label><Input type="date" value={form.pay_date} onChange={(e) => set("pay_date", e.target.value)} /></div>
            <div className="space-y-1"><Label>Period start</Label><Input type="date" value={form.period_start} onChange={(e) => set("period_start", e.target.value)} /></div>
            <div className="space-y-1"><Label>Period end</Label><Input type="date" value={form.period_end} onChange={(e) => set("period_end", e.target.value)} /></div>
          </div>
          <div className="space-y-1"><Label>Description</Label><Textarea rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} /></div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending || !form.employee_id}>Create draft</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
