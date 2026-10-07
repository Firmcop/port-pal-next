import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Target, FileDown, FileText, Pencil, Check } from "lucide-react";
import { fmtMoney } from "@/lib/finance-format";
import { exportCSV, exportPDF } from "@/lib/export-utils";
import { useToast } from "@/hooks/use-toast";
import { ExpenseJournalDrillSheet, type DrillTarget } from "@/components/finance/ExpenseJournalDrillSheet";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ALL = "__all__";

type Row = {
  gl_account_id: string;
  code: string;
  name: string;
  category_name: string | null;
  category_id: string | null;
  budget: number[];
  actual: number[];
};

const lastDay = (year: number, month: number) => new Date(year, month, 0).getDate();

export default function BudgetsVsActual() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const thisYear = new Date().getFullYear();

  const [year, setYear] = useState(thisYear);
  const [depotId, setDepotId] = useState(ALL);
  const [projectId, setProjectId] = useState(ALL);
  const [editing, setEditing] = useState<{ account: string; month: number } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [drill, setDrill] = useState<DrillTarget | null>(null);

  const { data: depots } = useQuery({
    queryKey: ["depots-for-budget"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("depots").select("id,name").order("name");
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: projects } = useQuery({
    queryKey: ["projects-for-budget"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("projects").select("id,code,name").order("code");
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: raw, isLoading } = useQuery({
    queryKey: ["opex-budget-vs-actual", year, depotId, projectId],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("opex_budget_vs_actual", {
        _year: year,
        _depot_id: depotId === ALL ? null : depotId,
        _project_id: projectId === ALL ? null : projectId,
      });
      if (error) throw error;
      return data as any[];
    },
  });

  const rows = useMemo<Row[]>(() => {
    const map = new Map<string, Row>();
    (raw ?? []).forEach((r) => {
      let row = map.get(r.gl_account_id);
      if (!row) {
        row = {
          gl_account_id: r.gl_account_id,
          code: r.code,
          name: r.name,
          category_name: r.category_name,
          category_id: r.category_id,
          budget: Array(12).fill(0),
          actual: Array(12).fill(0),
        };
        map.set(r.gl_account_id, row);
      }
      row.budget[r.month - 1] = Number(r.budget_amount || 0);
      row.actual[r.month - 1] = Number(r.actual_amount || 0);
    });
    return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
  }, [raw]);

  const [hideEmpty, setHideEmpty] = useState(true);
  const visible = useMemo(
    () => rows.filter((r) => !hideEmpty || r.budget.some((v) => v !== 0) || r.actual.some((v) => v !== 0)),
    [rows, hideEmpty]
  );

  const sum = (arr: number[]) => arr.reduce((s, v) => s + v, 0);
  const grand = useMemo(() => {
    const b = Array(12).fill(0);
    const a = Array(12).fill(0);
    visible.forEach((r) => r.budget.forEach((v, i) => { b[i] += v; a[i] += r.actual[i]; }));
    return { b, a };
  }, [visible]);

  const setBudget = useMutation({
    mutationFn: async (v: { accountId: string; categoryId: string | null; month: number; amount: number }) => {
      const { error } = await (supabase as any).rpc("set_opex_budget", {
        _year: year,
        _month: v.month,
        _gl_account_id: v.accountId,
        _amount: v.amount,
        _category_id: v.categoryId,
        _depot_id: depotId === ALL ? null : depotId,
        _project_id: projectId === ALL ? null : projectId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["opex-budget-vs-actual"] });
      setEditing(null);
    },
    onError: (e: any) => toast({ title: "Could not save target", description: e.message, variant: "destructive" }),
  });

  const commitEdit = (row: Row, monthIdx: number) => {
    const amount = Number(editValue || 0);
    if (Number.isNaN(amount)) return setEditing(null);
    setBudget.mutate({ accountId: row.gl_account_id, categoryId: row.category_id, month: monthIdx + 1, amount });
  };

  const varianceClass = (budget: number, actual: number) => {
    if (!budget && !actual) return "text-muted-foreground";
    if (budget && actual > budget) return "text-destructive";
    if (budget && actual <= budget) return "text-success";
    return "";
  };

  const exportRows = () =>
    visible.map((r) => [
      r.code,
      r.category_name ?? r.name,
      ...r.budget.map((v, i) => `${v}/${r.actual[i]}`),
      String(sum(r.budget)),
      String(sum(r.actual)),
      String(sum(r.budget) - sum(r.actual)),
    ]);
  const exportHeaders = ["Code", "Category", ...MONTHS.map((m) => `${m} (budget/actual)`), "Budget YTD", "Actual YTD", "Variance"];

  const years = Array.from({ length: 6 }, (_, i) => thisYear + 1 - i);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Target className="h-6 w-6" />OPEX Budgets vs Actual</h1>
          <p className="text-muted-foreground">Monthly targets per expense category, with variance and drill-down to the journals behind each figure.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => exportCSV(`opex_budget_${year}.csv`, exportHeaders, exportRows())}>
            <FileDown className="h-4 w-4 mr-1" />CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => exportPDF(`OPEX Budget vs Actual ${year}`, `opex_budget_${year}.pdf`, exportHeaders, exportRows(), { landscape: true })}>
            <FileText className="h-4 w-4 mr-1" />PDF
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="grid gap-3 py-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label className="text-xs">Year</Label>
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Depot / branch</Label>
            <Select value={depotId} onValueChange={setDepotId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All depots</SelectItem>
                {(depots ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Project / job</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All projects</SelectItem>
                {(projects ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button variant="outline" size="sm" onClick={() => setHideEmpty(!hideEmpty)}>
              {hideEmpty ? "Show all accounts" : "Hide empty accounts"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base">
            {year} — click a budget cell to set the target, click an actual to see the journals
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 bg-card min-w-[200px]">Category / account</TableHead>
                {MONTHS.map((m) => <TableHead key={m} className="text-right min-w-[110px]">{m}</TableHead>)}
                <TableHead className="text-right min-w-[110px]">Budget YTD</TableHead>
                <TableHead className="text-right min-w-[110px]">Actual YTD</TableHead>
                <TableHead className="text-right min-w-[110px]">Variance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={16} className="py-8 text-center text-muted-foreground">Loading…</TableCell></TableRow>
              ) : !visible.length ? (
                <TableRow><TableCell colSpan={16} className="py-8 text-center text-muted-foreground">No expense accounts with activity or targets for {year}.</TableCell></TableRow>
              ) : (
                visible.map((r) => {
                  const bTot = sum(r.budget);
                  const aTot = sum(r.actual);
                  return (
                    <TableRow key={r.gl_account_id}>
                      <TableCell className="sticky left-0 bg-card">
                        <div className="font-medium text-sm">{r.category_name ?? r.name}</div>
                        <div className="font-mono text-xs text-muted-foreground">{r.code} — {r.name}</div>
                      </TableCell>
                      {MONTHS.map((m, i) => {
                        const isEditing = editing?.account === r.gl_account_id && editing?.month === i;
                        return (
                          <TableCell key={m} className="text-right align-top">
                            {isEditing ? (
                              <div className="flex items-center gap-1">
                                <Input
                                  autoFocus
                                  type="number"
                                  step="0.01"
                                  className="h-7 text-right text-xs"
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") commitEdit(r, i);
                                    if (e.key === "Escape") setEditing(null);
                                  }}
                                />
                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => commitEdit(r, i)}>
                                  <Check className="h-3 w-3" />
                                </Button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                className="group flex w-full items-center justify-end gap-1 text-xs text-muted-foreground hover:text-foreground"
                                onClick={() => { setEditing({ account: r.gl_account_id, month: i }); setEditValue(String(r.budget[i] || "")); }}
                              >
                                <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-100" />
                                <span className="font-mono">{r.budget[i] ? fmtMoney(r.budget[i]) : "—"}</span>
                              </button>
                            )}
                            <button
                              type="button"
                              className={`mt-0.5 block w-full text-right font-mono text-xs underline-offset-2 hover:underline ${varianceClass(r.budget[i], r.actual[i])}`}
                              onClick={() =>
                                setDrill({
                                  glAccountId: r.gl_account_id,
                                  label: `${r.code} — ${r.name} · ${MONTHS[i]} ${year}`,
                                  from: `${year}-${String(i + 1).padStart(2, "0")}-01`,
                                  to: `${year}-${String(i + 1).padStart(2, "0")}-${lastDay(year, i + 1)}`,
                                  depotId: depotId === ALL ? null : depotId,
                                  projectId: projectId === ALL ? null : projectId,
                                })
                              }
                            >
                              {fmtMoney(r.actual[i])}
                            </button>
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-right font-mono text-xs">{fmtMoney(bTot)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{fmtMoney(aTot)}</TableCell>
                      <TableCell className={`text-right font-mono text-xs ${varianceClass(bTot, aTot)}`}>
                        {fmtMoney(bTot - aTot)}
                        {bTot > 0 && (
                          <span className="block text-[10px]">{(((aTot - bTot) / bTot) * 100).toFixed(1)}%</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
              {!!visible.length && (
                <TableRow className="border-t-2 font-semibold">
                  <TableCell className="sticky left-0 bg-card">Total</TableCell>
                  {MONTHS.map((m, i) => (
                    <TableCell key={m} className="text-right font-mono text-xs">
                      <span className="block text-muted-foreground">{fmtMoney(grand.b[i])}</span>
                      <span className={varianceClass(grand.b[i], grand.a[i])}>{fmtMoney(grand.a[i])}</span>
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-mono text-xs">{fmtMoney(sum(grand.b))}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{fmtMoney(sum(grand.a))}</TableCell>
                  <TableCell className={`text-right font-mono text-xs ${varianceClass(sum(grand.b), sum(grand.a))}`}>
                    {fmtMoney(sum(grand.b) - sum(grand.a))}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ExpenseJournalDrillSheet target={drill} onOpenChange={(v) => !v && setDrill(null)} />
    </div>
  );
}
