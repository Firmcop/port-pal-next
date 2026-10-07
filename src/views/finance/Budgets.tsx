import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/use-organization";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Wallet } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fmtMoney, ACCOUNT_TYPE_LABEL } from "@/lib/finance-format";

export default function Budgets() {
  const org = useOrganization();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [periodId, setPeriodId] = useState<string>("");
  const [edits, setEdits] = useState<Record<string, number>>({});

  const { data: periods } = useQuery({
    queryKey: ["fiscal-periods-for-budgets"],
    queryFn: async () => {
      const { data, error } = await supabase.from("fiscal_periods" as any).select("id,year,month").order("year", { ascending: false }).order("month");
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: accounts } = useQuery({
    queryKey: ["accounts-for-budgets"],
    queryFn: async () => {
      const { data, error } = await supabase.from("gl_accounts" as any).select("id,code,name,account_type").order("code");
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: budgets } = useQuery({
    queryKey: ["budgets", periodId],
    enabled: !!periodId,
    queryFn: async () => {
      const { data, error } = await supabase.from("budgets" as any).select("*").eq("period_id", periodId).is("project_id", null);
      if (error) throw error;
      return data as any[];
    },
  });

  const budgetMap = useMemo(() => {
    const m: Record<string, any> = {};
    (budgets ?? []).forEach((b) => { m[b.gl_account_id] = b; });
    return m;
  }, [budgets]);

  const save = useMutation({
    mutationFn: async () => {
      const rows = Object.entries(edits).map(([gl_account_id, amount]) => ({
        organization_id: org.organizationId,
        gl_account_id,
        period_id: periodId,
        amount,
      }));
      if (!rows.length) return;
      const { error } = await supabase.from("budgets" as any).upsert(rows, { onConflict: "organization_id,gl_account_id,period_id" });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["budgets", periodId] }); setEdits({}); toast({ title: "Budgets saved" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Wallet className="h-6 w-6" />Budgets</h1>
        <p className="text-muted-foreground">Set planned amounts per GL account for a fiscal period.</p>
      </div>

      <div className="flex gap-3 items-end">
        <div className="min-w-[240px]">
          <Label>Period</Label>
          <Select value={periodId} onValueChange={setPeriodId}>
            <SelectTrigger><SelectValue placeholder="Select period…" /></SelectTrigger>
            <SelectContent>
              {(periods ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.year}-{String(p.month).padStart(2, "0")}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={() => save.mutate()} disabled={!periodId || !Object.keys(edits).length || save.isPending}>Save changes</Button>
      </div>

      {periodId && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right w-48">Budget</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(accounts ?? []).map((a) => {
                  const current = edits[a.id] ?? Number(budgetMap[a.id]?.amount ?? 0);
                  return (
                    <TableRow key={a.id}>
                      <TableCell className="font-mono text-xs">{a.code}</TableCell>
                      <TableCell>{a.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{ACCOUNT_TYPE_LABEL[a.account_type]}</TableCell>
                      <TableCell className="text-right">
                        <Input type="number" step="0.01" className="text-right h-8" value={current}
                          onChange={(e) => setEdits({ ...edits, [a.id]: Number(e.target.value) })} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
