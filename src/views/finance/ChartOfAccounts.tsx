import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/use-organization";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, BookOpen, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ACCOUNT_TYPE_LABEL, ACCOUNT_TYPE_ORDER, getDefaultCurrency } from "@/lib/finance-format";

export default function ChartOfAccounts() {
  const org = useOrganization();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", account_type: "asset", currency: getDefaultCurrency() });

  const { data: accounts, isLoading } = useQuery({
    queryKey: ["gl-accounts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("gl_accounts" as any).select("*").order("code");
      if (error) throw error;
      return data as any[];
    },
  });

  // Auto-seed if empty
  useEffect(() => {
    if (!isLoading && accounts && accounts.length === 0 && org.organizationId) {
      supabase.rpc("ensure_default_coa" as any, { _org_id: org.organizationId }).then(() => {
        qc.invalidateQueries({ queryKey: ["gl-accounts"] });
      });
    }
  }, [isLoading, accounts, org.organizationId, qc]);

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("gl_accounts" as any).insert({
        ...form,
        organization_id: org.organizationId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gl-accounts"] });
      setOpen(false);
      setForm({ code: "", name: "", account_type: "asset", currency: getDefaultCurrency() });
      toast({ title: "Account created" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const seed = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("ensure_default_coa" as any, { _org_id: org.organizationId });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gl-accounts"] });
      toast({ title: "Default chart seeded" });
    },
  });

  const grouped = useMemo(() => {
    const m: Record<string, any[]> = {};
    (accounts ?? []).forEach((a) => {
      (m[a.account_type] ||= []).push(a);
    });
    return m;
  }, [accounts]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><BookOpen className="h-6 w-6" />Chart of Accounts</h1>
          <p className="text-muted-foreground">All GL accounts used for postings and reporting.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => seed.mutate()} disabled={seed.isPending}>
            <Sparkles className="h-4 w-4 mr-1" /> Seed defaults
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="h-4 w-4 mr-1" /> New account</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New GL account</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Code</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
                <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div>
                  <Label>Type</Label>
                  <Select value={form.account_type} onValueChange={(v) => setForm({ ...form, account_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ACCOUNT_TYPE_ORDER.map((t) => <SelectItem key={t} value={t}>{ACCOUNT_TYPE_LABEL[t]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Currency</Label><Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} /></div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={() => create.mutate()} disabled={!form.code || !form.name || create.isPending}>Create</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {ACCOUNT_TYPE_ORDER.map((type) => {
        const list = grouped[type] ?? [];
        if (!list.length) return null;
        return (
          <Card key={type}>
            <CardHeader className="py-3"><CardTitle className="text-base">{ACCOUNT_TYPE_LABEL[type]}</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Currency</TableHead>
                    <TableHead className="text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-mono">{a.code}</TableCell>
                      <TableCell>{a.name}</TableCell>
                      <TableCell>{a.currency}</TableCell>
                      <TableCell className="text-right">
                        {a.is_system && <Badge variant="outline" className="mr-1">system</Badge>}
                        {a.is_active ? <Badge className="bg-success/15 text-success" variant="secondary">active</Badge> : <Badge variant="secondary">inactive</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
