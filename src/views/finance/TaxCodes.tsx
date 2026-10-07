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
import { Plus, Percent } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function TaxCodes() {
  const org = useOrganization();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", rate: 0, kind: "output", jurisdiction: "KE", gl_account_id: "" });

  const { data: codes } = useQuery({
    queryKey: ["tax-codes"],
    queryFn: async () => {
      const { data, error } = await supabase.from("tax_codes" as any).select("*, gl_accounts(code,name)").order("code");
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: glAccounts } = useQuery({
    queryKey: ["gl-accounts-for-tax"],
    queryFn: async () => {
      const { data, error } = await supabase.from("gl_accounts" as any).select("id,code,name,account_type").order("code");
      if (error) throw error;
      return data as any[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("tax_codes" as any).insert({
        ...form,
        rate: Number(form.rate),
        gl_account_id: form.gl_account_id || null,
        organization_id: org.organizationId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tax-codes"] });
      setOpen(false);
      setForm({ code: "", name: "", rate: 0, kind: "output", jurisdiction: "KE", gl_account_id: "" });
      toast({ title: "Tax code created" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Percent className="h-6 w-6" />Tax Codes</h1>
          <p className="text-muted-foreground">VAT, withholding, and other tax rates applied to invoice/PO lines.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />New tax code</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New tax code</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Code</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="VAT16" /></div>
                <div><Label>Rate (%)</Label><Input type="number" step="0.01" value={form.rate} onChange={(e) => setForm({ ...form, rate: Number(e.target.value) / 100 })} /></div>
              </div>
              <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Standard VAT 16%" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Kind</Label>
                  <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="output">Output (Sales)</SelectItem>
                      <SelectItem value="input">Input (Purchases)</SelectItem>
                      <SelectItem value="withholding">Withholding</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Jurisdiction</Label><Input value={form.jurisdiction} onChange={(e) => setForm({ ...form, jurisdiction: e.target.value.toUpperCase() })} /></div>
              </div>
              <div>
                <Label>GL Control Account</Label>
                <Select value={form.gl_account_id} onValueChange={(v) => setForm({ ...form, gl_account_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select account…" /></SelectTrigger>
                  <SelectContent>
                    {(glAccounts ?? []).map((a) => <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => create.mutate()} disabled={!form.code || !form.name || create.isPending}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead>Jurisdiction</TableHead>
                <TableHead>GL Account</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!codes?.length ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No tax codes yet.</TableCell></TableRow>
              ) : codes.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono">{c.code}</TableCell>
                  <TableCell>{c.name}</TableCell>
                  <TableCell><Badge variant="secondary" className="capitalize">{c.kind}</Badge></TableCell>
                  <TableCell className="text-right font-mono">{(Number(c.rate) * 100).toFixed(2)}%</TableCell>
                  <TableCell>{c.jurisdiction}</TableCell>
                  <TableCell className="text-xs">{c.gl_accounts ? `${c.gl_accounts.code} — ${c.gl_accounts.name}` : "—"}</TableCell>
                  <TableCell>{c.is_active ? <Badge className="bg-success/15 text-success" variant="secondary">active</Badge> : <Badge variant="secondary">inactive</Badge>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
