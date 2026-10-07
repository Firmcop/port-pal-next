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
import { Plus, Wallet } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";

const ACCOUNT_TYPES = ["bank", "cash", "mobile_money", "credit_card", "other"] as const;

const typeColor: Record<string, string> = {
  bank: "bg-info/15 text-info",
  cash: "bg-success/15 text-success",
  mobile_money: "bg-warning/15 text-warning",
  credit_card: "bg-purple-100 text-purple-800",
  other: "bg-muted text-muted-foreground",
};

export default function FinanceAccounts() {
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({
    name: "", account_type: "bank", currency: getDefaultCurrency(), opening_balance: "0",
    bank_name: "", account_number: "", branch: "", swift_bic: "", notes: "",
  });
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  useRealtimeInvalidate([
    { table: "financial_accounts", queryKeys: ["financial-account-balances"] },
    { table: "accounting_transactions", queryKeys: ["financial-account-balances"] },
    { table: "inter_account_transfers", queryKeys: ["financial-account-balances"] },
    { table: "payments", queryKeys: ["financial-account-balances"] },
    { table: "vendor_payments", queryKeys: ["financial-account-balances"] },
  ], "fin-accounts-rt");



  const { data: balances, isLoading } = useQuery({
    queryKey: ["financial-account-balances"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("financial_account_balances").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const { bank_name, account_number, branch, swift_bic, ...core } = form;
      const { data: created, error } = await (supabase as any).from("financial_accounts").insert({
        ...core,
        opening_balance: parseFloat(form.opening_balance) || 0,
        created_by: user?.id,
      }).select("id, organization_id").single();
      if (error) throw error;
      if (bank_name || account_number || branch || swift_bic) {
        // Banking details are stored separately and readable only by finance roles.
        const { error: bankErr } = await (supabase as any).from("financial_account_bank_details").insert({
          account_id: created.id,
          organization_id: created.organization_id,
          bank_name: bank_name || null,
          account_number: account_number || null,
          branch: branch || null,
          swift_bic: swift_bic || null,
        });
        if (bankErr) throw bankErr;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["financial-account-balances"] });
      toast({ title: "Account created" });
      setOpen(false);
      setForm({ name: "", account_type: "bank", currency: getDefaultCurrency(), opening_balance: "0", bank_name: "", account_number: "", branch: "", swift_bic: "", notes: "" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });


  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Wallet className="h-6 w-6" />Bank &amp; Cash Accounts</h1>
          <p className="text-muted-foreground">Central hub for every bank account, cash box, mobile-money wallet, and credit card.</p>
        </div>
        <Button onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" />New Account</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Currency</TableHead>
                <TableHead className="text-right">Opening</TableHead>
                <TableHead className="text-right">Net Movement</TableHead>
                <TableHead className="text-right">Current Balance</TableHead>
                <TableHead className="text-right">Cleared</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : !balances?.length ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No accounts yet — create your first.</TableCell></TableRow>
              ) : balances.map((b: any) => (
                <TableRow key={b.account_id} className="hover:bg-muted/40">
                  <TableCell className="font-medium">{b.name} {!b.is_active && <Badge variant="outline" className="ml-2">inactive</Badge>}</TableCell>
                  <TableCell><Badge className={typeColor[b.account_type] ?? ""} variant="secondary">{b.account_type.replace("_"," ")}</Badge></TableCell>
                  <TableCell className="text-xs">{b.currency}</TableCell>
                  <TableCell className="text-right font-mono">{Number(b.opening_balance).toFixed(2)}</TableCell>
                  <TableCell className="text-right font-mono">{Number(b.net_movement).toFixed(2)}</TableCell>
                  <TableCell className="text-right font-mono font-bold">{Number(b.current_balance).toFixed(2)}</TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">{Number(b.cleared_balance).toFixed(2)}</TableCell>
                  <TableCell><Button size="sm" variant="ghost" onClick={() => navigate(`/finance/accounts/${b.account_id}`)}>Open</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>New Financial Account</DialogTitle></DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); createMut.mutate(); }} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1 col-span-2"><Label>Name *</Label><Input required value={form.name} onChange={(e) => set("name", e.target.value)} /></div>
              <div className="space-y-1">
                <Label>Type *</Label>
                <Select value={form.account_type} onValueChange={(v) => set("account_type", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{ACCOUNT_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace("_"," ")}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label>Currency</Label><Input value={form.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} /></div>
              <div className="space-y-1"><Label>Opening Balance</Label><Input type="number" step="0.01" value={form.opening_balance} onChange={(e) => set("opening_balance", e.target.value)} /></div>
              <div className="space-y-1"><Label>Bank Name</Label><Input value={form.bank_name} onChange={(e) => set("bank_name", e.target.value)} /></div>
              <div className="space-y-1"><Label>Account #</Label><Input value={form.account_number} onChange={(e) => set("account_number", e.target.value)} /></div>
              <div className="space-y-1"><Label>Branch</Label><Input value={form.branch} onChange={(e) => set("branch", e.target.value)} /></div>
              <div className="space-y-1"><Label>SWIFT / BIC</Label><Input value={form.swift_bic} onChange={(e) => set("swift_bic", e.target.value)} /></div>
              <div className="space-y-1 col-span-2"><Label>Notes</Label><Textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} /></div>
            </div>
            <Button type="submit" className="w-full" disabled={createMut.isPending || !form.name}>Create Account</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
