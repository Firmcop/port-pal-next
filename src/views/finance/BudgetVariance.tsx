import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TrendingUp } from "lucide-react";
import { fmtMoney, ACCOUNT_TYPE_LABEL } from "@/lib/finance-format";

export default function BudgetVariance() {
  const [periodId, setPeriodId] = useState("");

  const { data: periods } = useQuery({
    queryKey: ["fiscal-periods-for-variance"],
    queryFn: async () => {
      const { data, error } = await supabase.from("fiscal_periods" as any).select("id,year,month").order("year", { ascending: false }).order("month");
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: rows } = useQuery({
    queryKey: ["budget-variance", periodId],
    enabled: !!periodId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("budget_variance" as any, { _period_id: periodId });
      if (error) throw error;
      return data as any[];
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><TrendingUp className="h-6 w-6" />Budget Variance</h1>
        <p className="text-muted-foreground">Actual vs budgeted amounts per account.</p>
      </div>

      <div className="max-w-xs">
        <Label>Period</Label>
        <Select value={periodId} onValueChange={setPeriodId}>
          <SelectTrigger><SelectValue placeholder="Select period…" /></SelectTrigger>
          <SelectContent>
            {(periods ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.year}-{String(p.month).padStart(2, "0")}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Budget</TableHead>
                <TableHead className="text-right">Actual</TableHead>
                <TableHead className="text-right">Variance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!rows?.length ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{periodId ? "No data" : "Select a period"}</TableCell></TableRow>
              ) : rows.map((r: any) => {
                const v = Number(r.actual_amount) - Number(r.budget_amount);
                return (
                  <TableRow key={r.gl_account_id}>
                    <TableCell className="font-mono text-xs">{r.code}</TableCell>
                    <TableCell>{r.name}</TableCell>
                    <TableCell className="text-xs">{ACCOUNT_TYPE_LABEL[r.account_type]}</TableCell>
                    <TableCell className="text-right font-mono">{fmtMoney(r.budget_amount)}</TableCell>
                    <TableCell className="text-right font-mono">{fmtMoney(r.actual_amount)}</TableCell>
                    <TableCell className={`text-right font-mono ${v < 0 ? "text-success" : v > 0 ? "text-destructive" : ""}`}>{fmtMoney(v)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
