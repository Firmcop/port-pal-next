import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const NONE = "__none__";

type Line = { category_id: string; gl_account_id: string; description: string; amount: string; tax_code_id: string };

const blankLine = (): Line => ({ category_id: "", gl_account_id: "", description: "", amount: "", tax_code_id: "" });

export function RecurringExpenseDialog({
  open,
  template,
  onOpenChange,
}: {
  open: boolean;
  template?: any | null;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState<any>({});
  const [lines, setLines] = useState<Line[]>([blankLine()]);

  const { data: categories } = useQuery({
    queryKey: ["expense-categories-active"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("expense_categories")
        .select("id,code,name,gl_account_id,tax_code_id,depot_id,project_id")
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: suppliers } = useQuery({
    queryKey: ["suppliers-min"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("suppliers").select("id,name").order("name");
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: accounts } = useQuery({
    queryKey: ["financial-accounts-min"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("financial_accounts").select("id,name,currency").eq("is_active", true).order("name");
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: depots } = useQuery({
    queryKey: ["depots-min"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("depots").select("id,name").order("name");
      if (error) throw error;
      return data as any[];
    },
  });

  useEffect(() => {
    if (!open) return;
    if (template) {
      setForm({ ...template });
      (async () => {
        const { data } = await (supabase as any)
          .from("recurring_expense_template_lines")
          .select("*").eq("template_id", template.id).order("sort_order");
        setLines(
          (data ?? []).length
            ? (data as any[]).map((l) => ({
                category_id: l.category_id ?? "",
                gl_account_id: l.gl_account_id ?? "",
                description: l.description ?? "",
                amount: String(l.amount ?? ""),
                tax_code_id: l.tax_code_id ?? "",
              }))
            : [blankLine()]
        );
      })();
    } else {
      const today = new Date().toISOString().slice(0, 10);
      setForm({
        name: "",
        payment_mode: "credit",
        frequency: "monthly",
        interval_count: 1,
        day_of_month: 1,
        due_days: 0,
        start_date: today,
        next_run_date: today,
        auto_submit: true,
        is_active: true,
      });
      setLines([blankLine()]);
    }
  }, [open, template]);

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const pickCategory = (i: number, categoryId: string) => {
    const cat = (categories ?? []).find((c) => c.id === categoryId);
    setLine(i, {
      category_id: categoryId,
      gl_account_id: cat?.gl_account_id ?? "",
      tax_code_id: cat?.tax_code_id ?? "",
      description: lines[i].description || cat?.name || "",
    });
  };

  const save = useMutation({
    mutationFn: async () => {
      const valid = lines.filter((l) => l.gl_account_id && Number(l.amount) > 0);
      if (!form.name?.trim()) throw new Error("Give the schedule a name");
      if (!valid.length) throw new Error("Add at least one line with a category and amount");

      const payload = {
        name: form.name.trim(),
        supplier_id: form.supplier_id || null,
        payee: form.payee || null,
        payment_mode: form.payment_mode || "credit",
        financial_account_id: form.financial_account_id || null,
        currency: form.currency || null,
        depot_id: form.depot_id || null,
        project_id: form.project_id || null,
        reference: form.reference || null,
        notes: form.notes || null,
        frequency: form.frequency,
        interval_count: Number(form.interval_count || 1),
        day_of_month: form.day_of_month ? Number(form.day_of_month) : null,
        due_days: Number(form.due_days || 0),
        start_date: form.start_date,
        end_date: form.end_date || null,
        next_run_date: form.next_run_date || form.start_date,
        auto_submit: !!form.auto_submit,
        is_active: !!form.is_active,
      };

      let templateId = template?.id;
      if (templateId) {
        const { error } = await (supabase as any).from("recurring_expense_templates").update(payload).eq("id", templateId);
        if (error) throw error;
        await (supabase as any).from("recurring_expense_template_lines").delete().eq("template_id", templateId);
      } else {
        const { data, error } = await (supabase as any)
          .from("recurring_expense_templates").insert(payload).select("id").single();
        if (error) throw error;
        templateId = data.id;
      }

      const { error: lineErr } = await (supabase as any).from("recurring_expense_template_lines").insert(
        valid.map((l, i) => ({
          template_id: templateId,
          category_id: l.category_id || null,
          gl_account_id: l.gl_account_id,
          description: l.description || null,
          amount: Number(l.amount),
          tax_code_id: l.tax_code_id || null,
          depot_id: form.depot_id || null,
          project_id: form.project_id || null,
          sort_order: i,
        }))
      );
      if (lineErr) throw lineErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recurring-expense-templates"] });
      toast({ title: template ? "Schedule updated" : "Schedule created" });
      onOpenChange(false);
    },
    onError: (e: any) => toast({ title: "Could not save schedule", description: e.message, variant: "destructive" }),
  });

  const total = lines.reduce((s, l) => s + Number(l.amount || 0), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{template ? "Edit recurring expense" : "New recurring expense"}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label className="text-xs">Schedule name *</Label>
            <Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Yard rent — HQ" />
          </div>
          <div>
            <Label className="text-xs">Supplier</Label>
            <Select value={form.supplier_id ?? NONE} onValueChange={(v) => setForm({ ...form, supplier_id: v === NONE ? null : v })}>
              <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {(suppliers ?? []).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Payee (if no supplier)</Label>
            <Input value={form.payee ?? ""} onChange={(e) => setForm({ ...form, payee: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Frequency</Label>
            <Select value={form.frequency ?? "monthly"} onValueChange={(v) => setForm({ ...form, frequency: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="quarterly">Quarterly</SelectItem>
                <SelectItem value="yearly">Yearly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Every N periods</Label>
            <Input type="number" min={1} value={form.interval_count ?? 1} onChange={(e) => setForm({ ...form, interval_count: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Start date</Label>
            <Input type="date" value={form.start_date ?? ""} onChange={(e) => setForm({ ...form, start_date: e.target.value, next_run_date: form.next_run_date || e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Next run</Label>
            <Input type="date" value={form.next_run_date ?? ""} onChange={(e) => setForm({ ...form, next_run_date: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">End date (optional)</Label>
            <Input type="date" value={form.end_date ?? ""} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Payment terms (days)</Label>
            <Input type="number" min={0} value={form.due_days ?? 0} onChange={(e) => setForm({ ...form, due_days: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Depot</Label>
            <Select value={form.depot_id ?? NONE} onValueChange={(v) => setForm({ ...form, depot_id: v === NONE ? null : v })}>
              <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {(depots ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Settlement account (for paid mode)</Label>
            <Select value={form.financial_account_id ?? NONE} onValueChange={(v) => setForm({ ...form, financial_account_id: v === NONE ? null : v })}>
              <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {(accounts ?? []).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Notes</Label>
            <Textarea rows={2} value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold">Lines</Label>
            <Button variant="outline" size="sm" onClick={() => setLines([...lines, blankLine()])}>
              <Plus className="h-4 w-4 mr-1" />Add line
            </Button>
          </div>
          {lines.map((l, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[2fr_2fr_1fr_auto] items-end rounded-md border p-2">
              <div>
                <Label className="text-[10px]">Category</Label>
                <Select value={l.category_id || NONE} onValueChange={(v) => pickCategory(i, v === NONE ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {(categories ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.code} — {c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[10px]">Description</Label>
                <Input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />
              </div>
              <div>
                <Label className="text-[10px]">Amount</Label>
                <Input type="number" step="0.01" value={l.amount} onChange={(e) => setLine(i, { amount: e.target.value })} />
              </div>
              <Button variant="ghost" size="icon" onClick={() => setLines(lines.filter((_, idx) => idx !== i))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <p className="text-right text-sm font-mono">Total per run: {total.toFixed(2)}</p>
        </div>

        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={!!form.auto_submit} onCheckedChange={(v) => setForm({ ...form, auto_submit: v })} />
            Submit generated entries for approval automatically
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={!!form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
            Active
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
