import { useMemo, useState } from "react";
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
import { Plus, Receipt, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fmtMoney } from "@/lib/finance-format";

type Line = { description: string; gl_account_id: string; project_id: string; amount: string };
const NONE = "__none__";
const emptyLine = (): Line => ({ description: "", gl_account_id: "", project_id: NONE, amount: "" });
const today = () => new Date().toISOString().slice(0, 10);

export default function ExpenseClaims() {
  const org = useOrganization();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ claim_number: "", employee_id: "", claim_date: today(), notes: "" });
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [reimburseFor, setReimburseFor] = useState<any>(null);
  const [reimburse, setReimburse] = useState({ financial_account_id: "", date: today(), reference: "" });

  const { data: claims } = useQuery({
    queryKey: ["expense-claims"],
    queryFn: async () => {
      const { data, error } = await supabase.from("expense_claims" as any)
        .select("*, employees(name), expense_claim_lines(id, description, amount)")
        .order("claim_date", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: employees } = useQuery({
    queryKey: ["employees-for-claim"],
    queryFn: async () => {
      const { data, error } = await supabase.from("employees" as any).select("id,name").eq("is_active", true).order("name");
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: accounts } = useQuery({
    queryKey: ["claim-expense-accounts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("gl_accounts").select("id, code, name")
        .in("account_type", ["expense", "cost_of_goods"] as any).eq("is_active", true).order("code");
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: projects } = useQuery({
    queryKey: ["claim-projects"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("projects").select("id, code, name").order("code");
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: banks } = useQuery({
    queryKey: ["claim-banks"],
    queryFn: async () => {
      const { data, error } = await supabase.from("financial_accounts").select("id, name, currency").eq("is_active", true).order("name");
      if (error) throw error;
      return data as any[];
    },
  });

  const total = useMemo(() => lines.reduce((s, l) => s + (Number(l.amount) || 0), 0), [lines]);
  const linesValid = lines.length > 0 && lines.every((l) => l.description.trim() && Number(l.amount) > 0);

  const create = useMutation({
    mutationFn: async () => {
      const { data: claim, error } = await supabase.from("expense_claims" as any).insert({
        claim_number: form.claim_number,
        claim_date: form.claim_date,
        notes: form.notes || null,
        employee_id: form.employee_id || null,
        organization_id: org.organizationId,
        status: "submitted",
        total_amount: total,
      }).select("id").single();
      if (error) throw error;
      const rows = lines.map((l) => ({
        organization_id: org.organizationId,
        claim_id: (claim as any).id,
        description: l.description,
        category: l.description,
        gl_account_id: l.gl_account_id || null,
        project_id: l.project_id === NONE ? null : l.project_id,
        amount: Number(l.amount),
      }));
      const { error: lineErr } = await supabase.from("expense_claim_lines" as any).insert(rows);
      if (lineErr) throw lineErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expense-claims"] });
      setOpen(false);
      setForm({ claim_number: "", employee_id: "", claim_date: today(), notes: "" });
      setLines([emptyLine()]);
      toast({ title: "Claim submitted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const decide = useMutation({
    mutationFn: async ({ id, decision, note }: { id: string; decision: "approved" | "rejected"; note?: string }) => {
      const { error } = await (supabase as any).rpc("decide_expense_claim", { _claim_id: id, _decision: decision, _note: note ?? null });
      if (error) throw error;
    },
    onSuccess: (_d, v) => { qc.invalidateQueries({ queryKey: ["expense-claims"] }); toast({ title: v.decision === "approved" ? "Claim approved and posted" : "Claim rejected" }); },
    onError: (e: any) => toast({ title: "Could not update the claim", description: e.message, variant: "destructive" }),
  });

  const pay = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).rpc("reimburse_expense_claim", {
        _claim_id: reimburseFor.id,
        _financial_account_id: reimburse.financial_account_id,
        _date: reimburse.date,
        _reference: reimburse.reference || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expense-claims"] });
      setReimburseFor(null);
      toast({ title: "Claim reimbursed" });
    },
    onError: (e: any) => toast({ title: "Could not reimburse", description: e.message, variant: "destructive" }),
  });

  const setLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Receipt className="h-6 w-6" />Expense Claims</h1>
          <p className="text-muted-foreground">Employee expense reimbursements: submit, approve (posts the cost), reimburse (pays from a bank account).</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />New claim</Button></DialogTrigger>
          <DialogContent className="max-w-3xl">
            <DialogHeader><DialogTitle>New expense claim</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div><Label>Claim #</Label><Input value={form.claim_number} onChange={(e) => setForm({ ...form, claim_number: e.target.value })} /></div>
                <div><Label>Date</Label><Input type="date" value={form.claim_date} onChange={(e) => setForm({ ...form, claim_date: e.target.value })} /></div>
                <div>
                  <Label>Employee</Label>
                  <Select value={form.employee_id} onValueChange={(v) => setForm({ ...form, employee_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                    <SelectContent>
                      {(employees ?? []).map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Description</TableHead><TableHead>Account</TableHead><TableHead>Project</TableHead>
                      <TableHead className="text-right">Amount (incl. VAT)</TableHead><TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((l, i) => (
                      <TableRow key={i}>
                        <TableCell><Input value={l.description} placeholder="e.g. Fuel" onChange={(e) => setLine(i, { description: e.target.value })} /></TableCell>
                        <TableCell className="min-w-[180px]">
                          <Select value={l.gl_account_id || NONE} onValueChange={(v) => setLine(i, { gl_account_id: v === NONE ? "" : v })}>
                            <SelectTrigger><SelectValue placeholder="Staff expense claims" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>Staff expense claims (default)</SelectItem>
                              {(accounts ?? []).map((a) => <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="min-w-[150px]">
                          <Select value={l.project_id} onValueChange={(v) => setLine(i, { project_id: v })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>No project</SelectItem>
                              {(projects ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell><Input type="number" step="0.01" className="text-right" value={l.amount} onChange={(e) => setLine(i, { amount: e.target.value })} /></TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" onClick={() => setLines(lines.length > 1 ? lines.filter((_, j) => j !== i) : lines)}><Trash2 className="h-4 w-4" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex items-center justify-between text-sm">
                <Button variant="outline" size="sm" onClick={() => setLines([...lines, emptyLine()])}><Plus className="h-3 w-3 mr-1" />Add line</Button>
                <span className="font-mono">Total {fmtMoney(total)}</span>
              </div>
              <div><Label>Notes</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => create.mutate()} disabled={!form.claim_number || !linesValid || create.isPending}>Submit</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Claim #</TableHead><TableHead>Employee</TableHead><TableHead>Date</TableHead><TableHead>Lines</TableHead>
                <TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!claims?.length ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No claims.</TableCell></TableRow>
              ) : claims.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono">{c.claim_number}</TableCell>
                  <TableCell>{c.employees?.name ?? "—"}</TableCell>
                  <TableCell className="text-xs">{c.claim_date}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {(c.expense_claim_lines ?? []).map((l: any) => l.description).filter(Boolean).join(", ") || "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(c.total_amount)}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="capitalize">{c.status}</Badge>
                    {c.status === "rejected" && c.rejection_reason && <div className="text-xs text-muted-foreground mt-1">{c.rejection_reason}</div>}
                  </TableCell>
                  <TableCell className="text-right space-x-1 whitespace-nowrap">
                    {(c.status === "submitted" || c.status === "draft") && (
                      <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ id: c.id, decision: "approved" })}>Approve</Button>
                    )}
                    {c.status === "approved" && (
                      <Button size="sm" variant="outline" onClick={() => { setReimburseFor(c); setReimburse({ financial_account_id: "", date: today(), reference: "" }); }}>Reimburse</Button>
                    )}
                    {(c.status === "submitted" || c.status === "draft") && (
                      <Button size="sm" variant="ghost" onClick={() => {
                        const note = window.prompt("Reason for rejecting this claim?", "");
                        if (note) decide.mutate({ id: c.id, decision: "rejected", note });
                      }}>Reject</Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!reimburseFor} onOpenChange={(o) => { if (!o) setReimburseFor(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reimburse {reimburseFor?.claim_number}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Pays {fmtMoney(reimburseFor?.total_amount ?? 0)} to {reimburseFor?.employees?.name ?? "the employee"} and clears the amount owed.</p>
            <div>
              <Label>Pay from</Label>
              <Select value={reimburse.financial_account_id} onValueChange={(v) => setReimburse({ ...reimburse, financial_account_id: v })}>
                <SelectTrigger><SelectValue placeholder="Bank, cash or M-Pesa account…" /></SelectTrigger>
                <SelectContent>
                  {(banks ?? []).map((b) => <SelectItem key={b.id} value={b.id}>{b.name} ({b.currency})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Date</Label><Input type="date" value={reimburse.date} onChange={(e) => setReimburse({ ...reimburse, date: e.target.value })} /></div>
              <div><Label>Reference</Label><Input value={reimburse.reference} placeholder="e.g. M-Pesa code" onChange={(e) => setReimburse({ ...reimburse, reference: e.target.value })} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReimburseFor(null)}>Cancel</Button>
            <Button onClick={() => pay.mutate()} disabled={!reimburse.financial_account_id || pay.isPending}>Reimburse</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
