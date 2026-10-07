import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileText, Calculator, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fmtMoney } from "@/lib/finance-format";

export default function TaxReturns() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [periodId, setPeriodId] = useState<string>("");
  const [jurisdiction, setJurisdiction] = useState("KE");
  const [preview, setPreview] = useState<{ output_total: number; input_total: number; net_payable: number } | null>(null);

  const { data: periods } = useQuery({
    queryKey: ["fiscal-periods-for-tax"],
    queryFn: async () => {
      const { data, error } = await supabase.from("fiscal_periods" as any).select("id,year,month,status").order("year", { ascending: false }).order("month", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: returns } = useQuery({
    queryKey: ["tax-returns"],
    queryFn: async () => {
      const { data, error } = await supabase.from("tax_returns" as any).select("*, fiscal_periods(year,month)").order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const compute = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("compute_tax_return" as any, { _period_id: periodId, _jurisdiction: jurisdiction });
      if (error) throw error;
      return (Array.isArray(data) ? data[0] : data) as any;
    },
    onSuccess: (r: any) => setPreview(r),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const post = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("post_tax_return" as any, { _period_id: periodId, _jurisdiction: jurisdiction });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tax-returns"] }); setPreview(null); toast({ title: "Tax return posted" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><FileText className="h-6 w-6" />Tax Returns</h1>
        <p className="text-muted-foreground">Compute and file VAT/sales tax returns per fiscal period.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Compute return</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-3 items-end flex-wrap">
            <div className="min-w-[200px]">
              <Label>Period</Label>
              <Select value={periodId} onValueChange={setPeriodId}>
                <SelectTrigger><SelectValue placeholder="Select period…" /></SelectTrigger>
                <SelectContent>
                  {(periods ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.year}-{String(p.month).padStart(2, "0")} ({p.status})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="w-32">
              <Label>Jurisdiction</Label>
              <Input value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value.toUpperCase())} />
            </div>
            <Button onClick={() => compute.mutate()} disabled={!periodId || compute.isPending}><Calculator className="h-4 w-4 mr-1" />Compute</Button>
            {preview && <Button variant="default" onClick={() => post.mutate()} disabled={post.isPending}><CheckCircle2 className="h-4 w-4 mr-1" />Post</Button>}
          </div>
          {preview && (
            <div className="grid grid-cols-3 gap-3 pt-3">
              <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Output VAT</div><div className="text-xl font-bold">{fmtMoney(preview.output_total)}</div></CardContent></Card>
              <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Input VAT</div><div className="text-xl font-bold">{fmtMoney(preview.input_total)}</div></CardContent></Card>
              <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Net Payable</div><div className="text-xl font-bold">{fmtMoney(preview.net_payable)}</div></CardContent></Card>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">History</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead>Jurisdiction</TableHead>
                <TableHead className="text-right">Output</TableHead>
                <TableHead className="text-right">Input</TableHead>
                <TableHead className="text-right">Net Payable</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Reference</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!returns?.length ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No returns posted yet.</TableCell></TableRow>
              ) : returns.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono">{r.fiscal_periods?.year}-{String(r.fiscal_periods?.month).padStart(2, "0")}</TableCell>
                  <TableCell>{r.jurisdiction}</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(r.output_total)}</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(r.input_total)}</TableCell>
                  <TableCell className="text-right font-mono font-bold">{fmtMoney(r.net_payable)}</TableCell>
                  <TableCell><Badge variant="secondary" className="capitalize">{r.status}</Badge></TableCell>
                  <TableCell className="text-xs">{r.reference || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
