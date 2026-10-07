import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Target, Download, Receipt } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { MaterialPicker, useMaterialCatalogWithStock, type CatalogMaterial } from "@/components/materials/MaterialPicker";
import { exportCSV } from "@/lib/export-utils";
import { DirectExpensesCard, useConversionCombinedExpenseTotal } from "@/components/conversions/DirectExpensesCard";
import { ExpenseDialog } from "@/components/finance/ExpenseDialog";
import { ConversionExpenseGrid } from "@/components/conversions/ConversionExpenseGrid";

export function useConversionBudgetLines(conversionId: string) {
  return useQuery({
    queryKey: ["conversion-budget-lines", conversionId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("conversion_budget_lines")
        .select("*")
        .eq("conversion_id", conversionId)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: !!conversionId,
  });
}

/** Total budget + planned BOM lines with live variance against actual usage. */
export function BudgetTab({ job, onChanged }: { job: any; onChanged: () => void }) {
  const conversionId = job.id as string;
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: catalog = [] } = useMaterialCatalogWithStock();
  const { data: lines = [] } = useConversionBudgetLines(conversionId);
  const [budget, setBudget] = useState(String(job.budget_amount ?? 0));
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [f, setF] = useState<{ material_id: string | null; description: string; planned_qty: string; est_unit_cost: string }>(
    { material_id: null, description: "", planned_qty: "1", est_unit_cost: "" },
  );

  const { data: variance = [] } = useQuery({
    queryKey: ["conversion-budget-variance", conversionId],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("conversion_budget_variance", { _conversion_id: conversionId });
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: !!conversionId,
  });

  const plannedTotal = useMemo(
    () => lines.reduce((s: number, l: any) => s + Number(l.est_total ?? 0), 0),
    [lines],
  );
  const actualTotal = useMemo(
    () => variance.reduce((s: number, r: any) => s + Number(r.actual_cost ?? 0), 0),
    [variance],
  );
  const expenses = useConversionCombinedExpenseTotal(conversionId);
  const expenseTotal = expenses.total;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["conversion-budget-lines", conversionId] });
    qc.invalidateQueries({ queryKey: ["conversion-budget-variance", conversionId] });
    onChanged();
  };

  const saveBudget = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any)
        .from("container_conversions")
        .update({ budget_amount: parseFloat(budget) || 0 })
        .eq("id", conversionId);
      if (error) throw error;
    },
    onSuccess: () => { toast({ title: "Budget saved" }); refresh(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const addLine = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).from("conversion_budget_lines").insert({
        conversion_id: conversionId,
        material_id: f.material_id,
        description: f.description,
        planned_qty: parseFloat(f.planned_qty) || 0,
        est_unit_cost: parseFloat(f.est_unit_cost) || 0,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setF({ material_id: null, description: "", planned_qty: "1", est_unit_cost: "" });
      toast({ title: "Planned line added" });
      refresh();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const delLine = useMutation({
    mutationFn: async (lineId: string) => {
      const { error } = await (supabase as any).from("conversion_budget_lines").delete().eq("id", lineId);
      if (error) throw error;
    },
    onSuccess: () => { toast({ title: "Line removed" }); refresh(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const pickMaterial = (id: string | null, m: CatalogMaterial | null) => {
    setF((p) => ({
      ...p,
      material_id: id,
      description: m ? m.name : p.description,
      est_unit_cost: m ? String(m.avg_unit_cost ?? m.unit_cost ?? 0) : p.est_unit_cost,
    }));
  };

  const budgetNum = Number(job.budget_amount ?? 0);

  const exportBudgetCsv = () => {
    const headers = [
      "Material", "Category", "Planned qty", "Issued qty", "Returned qty", "Net used",
      "Qty variance", "Planned unit cost", "Intended cost", "Actual cost", "Cost variance", "Variance %",
    ];
    const rows = variance.map((r: any) => {
      const est = Number(r.est_total ?? 0);
      const act = Number(r.actual_cost ?? 0);
      return [
        String(r.description ?? ""),
        String(r.category ?? ""),
        String(Number(r.planned_qty ?? 0)),
        String(Number(r.issued_qty ?? 0)),
        String(Number(r.returned_qty ?? 0)),
        String(Number(r.used_qty ?? 0)),
        String(Number(r.qty_variance ?? 0)),
        String(Number(r.est_unit_cost ?? 0)),
        est.toFixed(2),
        act.toFixed(2),
        (act - est).toFixed(2),
        est ? `${(((act - est) / est) * 100).toFixed(1)}%` : "",
      ];
    });
    rows.push([
      "Expenses charged to this job", "", "", "", "", "", "", "",
      "0.00",
      expenses.jobTotal.toFixed(2),
      expenses.jobTotal.toFixed(2),
      "",
    ]);
    if (expenses.countable && expenses.projectTotal > 0) {
      rows.push([
        "Expenses via this job's project", "", "", "", "", "", "", "",
        "0.00",
        expenses.projectTotal.toFixed(2),
        expenses.projectTotal.toFixed(2),
        "",
      ]);
    }
    rows.push([
      "TOTAL", "", "", "", "", "", "",
      "",
      plannedTotal.toFixed(2),
      (actualTotal + expenseTotal).toFixed(2),
      (actualTotal + expenseTotal - plannedTotal).toFixed(2),
      plannedTotal ? `${(((actualTotal + expenseTotal - plannedTotal) / plannedTotal) * 100).toFixed(1)}%` : "",
    ]);
    const ref = job.conversion_number ?? job.id;
    exportCSV(`budget-variance-${ref}-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><Target className="h-4 w-4" />Job budget</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Total intended cost</Label>
              <Input type="number" className="w-48" value={budget} onChange={(e) => setBudget(e.target.value)} />
            </div>
            <Button size="sm" onClick={() => saveBudget.mutate()} disabled={saveBudget.isPending}>Save budget</Button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
            <div><p className="text-xs text-muted-foreground">Budget</p><p className="font-mono">{budgetNum.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p></div>
            <div><p className="text-xs text-muted-foreground">Planned materials</p><p className="font-mono">{plannedTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p></div>
            <div><p className="text-xs text-muted-foreground">Actual materials</p><p className="font-mono">{actualTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p></div>
            <div>
              <p className="text-xs text-muted-foreground">Expenses</p>
              <p className="font-mono">{expenseTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
              <p className="text-[10px] text-muted-foreground">
                Charged to job {expenses.jobTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                {expenses.countable && expenses.projectTotal > 0 && (
                  <> · via project {expenses.projectTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</>
                )}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Variance (incl. expenses)</p>
              <p className={`font-mono font-bold ${actualTotal + expenseTotal - plannedTotal > 0 ? "text-destructive" : "text-success"}`}>
                {(actualTotal + expenseTotal - plannedTotal).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Planned bill of materials</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={(e) => { e.preventDefault(); addLine.mutate(); }} className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Material</Label>
              <MaterialPicker value={f.material_id} onChange={pickMaterial} materials={catalog} allowCustom />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="space-y-1"><Label className="text-xs">Description</Label><Input value={f.description} onChange={(e) => setF((p) => ({ ...p, description: e.target.value }))} required /></div>
              <div className="space-y-1"><Label className="text-xs">Planned qty</Label><Input type="number" step="0.01" value={f.planned_qty} onChange={(e) => setF((p) => ({ ...p, planned_qty: e.target.value }))} /></div>
              <div className="space-y-1"><Label className="text-xs">Est. unit cost</Label><Input type="number" step="0.01" value={f.est_unit_cost} onChange={(e) => setF((p) => ({ ...p, est_unit_cost: e.target.value }))} /></div>
              <div className="flex items-end"><Button type="submit" size="sm" disabled={addLine.isPending || !f.description}><Plus className="mr-1 h-3 w-3" />Add planned line</Button></div>
            </div>
          </form>
          <Separator />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Planned qty</TableHead>
                <TableHead className="text-right">Est. unit</TableHead>
                <TableHead className="text-right">Est. total</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {!lines.length ? (
                <TableRow><TableCell colSpan={5} className="py-4 text-center text-muted-foreground">No planned lines yet</TableCell></TableRow>
              ) : lines.map((l: any) => (
                <TableRow key={l.id}>
                  <TableCell className="text-sm">{l.description}{!l.material_id && <Badge variant="outline" className="ml-2 text-[10px]">custom</Badge>}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{Number(l.planned_qty)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{Number(l.est_unit_cost).toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{Number(l.est_total).toLocaleString()}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => delLine.mutate(l.id)}><Trash2 className="h-3 w-3" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={() => setExpenseOpen(true)}>
          <Receipt className="mr-1 h-3 w-3" />Charge an expense to this job
        </Button>
      </div>
      <ConversionExpenseGrid conversionId={conversionId} />

      <DirectExpensesCard conversionId={conversionId} projectId={job.project_id ?? null} />
      <PostingStatusCard conversionId={conversionId} />
      <ExpenseDialog
        open={expenseOpen}
        onOpenChange={setExpenseOpen}
        defaultConversionId={conversionId}
        defaultProjectId={job.project_id ?? undefined}
      />

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-base">Budget vs actual (per material)</CardTitle>
          <Button size="sm" variant="outline" onClick={exportBudgetCsv} disabled={!variance.length}>
            <Download className="mr-1 h-3 w-3" />Export CSV
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Material</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Planned</TableHead>
                <TableHead className="text-right">Issued</TableHead>
                <TableHead className="text-right">Returned</TableHead>
                <TableHead className="text-right">Used</TableHead>
                <TableHead className="text-right">Qty var.</TableHead>
                <TableHead className="text-right">Est. cost</TableHead>
                <TableHead className="text-right">Actual cost</TableHead>
                <TableHead className="text-right">Cost var.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!variance.length ? (
                <TableRow><TableCell colSpan={10} className="py-6 text-center text-muted-foreground">Nothing planned or used yet</TableCell></TableRow>
              ) : variance.map((r: any, i: number) => (
                <TableRow key={`${r.material_id ?? r.description}-${i}`}>
                  <TableCell className="text-sm">
                    {r.description}
                    {!r.in_budget && <Badge variant="secondary" className="ml-2 text-[10px]">unbudgeted</Badge>}
                    {r.budget_edited_after_use && (
                      <Badge variant="outline" className="ml-2 border-amber-500 text-[10px] text-amber-600" title="Budget was edited after material was consumed — history uses the snapshot in force at the time">
                        budget edited
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.category ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{Number(r.planned_qty)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{Number(r.issued_qty ?? 0)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{Number(r.returned_qty ?? 0)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{Number(r.used_qty)}</TableCell>
                  <TableCell className={`text-right font-mono text-sm ${Number(r.qty_variance) > 0 ? "text-destructive" : ""}`}>{Number(r.qty_variance)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{Number(r.est_total).toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{Number(r.actual_cost).toLocaleString()}</TableCell>
                  <TableCell className={`text-right font-mono text-sm font-medium ${Number(r.cost_variance) > 0 ? "text-destructive" : "text-success"}`}>
                    {Number(r.cost_variance).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

/** Plain statement of whether this job's costs have reached the accounts. */
function PostingStatusCard({ conversionId }: { conversionId: string }) {
  const { data } = useQuery({
    queryKey: ["conversion-posting-status", conversionId],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("conversion_posting_status", { _conversion_id: conversionId });
      if (error) throw error;
      return (data ?? [])[0] ?? null;
    },
    enabled: !!conversionId,
  });
  if (!data) return null;
  const jobCost = Number(data.job_cost_total ?? 0);
  const adjustments = Number(data.posted_amount ?? 0);
  const entries = Number(data.posted_entries ?? 0);

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Finance posting</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div><p className="text-xs text-muted-foreground">Cost recorded on this job</p><p className="font-mono">{jobCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p></div>
          <div><p className="text-xs text-muted-foreground">Cost adjustments posted for this job</p><p className="font-mono">{adjustments.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p></div>
          <div><p className="text-xs text-muted-foreground">Journal entries</p><p className="font-mono">{entries}</p></div>
        </div>
        <p className="text-xs text-muted-foreground">
          Every cost on this job reaches the accounts through the document it came from — supplier invoices, goods receipts,
          operating expenses and payroll — so the figures above are already in the ledger. Completing a job does not create a
          second entry; only cost re-syncs and corrections post against the job itself.
        </p>
      </CardContent>
    </Card>
  );
}
