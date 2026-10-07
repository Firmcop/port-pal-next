import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshCcw, Globe } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fmtMoney } from "@/lib/finance-format";
import { format } from "date-fns";

export default function FxRevaluation() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [periodId, setPeriodId] = useState("");

  const { data: periods } = useQuery({
    queryKey: ["fiscal-periods-for-fx"],
    queryFn: async () => {
      const { data, error } = await supabase.from("fiscal_periods" as any).select("id,year,month").order("year", { ascending: false }).order("month");
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: runs } = useQuery({
    queryKey: ["fx-runs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("fx_revaluation_runs" as any).select("*, fiscal_periods(year,month)").order("run_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const run = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("run_fx_revaluation" as any, { _period_id: periodId });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["fx-runs"] }); toast({ title: "FX revaluation recorded" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Globe className="h-6 w-6" />FX Revaluation</h1>
        <p className="text-muted-foreground">Revalue foreign-currency open balances at period end.</p>
      </div>

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
        <Button onClick={() => run.mutate()} disabled={!periodId || run.isPending}><RefreshCcw className="h-4 w-4 mr-1" />Run revaluation</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Run At</TableHead>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Gain / Loss</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!runs?.length ? (
                <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No runs yet.</TableCell></TableRow>
              ) : runs.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs">{format(new Date(r.run_at), "dd MMM yyyy HH:mm")}</TableCell>
                  <TableCell className="font-mono">{r.fiscal_periods?.year}-{String(r.fiscal_periods?.month).padStart(2, "0")}</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(r.gain_loss_total)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.notes}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
