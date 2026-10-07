import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Scale, AlertTriangle, CheckCircle2, FileSpreadsheet } from "lucide-react";
import { formatMoneyCode } from "@/lib/money";
import { exportCSV } from "@/lib/export-utils";
import {
  normalizeReconciliation,
  jobIsReconciled,
  projectIsReconciled,
  reconciliationIssues,
} from "@/lib/wage-reconciliation";

export default function HRMWageReconciliation() {
  const [weekId, setWeekId] = useState<string>("");

  const { data: weeks = [] } = useQuery({
    queryKey: ["wage-recon-weeks"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("attendance_weeks")
        .select("id, week_start, week_end, status")
        .order("week_start", { ascending: false })
        .limit(52);
      if (error) throw error;
      return data ?? [];
    },
  });

  const activeWeek = weekId || weeks[0]?.id || "";

  const { data: recon, isLoading } = useQuery({
    queryKey: ["wage-recon", activeWeek],
    enabled: !!activeWeek,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("reconcile_attendance_week", { _week_id: activeWeek });
      if (error) throw error;
      return normalizeReconciliation(data);
    },
  });

  const { data: lines = [] } = useQuery({
    queryKey: ["wage-recon-lines", activeWeek],
    enabled: !!activeWeek,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("attendance_lines")
        .select("*, employee:employees(name), job:container_conversions(conversion_number), project:projects(name)")
        .eq("week_id", activeWeek)
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const currency = recon?.week.currency;
  const issues = recon ? reconciliationIssues(recon) : [];

  const byEmployee = useMemo(() => {
    const map = new Map<string, { name: string; rows: any[]; total: number }>();
    for (const l of lines as any[]) {
      const key = l.employee_id;
      if (!map.has(key)) map.set(key, { name: l.employee?.name ?? "Employee", rows: [], total: 0 });
      const g = map.get(key)!;
      g.rows.push(l);
      g.total += Number(l.amount ?? 0);
    }
    return [...map.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [lines]);

  function exportBreakdown() {
    if (!recon) return;
    exportCSV(
      `wage-reconciliation-${recon.week.week_start}.csv`,
      ["Type", "Reference", "Project", "Attendance", "Job labour", "Cost entries", "COGS posted", "Variance"],
      [
        ...recon.jobs.map((j) => [
          "job",
          j.job_number ?? j.conversion_id,
          j.project_name ?? "",
          j.attendance_amount.toFixed(2),
          j.job_labour_amount.toFixed(2),
          j.cost_entry_amount.toFixed(2),
          "",
          j.variance.toFixed(2),
        ]),
        ...recon.projects.map((p) => [
          "project",
          p.project_name,
          p.project_name,
          p.labour_amount.toFixed(2),
          "",
          "",
          p.cogs_posted.toFixed(2),
          p.variance.toFixed(2),
        ]),
        ...recon.accounts.map((a) => [
          "account",
          `${a.account_type} / ${a.category ?? ""}`,
          "",
          "",
          "",
          "",
          `${a.debit.toFixed(2)} DR / ${a.credit.toFixed(2)} CR`,
          "",
        ]),
      ]
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Scale className="h-6 w-6" />Wage Reconciliation</h1>
          <p className="text-muted-foreground">Payroll labour rows against the job, project COGS and ledger postings for an approved week.</p>
        </div>
        <Button variant="outline" onClick={exportBreakdown} disabled={!recon}><FileSpreadsheet className="mr-1 h-4 w-4" />Export CSV</Button>
      </div>

      <Card><CardContent className="p-4 flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label>Week</Label>
          <Select value={activeWeek} onValueChange={setWeekId}>
            <SelectTrigger className="w-[300px]"><SelectValue placeholder="Pick a week…" /></SelectTrigger>
            <SelectContent>
              {weeks.map((w: any) => (
                <SelectItem key={w.id} value={w.id}>{w.week_start} → {w.week_end} ({w.status})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent></Card>

      {isLoading && <p className="text-muted-foreground text-sm">Loading reconciliation…</p>}

      {recon && (
        <>
          <Card className={issues.length ? "border-destructive/50" : "border-success/40"}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                {issues.length ? <AlertTriangle className="h-4 w-4 text-destructive" /> : <CheckCircle2 className="h-4 w-4 text-success" />}
                {issues.length ? "Attention needed" : "Fully reconciled"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {issues.length > 0 && (
                <ul className="text-sm text-destructive list-disc pl-5">{issues.map((i) => <li key={i}>{i}</li>)}</ul>
              )}
              <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-sm">
                {[
                  ["Base", recon.totals.base],
                  ["Overtime", recon.totals.overtime],
                  ["Allowances", recon.totals.allowance],
                  ["Gross", recon.totals.gross],
                  ["Deductions", recon.totals.deductions],
                  ["Net", recon.totals.net],
                ].map(([label, value]) => (
                  <div key={label as string}>
                    <div className="text-muted-foreground text-xs">{label as string}</div>
                    <div className="font-mono font-medium">{formatMoneyCode(Number(value), currency)}</div>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 items-center text-xs">
                <Badge variant="outline">{recon.totals.line_count} entries</Badge>
                {recon.totals.correction_count > 0 && <Badge variant="secondary">{recon.totals.correction_count} correction rows</Badge>}
                <Badge variant={recon.ledger.balanced ? "secondary" : "destructive"} className={recon.ledger.balanced ? "bg-success/15 text-success" : ""}>
                  {recon.ledger.balanced
                    ? `Balanced — ${formatMoneyCode(recon.ledger.debit, currency)} DR / CR`
                    : `Out by ${formatMoneyCode(recon.ledger.difference, currency)}`}
                </Badge>
                <Badge variant="outline" className="capitalize">{recon.week.status}</Badge>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">By conversion job</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Job</TableHead><TableHead>Project</TableHead>
                  <TableHead className="text-right">Attendance</TableHead>
                  <TableHead className="text-right">Job labour</TableHead>
                  <TableHead className="text-right">Cost entries</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {recon.jobs.map((j) => {
                    const ok = jobIsReconciled(j, currency);
                    return (
                      <TableRow key={j.conversion_id} className={ok ? "" : "bg-destructive/5"}>
                        <TableCell className="font-mono text-xs">
                          <Link to={`/conversions/${j.conversion_id}`} className="hover:underline">{j.job_number ?? j.conversion_id.slice(0, 8)}</Link>
                        </TableCell>
                        <TableCell>{j.project_id ? <Link to={`/finance/projects/${j.project_id}`} className="hover:underline">{j.project_name}</Link> : <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="text-right font-mono">{formatMoneyCode(j.attendance_amount, currency)}</TableCell>
                        <TableCell className="text-right font-mono">{formatMoneyCode(j.job_labour_amount, currency)}</TableCell>
                        <TableCell className="text-right font-mono">{formatMoneyCode(j.cost_entry_amount, currency)}</TableCell>
                        <TableCell className={`text-right font-mono ${ok ? "text-muted-foreground" : "text-destructive font-semibold"}`}>{j.variance.toFixed(2)}</TableCell>
                      </TableRow>
                    );
                  })}
                  {!recon.jobs.length && <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">No job-assigned wages this week.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Project COGS</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead className="text-right">Labour</TableHead>
                    <TableHead className="text-right">Allowances</TableHead>
                    <TableHead className="text-right">Posted COGS</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {recon.projects.map((p) => {
                      const ok = projectIsReconciled(p, currency);
                      return (
                        <TableRow key={p.project_id ?? "none"} className={ok ? "" : "bg-destructive/5"}>
                          <TableCell>{p.project_id ? <Link to={`/finance/projects/${p.project_id}`} className="hover:underline">{p.project_name}</Link> : p.project_name}</TableCell>
                          <TableCell className="text-right font-mono">{formatMoneyCode(p.labour_amount, currency)}</TableCell>
                          <TableCell className="text-right font-mono">{formatMoneyCode(p.allowance_amount, currency)}</TableCell>
                          <TableCell className={`text-right font-mono ${ok ? "" : "text-destructive font-semibold"}`}>{formatMoneyCode(p.cogs_posted, currency)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Ledger postings</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Account</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {recon.accounts.map((a) => (
                      <TableRow key={`${a.account_type}-${a.category}`}>
                        <TableCell className="text-sm">
                          <span className="capitalize">{a.account_type.replace(/_/g, " ")}</span>
                          <span className="text-muted-foreground"> · {(a.category ?? "").replace(/_/g, " ")}</span>
                        </TableCell>
                        <TableCell className="text-right font-mono">{a.debit ? formatMoneyCode(a.debit, currency) : ""}</TableCell>
                        <TableCell className="text-right font-mono">{a.credit ? formatMoneyCode(a.credit, currency) : ""}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-semibold">
                      <TableCell><Link to="/finance/ledger" className="hover:underline">Total</Link></TableCell>
                      <TableCell className="text-right font-mono">{formatMoneyCode(recon.ledger.debit, currency)}</TableCell>
                      <TableCell className="text-right font-mono">{formatMoneyCode(recon.ledger.credit, currency)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Attendance entries by employee</CardTitle></CardHeader>
            <CardContent>
              <Accordion type="multiple">
                {byEmployee.map(([id, g]) => (
                  <AccordionItem key={id} value={id}>
                    <AccordionTrigger>
                      <span className="flex-1 text-left">{g.name}</span>
                      <span className="font-mono mr-2">{formatMoneyCode(g.total, currency)}</span>
                    </AccordionTrigger>
                    <AccordionContent>
                      <Table>
                        <TableHeader><TableRow>
                          <TableHead>Job</TableHead><TableHead>Project</TableHead>
                          <TableHead className="text-right">Hours</TableHead>
                          <TableHead className="text-right">OT</TableHead>
                          <TableHead className="text-right">Allowance</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead>Note</TableHead>
                        </TableRow></TableHeader>
                        <TableBody>
                          {g.rows.map((l: any) => (
                            <TableRow key={l.id} className={Number(l.amount) < 0 ? "text-destructive" : ""}>
                              <TableCell className="font-mono text-xs">{l.job?.conversion_number ?? "—"}</TableCell>
                              <TableCell className="text-xs">{l.project?.name ?? "—"}</TableCell>
                              <TableCell className="text-right font-mono">{Number(l.hours ?? 0)}</TableCell>
                              <TableCell className="text-right font-mono">{Number(l.overtime_hours ?? 0)}</TableCell>
                              <TableCell className="text-right font-mono">{formatMoneyCode(Number(l.allowance ?? 0), currency)}</TableCell>
                              <TableCell className="text-right font-mono">{formatMoneyCode(Number(l.amount ?? 0), currency)}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {l.reverses_line_id ? "Reversal" : l.is_correction ? "Correction" : ""}
                                {l.correction_reason ? ` — ${l.correction_reason}` : ""}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
              {!byEmployee.length && <p className="text-sm text-muted-foreground py-4 text-center">No attendance entries for this week.</p>}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
