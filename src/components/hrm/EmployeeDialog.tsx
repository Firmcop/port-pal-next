import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
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
  employee?: any | null;
  onSaved: () => void;
};

const empty = {
  code: "", name: "", email: "", phone: "", role: "Employee",
  division: "", control_account_id: "", status: "active",
  daily_rate: "0", hired_on: "", tax_id: "", notes: "",
  pay_frequency: "monthly", pay_basis: "daily", hourly_rate: "0",
  monthly_salary: "0", overtime_multiplier: "1.5", statutory_exempt: false,
  deductions: [] as any[],
};

type Deduction = { name: string; type: string; method: string; value: number; frequency: string };

const PRESETS: Deduction[] = [
  { name: "PAYE", type: "tax", method: "percent", value: 10, frequency: "monthly" },
  { name: "NSSF", type: "pension", method: "fixed", value: 200, frequency: "monthly" },
  { name: "Housing Levy", type: "tax", method: "percent", value: 1.5, frequency: "monthly" },
  { name: "SHIF", type: "benefit", method: "percent", value: 2.75, frequency: "monthly" },
];



export function EmployeeDialog({ open, onOpenChange, employee, onSaved }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [form, setForm] = useState<any>(empty);
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (employee) {
      setForm({
        code: employee.code ?? "",
        name: employee.name ?? "",
        email: employee.email ?? "",
        phone: employee.phone ?? "",
        role: employee.role ?? "Employee",
        division: employee.division ?? "",
        control_account_id: employee.control_account_id ?? "",
        status: employee.status ?? "active",
        daily_rate: String(employee.daily_rate ?? "0"),
        hired_on: employee.hired_on ?? "",
        tax_id: employee.tax_id ?? "",
        notes: "",
        pay_frequency: employee.pay_frequency ?? "monthly",
        pay_basis: employee.pay_basis ?? "daily",
        hourly_rate: String(employee.hourly_rate ?? "0"),
        monthly_salary: String(employee.monthly_salary ?? "0"),
        overtime_multiplier: String(employee.overtime_multiplier ?? "1.5"),
        statutory_exempt: !!employee.statutory_exempt,
        deductions: Array.isArray(employee.deductions) ? employee.deductions : [],

      });
    } else {
      setForm(empty);
    }
  }, [employee, open]);

  const { data: accounts = [] } = useQuery({
    queryKey: ["fa-for-employee"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("financial_accounts").select("id,name").eq("is_active", true).order("name");
      if (error) return [];
      return data ?? [];
    },
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: any = {
        code: form.code || null,
        name: form.name,
        email: form.email || null,
        phone: form.phone || null,
        role: form.role || "Employee",
        division: form.division || null,
        control_account_id: form.control_account_id || null,
        status: form.status,
        daily_rate: parseFloat(form.daily_rate) || 0,
        hired_on: form.hired_on || null,
        tax_id: form.tax_id || null,
        pay_frequency: form.pay_frequency,
        pay_basis: form.pay_basis,
        hourly_rate: parseFloat(form.hourly_rate) || 0,
        monthly_salary: parseFloat(form.monthly_salary) || 0,
        overtime_multiplier: parseFloat(form.overtime_multiplier) || 1.5,
        statutory_exempt: !!form.statutory_exempt,
        deductions: (form.deductions ?? []).filter((d: Deduction) => d.name && Number(d.value) !== 0),

      };
      if (!employee?.id) delete payload.code;
      if (employee?.id) {
        const { error } = await (supabase as any).from("employees").update(payload).eq("id", employee.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from("employees").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: onSaved,
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{employee ? "Edit Employee" : "New Employee"}</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Code</Label><Input value={employee ? form.code : ""} readOnly disabled={!employee} onChange={(e) => set("code", e.target.value)} placeholder="Generated automatically" /></div>
            <div className="space-y-1"><Label>Name *</Label><Input required value={form.name} onChange={(e) => set("name", e.target.value)} /></div>
            <div className="space-y-1"><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} /></div>
            <div className="space-y-1"><Label>Phone</Label><Input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div>
            <div className="space-y-1"><Label>Role / Title</Label><Input value={form.role} onChange={(e) => set("role", e.target.value)} /></div>
            <div className="space-y-1"><Label>Division</Label><Input value={form.division} onChange={(e) => set("division", e.target.value)} /></div>
            <div className="space-y-1 col-span-2">
              <Label>Control account</Label>
              <Select value={form.control_account_id || "none"} onValueChange={(v) => set("control_account_id", v === "none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None —</SelectItem>
                  {accounts.map((a: any) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => set("status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="on_leave">On leave</SelectItem>
                  <SelectItem value="terminated">Terminated</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Pay frequency</Label>
              <Select value={form.pay_frequency} onValueChange={(v) => set("pay_frequency", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly salary</SelectItem>
                  <SelectItem value="weekly">Weekly wages</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Pay basis</Label>
              <Select value={form.pay_basis} onValueChange={(v) => set("pay_basis", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Per day</SelectItem>
                  <SelectItem value="hourly">Per hour</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Hourly rate</Label><Input type="number" step="0.01" value={form.hourly_rate} onChange={(e) => set("hourly_rate", e.target.value)} /></div>
            <div className="space-y-1"><Label>Monthly salary</Label><Input type="number" step="0.01" value={form.monthly_salary} onChange={(e) => set("monthly_salary", e.target.value)} /></div>
            <div className="space-y-1"><Label>Overtime multiplier</Label><Input type="number" step="0.1" value={form.overtime_multiplier} onChange={(e) => set("overtime_multiplier", e.target.value)} /></div>
            <label className="col-span-full flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={!!form.statutory_exempt} onChange={(e) => set("statutory_exempt", e.target.checked)} />
              <span>No statutory deductions (PAYE, NSSF, SHIF, Housing Levy) — only for staff legally exempt, e.g. non-resident contractors</span>
            </label>
            <div className="space-y-1"><Label>Daily rate</Label><Input type="number" step="0.01" value={form.daily_rate} onChange={(e) => set("daily_rate", e.target.value)} /></div>
            <div className="space-y-1"><Label>Hire date</Label><Input type="date" value={form.hired_on} onChange={(e) => set("hired_on", e.target.value)} /></div>
            <div className="space-y-1"><Label>Tax ID</Label><Input value={form.tax_id} onChange={(e) => set("tax_id", e.target.value)} /></div>
          </div>

          <div className="space-y-2 rounded-md border p-3">
            <div className="flex items-center justify-between">
              <div>
                <Label>Deductions</Label>
                <p className="text-xs text-muted-foreground">Applied to weekly wage postings and month-end payslips.</p>
              </div>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => set("deductions", [...(form.deductions ?? []), ...PRESETS])}>Add statutory set</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => set("deductions", [...(form.deductions ?? []), { name: "", type: "other", method: "percent", value: 0, frequency: "monthly" }])}>Add</Button>
              </div>
            </div>
            {(form.deductions ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">No deductions configured.</p>
            ) : (form.deductions ?? []).map((d: Deduction, i: number) => {
              const upd = (patch: Partial<Deduction>) =>
                set("deductions", (form.deductions ?? []).map((x: Deduction, j: number) => (j === i ? { ...x, ...patch } : x)));
              return (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <Input className="col-span-3" placeholder="Name" value={d.name} onChange={(e) => upd({ name: e.target.value })} />
                  <Select value={d.type} onValueChange={(v) => upd({ type: v })}>
                    <SelectTrigger className="col-span-2"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tax">Tax</SelectItem>
                      <SelectItem value="pension">Pension</SelectItem>
                      <SelectItem value="benefit">Benefit</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={d.method} onValueChange={(v) => upd({ method: v })}>
                    <SelectTrigger className="col-span-2"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percent">% of gross</SelectItem>
                      <SelectItem value="fixed">Fixed</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input className="col-span-2" type="number" step="0.01" value={String(d.value ?? 0)} onChange={(e) => upd({ value: parseFloat(e.target.value) || 0 })} />
                  <Select value={d.frequency} onValueChange={(v) => upd({ frequency: v })}>
                    <SelectTrigger className="col-span-2"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="both">Both</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button type="button" size="sm" variant="ghost" className="col-span-1" onClick={() => set("deductions", (form.deductions ?? []).filter((_: any, j: number) => j !== i))}>×</Button>
                </div>
              );
            })}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending || !form.name}>{employee ? "Save" : "Create"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
