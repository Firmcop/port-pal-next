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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, FileCheck2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fmtMoney } from "@/lib/finance-format";
import { format } from "date-fns";

export default function Withholding() {
  const org = useOrganization();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    certificate_number: "",
    rate: 0.05,
    base_amount: 0,
    certificate_date: new Date().toISOString().slice(0, 10),
    notes: "",
  });

  const { data: certs } = useQuery({
    queryKey: ["wht-certs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("withholding_certificates" as any).select("*").order("certificate_date", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const amount_withheld = Number((form.base_amount * form.rate).toFixed(2));
      const { error } = await supabase.from("withholding_certificates" as any).insert({
        ...form,
        amount_withheld,
        organization_id: org.organizationId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wht-certs"] });
      setOpen(false);
      setForm({ certificate_number: "", rate: 0.05, base_amount: 0, certificate_date: new Date().toISOString().slice(0, 10), notes: "" });
      toast({ title: "Certificate issued" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><FileCheck2 className="h-6 w-6" />Withholding Tax</h1>
          <p className="text-muted-foreground">WHT certificates issued to suppliers against vendor payments.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />Issue certificate</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Issue WHT certificate</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Certificate #</Label><Input value={form.certificate_number} onChange={(e) => setForm({ ...form, certificate_number: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Rate (%)</Label><Input type="number" step="0.01" value={form.rate * 100} onChange={(e) => setForm({ ...form, rate: Number(e.target.value) / 100 })} /></div>
                <div><Label>Date</Label><Input type="date" value={form.certificate_date} onChange={(e) => setForm({ ...form, certificate_date: e.target.value })} /></div>
              </div>
              <div><Label>Base amount</Label><Input type="number" step="0.01" value={form.base_amount} onChange={(e) => setForm({ ...form, base_amount: Number(e.target.value) })} /></div>
              <div className="text-sm text-muted-foreground">Withheld: <b>{fmtMoney(form.base_amount * form.rate)}</b></div>
              <div><Label>Notes</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => create.mutate()} disabled={!form.certificate_number || !form.base_amount || create.isPending}>Issue</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Certificate #</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="text-right">Base</TableHead>
                <TableHead className="text-right">Withheld</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!certs?.length ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No certificates yet.</TableCell></TableRow>
              ) : certs.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono">{c.certificate_number}</TableCell>
                  <TableCell className="text-xs">{format(new Date(c.certificate_date), "dd MMM yyyy")}</TableCell>
                  <TableCell className="text-right font-mono">{(Number(c.rate) * 100).toFixed(2)}%</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(c.base_amount)}</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(c.amount_withheld)}</TableCell>
                  <TableCell><Badge variant="secondary" className="capitalize">{c.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
