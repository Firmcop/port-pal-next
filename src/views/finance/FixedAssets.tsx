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
import { Plus, Boxes, PlayCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fmtMoney } from "@/lib/finance-format";

export default function FixedAssets() {
  const org = useOrganization();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [periodId, setPeriodId] = useState("");
  const [form, setForm] = useState({ code: "", name: "", category: "", cost: 0, salvage_value: 0, useful_life_months: 60, method: "straight_line" });

  const { data: assets } = useQuery({
    queryKey: ["fixed-assets"],
    queryFn: async () => {
      const { data, error } = await supabase.from("fixed_assets" as any).select("*").order("code");
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: periods } = useQuery({
    queryKey: ["periods-for-depr"],
    queryFn: async () => {
      const { data, error } = await supabase.from("fiscal_periods" as any).select("id,year,month").order("year", { ascending: false }).order("month");
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: runs } = useQuery({
    queryKey: ["depr-runs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("fixed_asset_depreciation_runs" as any).select("*, fiscal_periods(year,month)").order("run_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("fixed_assets" as any).insert({ ...form, organization_id: org.organizationId });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["fixed-assets"] }); setOpen(false); setForm({ code: "", name: "", category: "", cost: 0, salvage_value: 0, useful_life_months: 60, method: "straight_line" }); toast({ title: "Asset added" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const runDepr = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("run_depreciation" as any, { _period_id: periodId });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["depr-runs"] }); qc.invalidateQueries({ queryKey: ["fixed-assets"] }); toast({ title: "Depreciation run completed" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Boxes className="h-6 w-6" />Fixed Assets</h1>
          <p className="text-muted-foreground">Register and depreciate long-lived assets.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />Add asset</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New fixed asset</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Code</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
                <div><Label>Category</Label><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></div>
              </div>
              <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div className="grid grid-cols-3 gap-3">
                <div><Label>Cost</Label><Input type="number" step="0.01" value={form.cost} onChange={(e) => setForm({ ...form, cost: Number(e.target.value) })} /></div>
                <div><Label>Salvage</Label><Input type="number" step="0.01" value={form.salvage_value} onChange={(e) => setForm({ ...form, salvage_value: Number(e.target.value) })} /></div>
                <div><Label>Life (mo)</Label><Input type="number" value={form.useful_life_months} onChange={(e) => setForm({ ...form, useful_life_months: Number(e.target.value) })} /></div>
              </div>
              <div>
                <Label>Method</Label>
                <Select value={form.method} onValueChange={(v) => setForm({ ...form, method: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="straight_line">Straight Line</SelectItem>
                    <SelectItem value="declining">Declining Balance</SelectItem>
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
                <TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Category</TableHead>
                <TableHead className="text-right">Cost</TableHead><TableHead className="text-right">Accum. Depr.</TableHead>
                <TableHead className="text-right">NBV</TableHead><TableHead>Method</TableHead><TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!assets?.length ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No assets yet.</TableCell></TableRow>
              ) : assets.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-mono text-xs">{a.code}</TableCell>
                  <TableCell>{a.name}</TableCell>
                  <TableCell className="text-xs">{a.category || "—"}</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(a.cost)}</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(a.accumulated_depreciation)}</TableCell>
                  <TableCell className="text-right font-mono font-bold">{fmtMoney(Number(a.cost) - Number(a.accumulated_depreciation))}</TableCell>
                  <TableCell className="text-xs">{a.method}</TableCell>
                  <TableCell><Badge variant="secondary">{a.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <h2 className="font-semibold">Depreciation Runs</h2>
          <div className="flex items-end gap-3">
            <div className="min-w-[200px]">
              <Label>Period</Label>
              <Select value={periodId} onValueChange={setPeriodId}>
                <SelectTrigger><SelectValue placeholder="Select period…" /></SelectTrigger>
                <SelectContent>
                  {(periods ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.year}-{String(p.month).padStart(2, "0")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => runDepr.mutate()} disabled={!periodId || runDepr.isPending}><PlayCircle className="h-4 w-4 mr-1" />Run</Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Period</TableHead><TableHead>Assets</TableHead><TableHead className="text-right">Total Depreciation</TableHead><TableHead>Notes</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {!runs?.length ? (
                <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">No runs.</TableCell></TableRow>
              ) : runs.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono">{r.fiscal_periods?.year}-{String(r.fiscal_periods?.month).padStart(2, "0")}</TableCell>
                  <TableCell>{r.asset_count}</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(r.total_depreciation)}</TableCell>
                  <TableCell className="text-xs">{r.notes}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
