import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/use-organization";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Coins } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fmtMoney } from "@/lib/finance-format";

export default function PettyCash() {
  const org = useOrganization();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [floatOpen, setFloatOpen] = useState(false);
  const [voucherOpen, setVoucherOpen] = useState(false);
  const [activeFloat, setActiveFloat] = useState<string>("");
  const [floatForm, setFloatForm] = useState({ name: "", opening_balance: 0 });
  const [voucherForm, setVoucherForm] = useState({ voucher_number: "", payee: "", amount: 0, notes: "" });

  const { data: floats } = useQuery({
    queryKey: ["pc-floats"],
    queryFn: async () => {
      const { data, error } = await supabase.from("petty_cash_floats" as any).select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: vouchers } = useQuery({
    queryKey: ["pc-vouchers", activeFloat],
    enabled: !!activeFloat,
    queryFn: async () => {
      const { data, error } = await supabase.from("petty_cash_vouchers" as any).select("*").eq("float_id", activeFloat).order("voucher_date", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const createFloat = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("petty_cash_floats" as any).insert({ ...floatForm, current_balance: floatForm.opening_balance, organization_id: org.organizationId });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pc-floats"] }); setFloatOpen(false); setFloatForm({ name: "", opening_balance: 0 }); toast({ title: "Float created" }); },
  });

  const addVoucher = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("petty_cash_vouchers" as any).insert({ ...voucherForm, float_id: activeFloat, organization_id: org.organizationId });
      if (error) throw error;
      const f = (floats ?? []).find((x) => x.id === activeFloat);
      if (f) await supabase.from("petty_cash_floats" as any).update({ current_balance: Number(f.current_balance) - voucherForm.amount }).eq("id", activeFloat);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pc-vouchers", activeFloat] }); qc.invalidateQueries({ queryKey: ["pc-floats"] }); setVoucherOpen(false); setVoucherForm({ voucher_number: "", payee: "", amount: 0, notes: "" }); toast({ title: "Voucher added" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Coins className="h-6 w-6" />Petty Cash</h1>
          <p className="text-muted-foreground">Manage cash floats and voucher disbursements.</p>
        </div>
        <Dialog open={floatOpen} onOpenChange={setFloatOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />New float</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New petty cash float</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={floatForm.name} onChange={(e) => setFloatForm({ ...floatForm, name: e.target.value })} /></div>
              <div><Label>Opening balance</Label><Input type="number" step="0.01" value={floatForm.opening_balance} onChange={(e) => setFloatForm({ ...floatForm, opening_balance: Number(e.target.value) })} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setFloatOpen(false)}>Cancel</Button>
              <Button onClick={() => createFloat.mutate()} disabled={!floatForm.name || createFloat.isPending}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Name</TableHead><TableHead className="text-right">Opening</TableHead><TableHead className="text-right">Current</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {!floats?.length ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No floats.</TableCell></TableRow>
              ) : floats.map((f) => (
                <TableRow key={f.id} className={activeFloat === f.id ? "bg-muted" : ""}>
                  <TableCell className="font-medium">{f.name}</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(f.opening_balance)}</TableCell>
                  <TableCell className="text-right font-mono font-bold">{fmtMoney(f.current_balance)}</TableCell>
                  <TableCell className="text-xs">{f.status}</TableCell>
                  <TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => setActiveFloat(f.id)}>Vouchers</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {activeFloat && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Vouchers</h2>
              <Dialog open={voucherOpen} onOpenChange={setVoucherOpen}>
                <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />New voucher</Button></DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>New petty cash voucher</DialogTitle></DialogHeader>
                  <div className="space-y-3">
                    <div><Label>Voucher #</Label><Input value={voucherForm.voucher_number} onChange={(e) => setVoucherForm({ ...voucherForm, voucher_number: e.target.value })} /></div>
                    <div><Label>Payee</Label><Input value={voucherForm.payee} onChange={(e) => setVoucherForm({ ...voucherForm, payee: e.target.value })} /></div>
                    <div><Label>Amount</Label><Input type="number" step="0.01" value={voucherForm.amount} onChange={(e) => setVoucherForm({ ...voucherForm, amount: Number(e.target.value) })} /></div>
                    <div><Label>Notes</Label><Input value={voucherForm.notes} onChange={(e) => setVoucherForm({ ...voucherForm, notes: e.target.value })} /></div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setVoucherOpen(false)}>Cancel</Button>
                    <Button onClick={() => addVoucher.mutate()} disabled={!voucherForm.voucher_number || !voucherForm.amount || addVoucher.isPending}>Add</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
            <Table>
              <TableHeader>
                <TableRow><TableHead>Voucher</TableHead><TableHead>Date</TableHead><TableHead>Payee</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Notes</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {!vouchers?.length ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">None.</TableCell></TableRow>
                ) : vouchers.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-mono">{v.voucher_number}</TableCell>
                    <TableCell className="text-xs">{v.voucher_date}</TableCell>
                    <TableCell>{v.payee}</TableCell>
                    <TableCell className="text-right font-mono">{fmtMoney(v.amount)}</TableCell>
                    <TableCell className="text-xs">{v.notes}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
