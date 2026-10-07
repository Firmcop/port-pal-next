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
import { Plus, Receipt } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fmtMoney } from "@/lib/finance-format";

export default function ExpenseClaims() {
  const org = useOrganization();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ claim_number: "", employee_id: "", total_amount: 0, notes: "" });

  const { data: claims } = useQuery({
    queryKey: ["expense-claims"],
    queryFn: async () => {
      const { data, error } = await supabase.from("expense_claims" as any).select("*, employees(first_name,last_name)").order("claim_date", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: employees } = useQuery({
    queryKey: ["employees-for-claim"],
    queryFn: async () => {
      const { data, error } = await supabase.from("employees" as any).select("id,first_name,last_name").order("first_name");
      if (error) throw error;
      return data as any[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("expense_claims" as any).insert({ ...form, employee_id: form.employee_id || null, organization_id: org.organizationId, status: "submitted" });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["expense-claims"] }); setOpen(false); setForm({ claim_number: "", employee_id: "", total_amount: 0, notes: "" }); toast({ title: "Claim submitted" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const updates: any = { status };
      if (status === "approved") updates.approved_at = new Date().toISOString();
      if (status === "reimbursed") updates.reimbursed_at = new Date().toISOString();
      const { error } = await supabase.from("expense_claims" as any).update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["expense-claims"] }); toast({ title: "Updated" }); },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Receipt className="h-6 w-6" />Expense Claims</h1>
          <p className="text-muted-foreground">Employee expense reimbursements with approval lifecycle.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />New claim</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New expense claim</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Claim #</Label><Input value={form.claim_number} onChange={(e) => setForm({ ...form, claim_number: e.target.value })} /></div>
              <div>
                <Label>Employee</Label>
                <Select value={form.employee_id} onValueChange={(v) => setForm({ ...form, employee_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    {(employees ?? []).map((e) => <SelectItem key={e.id} value={e.id}>{e.first_name} {e.last_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Total amount</Label><Input type="number" step="0.01" value={form.total_amount} onChange={(e) => setForm({ ...form, total_amount: Number(e.target.value) })} /></div>
              <div><Label>Notes</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => create.mutate()} disabled={!form.claim_number || create.isPending}>Submit</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Claim #</TableHead><TableHead>Employee</TableHead><TableHead>Date</TableHead>
                <TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!claims?.length ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No claims.</TableCell></TableRow>
              ) : claims.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono">{c.claim_number}</TableCell>
                  <TableCell>{c.employees ? `${c.employees.first_name} ${c.employees.last_name}` : "—"}</TableCell>
                  <TableCell className="text-xs">{c.claim_date}</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(c.total_amount)}</TableCell>
                  <TableCell><Badge variant="secondary" className="capitalize">{c.status}</Badge></TableCell>
                  <TableCell className="text-right space-x-1">
                    {c.status === "submitted" && <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ id: c.id, status: "approved" })}>Approve</Button>}
                    {c.status === "approved" && <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ id: c.id, status: "reimbursed" })}>Reimburse</Button>}
                    {(c.status === "submitted" || c.status === "draft") && <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ id: c.id, status: "rejected" })}>Reject</Button>}
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
