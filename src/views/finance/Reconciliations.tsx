import { useState } from "react";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, ClipboardCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";

const statusColor: Record<string, string> = {
  in_progress: "bg-warning/15 text-warning",
  completed: "bg-success/15 text-success",
  voided: "bg-destructive/15 text-destructive",
};

export default function Reconciliations() {
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({
    account_id: "", statement_start: "", statement_end: "",
    statement_opening_balance: "0", statement_closing_balance: "0",
  });
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  useRealtimeInvalidate([
    { table: "bank_reconciliations", queryKeys: ["reconciliations"] },
  ], "reconciliations-rt");



  const { data: accounts } = useQuery({
    queryKey: ["financial-accounts-active"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("financial_accounts").select("id, name, account_type").eq("is_active", true).order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: list, isLoading } = useQuery({
    queryKey: ["reconciliations"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("bank_reconciliations")
        .select("*, account:financial_accounts(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any).from("bank_reconciliations").insert({
        account_id: form.account_id,
        statement_start: form.statement_start,
        statement_end: form.statement_end,
        statement_opening_balance: parseFloat(form.statement_opening_balance) || 0,
        statement_closing_balance: parseFloat(form.statement_closing_balance) || 0,
        created_by: user?.id,
      }).select("id").single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["reconciliations"] });
      toast({ title: "Reconciliation started" });
      setOpen(false);
      if (data?.id) navigate(`/finance/reconciliations/${data.id}`);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><ClipboardCheck className="h-6 w-6" />Bank Reconciliations</h1>
          <p className="text-muted-foreground">Verify your records against the actual bank statement.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <a href="/finance/sales-currency-reconciliation">Sales Currency Reconciliation</a>
          </Button>
          <Button variant="outline" asChild>
            <a href="/finance/currency-backfill">Currency Backfill</a>
          </Button>
          <Button variant="outline" asChild>
            <a href="/finance/fx-rates">FX Rates</a>
          </Button>
          <Button variant="outline" asChild>
            <a href="/finance/adopt-legacy-data">Adopt Legacy Data</a>
          </Button>
          <Button onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" />New Reconciliation</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Opening</TableHead>
                <TableHead className="text-right">Closing</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Completed</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : !list?.length ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No reconciliations yet</TableCell></TableRow>
              ) : list.map((r: any) => (
                <TableRow key={r.id} className="cursor-pointer hover:bg-muted/40" onClick={() => navigate(`/finance/reconciliations/${r.id}`)}>
                  <TableCell className="font-medium">{r.account?.name ?? "—"}</TableCell>
                  <TableCell className="text-xs">{format(new Date(r.statement_start), "yyyy-MM-dd")} → {format(new Date(r.statement_end), "yyyy-MM-dd")}</TableCell>
                  <TableCell className="text-right font-mono">{Number(r.statement_opening_balance).toFixed(2)}</TableCell>
                  <TableCell className="text-right font-mono">{Number(r.statement_closing_balance).toFixed(2)}</TableCell>
                  <TableCell><Badge className={statusColor[r.status] ?? ""} variant="secondary">{r.status.replace("_"," ")}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.completed_at ? format(new Date(r.completed_at), "yyyy-MM-dd") : "—"}</TableCell>
                  <TableCell><Button size="sm" variant="ghost">Open</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Reconciliation</DialogTitle></DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); createMut.mutate(); }} className="space-y-3">
            <div className="space-y-1">
              <Label>Account *</Label>
              <Select value={form.account_id} onValueChange={(v) => set("account_id", v)}>
                <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>{accounts?.map((a: any) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Statement Start *</Label><Input type="date" required value={form.statement_start} onChange={(e) => set("statement_start", e.target.value)} /></div>
              <div className="space-y-1"><Label>Statement End *</Label><Input type="date" required value={form.statement_end} onChange={(e) => set("statement_end", e.target.value)} /></div>
              <div className="space-y-1"><Label>Opening Balance</Label><Input type="number" step="0.01" value={form.statement_opening_balance} onChange={(e) => set("statement_opening_balance", e.target.value)} /></div>
              <div className="space-y-1"><Label>Closing Balance</Label><Input type="number" step="0.01" value={form.statement_closing_balance} onChange={(e) => set("statement_closing_balance", e.target.value)} /></div>
            </div>
            <Button type="submit" className="w-full" disabled={createMut.isPending || !form.account_id || !form.statement_start || !form.statement_end}>Start Reconciliation</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
