import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/use-organization";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Repeat, Play, Pause, PlayCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fmtMoney, getDefaultCurrency } from "@/lib/finance-format";

const FREQUENCIES = ["weekly", "biweekly", "monthly", "quarterly", "yearly"] as const;

export default function RecurringInvoices() {
  const org = useOrganization();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "", customer_name: "", customer_reference: "", invoice_type: "storage",
    subtotal: 0, tax_rate: 0, currency: getDefaultCurrency(), frequency: "monthly",
    interval_count: 1, due_days: 30, next_run_date: new Date().toISOString().slice(0, 10),
    end_date: "", notes: "",
  });

  const { data: templates, isLoading } = useQuery({
    queryKey: ["recurring-invoice-templates"],
    queryFn: async () => {
      const { data, error } = await supabase.from("recurring_invoice_templates" as any).select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const payload: any = { ...form, organization_id: org.organizationId };
      if (!payload.end_date) delete payload.end_date;
      const { error } = await supabase.from("recurring_invoice_templates" as any).insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recurring-invoice-templates"] });
      setOpen(false);
      toast({ title: "Template created" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggle = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("recurring_invoice_templates" as any).update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recurring-invoice-templates"] }),
  });

  const runNow = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("issue_recurring_invoices" as any);
      if (error) throw error;
      return data as number;
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ["recurring-invoice-templates"] });
      toast({ title: `${n ?? 0} invoice(s) issued` });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Repeat className="h-6 w-6" />Recurring Invoices</h1>
          <p className="text-muted-foreground">Templates that auto-issue invoices on a schedule.</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => runNow.mutate()} disabled={runNow.isPending}>
            <PlayCircle className="h-4 w-4 mr-1" /> Run due now
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="h-4 w-4 mr-1" /> New template</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader><DialogTitle>New recurring invoice template</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div><Label>Customer</Label><Input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} /></div>
                <div><Label>Reference</Label><Input value={form.customer_reference} onChange={(e) => setForm({ ...form, customer_reference: e.target.value })} /></div>
                <div><Label>Subtotal</Label><Input type="number" value={form.subtotal} onChange={(e) => setForm({ ...form, subtotal: Number(e.target.value) })} /></div>
                <div><Label>Tax rate %</Label><Input type="number" value={form.tax_rate} onChange={(e) => setForm({ ...form, tax_rate: Number(e.target.value) })} /></div>
                <div><Label>Currency</Label><Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} /></div>
                <div>
                  <Label>Frequency</Label>
                  <Select value={form.frequency} onValueChange={(v) => setForm({ ...form, frequency: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{FREQUENCIES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Interval</Label><Input type="number" min={1} value={form.interval_count} onChange={(e) => setForm({ ...form, interval_count: Number(e.target.value) })} /></div>
                <div><Label>Due days</Label><Input type="number" min={0} value={form.due_days} onChange={(e) => setForm({ ...form, due_days: Number(e.target.value) })} /></div>
                <div><Label>Next run date</Label><Input type="date" value={form.next_run_date} onChange={(e) => setForm({ ...form, next_run_date: e.target.value })} /></div>
                <div><Label>End date (optional)</Label><Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></div>
                <div className="col-span-2"><Label>Notes</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={() => create.mutate()} disabled={!form.name || !form.customer_name || create.isPending}>Create</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Frequency</TableHead>
                <TableHead>Next run</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : !templates?.length ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No templates yet.</TableCell></TableRow>
              ) : templates.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell>{t.customer_name}</TableCell>
                  <TableCell className="capitalize">{t.frequency} × {t.interval_count}</TableCell>
                  <TableCell>{t.next_run_date}</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(t.subtotal, t.currency)}</TableCell>
                  <TableCell><Badge variant="secondary">{t.status}</Badge></TableCell>
                  <TableCell className="text-right">
                    {t.status === "active"
                      ? <Button size="sm" variant="outline" onClick={() => toggle.mutate({ id: t.id, status: "paused" })}><Pause className="h-3 w-3 mr-1" />Pause</Button>
                      : t.status === "paused"
                        ? <Button size="sm" variant="outline" onClick={() => toggle.mutate({ id: t.id, status: "active" })}><Play className="h-3 w-3 mr-1" />Resume</Button>
                        : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
