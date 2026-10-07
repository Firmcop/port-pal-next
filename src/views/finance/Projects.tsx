import { useState } from "react";
import { getDefaultCurrency } from "@/lib/finance-format";
import { useNavigate } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, FolderKanban } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const STATUSES = ["active", "on_hold", "completed", "archived"] as const;
const statusColor: Record<string, string> = {
  active: "bg-success/15 text-success",
  on_hold: "bg-warning/15 text-warning",
  completed: "bg-info/15 text-info",
  archived: "bg-muted text-muted-foreground",
};

export default function Projects() {
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({
    code: "", name: "", customer_id: "", status: "active",
    start_date: "", end_date: "", budget_amount: "0", currency: getDefaultCurrency(), description: "",
  });
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const { data: projects, isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("projects")
        .select("*, customer:customers(company_name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: pnl } = useQuery({
    queryKey: ["project-pnl"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("project_pnl").select("*");
      if (error) throw error;
      const map: Record<string, any> = {};
      (data ?? []).forEach((r: any) => { map[r.project_id] = r; });
      return map;
    },
  });

  const { data: jobCosts } = useQuery({
    queryKey: ["project-job-costs-all"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("project_job_costs").select("*");
      if (error) throw error;
      const map: Record<string, any> = {};
      (data ?? []).forEach((r: any) => { map[r.project_id] = r; });
      return map;
    },
  });

  const { data: customers } = useQuery({
    queryKey: ["customers-list-projects"],
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("id, company_name").eq("is_active", true).order("company_name");
      if (error) throw error;
      return data;
    },
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).from("projects").insert({
        ...form,
        customer_id: form.customer_id || null,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        budget_amount: parseFloat(form.budget_amount) || 0,
        created_by: user?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast({ title: "Project created" });
      setOpen(false);
      setForm({ code: "", name: "", customer_id: "", status: "active", start_date: "", end_date: "", budget_amount: "0", currency: getDefaultCurrency(), description: "" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><FolderKanban className="h-6 w-6" />Projects</h1>
          <p className="text-muted-foreground">Track income, expenses, and profitability per contract or work cluster.</p>
        </div>
        <Button onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" />New Project</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Budget</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Margin</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : !projects?.length ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No projects yet</TableCell></TableRow>
              ) : projects.map((p: any) => {
                const r = pnl?.[p.id];
                const jc = Number(jobCosts?.[p.id]?.job_cost_total || 0);
                const revenue = Number(r?.revenue || 0);
                const cost = Number(r?.cogs || 0) + Number(r?.expenses || 0) + jc;
                const margin = revenue - cost;
                return (
                  <TableRow key={p.id} className="cursor-pointer hover:bg-muted/40" onClick={() => navigate(`/finance/projects/${p.id}`)}>
                    <TableCell className="font-mono text-xs">{p.code}</TableCell>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{p.customer?.company_name ?? "—"}</TableCell>
                    <TableCell><Badge className={statusColor[p.status] ?? ""} variant="secondary">{p.status.replace("_"," ")}</Badge></TableCell>
                    <TableCell className="text-right font-mono">{Number(p.budget_amount).toFixed(2)}</TableCell>
                    <TableCell className="text-right font-mono text-success">{revenue.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-mono text-destructive">
                      {cost.toFixed(2)}
                      {jc > 0 && <div className="text-[10px] text-muted-foreground">incl. jobs {jc.toFixed(2)}</div>}
                    </TableCell>
                    <TableCell className={`text-right font-mono font-bold ${margin >= 0 ? "text-success" : "text-destructive"}`}>{margin.toFixed(2)}</TableCell>
                    <TableCell><Button size="sm" variant="ghost">Open</Button></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Project</DialogTitle></DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); createMut.mutate(); }} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Code *</Label><Input required value={form.code} onChange={(e) => set("code", e.target.value)} placeholder="PRJ-001" /></div>
              <div className="space-y-1">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => set("status", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace("_"," ")}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1 col-span-2"><Label>Name *</Label><Input required value={form.name} onChange={(e) => set("name", e.target.value)} /></div>
              <div className="space-y-1 col-span-2">
                <Label>Customer</Label>
                <Select value={form.customer_id} onValueChange={(v) => set("customer_id", v)}>
                  <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                  <SelectContent>{customers?.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label>Start Date</Label><Input type="date" value={form.start_date} onChange={(e) => set("start_date", e.target.value)} /></div>
              <div className="space-y-1"><Label>End Date</Label><Input type="date" value={form.end_date} onChange={(e) => set("end_date", e.target.value)} /></div>
              <div className="space-y-1"><Label>Budget</Label><Input type="number" step="0.01" value={form.budget_amount} onChange={(e) => set("budget_amount", e.target.value)} /></div>
              <div className="space-y-1"><Label>Currency</Label><Input value={form.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} /></div>
              <div className="space-y-1 col-span-2"><Label>Description</Label><Textarea rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} /></div>
            </div>
            <Button type="submit" className="w-full" disabled={createMut.isPending || !form.code || !form.name}>Create Project</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
