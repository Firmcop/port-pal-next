import { useState } from "react";
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
import { Plus, ArrowLeftRight, Ban } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { formatAccountTypeLabel } from "@/lib/format";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RecurringTransfersTab } from "@/components/finance/RecurringTransfersTab";

export default function FinanceTransfers() {
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({
    from_account_id: "", to_account_id: "", amount: "", fx_rate: "1", fees: "0",
    description: "", reference: "", transfer_date: new Date().toISOString().slice(0, 10),
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

  const { data: transfers, isLoading } = useQuery({
    queryKey: ["transfers"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("inter_account_transfers")
        .select("*, from_account:financial_accounts!from_account_id(name), to_account:financial_accounts!to_account_id(name)")
        .order("transfer_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const createMut = useMutation({
    mutationFn: async () => {
      if (form.from_account_id === form.to_account_id) throw new Error("From/To must differ");
      const num = `TRF-${Date.now().toString(36).toUpperCase()}`;
      const { error } = await (supabase as any).from("inter_account_transfers").insert({
        transfer_number: num,
        transfer_date: new Date(form.transfer_date).toISOString(),
        from_account_id: form.from_account_id,
        to_account_id: form.to_account_id,
        amount: parseFloat(form.amount) || 0,
        fx_rate: parseFloat(form.fx_rate) || 1,
        fees: parseFloat(form.fees) || 0,
        description: form.description || null,
        reference: form.reference || null,
        created_by: user?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transfers"] });
      qc.invalidateQueries({ queryKey: ["financial-account-balances"] });
      toast({ title: "Transfer recorded" });
      setOpen(false);
      setForm({ from_account_id: "", to_account_id: "", amount: "", fx_rate: "1", fees: "0", description: "", reference: "", transfer_date: new Date().toISOString().slice(0, 10) });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const voidMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).rpc("void_inter_account_transfer", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transfers"] });
      qc.invalidateQueries({ queryKey: ["financial-account-balances"] });
      toast({ title: "Transfer voided" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><ArrowLeftRight className="h-6 w-6" />Inter-Account Transfers</h1>
          <p className="text-muted-foreground">Move funds between bank, cash, and other accounts within the same business.</p>
        </div>
        <Button onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" />New Transfer</Button>
      </div>

      <Tabs defaultValue="history">
        <TabsList>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="scheduled">Scheduled</TabsTrigger>
        </TabsList>
        <TabsContent value="history" className="space-y-4 pt-4">


      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Transfer #</TableHead>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Fees</TableHead>
                <TableHead className="text-right">FX</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : !transfers?.length ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No transfers yet</TableCell></TableRow>
              ) : transfers.map((t: any) => (
                <TableRow key={t.id}>
                  <TableCell className="text-xs">{format(new Date(t.transfer_date), "yyyy-MM-dd")}</TableCell>
                  <TableCell className="font-mono text-xs">{t.transfer_number}</TableCell>
                  <TableCell>{t.from_account?.name ?? "—"}</TableCell>
                  <TableCell>{t.to_account?.name ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono">{Number(t.amount).toFixed(2)}</TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">{Number(t.fees).toFixed(2)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{Number(t.fx_rate).toFixed(4)}</TableCell>
                  <TableCell>{t.voided_at ? <Badge variant="destructive">voided</Badge> : <Badge variant="secondary" className="bg-success/15 text-success">posted</Badge>}</TableCell>
                  <TableCell>
                    {!t.voided_at && (
                      <Button size="sm" variant="ghost" onClick={() => { if (confirm("Void this transfer? This will post reversing entries.")) voidMut.mutate(t.id); }}>
                        <Ban className="h-3 w-3 mr-1" />Void
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
        </TabsContent>
        <TabsContent value="scheduled" className="pt-4">
          <RecurringTransfersTab />
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Transfer</DialogTitle></DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); createMut.mutate(); }} className="space-y-3">
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
              <div className="space-y-1"><Label>Date</Label><Input type="date" value={form.transfer_date} onChange={(e) => set("transfer_date", e.target.value)} /></div>
              <div className="space-y-1"><Label>Amount *</Label><Input type="number" step="0.01" required value={form.amount} onChange={(e) => set("amount", e.target.value)} /></div>
              <div className="space-y-1"><Label>FX Rate</Label><Input type="number" step="0.0001" value={form.fx_rate} onChange={(e) => set("fx_rate", e.target.value)} /></div>
              <div className="space-y-1"><Label>Fees</Label><Input type="number" step="0.01" value={form.fees} onChange={(e) => set("fees", e.target.value)} /></div>
              <div className="space-y-1 col-span-2"><Label>Reference</Label><Input value={form.reference} onChange={(e) => set("reference", e.target.value)} /></div>
              <div className="space-y-1 col-span-2"><Label>Description</Label><Textarea rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} /></div>
            </div>
            <Button type="submit" className="w-full" disabled={createMut.isPending || !form.from_account_id || !form.to_account_id || !form.amount}>Record Transfer</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
